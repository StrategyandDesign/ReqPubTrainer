-- ============================================================================
-- ReqPub v2.48.0 - fix-sealing.sql
-- Cryptographic sealing: acceptance receipts, Ed25519 over the canonical
-- receipt, dual RFC 3161 timestamps stored whole, key registry.
-- Deploy order: run AFTER fix-chain.sql (v2.47.x). Idempotent, safe twice.
-- Writes are RPC-only. No authority capture, by owner decision.
-- ============================================================================

-- PRECHECK: fail here, with a named reason, before creating anything.
do $$ begin
  if to_regclass('public.sign_requests') is null then
    raise exception 'PRECHECK failed: sign_requests is missing; this database predates e-sign v1 (v2.26). Run the base schema first.';
  end if;
  if to_regclass('public.versions') is null or to_regclass('public.orgs') is null then
    raise exception 'PRECHECK failed: versions or orgs is missing; run the base schema first.';
  end if;
  if to_regprocedure('public.is_project_member(text)') is null then
    raise exception 'PRECHECK failed: is_project_member(text) is missing; run the base schema first.';
  end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,text,text,jsonb)') is null then
    raise exception 'PRECHECK failed: log_activity is missing; run the base schema first.';
  end if;
end $$;

create table if not exists receipt_keys (
  kid text primary key,
  alg text not null default 'Ed25519',
  public_key_spki_base64 text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
alter table receipt_keys enable row level security;
drop policy if exists receipt_keys_select on receipt_keys;
create policy receipt_keys_select on receipt_keys for select using (true);
revoke insert, update, delete on receipt_keys from authenticated, anon;
grant select on receipt_keys to authenticated, anon;

create table if not exists acceptance_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  sign_request_id uuid not null unique references sign_requests(id) on delete cascade,
  receipt_json jsonb not null,
  canonical_hash text not null,
  signature_base64 text not null,
  key_id text not null,
  tsa_primary_der text,
  tsa_secondary_der text,
  tsa_status text not null default 'pending'
    check (tsa_status in ('pending','single','dual')),
  sealed_at timestamptz not null default now()
);
create index if not exists acceptance_receipts_proj on acceptance_receipts(project_id);
alter table acceptance_receipts enable row level security;
drop policy if exists acceptance_receipts_select on acceptance_receipts;
create policy acceptance_receipts_select on acceptance_receipts
  for select using (is_project_member(project_id));
revoke insert, update, delete on acceptance_receipts from authenticated, anon;
grant select on acceptance_receipts to authenticated;

