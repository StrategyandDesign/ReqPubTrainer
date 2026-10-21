-- ReqPub 3.1.0 - the record conformance release
-- Idempotent. Four changes, each a sentence the discovery paper makes that the
-- schema could not back:
--   1. A row remembers who authored it and where it came from. field_rows gains
--      author_name and origin; upsert_row takes an optional source comm and
--      copies both from it server side, so the operator whose words were
--      promoted is the row's author, and an agent's draft stays marked agent.
--   2. A timestamp reply is checked before it is stored. receipt_tsa_update
--      accepted any text and marked the receipt dual; it now refuses a reply
--      without the shape of a granted RFC 3161 response carrying this
--      receipt's hash, and a stored reply is never overwritten.
--   3. A client's slot is satisfied by the client's own e-signature and by
--      nothing a manager clicks. approval_decide refuses to approve a slot
--      with no assigned teammate, and the provenance trigger refuses the same
--      transition on a direct write.
--   4. A signature advances the version. sign_request_sign lands on the slot
--      held for the signer, or opens one, and moves the version to in_review
--      or approved exactly as an in-app decision does.

-- ---------------------------------------------------------------------------
-- 1. Row authorship and origin.
-- ---------------------------------------------------------------------------
alter table field_rows add column if not exists author_name text not null default '';
alter table field_rows add column if not exists origin text not null default 'app';
alter table field_rows drop constraint if exists field_rows_origin_check;
alter table field_rows add constraint field_rows_origin_check
  check (origin in ('app','brief','sme','partner','team','meeting','update','agent'));

drop function if exists upsert_row(text, text, uuid, jsonb, double precision, integer);
create or replace function upsert_row(
  p_project text, p_field text, p_id uuid, p_data jsonb,
  p_pos double precision default null, p_base_rev integer default null, p_source uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row field_rows%rowtype; v_k integer; v_pos double precision;
        v_author text; v_origin text;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if pg_column_size(p_data) > 131072 then           -- 128 KB per row
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;

  if p_id is null then
    -- Authorship is stamped once, at insert, and never rewritten. A row typed
    -- in the app is authored by the manager typing it. A row promoted from an
    -- Inbox entry is authored by that entry's author and carries its origin,
    -- read here from the comm rather than trusted from the client.
    v_author := current_display_name(); v_origin := 'app';
    if p_source is not null then
      select c.author_name, c.origin into v_author, v_origin
        from comms c where c.id = p_source and c.project_id = p_project;
      if not found then return jsonb_build_object('ok', false, 'error', 'bad_source'); end if;
      v_author := coalesce(nullif(trim(v_author), ''), current_display_name());
    end if;
    -- Serialize k allocation per (project, field): two simultaneous adds get
    -- distinct k values and distinct rows. This was v1's #1 data-loss bug.
    perform pg_advisory_xact_lock(hashtextextended(p_project || '/' || p_field, 42));
    select coalesce(max(k), 0) + 1 into v_k from field_rows
      where project_id = p_project and field_id = p_field;
    select coalesce(max(pos), 0) + 1 into v_pos from field_rows
      where project_id = p_project and field_id = p_field and not deleted;
    insert into field_rows(project_id, field_id, k, data, pos, updated_by, updated_by_name, author_name, origin)
    values (p_project, p_field, v_k, coalesce(p_data, '{}'::jsonb), coalesce(p_pos, v_pos),
            auth.uid(), current_display_name(), v_author, v_origin)
    returning * into v_row;
  else
    update field_rows
       set data = coalesce(p_data, data), pos = coalesce(p_pos, pos), rev = rev + 1,
           updated_by = auth.uid(), updated_by_name = current_display_name(), updated_at = now()
     where id = p_id and project_id = p_project
       and (p_base_rev is null or rev = p_base_rev)
    returning * into v_row;
    if v_row.id is null then
      select * into v_row from field_rows where id = p_id;
      if v_row.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
      return jsonb_build_object('ok', false, 'conflict', true, 'rev', v_row.rev,
        'data', v_row.data, 'by', v_row.updated_by_name, 'at', v_row.updated_at);
    end if;
  end if;

  update projects set updated_at = now() where id = p_project;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'k', v_row.k, 'rev', v_row.rev, 'pos', v_row.pos,
    'author', v_row.author_name, 'origin', v_row.origin);
