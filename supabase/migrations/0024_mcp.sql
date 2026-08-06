-- ============================================================================
-- ReqPub v2.51 - THE MCP SERVER. Run once in the Supabase SQL editor, after
-- fix-webhooks.sql. Idempotent; safe to run twice.
--
-- A read surface for the record and a door into the inbox, never a hand on
-- the pen. Agents propose; humans accept. Inert until a key exists: with
-- zero rows in mcp_api_keys, nothing is reachable and every prior flow
-- behaves byte for byte as v2.50.1.
--
-- Auth: Authorization: Bearer rqp_live_<32 base62>. The key renders once at
-- issuance and is never stored; only its sha256 lands in mcp_api_keys.
-- Every call is admitted through mcp_gate: an advisory-lock, windowed-count
-- limiter at 60 admitted calls per key per minute (the same anonymous-
-- throttle pattern the share submit uses), and every admission, refusal,
-- denial, and error appends one row to mcp_audit_log, which is insert-only
-- under the same guard-trigger posture as the chain.
--
-- The write tool, reqpub_propose, is doubly gated: key.propose_enabled AND
-- the project's authored control field ctrl_mcp_propose = 'on', both
-- default off. A proposal is an ordinary comm with origin 'agent' (U1: the
-- origin check constraint is dropped and re-added with 'agent'), attributed
-- to the key's label, status new, promoted or closed by a human through the
-- existing machinery. No tool touches project_fields, field_rows, versions,
-- version_approvals, sign_requests, receipts, webhooks, or keys.
--
-- Recorded adaptation (fail-closed rule 11): key issuance and revocation
-- are org-scoped, and org-level activity is outside the per-project chain
-- by the frozen v2.47 design. They are logged via log_activity at org
-- level; proposals, being project-scoped, are chained. Stated again in
-- RELEASE_REPORT_v2.51.md.
-- ============================================================================

-- PRECHECK: name anything missing before creating anything.
do $$
declare missing text := '';
begin
  if to_regclass('public.comms') is null then missing := missing || ' comms'; end if;
  if to_regclass('public.projects') is null then missing := missing || ' projects'; end if;
  if to_regclass('public.versions') is null then missing := missing || ' versions'; end if;
  if to_regclass('public.sign_requests') is null then missing := missing || ' sign_requests'; end if;
  if to_regclass('public.acceptance_receipts') is null then missing := missing || ' acceptance_receipts'; end if;
  if to_regclass('public.project_fields') is null then missing := missing || ' project_fields'; end if;
  if to_regprocedure('public.verify_project_chain(text)') is null then missing := missing || ' verify_project_chain(text)'; end if;
  if to_regprocedure('public.is_org_manager(uuid)') is null then missing := missing || ' is_org_manager(uuid)'; end if;
  if to_regprocedure('public.project_org(text)') is null then missing := missing || ' project_org(text)'; end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,text,text,jsonb)') is null then missing := missing || ' log_activity'; end if;
  if missing <> '' then
    raise exception 'fix-mcp.sql prerequisites missing:%', missing;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- U1: extend comms.origin with 'agent' by drop and re-add, the established
-- pattern. Members still cannot insert 'agent' directly; the insert policy
-- is untouched and the agent path is a definer RPC.
-- ----------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.comms'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%origin%'
  loop
    execute format('alter table comms drop constraint %I', c.conname);
  end loop;
  alter table comms add constraint comms_origin_check
    check (origin in ('app','brief','sme','partner','team','meeting','update','agent'));
end $$;

-- ----------------------------------------------------------------------------
-- Tables. Direct DML revoked; every write goes through a definer RPC.
-- ----------------------------------------------------------------------------
create table if not exists mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key_hash text not null unique,             -- sha256 hex of the full presented key
  label text not null,
  project_ids text[],                        -- null means every project the org grants
  propose_enabled boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists mak_org on mcp_api_keys(org_id, created_at desc);

create table if not exists mcp_audit_log (
  id bigint generated always as identity primary key,
  key_id uuid not null references mcp_api_keys(id) on delete cascade,
  tool text not null,
  params_hash text not null default '',
  status text not null,                      -- ok | denied | error | rate_limited
  at timestamptz not null default now()
);
create index if not exists mal_key_at on mcp_audit_log(key_id, at desc);

alter table mcp_api_keys enable row level security;
alter table mcp_audit_log enable row level security;
drop policy if exists mak_select on mcp_api_keys;
create policy mak_select on mcp_api_keys
  for select using (is_org_manager(org_id));
