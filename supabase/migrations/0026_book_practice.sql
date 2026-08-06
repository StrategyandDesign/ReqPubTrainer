-- ============================================================================
-- ReqPub v2.55 - THE BOOK, THE INVOICE PACKET, AND PRACTICE MODE.
-- Run once in the Supabase SQL editor, after fix-evidence.sql. Idempotent;
-- safe to run twice. One new column with a guard trigger, four function
-- bodies, two of them house replacements of existing functions
-- (webhook_enqueue, sign_request_context, get_share), each pinned by test.
--
-- Practice mode: a rehearsal must never become evidence and evidence must
-- never become rehearsal. practice is settable only at creation and
-- immutable afterward, enforced by trigger in both directions. A practice
-- project produces zero webhook deliveries, is refused by evidence_gather
-- (shipped v2.52, already live), is excluded from the Book export, and
-- announces itself on every external surface through the two context
-- functions below.
--
-- The Book lists facts and never scores them. project_acceptance_facts is
-- one member-scoped batched call, no per-card queries; book_export returns
-- authored and cryptographic facts only, the evidence.csv columns plus
-- engagement_value where a manager authored one.
-- ============================================================================

do $$
declare missing text := '';
begin
  if to_regclass('public.projects') is null then missing := missing || ' projects'; end if;
  if to_regclass('public.sign_requests') is null then missing := missing || ' sign_requests'; end if;
  if to_regclass('public.acceptance_receipts') is null then missing := missing || ' acceptance_receipts'; end if;
  if to_regclass('public.chain_events') is null then missing := missing || ' chain_events'; end if;
  if to_regclass('public.project_fields') is null then missing := missing || ' project_fields'; end if;
  if to_regprocedure('public.webhook_enqueue(text, sign_requests, uuid)') is null then missing := missing || ' webhook_enqueue'; end if;
  if to_regprocedure('public.sign_request_context(text)') is null then missing := missing || ' sign_request_context'; end if;
  if to_regprocedure('public.get_share(text)') is null then missing := missing || ' get_share'; end if;
  if missing <> '' then raise exception 'fix-book-practice.sql prerequisites missing:%', missing; end if;
end $$;

-- ----------------------------------------------------------------------------
-- Practice: the column and the immutability guard, both directions.
-- ----------------------------------------------------------------------------
alter table projects add column if not exists practice boolean not null default false;

create or replace function projects_practice_guard()
returns trigger language plpgsql as $$
begin
  if new.practice is distinct from old.practice then
    raise exception 'practice is immutable after creation: a rehearsal never becomes evidence and evidence never becomes a rehearsal';
  end if;
  return new;
end; $$;
drop trigger if exists projects_practice_immutable on projects;
create trigger projects_practice_immutable
  before update on projects
  for each row execute function projects_practice_guard();

-- ----------------------------------------------------------------------------
-- The Book's facts: one batched member-scoped call for the projects grid.
-- Latest baseline facts already ride client state; this adds the signature
-- counts and the sealed truth, keyed by project id.
-- ----------------------------------------------------------------------------
create or replace function project_acceptance_facts()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(t.pid, t.facts), '{}'::jsonb) from (
    select p.id as pid, jsonb_build_object(
      'pending', (select count(*) from sign_requests s
                   where s.project_id = p.id and s.revoked = false and s.status = 'pending'),
      'signed',  (select count(*) from sign_requests s
                   where s.project_id = p.id and s.revoked = false and s.status = 'signed'),
      'sealed',  exists (select 1 from acceptance_receipts r where r.project_id = p.id)) as facts
    from projects p
    where p.archived = false and is_org_member(p.org_id)
  ) t;
$$;
revoke execute on function project_acceptance_facts() from public;
grant execute on function project_acceptance_facts() to authenticated;

