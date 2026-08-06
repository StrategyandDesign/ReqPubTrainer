-- ============================================================================
-- ReqPub v2.49.0 - fix-attachment-hash.sql
-- Attachment hashing: every stored file's exact bytes become provable.
-- A sha256_hex digest is computed by the upload function in the same pass
-- that scans the bytes, recorded through attachment_add, verifiable on
-- demand (the function re-downloads and re-hashes), backfillable for
-- files that predate this release (marked hashed-after-upload so the two
-- provenances are never confused), and snapshotted into sign evidence at
-- send as attachmentsAtSend so every receipt pins which files existed at
-- the moment the request went out.
-- Deploy order: run AFTER fix-sealing.sql (v2.48.x). Idempotent, safe twice.
-- Writes are RPC-only. No authority capture. No fail-closed acceptance
-- rule ships: attachments are thread artifacts, the accepted deliverable
-- is the snapshot, already fingerprinted.
-- ============================================================================

-- PRECHECK: fail here, with a named reason, before creating anything.
do $$ begin
  if to_regclass('public.attachments') is null then
    raise exception 'PRECHECK failed: attachments is missing; this database predates uploads (v2.20). Run the base schema first.';
  end if;
  if to_regclass('public.sign_requests') is null then
    raise exception 'PRECHECK failed: sign_requests is missing; this database predates e-sign v1 (v2.26). Run the base schema first.';
  end if;
  if to_regprocedure('public.project_org(text)') is null then
    raise exception 'PRECHECK failed: project_org(text) is missing; run the base schema first.';
  end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,text,text,jsonb)') is null then
    raise exception 'PRECHECK failed: log_activity is missing; run the base schema first.';
  end if;
  if to_regprocedure('public.attachment_add(text,uuid,uuid,text,text,uuid,text,text,bigint,text,text,text)') is null
     and to_regprocedure('public.attachment_add(text,uuid,uuid,text,text,uuid,text,text,bigint,text,text,text,text)') is null then
    raise exception 'PRECHECK failed: attachment_add is missing in any known shape; run the base schema first.';
  end if;
end $$;

-- The digest column. Empty string means "no hash recorded", never null:
-- the column tells you what is known, not what might be.
alter table attachments add column if not exists sha256_hex text not null default '';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attachments_sha256_shape') then
    alter table attachments add constraint attachments_sha256_shape
      check (sha256_hex = '' or sha256_hex ~ '^[0-9a-f]{64}$') not valid;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- attachment_add gains p_sha256 (default '', so every existing caller keeps
-- working unchanged). The old 12-parameter signature is dropped first: a
-- create-or-replace cannot change a signature, and two overloads would make
-- the function's 12-argument calls ambiguous.
-- ----------------------------------------------------------------------------
drop function if exists attachment_add(text, uuid, uuid, text, text, uuid, text, text, bigint, text, text, text);

