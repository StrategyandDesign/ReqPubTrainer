-- ReqPub 3.2.0 - the engineering seam release
-- Idempotent. Two changes, each a sentence the engineering model makes that
-- the schema could not back:
--   1. The build regenerates only from a signed version. A project that turns
--      the signed handoff control on has mcp_get_baseline refuse a baseline
--      with no sealed acceptance receipt, and every answer states whether
--      the baseline is sealed and by whom, so a Planner can check before it
--      claims conformance.
--   2. The whole record exports. evidence_gather gains the discovery entries
--      (what was heard, decided and left open, with their sources) and the
--      conversations (every Inbox entry with its thread), under the same
--      leak rules as the rest of the pack: no token, no email address.
-- The discovery record itself (clearance, ranking, findings, control function
-- constraints, release reviews), the test columns and the knowledge map are
-- content: rows under existing fields, versioned in the snapshot, needing no
-- schema change.

-- ---------------------------------------------------------------------------
-- 1. Signed handoff. The control is an authored project field, exactly as
--    ctrl_mcp_propose is: a row in project_fields whose value is 'on'.
-- ---------------------------------------------------------------------------
create or replace function version_sealed(p_version uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sealed', exists (
      select 1 from sign_requests s
        join acceptance_receipts r on r.sign_request_id = s.id
       where s.version_id = p_version and s.revoked = false and s.status = 'signed'),
    'sealedBy', coalesce((
      select jsonb_agg(jsonb_build_object(
        'signerName', coalesce(nullif(s.signed_name, ''), s.signer_name),
        'signerRole', s.signer_role, 'signedAt', s.signed_at,
        'receiptId', r.id, 'tsaStatus', r.tsa_status)
        order by s.signed_at)
      from sign_requests s
      join acceptance_receipts r on r.sign_request_id = s.id
      where s.version_id = p_version and s.revoked = false and s.status = 'signed'), '[]'::jsonb));
$$;
revoke execute on function version_sealed(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function version_sealed(uuid) to service_role';
  end if;
end $$;

create or replace function mcp_get_baseline(p_org uuid, p_scope text[], p_project text, p_seq int default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v versions%rowtype; v_seal jsonb; v_signed_only boolean;
begin
  if not mcp_in_scope(p_org, p_scope, p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  select * into v from versions
   where project_id = p_project and (p_seq is null or seq = p_seq)
   order by seq desc limit 1;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'no_baseline'); end if;
  v_seal := version_sealed(v.id);
  select exists (
    select 1 from project_fields f
     where f.project_id = p_project and f.field_id = 'ctrl_signed_handoff'
       and f.value #>> '{}' = 'on') into v_signed_only;
  if v_signed_only and not coalesce((v_seal ->> 'sealed')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'unsealed',
      'message', 'This project hands off only from a sealed baseline. Baseline v' || v.label || ' carries no sealed acceptance receipt.',
      'projectId', p_project, 'label', v.label, 'seq', v.seq, 'status', v.status);
  end if;
  return jsonb_build_object('ok', true, 'projectId', p_project,
    'label', v.label, 'seq', v.seq, 'status', v.status, 'note', coalesce(v.note, ''),
    'authorName', coalesce(v.author_name, ''), 'createdAt', v.created_at,
    'snapshot', v.snapshot,
    'sealed', coalesce((v_seal ->> 'sealed')::boolean, false),
    'sealedBy', coalesce(v_seal -> 'sealedBy', '[]'::jsonb),
    'signedHandoff', v_signed_only,
    'practice', coalesce((select (to_jsonb(p) ->> 'practice')::boolean from projects p where p.id = p_project), false));
end; $$;
revoke execute on function mcp_get_baseline(uuid, text[], text, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_get_baseline(uuid, text[], text, int) to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The whole record exports. Same throat, two more arrays. author_email,
--    reply_token and author_user never leave the table; the pack's leak
--    suite greps for them anyway.
-- ---------------------------------------------------------------------------
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
    'discovery', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'takeaway', d.takeaway, 'context', d.context, 'heard', d.heard,
        'decided', d.decided, 'openQuestions', d.open_questions, 'notes', d.notes,
        'tags', d.tags, 'who', d.who, 'source', d.source, 'links', d.links,
        'authorName', d.author_name, 'promotedTo', d.promoted_to,
        'createdAt', d.created_at, 'updatedAt', d.updated_at)
        order by d.created_at)
      from discovery_entries d where d.project_id = p_project), '[]'::jsonb),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'ref', coalesce(c.ref, ''), 'origin', c.origin, 'kind', c.fb_type,
        'title', c.title, 'body', c.body, 'steps', c.steps, 'severity', c.severity,
        'verdict', c.verdict, 'status', c.status, 'assignee', c.assignee,
        'authorName', c.author_name, 'promotedTo', c.promoted_to,
        'versionSeq', c.version_seq, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
        'messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'from', m.author_kind, 'name', m.author_name, 'body', m.body, 'at', m.created_at)
            order by m.created_at)
          from messages m where m.parent_kind = 'comm' and m.parent_id = c.id), '[]'::jsonb))
        order by c.created_at)
      from comms c where c.project_id = p_project), '[]'::jsonb),
    'chain', verify_project_chain(p_project));
end; $$;
revoke execute on function evidence_gather(text) from public;
grant execute on function evidence_gather(text) to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0031', 'handoff_and_export', '29c549c175140b3e9741dd8505c5e3e1ace8f653aee43307b4f7b7abe817a24d')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