-- ----------------------------------------------------------------------------
-- The Book export: every project where the caller is a manager, practice
-- excluded, one row per signature, the evidence.csv columns exactly, plus
-- engagement_value where authored. Chain head columns carry each receipt's
-- own at-seal chain snapshot where sealed, and the project's current chain
-- tail otherwise: authored and recorded facts, never a fresh verdict.
-- ----------------------------------------------------------------------------
create or replace function book_export()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'project_name', p.name,
      'version_label', v.label,
      'seq', v.seq,
      'doc_fingerprint', s.doc_fingerprint,
      'signer_name', coalesce(nullif(s.signed_name, ''), s.signer_name),
      'signer_role', s.signer_role,
      'signer_email_domain', coalesce(nullif(split_part(s.signer_email, '@', 2), ''), ''),
      'signed_at', s.signed_at,
      'receipt_id', r.id,
      'canonical_hash', coalesce(r.canonical_hash, ''),
      'tsa_status', coalesce(r.tsa_status, ''),
      'sealed_at', r.sealed_at,
      'chain_head_seq', coalesce((r.receipt_json #>> '{chain,headSeq}'),
        (select ce.seq::text from chain_events ce where ce.project_id = p.id order by ce.seq desc limit 1), ''),
      'chain_head_hash', coalesce((r.receipt_json #>> '{chain,headHash}'),
        (select ce.link_hash from chain_events ce where ce.project_id = p.id order by ce.seq desc limit 1), ''),
      'engagement_value', coalesce((select f.value #>> '{}' from project_fields f
        where f.project_id = p.id and f.field_id = 'ctrl_engagement_value'), ''))
    order by p.name, v.seq, s.sent_at), '[]'::jsonb)
  from sign_requests s
  join projects p on p.id = s.project_id
  join versions v on v.id = s.version_id
  left join acceptance_receipts r on r.sign_request_id = s.id
  where s.revoked = false
    and p.archived = false
    and p.practice = false
    and is_org_manager(p.org_id);
$$;
revoke execute on function book_export() from public;
grant execute on function book_export() to authenticated;

-- ----------------------------------------------------------------------------
-- Webhook silence for practice, absolute: the enqueue function returns
-- before building anything, so a practice project produces zero delivery
-- rows ever. House replacement of the v2.50 body; the only change is the
-- guard at the top, pinned by test.
-- ----------------------------------------------------------------------------
create or replace function webhook_enqueue(p_event text, p_sr sign_requests, p_receipt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ver versions%rowtype; v_head record; v_base jsonb; v_ep record; v_id uuid;
begin
  if coalesce((select practice from projects where id = p_sr.project_id), false) then
    return;  -- practice records are non-evidence by construction; nothing announces them
  end if;
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
-- The external surfaces announce practice. House replacements of the two
-- context functions; the only change is the practice key, pinned by test.
-- ----------------------------------------------------------------------------
create or replace function sign_request_context(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true,
    'status', r.status,
    'revoked', r.revoked,
    'signer', jsonb_build_object('email', r.signer_email, 'name', r.signer_name, 'role', r.signer_role),
    'signedName', r.signed_name, 'signedAt', r.signed_at, 'declineReason', r.decline_reason,
    'fingerprint', r.doc_fingerprint,
    'project', p.name, 'logo', p.brand_logo, 'brandLabel', p.brand_label,
    'practice', p.practice,
    'label', v.label, 'seq', v.seq, 'versionStatus', v.status,
    'note', v.note, 'author', v.author_name, 'created', v.created_at,
    'snapshot', v.snapshot)
  from sign_requests r
  join versions v on v.id = r.version_id
  join projects p on p.id = r.project_id
  where r.token = p_token and r.revoked = false
  limit 1;
$$;
grant execute on function sign_request_context(text) to anon, authenticated;

create or replace function get_share(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select case when p.id is null then s.payload
              else s.payload || jsonb_build_object('logo', p.brand_logo, 'brandLabel', p.brand_label,
                                                   'practice', p.practice) end
  from shares s left join projects p on p.id = s.project_id
  where s.token = p_token and s.revoked = false limit 1;
$$;
grant execute on function get_share(text) to anon, authenticated;

-- seal_context carries practice so the seal can state it in the receipt.
create or replace function seal_context(p_sign_request uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true, 'status', r.status, 'revoked', r.revoked,
    'signRequestId', r.id,
    'signer', jsonb_build_object('name', r.signer_name, 'role', r.signer_role,
      'emailDomain', split_part(r.signer_email, '@', 2)),
    'signedName', r.signed_name, 'signedAt', r.signed_at,
    'fingerprint', r.doc_fingerprint, 'evidence', r.evidence,
    'project', p.name, 'projectId', p.id, 'practice', p.practice,
    'label', v.label, 'seq', v.seq, 'snapshot', v.snapshot)
  from sign_requests r
  join versions v on v.id = r.version_id
  join projects p on p.id = r.project_id
  where r.id = p_sign_request and auth.uid() is not null and is_project_member(r.project_id)
  limit 1;
$$;
revoke execute on function seal_context(uuid) from public, anon;
grant execute on function seal_context(uuid) to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0026', 'book_practice', '8135111b61d90a4a81eafcd2a7cbd01a66b6b271bb852e877a43496e59773fd3')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
