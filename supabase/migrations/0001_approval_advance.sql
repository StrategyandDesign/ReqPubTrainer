-- fix-approval-advance.sql · v2.28.1
-- An approval decision now advances the version on its own. Before this,
-- approval_decide recorded the sign-off and touched nothing else, so an
-- approver could click Approve on a draft, see their row flip to Approved,
-- and watch the version pill keep saying Draft until someone also clicked
-- Send for review - the record contradicting itself on screen. The rule
-- now lives where the decision lands:
--   · first approval on a draft (others still pending)  → In review
--   · every slot approved                               → Approved
--   · a changes request on a draft or in-review version → Changes requested
--   · undoing a decision on an approved version         → In review
-- The invariant is unchanged and now enforced in both directions: a version
-- is never Approved while any slot is not approved. Send for review remains
-- as the explicit kickoff; it is no longer a required ceremony.
-- The return type changes from boolean to jsonb (ok, error, version_status),
-- matching version_set_status, so the app can update the pill without a
-- refetch. Run once per environment. Idempotent.

drop function if exists approval_decide(uuid, text, text);
create function approval_decide(p_approval uuid, p_status text, p_comment text default '')
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
grant execute on function approval_decide(uuid, text, text) to authenticated;

-- The waiting-on-you feed now includes draft versions: an approver assigned
-- before Send for review can act, and their click alone advances the version.
create or replace function my_open_approvals()
returns table(approval_id uuid, project_id text, project_name text,
              version_id uuid, version_label text, version_seq int, approver_role text)
language sql security definer set search_path = public as $$
  select a.id, v.project_id, p.name, v.id, v.label, v.seq, a.approver_role
    from version_approvals a
    join versions v on v.id = a.version_id
    join projects p on p.id = v.project_id
   where a.approver_user_id = auth.uid()
     and a.status = 'pending'
     and v.status in ('draft','in_review')
   order by v.seq desc;
$$;
grant execute on function my_open_approvals() to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0001', 'approval_advance', '4e187c845a11ce4d5451854c25af3b698c15dd0b0d7c10e7559b0deb127cf610')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
