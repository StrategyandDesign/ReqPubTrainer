-- ============================================================================
-- ReqPub v2.52 - THE EVIDENCE PACK. Run once in the Supabase SQL editor,
-- after fix-mcp.sql. Idempotent; safe to run twice. No new tables, no
-- constraint changes, no function deploys: two definer functions, both
-- read-side except one chained activity line.
--
-- One artifact a lawyer, an auditor, or a carrier can hold: what was
-- agreed, what changed, who signed, provable. evidence_gather is the one
-- throat every leak assertion tests: everything the pack contains passes
-- through this single function, so the no-token no-address discipline is
-- provable in one place.
--
-- The v2.34.2 boundary holds: no sign token, no update token, no reply
-- token, and no email address leaves this function. Signer identity is
-- name, role, and email domain only. Activity meta is omitted and the
-- omission is stated in the output, per standing owner decision D2.
--
-- Practice records are non-evidence by construction: a practice project
-- is refused here, before anything is gathered.
-- ============================================================================

-- PRECHECK: name anything missing before creating anything.
do $$
declare missing text := '';
begin
  if to_regclass('public.activity') is null then missing := missing || ' activity'; end if;
  if to_regclass('public.versions') is null then missing := missing || ' versions'; end if;
  if to_regclass('public.sign_requests') is null then missing := missing || ' sign_requests'; end if;
  if to_regclass('public.acceptance_receipts') is null then missing := missing || ' acceptance_receipts'; end if;
  if to_regclass('public.attachments') is null then missing := missing || ' attachments'; end if;
  if to_regclass('public.receipt_keys') is null then missing := missing || ' receipt_keys'; end if;
  if to_regprocedure('public.verify_project_chain(text)') is null then missing := missing || ' verify_project_chain(text)'; end if;
  if to_regprocedure('public.is_org_manager(uuid)') is null then missing := missing || ' is_org_manager(uuid)'; end if;
  if to_regprocedure('public.project_org(text)') is null then missing := missing || ' project_org(text)'; end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,text,text,jsonb)') is null then missing := missing || ' log_activity'; end if;
  if missing <> '' then
    raise exception 'fix-evidence.sql prerequisites missing:%', missing;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- The gather. Manager-gated, read-only, one jsonb. Versions carry their
-- snapshots because the baseline bundles in the pack cannot exist without
-- them; receipts carry their .tsr DER fields and the referenced public
-- keys ride along, so the whole pack builds offline from this one call.
-- ----------------------------------------------------------------------------
create or replace function evidence_gather(p_project text)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_org uuid; v_practice boolean;
begin
  v_org := project_org(p_project);
  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce((to_jsonb(p) ->> 'practice')::boolean, false) into v_practice
    from projects p where p.id = p_project;
  if v_practice then
    return jsonb_build_object('ok', false, 'error', 'practice_project',
      'message', 'Practice records are non-evidence by construction. No pack is produced.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'project', (select jsonb_build_object('id', p.id, 'name', p.name, 'createdAt', p.created_at)
                  from projects p where p.id = p_project),
    'metaOmitted', true,
    'metaNote', 'Activity meta is omitted from this gather by standing decision D2; the omission is part of the record.',
    'chronology', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', a.created_at, 'action', a.action, 'kind', a.entity_kind,
        'ref', a.entity_id, 'actor', a.actor_name, 'message', a.summary)
        order by a.id)
      from activity a where a.project_id = p_project and a.org_id = v_org), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', v.label, 'seq', v.seq, 'status', v.status, 'note', v.note,
        'authorName', v.author_name, 'createdAt', v.created_at, 'snapshot', v.snapshot)
        order by v.seq)
      from versions v where v.project_id = p_project), '[]'::jsonb),
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'signerName', coalesce(nullif(s.signed_name, ''), s.signer_name),
        'signerRole', s.signer_role,
        'signerEmailDomain', nullif(split_part(s.signer_email, '@', 2), ''),
        'status', s.status, 'sentAt', s.sent_at, 'signedAt', s.signed_at,
        'docFingerprint', s.doc_fingerprint, 'versionSeq', v.seq,
        'versionLabel', v.label, 'receiptId', r.id)
        order by s.sent_at)
      from sign_requests s
      join versions v on v.id = s.version_id
      left join acceptance_receipts r on r.sign_request_id = s.id
      where s.project_id = p_project and s.revoked = false), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'receiptId', r.id, 'canonicalHash', r.canonical_hash, 'keyId', r.key_id,
        'tsaStatus', r.tsa_status, 'sealedAt', r.sealed_at,
        'receiptJson', r.receipt_json, 'signatureBase64', r.signature_base64,
        'tsaPrimaryDer', r.tsa_primary_der, 'tsaSecondaryDer', r.tsa_secondary_der,
        'versionSeq', v.seq)
        order by r.sealed_at)
      from acceptance_receipts r
      join sign_requests s on s.id = r.sign_request_id
      join versions v on v.id = s.version_id
      where r.project_id = p_project), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fileName', a.file_name, 'mime', a.mime, 'sizeBytes', a.size_bytes,
        'sha256Hex', coalesce(a.sha256_hex, ''), 'scanStatus', a.scan_status,
        'createdAt', a.created_at)
        order by a.created_at)
      from attachments a where a.project_id = p_project), '[]'::jsonb),
    'keys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kid', k.kid, 'publicKeySpkiBase64', k.public_key_spki_base64)
        order by k.kid)
      from receipt_keys k where k.kid in (
        select distinct r.key_id from acceptance_receipts r where r.project_id = p_project)), '[]'::jsonb),
    'chain', verify_project_chain(p_project));
end; $$;
revoke execute on function evidence_gather(text) from public;
grant execute on function evidence_gather(text) to authenticated;

-- ----------------------------------------------------------------------------
-- The export is itself on the record: one chained activity line, written
-- only when a manager exports, carrying no meta worth omitting.
-- ----------------------------------------------------------------------------
create or replace function evidence_log_export(p_project text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := project_org(p_project);
  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform log_activity(v_org, p_project, 'evidence.exported', 'evidence',
    p_project, 'Evidence pack exported', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function evidence_log_export(text) from public;
grant execute on function evidence_log_export(text) to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0025', 'evidence', '4c94109c582c917462f3ee637f26ca053ee6212112e7c6794f03b4c26b90e493')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
