-- ============================================================================
-- ReqPub v2.50 - SIGNED WEBHOOKS. Run once in the Supabase SQL editor, after
-- fix-attachment-hash.sql. Idempotent; safe to run twice.
--
-- Inert until an endpoint exists: with zero rows in webhook_endpoints,
-- nothing is enqueued, nothing is sent, and every existing flow returns
-- exactly what it returned before, plus an empty pendingDeliveries list on
-- the two sign functions.
--
-- Dispatch mode LIVE in this release: lazy plus manual. U1 (pg_net) is not
-- consumed; no database-initiated HTTP exists. The signer page pings
-- deliver-webhooks with the delivery ids the sign functions return, the app
-- pings after the seal flows it initiates, and the manager panel lists
-- pending and dead deliveries with Redeliver and Deliver pending. If pg_net
-- is confirmed later, trigger-fired dispatch can ride the same rows.
--
-- Retry ladder, applied by webhook_delivery_result: 1m, 5m, 30m, 2h, 12h,
-- then dead. Delivery is at-least-once; receivers dedupe on deliveryId.
--
-- The payload never contains a sign token, an email address, or snapshot
-- content. Endpoint URLs are manager-visible only; the audit line records
-- the host, not the full URL, so a credentialed query string never reaches
-- the org-visible activity trail.
--
-- This file also replaces sign_request_sign and sign_request_decline with
-- their final v2.50 bodies (the v2.49 evidence merge is preserved inside).
-- ============================================================================

-- PRECHECK: name anything missing before creating anything.
do $$
declare missing text := '';
begin
  if to_regclass('public.sign_requests') is null then missing := missing || ' sign_requests'; end if;
  if to_regclass('public.acceptance_receipts') is null then missing := missing || ' acceptance_receipts'; end if;
  if to_regclass('public.chain_events') is null then missing := missing || ' chain_events'; end if;
  if to_regclass('public.projects') is null then missing := missing || ' projects'; end if;
  if to_regprocedure('public.project_org(text)') is null then missing := missing || ' project_org(text)'; end if;
  if to_regprocedure('public.is_project_manager(text)') is null then missing := missing || ' is_project_manager(text)'; end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,text,text,jsonb)') is null then missing := missing || ' log_activity'; end if;
  if missing <> '' then
    raise exception 'fix-webhooks.sql prerequisites missing:%', missing;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Tables. Direct DML revoked; every write goes through a definer RPC below.
-- ----------------------------------------------------------------------------
create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  url text not null,                             -- https only, enforced at create and again at delivery
  description text not null default '',
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists whe_proj on webhook_endpoints(project_id) where active;

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  attempt int not null default 0,
  status_code int,
  response_snippet text not null default '',
  state text not null default 'pending'
    check (state in ('pending','delivered','failed','dead')),
  next_retry_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists whd_ep on webhook_deliveries(endpoint_id, created_at desc);
create index if not exists whd_due on webhook_deliveries(state, next_retry_at) where state in ('pending','failed');

alter table webhook_endpoints enable row level security;
alter table webhook_deliveries enable row level security;
drop policy if exists whe_select on webhook_endpoints;
create policy whe_select on webhook_endpoints
  for select using (is_project_manager(project_id));
drop policy if exists whd_select on webhook_deliveries;
create policy whd_select on webhook_deliveries
  for select using (exists (
    select 1 from webhook_endpoints e
     where e.id = endpoint_id and is_project_manager(e.project_id)));
revoke insert, update, delete on webhook_endpoints from authenticated, anon;
revoke insert, update, delete on webhook_deliveries from authenticated, anon;
grant select on webhook_endpoints to authenticated;
grant select on webhook_deliveries to authenticated;