end; $$;
revoke execute on function upsert_row(text, text, uuid, jsonb, double precision, integer, uuid) from public, anon;
grant execute on function upsert_row(text, text, uuid, jsonb, double precision, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A timestamp reply must cover this receipt.
-- ---------------------------------------------------------------------------
-- True when the base64 text decodes to a DER SEQUENCE whose PKIStatusInfo
-- reads granted (0) or grantedWithMods (1) and whose bytes carry the
-- receipt's canonical hash, which is what the TSTInfo messageImprint holds.
-- A shape check, deliberately: the signature chain is verified offline by
-- the CLI and by openssl, and this function keeps garbage out of the column.
create or replace function receipt_tsa_covers(p_der text, p_hash_hex text)
returns boolean language plpgsql immutable set search_path = public as $$
declare b bytea; h bytea; head bytea;
begin
  if p_der is null or p_hash_hex is null then return false; end if;
  begin
    b := decode(p_der, 'base64');
    h := decode(p_hash_hex, 'hex');
  exception when others then return false; end;
  if length(b) < 16 or length(h) < 20 then return false; end if;
  if get_byte(b, 0) <> 48 then return false; end if;             -- 0x30, a SEQUENCE
  head := substring(b from 1 for 12);
  if position('\x020100'::bytea in head) = 0 and position('\x020101'::bytea in head) = 0 then
    return false;                                                 -- PKIStatus is not granted
  end if;
  return position(h in b) > 0;                                    -- the imprint is this receipt
end; $$;
revoke execute on function receipt_tsa_covers(text, text) from public, anon, authenticated;

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
  -- v3.1: the column holds only replies that are granted and carry this
  -- receipt's hash. Before this check any caller with the token or a
  -- membership could mark a receipt dual with arbitrary text.
  if p_primary is not null and not receipt_tsa_covers(p_primary, rec.canonical_hash) then
    raise exception 'primary timestamp reply does not cover this receipt';
  end if;
  if p_secondary is not null and not receipt_tsa_covers(p_secondary, rec.canonical_hash) then
    raise exception 'secondary timestamp reply does not cover this receipt';
  end if;
  -- Write once. A stored reply is evidence and is never replaced, so a
  -- holder of the sign link cannot swap a genuine token for one that merely
  -- passes the shape check and so break offline verification of the pack.
  -- A retry fills only what is still missing.
  v_status := case
    when coalesce(rec.tsa_primary_der, p_primary) is not null
     and coalesce(rec.tsa_secondary_der, p_secondary) is not null then 'dual'
    when coalesce(rec.tsa_primary_der, p_primary) is not null
      or coalesce(rec.tsa_secondary_der, p_secondary) is not null then 'single'
    else 'pending' end;
  update acceptance_receipts set
    tsa_primary_der = coalesce(tsa_primary_der, p_primary),
    tsa_secondary_der = coalesce(tsa_secondary_der, p_secondary),
    tsa_status = v_status
  where id = p_receipt;
  if v_status <> rec.tsa_status then
    perform log_activity(rec.org_id, rec.project_id, 'seal.timestamped', 'receipt',
      rec.id::text, 'Receipt timestamps: ' || v_status, '{}'::jsonb);
  end if;
  return jsonb_build_object('id', p_receipt, 'tsa_status', v_status);
end; $$;

-- ---------------------------------------------------------------------------
-- 3. A client's slot is approved by the client.
-- ---------------------------------------------------------------------------
create or replace function enforce_approval_provenance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending';                 -- approvers are added pending, never pre-approved
    new.decided_by := null; new.decided_at := null;
  elsif new.status is distinct from old.status then
    -- v3.1: a slot with no assigned teammate belongs to someone outside the
    -- team. It reaches approved only through that person's e-signature,
    -- which arrives with its sign_request_id. A direct write cannot.
    if new.status = 'approved' and new.approver_user_id is null and new.sign_request_id is null then
      raise exception 'esign_required: a slot with no assigned teammate is approved by e-signature only';
    end if;
    if new.status = 'pending' then
      new.decided_by := null; new.decided_at := null;
    else
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists va_provenance on version_approvals;
create trigger va_provenance before insert or update on version_approvals
  for each row execute function enforce_approval_provenance();

create or replace function approval_decide(p_approval uuid, p_status text, p_comment text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ver versions%rowtype; v_uid uuid; v_self boolean; v_pending int; v_new text;
begin
  select v.* into v_ver from versions v
    join version_approvals a on a.version_id = v.id where a.id = p_approval;
  if v_ver.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select approver_user_id into v_uid from version_approvals where id = p_approval;
  v_self := v_uid is not null and v_uid = auth.uid();
  if not (is_project_manager(v_ver.project_id)
          or (v_self and is_project_member(v_ver.project_id))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_status not in ('pending','approved','changes_requested') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  -- v3.1: a slot with no assigned teammate is a client's slot. It is
  -- satisfied by that person's own e-signature (sign_request_sign) and by
  -- nothing a manager clicks, so the firm cannot approve on the client's
  -- behalf. Requesting changes and reopening stay with the manager.
  if p_status = 'approved' and v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'esign_required');
  end if;
  update version_approvals
     set status = p_status, comment = coalesce(p_comment, ''),
         decided_by = auth.uid(), decided_at = case when p_status = 'pending' then null else now() end
   where id = p_approval;
  perform log_activity(project_org(v_ver.project_id), v_ver.project_id, 'approval.' || p_status,
    'approval', p_approval::text, 'v' || v_ver.label || ' approval ' || p_status, '{}'::jsonb);

  -- The decision advances the version. No slot count is trusted from the
  -- client: it is re-read here, after the update, inside the function.
  select count(*) into v_pending from version_approvals
   where version_id = v_ver.id and status <> 'approved';
  v_new := v_ver.status;
  if p_status = 'approved' then
    if v_pending = 0 then v_new := 'approved';
    elsif v_ver.status in ('draft','changes_requested') then v_new := 'in_review';
    end if;
  elsif p_status = 'changes_requested' and v_ver.status in ('draft','in_review') then
    v_new := 'changes_requested';
  elsif p_status = 'pending' and v_ver.status = 'approved' and v_pending > 0 then
    v_new := 'in_review';   -- an approved version cannot stand with a slot reopened
  end if;
  if v_new <> v_ver.status then
    update versions set status = v_new where id = v_ver.id;
    perform log_activity(project_org(v_ver.project_id), v_ver.project_id, 'version.status', 'version',
      v_ver.id::text, 'v' || v_ver.label || ' → ' || v_new,
      jsonb_build_object('from', v_ver.status, 'to', v_new, 'via', 'approval'));
  end if;
  return jsonb_build_object('ok', true, 'version_status', v_new);
end; $$;

-- ---------------------------------------------------------------------------
-- 4. A signature lands on the slot held for the signer and advances the version.
-- ---------------------------------------------------------------------------
create or replace function sign_request_sign(p_token text, p_typed_name text, p_ua text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r sign_requests%rowtype; v_ver versions%rowtype; v_appr uuid; v_deliv jsonb; v_pending int; v_new text;
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
  -- The signature manifests as an approval row. A pending slot held for this
  -- signer (no assigned teammate, not yet signed, named as the request or as
  -- the typed signature) is the landing; otherwise a new row is opened. The
  -- provenance trigger stamps decided_at on the decision; decided_by stays
  -- null for an accountless signer, and attribution lives in the signature
  -- record (typed name, email channel, token, timestamps).
  select a.id into v_appr from version_approvals a
   where a.version_id = r.version_id and a.status = 'pending'
     and a.approver_user_id is null and a.sign_request_id is null
     and trim(a.approver_name) <> ''
     and lower(trim(a.approver_name)) in (lower(trim(p_typed_name)), lower(trim(coalesce(r.signer_name, ''))))
   limit 1;
  if v_appr is null then
    insert into version_approvals(version_id, approver_role, approver_name)
    values (r.version_id, coalesce(nullif(trim(r.signer_role), ''), 'Signer'), trim(p_typed_name))
    returning id into v_appr;
  end if;
  update version_approvals
     set status = 'approved', comment = 'Signed electronically', sign_request_id = r.id,
         approver_name = trim(p_typed_name)
   where id = v_appr;
  update sign_requests
     set status = 'signed', signed_name = trim(p_typed_name), signed_at = now(), approval_id = v_appr,
         evidence = coalesce(evidence, '{}'::jsonb)
           || jsonb_build_object('ua', left(coalesce(p_ua, ''), 400), 'channel', 'email_token')
   where id = r.id;
  perform log_activity(r.org_id, r.project_id, 'sign.signed',
    'sign', r.id::text, 'v' || v_ver.label || ' signed by ' || trim(p_typed_name) || ' (' || r.signer_email || ')', '{}'::jsonb);
  -- v3.1: the signature advances the version exactly as an in-app decision
  -- does. Until now a fully signed version could stand In review forever.
  select count(*) into v_pending from version_approvals
   where version_id = v_ver.id and status <> 'approved';
  v_new := v_ver.status;
  if v_pending = 0 then v_new := 'approved';
  elsif v_ver.status in ('draft','changes_requested') then v_new := 'in_review';
  end if;
  if v_new <> v_ver.status then
    update versions set status = v_new where id = v_ver.id;
    perform log_activity(r.org_id, r.project_id, 'version.status', 'version',
      v_ver.id::text, 'v' || v_ver.label || ' → ' || v_new,
      jsonb_build_object('from', v_ver.status, 'to', v_new, 'via', 'esign'));
  end if;
  select coalesce(jsonb_agg(d.id), '[]'::jsonb) into v_deliv
    from webhook_deliveries d
   where d.event_type = 'sign.signed' and d.state = 'pending' and d.attempt = 0
     and d.payload->>'signRequestId' = r.id::text;
  return jsonb_build_object('ok', true, 'signedAt', now(), 'approvalId', v_appr,
    'versionStatus', v_new, 'pendingDeliveries', v_deliv);
end; $$;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0030', 'record_conformance', '57f4ab068f25c17f9b222b6e4904711966d9d1f81de889ff59ff4324154051fb')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
