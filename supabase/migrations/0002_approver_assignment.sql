-- ============================================================================
-- fix-approver-assignment.sql  (idempotent)
--
-- In-app approval routing. An approver slot can be assigned to a real team
-- member; that member then sees a "waiting on you" flag inside the app and can
-- approve their OWN slot. No email is sent. Free-text approver names still work
-- exactly as before (a manual sign-off with no assignee). Safe to run more than
-- once; changes nothing for existing rows (approver_user_id defaults null).
--
-- Run this once in the Supabase SQL editor. No data is modified.
-- ============================================================================

-- 1) The assignment column. Null = a manual, free-text approver (today's behavior).
alter table version_approvals add column if not exists approver_user_id uuid;
create index if not exists va_user on version_approvals(approver_user_id);

-- 2) Decisions: a manager may decide any slot; the ASSIGNED team member may
--    decide their own. Everyone else is refused. Provenance is unchanged: the
--    trigger still stamps decided_by/decided_at from auth.uid(), so a sign-off
--    is always attributed to whoever actually made it.
-- SUPERSEDED (v2.28.1): the approval_decide this patch installed is replaced
-- by supabase/fix-approval-advance.sql, which changes the return type to
-- jsonb and makes decisions advance the version. It is intentionally NOT
-- re-created here so that re-running this file can never downgrade a
-- deployment. Environments that ran this patch historically got the boolean
-- version; fix-approval-advance.sql drops and replaces it.

-- 3) The "waiting on you" feed: every pending slot assigned to the caller on a
--    version that is currently in review. Drives the dashboard flag.
-- SUPERSEDED (v2.28.1): my_open_approvals now includes draft versions and is
-- maintained in supabase/fix-approval-advance.sql and schema.sql. Not
-- re-created here for the same downgrade-safety reason.

-- 4) Team roster with display names, for the "assign to" picker. Restricted to
--    members of the org (the caller must be one).
create or replace function org_members_named(p_org uuid)
returns table(user_id uuid, email text, display_name text)
language sql security definer set search_path = public as $$
  select m.user_id, m.email, coalesce(up.display_name, '')
    from org_members m
    left join user_profiles up on up.user_id = m.user_id
   where m.org_id = p_org
     and exists(select 1 from org_members me where me.org_id = p_org and me.user_id = auth.uid());
$$;
grant execute on function org_members_named(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0002', 'approver_assignment', '8475b3d177390e9617d329e81c7e38ac0602fad876cf6cede5760bd1b09d96fe')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