create or replace function attachment_add(
  p_project text, p_comm uuid, p_message uuid,
  p_uploader_kind text, p_uploader_name text, p_uploader_user uuid,
  p_file_name text, p_mime text, p_size bigint, p_path text,
  p_scan_status text, p_scan_detail text, p_sha256 text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
  v_allow text[] := array[
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv','text/markdown',
    'image/png','image/jpeg','image/gif','image/webp','image/heic','application/zip'];
begin
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  if p_uploader_kind is null or p_uploader_kind not in ('team','partner','sme') then
    return jsonb_build_object('ok', false, 'error', 'bad_uploader'); end if;
  if coalesce(p_size, 0) <= 0 or p_size > 26214400 then
    return jsonb_build_object('ok', false, 'error', 'bad_size'); end if;
  if p_mime is null or not (p_mime = any(v_allow)) then
    return jsonb_build_object('ok', false, 'error', 'type_not_allowed'); end if;
  if p_scan_status = 'infected' then
    return jsonb_build_object('ok', false, 'error', 'infected'); end if;
  if p_scan_status is null or not (p_scan_status = any(array['clean','unscanned','error'])) then
    return jsonb_build_object('ok', false, 'error', 'bad_scan_status'); end if;
  -- A digest is 64 lowercase hex characters or absent. Anything else is a
  -- caller bug and is refused rather than stored looking like evidence.
  if coalesce(p_sha256, '') <> '' and p_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_hash'); end if;
  if p_comm is not null and not exists (select 1 from comms c where c.id = p_comm and c.project_id = p_project) then
    return jsonb_build_object('ok', false, 'error', 'bad_thread'); end if;
  -- Throttle external floods: 40 files/hour/project.
  perform pg_advisory_xact_lock(hashtextextended('attach/' || p_project, 13));
  if (select count(*) from attachments a
        where a.project_id = p_project and a.created_at > now() - interval '1 hour') >= 40 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;

  insert into attachments(org_id, project_id, comm_id, message_id, uploader_kind, uploader_name,
                          uploader_user, file_name, mime, size_bytes, storage_path, scan_status, scan_detail, sha256_hex)
  values (v_org, p_project, p_comm, p_message, p_uploader_kind,
          left(coalesce(p_uploader_name, ''), 200), p_uploader_user,
          left(p_file_name, 300), left(coalesce(p_mime, ''), 120), p_size, p_path,
          coalesce(p_scan_status, 'unscanned'), left(coalesce(p_scan_detail, ''), 500),
          coalesce(p_sha256, ''))
  returning id into v_id;

  if p_comm is not null then
    update comms set updated_at = now(), status = case when status = 'closed' then 'new' else status end
      where id = p_comm;
  end if;
  perform log_activity(v_org, p_project, 'attachment.added', 'attachment', v_id::text,
    coalesce(nullif(p_uploader_name, ''), 'Someone') || ' attached ' || left(p_file_name, 120),
    jsonb_build_object('mime', p_mime, 'size', p_size, 'scan', p_scan_status, 'by', p_uploader_kind)
      || case when coalesce(p_sha256, '') <> '' then jsonb_build_object('sha256', p_sha256) else '{}'::jsonb end);
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function attachment_add(text, uuid, uuid, text, text, uuid, text, text, bigint, text, text, text, text) from public;
do $$ begin
  execute 'grant execute on function attachment_add(text, uuid, uuid, text, text, uuid, text, text, bigint, text, text, text, text) to service_role';
exception when undefined_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Verification target. The upload function's 'verify' mode checks the caller's
-- JWT, then passes the user id here. Read scope matches the table's RLS: any
-- org member may verify a file their org can read. Returns the storage path
-- and the stored hash so the function can re-download, re-hash, and compare.
-- ----------------------------------------------------------------------------
create or replace function attachment_verify_target(p_id uuid, p_user uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case
    when a.id is null then jsonb_build_object('ok', false, 'error', 'not_found')
    when not exists (select 1 from org_members m where m.org_id = a.org_id and m.user_id = p_user)
      then jsonb_build_object('ok', false, 'error', 'forbidden')
    when a.sha256_hex = '' then jsonb_build_object('ok', false, 'error', 'unhashed', 'file_name', a.file_name)
    else jsonb_build_object('ok', true, 'storage_path', a.storage_path,
           'sha256_hex', a.sha256_hex, 'file_name', a.file_name, 'project_id', a.project_id)
  end
  from (select 1) one left join attachments a on a.id = p_id;
$$;
revoke execute on function attachment_verify_target(uuid, uuid) from public;
do $$ begin
  execute 'grant execute on function attachment_verify_target(uuid, uuid) to service_role';
exception when undefined_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Backfill targets. Manager-gated. One page of files that predate hashing,
-- oldest first, plus the count still waiting after this page, so the caller
-- loops until remaining is zero. Infected files were never stored, so the
-- only exclusion that matters is "already hashed".
-- ----------------------------------------------------------------------------
create or replace function attachment_backfill_targets(p_project text, p_user uuid, p_limit int default 25)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_org uuid; v_total int; v_rows jsonb;
begin
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  if not exists (select 1 from org_members m where m.org_id = v_org and m.user_id = p_user and m.role = 'manager') then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select count(*)::int into v_total from attachments a where a.project_id = p_project and a.sha256_hex = '';
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'storage_path', t.storage_path) order by t.created_at), '[]'::jsonb)
    into v_rows
    from (select a.id, a.storage_path, a.created_at from attachments a
           where a.project_id = p_project and a.sha256_hex = ''
           order by a.created_at asc
           limit least(greatest(coalesce(p_limit, 25), 1), 100)) t;
  return jsonb_build_object('ok', true, 'rows', v_rows,
    'remaining', greatest(v_total - jsonb_array_length(v_rows), 0));
end; $$;
revoke execute on function attachment_backfill_targets(text, uuid, int) from public;
do $$ begin
  execute 'grant execute on function attachment_backfill_targets(text, uuid, int) to service_role';
