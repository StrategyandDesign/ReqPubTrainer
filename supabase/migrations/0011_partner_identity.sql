-- ============================================================================
-- ReqPub - one partner identity per email per workspace · v2.34.0
-- ============================================================================
-- Run ONCE in the Supabase SQL editor (idempotent, safe to re-run). Identical
-- content lives in supabase/schema.sql section 4b, so a fresh install and a
-- live upgrade converge on the same state.
--
-- The defect. partners carried no uniqueness constraint on (org_id, email).
-- Two rows could therefore exist for one client email inside one workspace,
-- each holding its own partner_access grant to the same project. Every read
-- that joins partner_access -> partners -> projects then returned that project
-- once per identity, so the portal rendered it twice. The duplication was
-- never in the project data; it was in the identity table underneath it.
--
-- The fix is three steps, in this order, because the last one cannot be
-- created while the condition it forbids still exists in the table:
--
--   1. Merge. Group by (org_id, lower(email)). Keep the OLDEST row. Repoint
--      every child row at the keeper, then delete the losers.
--   2. Enforce. Unique index on (org_id, lower(email)).
--   3. Defend. partner_projects_v2 selects a distinct project list, so a
--      future identity defect cannot reach the portal as a duplicate card.
--
-- What the merge preserves, and why each matters:
--
--   * Message history. comms.partner_id and partner_notes.partner_id are both
--     ON DELETE SET NULL. Deleting a duplicate WITHOUT repointing first would
--     silently orphan every note that partner ever wrote: the rows survive but
--     stop being attributable, and partner_thread_v2 (which filters on
--     partner_id) stops returning them to the partner entirely. Repointing
--     precedes deletion for that reason, and only for that reason.
--   * The login link. partners.user_id is set when the partner signs up. The
--     oldest row is frequently the one a manager typed first and the NEWER row
--     the one that actually got claimed at signup, so keeping the oldest row
--     naively would strip the partner of their own login. user_id is therefore
--     lifted from whichever row in the group has one.
--   * Profile text. name, title, and company are lifted the same way when the
--     keeper's are blank, so a merge never blanks a filled-in profile.
--   * Project access. The union of both identities' grants, never the
--     intersection. A partner keeps every project either identity could see.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Merge duplicate identities onto the oldest row
-- ---------------------------------------------------------------------------
do $$
declare
  g record;
  v_keep uuid;
  v_dups uuid[];
begin
  for g in
    select org_id, lower(email) as key
    from partners
    where coalesce(trim(email), '') <> ''
    group by org_id, lower(email)
    having count(*) > 1
  loop
    -- The keeper: oldest by created_at, id as the deterministic tiebreak so
    -- two runs on the same data always choose the same row.
    select id into v_keep
    from partners
    where org_id = g.org_id and lower(email) = g.key
    order by created_at asc nulls last, id asc
    limit 1;

    select array_agg(id) into v_dups
    from partners
    where org_id = g.org_id and lower(email) = g.key and id <> v_keep;

    -- Lift the login link and any profile text the keeper is missing. Ordered
    -- by age so the earliest non-null wins, which keeps the result stable.
    update partners k set
      user_id = coalesce(k.user_id, (
        select d.user_id from partners d
        where d.id = any(v_dups) and d.user_id is not null
        order by d.created_at asc nulls last, d.id asc limit 1)),
      name = coalesce(nullif(trim(k.name), ''), (
        select nullif(trim(d.name), '') from partners d
        where d.id = any(v_dups) and coalesce(trim(d.name), '') <> ''
        order by d.created_at asc nulls last, d.id asc limit 1)),
      title = coalesce(nullif(trim(k.title), ''), (
        select nullif(trim(d.title), '') from partners d
        where d.id = any(v_dups) and coalesce(trim(d.title), '') <> ''
        order by d.created_at asc nulls last, d.id asc limit 1), ''),
      company = coalesce(nullif(trim(k.company), ''), (
        select nullif(trim(d.company), '') from partners d
        where d.id = any(v_dups) and coalesce(trim(d.company), '') <> ''
        order by d.created_at asc nulls last, d.id asc limit 1), '')
    where k.id = v_keep;

    -- Project access: move grants the keeper does not already hold, then drop
    -- the rest. Two steps because (partner_id, project_id) is the primary key
    -- and a blind update would collide on every shared project.
    update partner_access pa set partner_id = v_keep
    where pa.partner_id = any(v_dups)
      and not exists (select 1 from partner_access k
                      where k.partner_id = v_keep and k.project_id = pa.project_id);
    delete from partner_access where partner_id = any(v_dups);

    -- Message history, repointed before the delete that would null it out.
    update comms set partner_id = v_keep where partner_id = any(v_dups);
    if to_regclass('public.partner_notes') is not null then
      execute 'update partner_notes set partner_id = $1 where partner_id = any($2)'
        using v_keep, v_dups;
    end if;

    delete from partners where id = any(v_dups);

    raise notice 'partners: merged % duplicate identities into % for %',
      array_length(v_dups, 1), v_keep, g.key;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Enforce it at the table
-- ---------------------------------------------------------------------------
-- Case-insensitive on purpose: Ada@client.com and ada@client.com are one
-- person, and the portal duplicated exactly that pair. Rows with a blank
-- email are excluded rather than collapsed; they are unclaimed placeholders,
-- not identities, and merging them would join unrelated people.
create unique index if not exists partners_org_email_uniq
  on partners (org_id, lower(email))
  where coalesce(trim(email), '') <> '';

-- ---------------------------------------------------------------------------
-- 3) Second defensive layer, at the read
-- ---------------------------------------------------------------------------
-- The distinct is deliberately redundant with the index above. The index is
-- the guarantee; this is the blast radius if the guarantee is ever dropped,
-- bypassed by a future migration, or defeated by a second identity path that
-- does not exist yet. A duplicate identity should be a data problem, never a
-- visible defect in the client's portal.
create or replace function partner_projects_v2()
returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', t.project_id,
    'name', t.name,
    'payload', (select s.payload || jsonb_build_object('logo', t.brand_logo, 'brandLabel', t.brand_label)
                 from shares s
                 where s.project_id = t.project_id and s.kind = 'brief' and s.revoked = false
                 order by s.version_seq desc limit 1))), '[]'::jsonb)
  from (
    -- One row per project, however many identities reach it.
    select distinct pr.id as project_id, pr.name, pr.brand_logo, pr.brand_label
    from partner_access pa
    join partners p on p.id = pa.partner_id
    join projects pr on pr.id = pa.project_id
    where p.user_id = auth.uid()
      -- Only surface PRDs the team has actually published a brief for: a
      -- partner should see things ready to review, not assignments still
      -- being drafted.
      and exists (select 1 from shares s2
                  where s2.project_id = pa.project_id and s2.kind = 'brief' and s2.revoked = false)
  ) t;
$$;
grant execute on function partner_projects_v2() to authenticated;

notify pgrst, 'reload schema';

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0011', 'partner_identity', '50d887a27efea116ea0c764895a632ab90076c504b23ba094ac7690874994dd7')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
