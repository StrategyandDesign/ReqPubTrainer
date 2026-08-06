-- ============================================================================
-- ReqPub - partner-portal fixes (v2.8.2)   ← run this ONE file in Supabase
-- ============================================================================
-- Supersedes fix-brand-overlay.sql (includes everything it did). Safe to run on
-- its own, any time, repeatedly. No schema changes; no data is modified.
--
-- Fixes two things partners saw:
--   1. Assignments with no published brief appeared with their internal id (e.g.
--      "pmr1muwe…") as the title. Partners now only see PRDs the team has
--      published a brief for; the payload also carries the real project name.
--   2. A collaborator logo uploaded AFTER a brief was shared did not reach the
--      partner (nor SME brief / presentation links shared earlier), because
--      external viewers read a snapshot taken at share time. The logo is a
--      current property of the project, so it is now overlaid at read time.
--
-- How to apply: Supabase → SQL Editor → New query → paste all of this → Run.
-- ============================================================================

-- Partner portal: assigned PRDs, with real names + live-brand overlay.
create or replace function partner_projects_v2()
returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', pa.project_id,
    'name', pr.name,
    'payload', (select s.payload || jsonb_build_object('logo', pr.brand_logo, 'brandLabel', pr.brand_label)
                 from shares s
                 where s.project_id = pa.project_id and s.kind = 'brief' and s.revoked = false
                 order by s.version_seq desc limit 1))), '[]'::jsonb)
  from partner_access pa
  join partners p on p.id = pa.partner_id
  join projects pr on pr.id = pa.project_id
  where p.user_id = auth.uid()
    -- Only PRDs with a published brief: partners see what is ready to review.
    and exists (select 1 from shares s2
                where s2.project_id = pa.project_id and s2.kind = 'brief' and s2.revoked = false);
$$;
grant execute on function partner_projects_v2() to authenticated;

-- Accountless SME brief + read-only presentation link (both served by get_share):
-- overlay the project's current logo/label onto the shared snapshot at read time.
create or replace function get_share(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select case when p.id is null then s.payload
              else s.payload || jsonb_build_object('logo', p.brand_logo, 'brandLabel', p.brand_label) end
  from shares s left join projects p on p.id = s.project_id
  where s.token = p_token and s.revoked = false limit 1;
$$;
grant execute on function get_share(text) to anon, authenticated;

-- Verify (optional): assigned PRDs now list with a real name.
--   select pa.project_id, pr.name from partner_access pa
--   join projects pr on pr.id = pa.project_id;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0013', 'partner_portal', 'cbe6bf515c3e7ae16cdfe69034ecd7d23d0cbce4257f42b81ff12433949d97ee')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
