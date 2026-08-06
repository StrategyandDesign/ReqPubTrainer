-- fix-esign.sql - run once on the live database to add e-sign v1.
-- Idempotent: safe to run again. Fresh installs get this from schema.sql.
-- After running, deploy the mailer: supabase functions deploy send-sign-request
-- and (for signer receipts) supabase functions deploy send-sign-receipt --no-verify-jwt

-- ----------------------------------------------------------------------------
-- 14) E-sign v1 - recorded electronic signatures on a version
--     A signature request is an evidence row: token, signer identity channel,
--     the fingerprint captured at send, timestamps, and an audit trail. The
--     signature itself lands as a normal version_approvals row (inserted and
--     decided inside sign_request_sign), so the state machine, covers, gate
--     packets, and health signals all see it with zero new concepts. This is
--     a recorded signature with an audit trail, not cryptographic sealing;
--     sealing is the v2 phase and the receipt says so in plain words.
--     Writes are RPC-only; members read; signers act through the token.
-- ----------------------------------------------------------------------------
create table if not exists sign_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  version_id uuid not null references versions(id) on delete cascade,
  token text not null unique,
  signer_email text not null default '',
  signer_name text not null default '',
  signer_role text not null default '',
  status text not null default 'pending'
    check (status in ('pending','signed','declined')),
  doc_fingerprint text not null default '',   -- captured client-side at send; the signer's browser recomputes and compares
  sent_by uuid,
  sent_at timestamptz not null default now(),
  signed_name text not null default '',       -- the name the signer typed
  signed_at timestamptz,
  decline_reason text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  approval_id uuid,                            -- the version_approvals row the signature created
  revoked boolean not null default false
);
create index if not exists sr_ver on sign_requests(version_id);
create index if not exists sr_proj on sign_requests(project_id);
alter table sign_requests enable row level security;

drop policy if exists sr_read on sign_requests;
create policy sr_read on sign_requests for select using (is_project_member(project_id));
grant select on sign_requests to authenticated;
revoke insert, update, delete on sign_requests from authenticated, anon;

-- The approval row remembers which signature created it, so covers and
-- exports can mark a sign-off as e-signed without a join at render time.
alter table version_approvals add column if not exists sign_request_id uuid;

create or replace function sign_request_create(
  p_version uuid, p_email text, p_name text default '', p_role text default '', p_fingerprint text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ver versions%rowtype; v_id uuid; v_token text;
begin
  select * into v_ver from versions where id = p_version;
  if v_ver.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_project_manager(v_ver.project_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(trim(p_email), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;
  v_token := url_token();
  insert into sign_requests(org_id, project_id, version_id, token, signer_email, signer_name, signer_role, doc_fingerprint, sent_by)
  values (project_org(v_ver.project_id), v_ver.project_id, p_version, v_token,
          trim(p_email), coalesce(trim(p_name), ''), coalesce(trim(p_role), ''), coalesce(p_fingerprint, ''), auth.uid())
  returning id into v_id;
  perform log_activity(project_org(v_ver.project_id), v_ver.project_id, 'sign.requested',
    'sign', v_id::text, 'v' || v_ver.label || ' signature requested from ' || trim(p_email), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token);
end; $$;
grant execute on function sign_request_create(uuid, text, text, text, text) to authenticated;

-- Everything the signer's page needs, keyed by token: the exact stored
-- snapshot (versions are immutable, so this IS the artifact), the fingerprint
-- captured at send, branding, and the request state. Anon-callable.
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

create or replace function sign_request_sign(p_token text, p_typed_name text, p_ua text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r sign_requests%rowtype; v_ver versions%rowtype; v_appr uuid;
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
         evidence = jsonb_build_object('ua', left(coalesce(p_ua, ''), 400), 'channel', 'email_token')
   where id = r.id;
  perform log_activity(r.org_id, r.project_id, 'sign.signed',
    'sign', r.id::text, 'v' || v_ver.label || ' signed by ' || trim(p_typed_name) || ' (' || r.signer_email || ')', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'signedAt', now(), 'approvalId', v_appr);
end; $$;
grant execute on function sign_request_sign(text, text, text) to anon, authenticated;

create or replace function sign_request_decline(p_token text, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r sign_requests%rowtype; v_ver versions%rowtype;
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
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function sign_request_decline(text, text) to anon, authenticated;

create or replace function sign_request_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r sign_requests%rowtype;
begin
  select * into r from sign_requests where id = p_id;
  if r.id is null or not is_project_manager(r.project_id) then return false; end if;
  if r.status <> 'pending' then return false; end if;   -- a signed record is never un-signed from here
  update sign_requests set revoked = true where id = p_id;
  perform log_activity(r.org_id, r.project_id, 'sign.revoked',
    'sign', r.id::text, 'signature request to ' || r.signer_email || ' revoked', '{}'::jsonb);
  return true;
end; $$;
grant execute on function sign_request_revoke(uuid) to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0007', 'esign', 'd58f054a595f36a9236ce8e63cd425e2ddfdedebacd0cfdec5d39ad12d61ab7e')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