drop policy if exists mal_select on mcp_audit_log;
create policy mal_select on mcp_audit_log
  for select using (exists (
    select 1 from mcp_api_keys k where k.id = key_id and is_org_manager(k.org_id)));
revoke insert, update, delete on mcp_api_keys from authenticated, anon;
revoke insert, update, delete on mcp_audit_log from authenticated, anon;
grant select on mcp_api_keys to authenticated;
grant select on mcp_audit_log to authenticated;

-- Append-only guard: the audit trail cannot be rewritten, even by the owner.
create or replace function mcp_audit_guard()
returns trigger language plpgsql as $$
begin
  raise exception 'mcp_audit_log is append-only';
end; $$;
drop trigger if exists mcp_audit_no_rewrite on mcp_audit_log;
create trigger mcp_audit_no_rewrite
  before update or delete on mcp_audit_log
  for each row execute function mcp_audit_guard();

-- ----------------------------------------------------------------------------
-- Manager RPCs: issue, revoke, list. The key material exists only in the
-- issue response; the audit line carries the label, never the key.
-- ----------------------------------------------------------------------------
create or replace function mcp_key_issue(p_org uuid, p_label text, p_propose boolean default false, p_project_ids text[] default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        v_secret text := ''; v_byte int; v_key text; v_id uuid; v_bad int;
begin
  if not is_org_manager(p_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(trim(p_label), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'label_required'); end if;
  if p_project_ids is not null then
    select count(*) into v_bad from unnest(p_project_ids) s(pid)
     where not exists (select 1 from projects p where p.id = s.pid and p.org_id = p_org);
    if v_bad > 0 then return jsonb_build_object('ok', false, 'error', 'unknown_project_in_scope'); end if;
  end if;
  -- 32 base62 characters, rejection-sampled so no character is favored.
  while length(v_secret) < 32 loop
    v_byte := get_byte(gen_random_bytes(1), 0);
    if v_byte < 248 then
      v_secret := v_secret || substr(v_alphabet, 1 + (v_byte % 62), 1);
    end if;
  end loop;
  v_key := 'rqp_live_' || v_secret;
  insert into mcp_api_keys(org_id, key_hash, label, project_ids, propose_enabled, created_by)
  values (p_org, encode(digest(v_key, 'sha256'), 'hex'), left(trim(p_label), 120),
          p_project_ids, coalesce(p_propose, false), auth.uid())
  returning id into v_id;
  perform log_activity(p_org, null, 'mcp.key_issued', 'mcp_key', v_id::text,
    'MCP key issued: ' || left(trim(p_label), 120),
    jsonb_build_object('label', left(trim(p_label), 120),
      'propose', coalesce(p_propose, false),
      'scope', case when p_project_ids is null then 'all' else cardinality(p_project_ids)::text end));
  return jsonb_build_object('ok', true, 'id', v_id, 'key', v_key);
end; $$;
revoke execute on function mcp_key_issue(uuid, text, boolean, text[]) from public;
grant execute on function mcp_key_issue(uuid, text, boolean, text[]) to authenticated;

create or replace function mcp_key_revoke(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k mcp_api_keys%rowtype;
begin
  select * into k from mcp_api_keys where id = p_id;
  if k.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_org_manager(k.org_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if k.revoked_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  update mcp_api_keys set revoked_at = now() where id = p_id;
  perform log_activity(k.org_id, null, 'mcp.key_revoked', 'mcp_key', k.id::text,
    'MCP key revoked: ' || k.label, jsonb_build_object('label', k.label));
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function mcp_key_revoke(uuid) from public;
grant execute on function mcp_key_revoke(uuid) to authenticated;

create or replace function mcp_keys_list(p_org uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not is_org_manager(p_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k.id, 'label', k.label,
      'scope', case when k.project_ids is null then 'all' else cardinality(k.project_ids)::text end,
      'propose_enabled', k.propose_enabled, 'created_at', k.created_at,
      'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at)
      order by k.created_at desc)
    from mcp_api_keys k where k.org_id = p_org), '[]'::jsonb));
end; $$;
revoke execute on function mcp_keys_list(uuid) from public;
grant execute on function mcp_keys_list(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Service-role RPCs: the mcp function's whole database surface. Reads only,
-- plus one gated comm insert. Scope is enforced here, on every call, so the
-- function cannot forget it.
-- ----------------------------------------------------------------------------
create or replace function mcp_auth(p_key_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k mcp_api_keys%rowtype;
begin
  select * into k from mcp_api_keys where key_hash = p_key_hash;
  if k.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_key'); end if;
  if k.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  update mcp_api_keys set last_used_at = now() where id = k.id;
  return jsonb_build_object('ok', true, 'keyId', k.id, 'orgId', k.org_id,
    'label', k.label, 'projectIds', to_jsonb(k.project_ids),
    'proposeEnabled', k.propose_enabled);
end; $$;
revoke execute on function mcp_auth(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_auth(text) to service_role';
  end if;
end $$;

-- Admission and rate limit in one atomic step, in the house throttle
-- pattern: a per-key advisory lock serializes count-then-insert, so
-- parallel calls cannot each read a below-limit count and all slip through.
-- Every admitted call appends status ok; every refusal appends
-- rate_limited; later denials and errors append their own row. The window
-- counts every row, so refusals and errors consume budget too, which is
-- stated in docs/MCP.md.
create or replace function mcp_gate(p_key uuid, p_tool text, p_params_hash text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('mcp/' || p_key::text, 7));
  if (select count(*) from mcp_audit_log a
       where a.key_id = p_key and a.at > now() - interval '1 minute') >= 60 then
    insert into mcp_audit_log(key_id, tool, params_hash, status)
    values (p_key, left(coalesce(p_tool, ''), 80), left(coalesce(p_params_hash, ''), 64), 'rate_limited');
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into mcp_audit_log(key_id, tool, params_hash, status)
  values (p_key, left(coalesce(p_tool, ''), 80), left(coalesce(p_params_hash, ''), 64), 'ok');
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function mcp_gate(uuid, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_gate(uuid, text, text) to service_role';
  end if;
end $$;

create or replace function mcp_audit_append(p_key uuid, p_tool text, p_params_hash text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into mcp_audit_log(key_id, tool, params_hash, status)
  values (p_key, left(coalesce(p_tool, ''), 80), left(coalesce(p_params_hash, ''), 64),
          left(coalesce(p_status, 'error'), 40));
end; $$;
revoke execute on function mcp_audit_append(uuid, text, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_audit_append(uuid, text, text, text) to service_role';
  end if;
end $$;

-- Scope helper: a project is visible to a key when it belongs to the key's
-- org and, when the key is scoped, appears in the scope list.
create or replace function mcp_in_scope(p_org uuid, p_scope text[], p_project text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
     where p.id = p_project and p.org_id = p_org
       and (p_scope is null or p.id = any(p_scope)));
$$;
revoke execute on function mcp_in_scope(uuid, text[], text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_in_scope(uuid, text[], text) to service_role';
  end if;
end $$;

create or replace function mcp_list_projects(p_org uuid, p_scope text[])
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'projects', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'createdAt', p.created_at,
      'latestBaselineLabel', v.label, 'latestBaselineStatus', v.status,
      'practice', coalesce((to_jsonb(p) ->> 'practice')::boolean, false))
      order by p.created_at)
    from projects p
    left join lateral (
      select label, status from versions vv
       where vv.project_id = p.id order by vv.seq desc limit 1) v on true
    where p.org_id = p_org
      and coalesce((to_jsonb(p) ->> 'archived')::boolean, false) = false
      and (p_scope is null or p.id = any(p_scope))), '[]'::jsonb));
end; $$;
revoke execute on function mcp_list_projects(uuid, text[]) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_list_projects(uuid, text[]) to service_role';
  end if;
end $$;

create or replace function mcp_get_baseline(p_org uuid, p_scope text[], p_project text, p_seq int default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v versions%rowtype;
begin
  if not mcp_in_scope(p_org, p_scope, p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  select * into v from versions
   where project_id = p_project and (p_seq is null or seq = p_seq)
   order by seq desc limit 1;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'no_baseline'); end if;
  return jsonb_build_object('ok', true, 'projectId', p_project,
    'label', v.label, 'seq', v.seq, 'status', v.status, 'note', coalesce(v.note, ''),
    'authorName', coalesce(v.author_name, ''), 'createdAt', v.created_at,
    'snapshot', v.snapshot,
    'practice', coalesce((select (to_jsonb(p) ->> 'practice')::boolean from projects p where p.id = p_project), false));
end; $$;
revoke execute on function mcp_get_baseline(uuid, text[], text, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_get_baseline(uuid, text[], text, int) to service_role';
  end if;
end $$;

create or replace function mcp_signature_status(p_org uuid, p_scope text[], p_project text, p_seq int default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v versions%rowtype;
begin
  if not mcp_in_scope(p_org, p_scope, p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  select * into v from versions
   where project_id = p_project and (p_seq is null or seq = p_seq)
   order by seq desc limit 1;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'no_baseline'); end if;
  return jsonb_build_object('ok', true, 'projectId', p_project,
    'label', v.label, 'seq', v.seq,
    'practice', coalesce((select (to_jsonb(p) ->> 'practice')::boolean from projects p where p.id = p_project), false),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'signerName', coalesce(nullif(s.signed_name, ''), s.signer_name),
        'signerRole', s.signer_role, 'status', s.status,
        'sentAt', s.sent_at, 'signedAt', s.signed_at,
        'receiptId', r.id)
        order by s.sent_at)
      from sign_requests s
      left join acceptance_receipts r on r.sign_request_id = s.id
      where s.version_id = v.id and s.revoked = false), '[]'::jsonb));
end; $$;
revoke execute on function mcp_signature_status(uuid, text[], text, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_signature_status(uuid, text[], text, int) to service_role';
  end if;
end $$;

create or replace function mcp_get_receipt(p_org uuid, p_scope text[], p_receipt uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare r acceptance_receipts%rowtype;
begin
  select * into r from acceptance_receipts where id = p_receipt;
  if r.id is null or not mcp_in_scope(p_org, p_scope, r.project_id) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  return jsonb_build_object('ok', true, 'receiptId', r.id,
    'receiptJson', r.receipt_json, 'signatureBase64', r.signature_base64,
    'keyId', r.key_id, 'tsaStatus', r.tsa_status,
    'practice', coalesce((select (to_jsonb(p) ->> 'practice')::boolean from projects p where p.id = r.project_id), false));
end; $$;
revoke execute on function mcp_get_receipt(uuid, text[], uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_get_receipt(uuid, text[], uuid) to service_role';
  end if;
end $$;

create or replace function mcp_verify_chain(p_org uuid, p_scope text[], p_project text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not mcp_in_scope(p_org, p_scope, p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  return verify_project_chain(p_project);
end; $$;
revoke execute on function mcp_verify_chain(uuid, text[], text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_verify_chain(uuid, text[], text) to service_role';
  end if;
end $$;

-- Whether tools/list should offer reqpub_propose: the key gate is on and at
-- least one in-scope project has authored the control on.
create or replace function mcp_propose_visible(p_org uuid, p_scope text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'visible', exists (
    select 1 from project_fields f
      join projects p on p.id = f.project_id
     where p.org_id = p_org
       and (p_scope is null or p.id = any(p_scope))
       and f.field_id = 'ctrl_mcp_propose'
       and f.value #>> '{}' = 'on'));
$$;
revoke execute on function mcp_propose_visible(uuid, text[]) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_propose_visible(uuid, text[]) to service_role';
  end if;
end $$;

-- The one write: a proposal onto the comms spine. Both gates re-checked
-- here, server side, against live rows; the function's copy of the flags is
-- never trusted for the write itself.
create or replace function mcp_propose(p_key uuid, p_project text, p_subject text, p_body text, p_target text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare k mcp_api_keys%rowtype; v_org uuid; v_gate text; v_id uuid; v_body text;
begin
  select * into k from mcp_api_keys where id = p_key;
  if k.id is null or k.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_key'); end if;
  if not k.propose_enabled then
    return jsonb_build_object('ok', false, 'error', 'propose_disabled'); end if;
  if not mcp_in_scope(k.org_id, k.project_ids, p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  select f.value #>> '{}' into v_gate from project_fields f
   where f.project_id = p_project and f.field_id = 'ctrl_mcp_propose';
  if coalesce(v_gate, 'off') <> 'on' then
    return jsonb_build_object('ok', false, 'error', 'propose_disabled'); end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_body), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'subject_and_body_required'); end if;
  v_org := project_org(p_project);
  v_body := case when coalesce(trim(p_target), '') <> ''
                 then 'Target: ' || left(trim(p_target), 40) || E'\n\n' else '' end
            || left(p_body, 20000);
  insert into comms(org_id, project_id, origin, author_name, title, body, fb_type, status)
  values (v_org, p_project, 'agent', left(k.label, 200), left(trim(p_subject), 500), v_body,
          'Proposal', 'new')
  returning id into v_id;
  perform log_activity(v_org, p_project, 'comm.agent', 'comm', v_id::text,
    'Agent proposal from ' || k.label || ': ' || left(trim(p_subject), 120),
    jsonb_build_object('label', k.label,
      'targetRef', left(coalesce(trim(p_target), ''), 40)));
  return jsonb_build_object('ok', true, 'commId', v_id,
    'message', 'Proposal recorded for human review. Agents propose; humans accept.');
end; $$;
revoke execute on function mcp_propose(uuid, text, text, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_propose(uuid, text, text, text, text) to service_role';
  end if;
end $$;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0024', 'mcp', 'a90f8c52f954ce2c2e859885e7b47635f03c70b42e824298c28f27096e013b9d')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