-- ----------------------------------------------------------------------------
-- Enqueue. Builds the payload contract and one pending row per active
-- endpoint. Called only from the triggers below; no grant.
-- Payload: event, deliveryId, occurredAt, projectId, versionLabel, seq,
-- signRequestId, receiptId where applicable, docFingerprint, chainHead
-- {seq, linkHash}, signerName, signerRole. Never a token, never an email,
-- never snapshot content.
-- ----------------------------------------------------------------------------
create or replace function webhook_enqueue(p_event text, p_sr sign_requests, p_receipt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ver versions%rowtype; v_head record; v_base jsonb; v_ep record; v_id uuid;
begin
  select * into v_ver from versions where id = p_sr.version_id;
  select seq, link_hash into v_head
    from chain_events where project_id = p_sr.project_id
    order by seq desc limit 1;
  v_base := jsonb_build_object(
    'event', p_event,
    'occurredAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'projectId', p_sr.project_id,
    'versionLabel', coalesce(v_ver.label, ''),
    'seq', v_ver.seq,
    'signRequestId', p_sr.id::text,
    'docFingerprint', coalesce(p_sr.doc_fingerprint, ''),
    'chainHead', case when v_head is null then null
                 else jsonb_build_object('seq', v_head.seq, 'linkHash', v_head.link_hash) end,
    'signerName', coalesce(p_sr.signed_name, ''),
    'signerRole', coalesce(p_sr.signer_role, ''));
  if p_receipt is not null then
    v_base := v_base || jsonb_build_object('receiptId', p_receipt::text);
  end if;
  for v_ep in select id from webhook_endpoints
      where project_id = p_sr.project_id and active loop
    v_id := gen_random_uuid();
    insert into webhook_deliveries(id, endpoint_id, event_type, payload)
    values (v_id, v_ep.id, p_event, v_base || jsonb_build_object('deliveryId', v_id::text));
  end loop;
end; $$;
revoke execute on function webhook_enqueue(text, sign_requests, uuid) from public;

-- ----------------------------------------------------------------------------
-- Triggers. Wrapped non-blocking like every other trigger side effect: a
-- webhook problem must never break a signature or a seal.
-- ----------------------------------------------------------------------------
create or replace function webhook_on_sign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform webhook_enqueue(
      case new.status when 'signed' then 'sign.signed' else 'sign.declined' end,
      new, null);
  exception when others then null;  -- enqueue must never block the signature
  end;
  return new;
end; $$;
drop trigger if exists trg_webhook_sign on sign_requests;
create trigger trg_webhook_sign
  after update on sign_requests
  for each row
  when (old.status = 'pending' and new.status in ('signed','declined'))
  execute function webhook_on_sign();

create or replace function webhook_on_seal()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sr sign_requests%rowtype; v_event text;
begin
  begin
    select * into v_sr from sign_requests where id = new.sign_request_id;
    if v_sr.id is not null then
      if tg_op = 'INSERT' then v_event := 'seal.issued'; else v_event := 'seal.timestamped'; end if;
      perform webhook_enqueue(v_event, v_sr, new.id);
    end if;
  exception when others then null;  -- enqueue must never block the seal
  end;
  return new;
end; $$;
drop trigger if exists trg_webhook_seal_issued on acceptance_receipts;
create trigger trg_webhook_seal_issued
  after insert on acceptance_receipts
  for each row execute function webhook_on_seal();
drop trigger if exists trg_webhook_seal_timestamped on acceptance_receipts;
create trigger trg_webhook_seal_timestamped
  after update on acceptance_receipts
  for each row
  when (old.tsa_status = 'pending' and new.tsa_status in ('single','dual'))
  execute function webhook_on_seal();

-- ----------------------------------------------------------------------------
-- Manager RPCs: create, toggle, list, redeliver, due. Every config change is
-- written via log_activity('webhook.endpoint_changed') and therefore chained.
-- ----------------------------------------------------------------------------
create or replace function webhook_host(p_url text)
returns text language sql immutable as $$
  select coalesce(substring(p_url from '^https://([^/?#]+)'), '');
$$;
revoke execute on function webhook_host(text) from public;
grant execute on function webhook_host(text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function webhook_host(text) to service_role';
  end if;
end $$;

create or replace function endpoint_create(p_project text, p_url text, p_description text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_host text;
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  if p_url !~ '^https://[^[:space:]]+$' or length(p_url) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'https_required'); end if;
  v_host := webhook_host(p_url);
  if v_host = '' then return jsonb_build_object('ok', false, 'error', 'https_required'); end if;
  insert into webhook_endpoints(org_id, project_id, url, description, created_by)
  values (v_org, p_project, p_url, left(coalesce(p_description, ''), 300), auth.uid())
  returning id into v_id;
  perform log_activity(v_org, p_project, 'webhook.endpoint_changed', 'webhook',
    v_id::text, 'Webhook endpoint added: ' || v_host,
    jsonb_build_object('host', v_host, 'change', 'added'));
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function endpoint_create(text, text, text) from public;
grant execute on function endpoint_create(text, text, text) to authenticated;

create or replace function endpoint_set_active(p_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e webhook_endpoints%rowtype;
begin
  select * into e from webhook_endpoints where id = p_id;
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_project_manager(e.project_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if e.active = p_active then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  update webhook_endpoints set active = p_active where id = p_id;
  perform log_activity(e.org_id, e.project_id, 'webhook.endpoint_changed', 'webhook',
    e.id::text,
    'Webhook endpoint ' || case when p_active then 'activated' else 'deactivated' end
      || ': ' || webhook_host(e.url),
    jsonb_build_object('host', webhook_host(e.url),
      'change', case when p_active then 'activated' else 'deactivated' end));
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function endpoint_set_active(uuid, boolean) from public;
grant execute on function endpoint_set_active(uuid, boolean) to authenticated;

create or replace function deliveries_list(p_project text, p_limit int default 50)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'endpoint_id', x.endpoint_id, 'url', x.url,
      'event_type', x.event_type, 'state', x.state, 'attempt', x.attempt,
      'status_code', x.status_code, 'response_snippet', x.response_snippet,
      'next_retry_at', x.next_retry_at, 'created_at', x.created_at)
      order by x.created_at desc)
    from (select dd.id, dd.endpoint_id, ee.url, dd.event_type, dd.state,
                 dd.attempt, dd.status_code, dd.response_snippet,
                 dd.next_retry_at, dd.created_at
            from webhook_deliveries dd
            join webhook_endpoints ee on ee.id = dd.endpoint_id
           where ee.project_id = p_project
           order by dd.created_at desc
           limit greatest(1, least(coalesce(p_limit, 50), 200))) x), '[]'::jsonb));