exception when undefined_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Record one backfilled hash. Idempotent: a hash already on the row is never
-- overwritten, at-upload provenance included, so re-running a page cannot
-- rewrite history. Backfilled rows carry hashed-after-upload in scan_detail,
-- once, so nobody mistakes a backfilled digest for an at-upload digest.
-- ----------------------------------------------------------------------------
create or replace function attachment_set_hash(p_id uuid, p_sha256 text, p_backfilled boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a attachments%rowtype;
begin
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_hash'); end if;
  select * into a from attachments where id = p_id for update;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if a.sha256_hex <> '' then
    return jsonb_build_object('ok', true, 'already', true); end if;
  update attachments
     set sha256_hex = p_sha256,
         scan_detail = case
           when p_backfilled and position('hashed-after-upload' in scan_detail) = 0
             then left(case when scan_detail = '' then 'hashed-after-upload'
                            else scan_detail || ' | hashed-after-upload' end, 500)
           else scan_detail end
   where id = p_id;
  return jsonb_build_object('ok', true, 'already', false);
end; $$;
revoke execute on function attachment_set_hash(uuid, text, boolean) from public;
do $$ begin
  execute 'grant execute on function attachment_set_hash(uuid, text, boolean) to service_role';
exception when undefined_object then null; end $$;

-- ----------------------------------------------------------------------------
-- One audit line per backfill page, written after the page lands, with the
-- count. Per-row logging would flood the activity chain with entries that
-- say the same thing; one honest line per invocation is the record.
-- ----------------------------------------------------------------------------
create or replace function attachment_backfill_note(p_project text, p_user uuid, p_count int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_name text;
begin
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  if not exists (select 1 from org_members m where m.org_id = v_org and m.user_id = p_user and m.role = 'manager') then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(p_count, 0) <= 0 then return jsonb_build_object('ok', true, 'skipped', true); end if;
  v_name := coalesce((select display_name from user_profiles up where up.user_id = p_user), 'A manager');
  perform log_activity(v_org, p_project, 'attachment.hashed', 'attachment', p_project,
    v_name || ' hashed ' || p_count || ' existing file' || case when p_count = 1 then '' else 's' end,
    jsonb_build_object('count', p_count, 'mode', 'backfill'));
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function attachment_backfill_note(text, uuid, int) from public;
do $$ begin
  execute 'grant execute on function attachment_backfill_note(text, uuid, int) to service_role';
exception when undefined_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Sign-time binding, minimal and honest. sign_request_create additionally
-- snapshots into evidence the project's clean, hashed attachments at the
-- moment of send: file name, digest, size, oldest first, labeled
-- attachmentsAtSend. Unscanned, scan-error, and unhashed files are excluded
-- because a snapshot that cannot prove its bytes is not evidence. When no
-- file qualifies, evidence stays {} exactly as before. The receipt carries
-- evidence through unchanged (seal_context, v2.48), so no seal change ships.
-- ----------------------------------------------------------------------------
create or replace function sign_request_create(
  p_version uuid, p_email text, p_name text default '', p_role text default '', p_fingerprint text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ver versions%rowtype; v_id uuid; v_token text; v_atts jsonb;
begin
  select * into v_ver from versions where id = p_version;
  if v_ver.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_project_manager(v_ver.project_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(trim(p_email), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;
  select jsonb_agg(jsonb_build_object(
           'file_name', a.file_name, 'sha256_hex', a.sha256_hex, 'size_bytes', a.size_bytes)
         order by a.created_at)
    into v_atts
    from attachments a
   where a.project_id = v_ver.project_id and a.scan_status = 'clean' and a.sha256_hex <> '';
  v_token := url_token();
  insert into sign_requests(org_id, project_id, version_id, token, signer_email, signer_name, signer_role, doc_fingerprint, sent_by, evidence)
  values (project_org(v_ver.project_id), v_ver.project_id, p_version, v_token,
          trim(p_email), coalesce(trim(p_name), ''), coalesce(trim(p_role), ''), coalesce(p_fingerprint, ''), auth.uid(),
          case when v_atts is null then '{}'::jsonb else jsonb_build_object('attachmentsAtSend', v_atts) end)
  returning id into v_id;
  perform log_activity(project_org(v_ver.project_id), v_ver.project_id, 'sign.requested',
    'sign', v_id::text, 'v' || v_ver.label || ' signature requested from ' || trim(p_email), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token);
end; $$;
grant execute on function sign_request_create(uuid, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- sign_request_sign merges its signing evidence instead of replacing it.
-- Before this release it overwrote the evidence column wholesale, which
-- would have erased attachmentsAtSend at the exact moment it matters, right
-- before sealing. The build prompt did not name this; the tree did.
-- ----------------------------------------------------------------------------
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
         evidence = coalesce(evidence, '{}'::jsonb)
           || jsonb_build_object('ua', left(coalesce(p_ua, ''), 400), 'channel', 'email_token')
   where id = r.id;
  perform log_activity(r.org_id, r.project_id, 'sign.signed',
    'sign', r.id::text, 'v' || v_ver.label || ' signed by ' || trim(p_typed_name) || ' (' || r.signer_email || ')', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'signedAt', now(), 'approvalId', v_appr);
end; $$;
grant execute on function sign_request_sign(text, text, text) to anon, authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0022', 'attachment_hash', '7b7da46af5602b58884cc2921cee328b98135c560909cb459bb2ce095e881fc8')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