-- Store a sealed receipt. Insert-once per sign request; the caller proves
-- authority by the sign token or by project membership. Validates the sign
-- request is signed and not revoked. Never returns tokens or emails.
create or replace function receipt_store(
  p_sign_request uuid, p_token text, p_receipt jsonb,
  p_hash text, p_sig text, p_kid text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r sign_requests; existing acceptance_receipts; created acceptance_receipts;
begin
  select * into r from sign_requests where id = p_sign_request;
  if r.id is null then raise exception 'no such sign request'; end if;
  if r.revoked then raise exception 'revoked'; end if;
  if r.status <> 'signed' then raise exception 'not signed'; end if;
  if not (r.token = coalesce(p_token,'') or is_project_member(r.project_id)) then
    raise exception 'not allowed';
  end if;
  select * into existing from acceptance_receipts where sign_request_id = p_sign_request;
  if existing.id is not null then
    return jsonb_build_object('id', existing.id, 'existing', true,
      'canonical_hash', existing.canonical_hash, 'tsa_status', existing.tsa_status);
  end if;
  insert into acceptance_receipts(org_id, project_id, sign_request_id,
    receipt_json, canonical_hash, signature_base64, key_id)
  values (r.org_id, r.project_id, p_sign_request, p_receipt, p_hash, p_sig, p_kid)
  returning * into created;
  perform log_activity(r.org_id, r.project_id, 'seal.issued', 'receipt',
    created.id::text, 'Acceptance receipt sealed for v' ||
    coalesce((select label from versions where id = r.version_id), '?'), '{}'::jsonb);
  return jsonb_build_object('id', created.id, 'existing', false,
    'canonical_hash', created.canonical_hash, 'tsa_status', created.tsa_status);
end; $$;
grant execute on function receipt_store(uuid, text, jsonb, text, text, text) to anon, authenticated;

-- Upgrade timestamp columns only. Same authority rule. Never downgrades.
create or replace function receipt_tsa_update(
  p_receipt uuid, p_token text, p_primary text, p_secondary text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec acceptance_receipts; r sign_requests; v_status text;
begin
  select * into rec from acceptance_receipts where id = p_receipt;
  if rec.id is null then raise exception 'no such receipt'; end if;
  select * into r from sign_requests where id = rec.sign_request_id;
  if not (r.token = coalesce(p_token,'') or is_project_member(rec.project_id)) then
    raise exception 'not allowed';
  end if;
  v_status := case
    when coalesce(p_primary, rec.tsa_primary_der) is not null
     and coalesce(p_secondary, rec.tsa_secondary_der) is not null then 'dual'
    when coalesce(p_primary, rec.tsa_primary_der) is not null
      or coalesce(p_secondary, rec.tsa_secondary_der) is not null then 'single'
    else 'pending' end;
  update acceptance_receipts set
    tsa_primary_der = coalesce(p_primary, tsa_primary_der),
    tsa_secondary_der = coalesce(p_secondary, tsa_secondary_der),
    tsa_status = v_status
  where id = p_receipt;
  if v_status <> rec.tsa_status then
    perform log_activity(rec.org_id, rec.project_id, 'seal.timestamped', 'receipt',
      rec.id::text, 'Receipt timestamps: ' || v_status, '{}'::jsonb);
  end if;
  return jsonb_build_object('id', p_receipt, 'tsa_status', v_status);
end; $$;
grant execute on function receipt_tsa_update(uuid, text, text, text) to anon, authenticated;

-- Context for sealing by sign-request id (member path). Mirrors
-- sign_request_context without the token; email never leaves.
create or replace function seal_context(p_sign_request uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true, 'status', r.status, 'revoked', r.revoked,
    'signRequestId', r.id,
    'signer', jsonb_build_object('name', r.signer_name, 'role', r.signer_role,
      'emailDomain', split_part(r.signer_email, '@', 2)),
    'signedName', r.signed_name, 'signedAt', r.signed_at,
    'fingerprint', r.doc_fingerprint, 'evidence', r.evidence,
    'project', p.name, 'projectId', p.id,
    'label', v.label, 'seq', v.seq, 'snapshot', v.snapshot)
  from sign_requests r
  join versions v on v.id = r.version_id
  join projects p on p.id = r.project_id
  where r.id = p_sign_request and auth.uid() is not null and is_project_member(r.project_id)
  limit 1;
$$;
revoke execute on function seal_context(uuid) from public, anon;
grant execute on function seal_context(uuid) to authenticated;

-- Reader for the signer archive page and the app. Token or membership.
create or replace function receipt_for(p_sign_request uuid, p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'receipt', a.receipt_json,
    'canonical_hash', a.canonical_hash, 'signature_base64', a.signature_base64,
    'key_id', a.key_id, 'tsa_status', a.tsa_status,
    'tsa_primary_der', a.tsa_primary_der, 'tsa_secondary_der', a.tsa_secondary_der,
    'sealed_at', a.sealed_at)
  from acceptance_receipts a join sign_requests r on r.id = a.sign_request_id
  where a.sign_request_id = p_sign_request
    and ((p_token <> '' and r.token = p_token)
      or (auth.uid() is not null and is_project_member(a.project_id)))
  limit 1;
$$;
grant execute on function receipt_for(uuid, text) to anon, authenticated;
-- List sealed receipts for a project, member-scoped, for the workflow panel.
-- Facts only: the sign request it seals, the hash, kid, tsa status, time.
create or replace function receipts_for_project(p_project text)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'sign_request_id', a.sign_request_id, 'id', a.id,
    'canonical_hash', a.canonical_hash, 'key_id', a.key_id,
    'tsa_status', a.tsa_status, 'sealed_at', a.sealed_at)), '[]'::jsonb)
  from acceptance_receipts a
  where a.project_id = p_project and auth.uid() is not null and is_project_member(p_project);
$$;
revoke all on function receipts_for_project(text) from public, anon;
revoke execute on function receipts_for_project(text) from public, anon;
grant execute on function receipts_for_project(text) to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0021', 'sealing', '49893cccedd1c45fcb2ca06fe722cb5b467b88c5020b5f2a1b08e096fddbdad3')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