end; $$;
revoke execute on function deliveries_list(text, int) from public;
grant execute on function deliveries_list(text, int) to authenticated;

create or replace function delivery_redeliver(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d webhook_deliveries%rowtype; v_proj text;
begin
  select dd.* into d from webhook_deliveries dd where dd.id = p_id;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select project_id into v_proj from webhook_endpoints where id = d.endpoint_id;
  if not is_project_manager(v_proj) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if d.state not in ('failed', 'dead') then
    return jsonb_build_object('ok', false, 'error', 'not_redeliverable'); end if;
  update webhook_deliveries set state = 'pending', next_retry_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end; $$;
revoke execute on function delivery_redeliver(uuid) from public;
grant execute on function delivery_redeliver(uuid) to authenticated;

create or replace function deliveries_due(p_project text, p_limit int default 20)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'ids', coalesce((
    select jsonb_agg(d.id order by d.created_at)
    from (select dd.id, dd.created_at
            from webhook_deliveries dd
            join webhook_endpoints ee on ee.id = dd.endpoint_id
           where ee.project_id = p_project and ee.active
             and dd.state in ('pending', 'failed')
             and coalesce(dd.next_retry_at, now()) <= now()
           order by dd.created_at
           limit greatest(1, least(coalesce(p_limit, 20), 50))) d), '[]'::jsonb));
end; $$;
revoke execute on function deliveries_due(text, int) from public;
grant execute on function deliveries_due(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Delivery engine RPCs, service role only: deliver-webhooks takes one due
-- delivery, attempts it, and records the result. The ladder lives here so
-- every writer walks the same schedule.
-- ----------------------------------------------------------------------------
create or replace function webhook_delivery_take(p_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare d webhook_deliveries%rowtype; e webhook_endpoints%rowtype;
begin
  select * into d from webhook_deliveries where id = p_id;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into e from webhook_endpoints where id = d.endpoint_id;
  if not e.active then return jsonb_build_object('ok', false, 'error', 'endpoint_inactive'); end if;
  if d.state not in ('pending', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'not_due', 'state', d.state); end if;
  if d.next_retry_at is not null and d.next_retry_at > now() then
    return jsonb_build_object('ok', false, 'error', 'not_due', 'state', d.state); end if;
  return jsonb_build_object('ok', true, 'url', e.url, 'event_type', d.event_type,
    'attempt', d.attempt, 'payload', d.payload);
end; $$;
revoke execute on function webhook_delivery_take(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function webhook_delivery_take(uuid) to service_role';
  end if;
end $$;

create or replace function webhook_delivery_result(p_id uuid, p_ok boolean, p_status int, p_snippet text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d webhook_deliveries%rowtype; v_attempt int; v_state text; v_next timestamptz;
        v_ladder int[] := array[60, 300, 1800, 7200, 43200];  -- 1m 5m 30m 2h 12h
begin
  select * into d from webhook_deliveries where id = p_id for update;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if d.state in ('delivered', 'dead') then
    return jsonb_build_object('ok', true, 'state', d.state, 'unchanged', true); end if;
  v_attempt := d.attempt + 1;
  if p_ok then
    v_state := 'delivered'; v_next := null;
  elsif v_attempt >= 6 then
    v_state := 'dead'; v_next := null;
  else
    v_state := 'failed'; v_next := now() + make_interval(secs => v_ladder[v_attempt]);
  end if;
  update webhook_deliveries
     set attempt = v_attempt, state = v_state, next_retry_at = v_next,
         status_code = p_status, response_snippet = left(coalesce(p_snippet, ''), 200)
   where id = p_id;
  return jsonb_build_object('ok', true, 'state', v_state, 'attempt', v_attempt,
    'next_retry_at', v_next);
end; $$;
revoke execute on function webhook_delivery_result(uuid, boolean, int, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function webhook_delivery_result(uuid, boolean, int, text) to service_role';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Final v2.50 bodies of the two sign functions: unchanged flows, plus a
-- pendingDeliveries id list so the signer page can ping deliver-webhooks.
-- The ids are unguessable capability handles for deliveries this signer's
-- own action created; the list is empty whenever no endpoint is configured.
-- The v2.49 evidence merge is preserved verbatim.
-- ----------------------------------------------------------------------------
create or replace function sign_request_sign(p_token text, p_typed_name text, p_ua text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r sign_requests%rowtype; v_ver versions%rowtype; v_appr uuid; v_deliv jsonb;
begin
  select * into r from sign_requests where token = p_token and revoked = false;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_link'); end if;
  if r.status = 'signed' then
    return jsonb_build_object('ok', true, 'already', true, 'signedAt', r.signed_at, 'signedName', r.signed_name);
  end if;
  if r.status = 'declined' then return jsonb_build_object('ok', false, 'error', 'declined'); end if;
  if coalesce(trim(p_typed_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  select * into v_ver from versions where id = r.version_id;
  -- The signature manifests as a normal approval row. The provenance trigger
  -- forces the insert to pending and stamps decided_at on the decision;
  -- decided_by stays null for an accountless signer - attribution lives here,
  -- in the signature record (typed name, email channel, token, timestamps).
  insert into version_approvals(version_id, approver_role, approver_name)
  values (r.version_id, coalesce(nullif(trim(r.signer_role), ''), 'Signer'), trim(p_typed_name))
  returning id into v_appr;
  update version_approvals
     set status = 'approved', comment = 'Signed electronically', sign_request_id = r.id
   where id = v_appr;
  update sign_requests
     set status = 'signed', signed_name = trim(p_typed_name), signed_at = now(), approval_id = v_appr,
         evidence = coalesce(evidence, '{}'::jsonb)
           || jsonb_build_object('ua', left(coalesce(p_ua, ''), 400), 'channel', 'email_token')
   where id = r.id;
  perform log_activity(r.org_id, r.project_id, 'sign.signed',
    'sign', r.id::text, 'v' || v_ver.label || ' signed by ' || trim(p_typed_name) || ' (' || r.signer_email || ')', '{}'::jsonb);
  select coalesce(jsonb_agg(d.id), '[]'::jsonb) into v_deliv
    from webhook_deliveries d
   where d.event_type = 'sign.signed' and d.state = 'pending' and d.attempt = 0
     and d.payload->>'signRequestId' = r.id::text;
  return jsonb_build_object('ok', true, 'signedAt', now(), 'approvalId', v_appr,
    'pendingDeliveries', v_deliv);
end; $$;
grant execute on function sign_request_sign(text, text, text) to anon, authenticated;

create or replace function sign_request_decline(p_token text, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r sign_requests%rowtype; v_ver versions%rowtype; v_deliv jsonb;
begin
  select * into r from sign_requests where token = p_token and revoked = false;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_link'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'already_decided'); end if;
  select * into v_ver from versions where id = r.version_id;
  update sign_requests
     set status = 'declined', decline_reason = left(coalesce(p_reason, ''), 2000)
   where id = r.id;
  perform log_activity(r.org_id, r.project_id, 'sign.declined',
    'sign', r.id::text, 'v' || v_ver.label || ' declined by ' || r.signer_email, '{}'::jsonb);
  select coalesce(jsonb_agg(d.id), '[]'::jsonb) into v_deliv
    from webhook_deliveries d
   where d.event_type = 'sign.declined' and d.state = 'pending' and d.attempt = 0
     and d.payload->>'signRequestId' = r.id::text;
  return jsonb_build_object('ok', true, 'pendingDeliveries', v_deliv);
end; $$;
grant execute on function sign_request_decline(text, text) to anon, authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0023', 'webhooks', '7150a8afe6c4bb2a6ecff626cf0ca0101b8130960e9cc6c3bbbdb6608c570bcf')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
