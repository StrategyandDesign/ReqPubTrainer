-- ============================================================================
-- ReqPub - display-label fix: attachment uploader fallback name · v2.22.1
-- ============================================================================
-- Run ONCE in the Supabase SQL editor (idempotent; safe to re-run). One word:
-- when a client contact has no name on their row, the resolver's fallback
-- display name said 'Partner' - the one word the UI no longer uses (the
-- buyer's firm reserves it for its owners; see docs/DEPLOY.md, Naming). The
-- schema role, tables, and keys keep the name `partner` permanently; only the
-- string a person could read changes. No behavior, authorization, or shape
-- change - this is the same function with a different fallback label.
-- Historical rows are untouched; the fallback only applies at resolve time.
-- ============================================================================

create or replace function attachment_uploader(p_comm uuid, p_user uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case
    when c.id is null then jsonb_build_object('ok', false, 'error', 'bad_thread')
    when exists (select 1 from org_members m where m.org_id = c.org_id and m.user_id = p_user)
      then jsonb_build_object('ok', true, 'kind', 'team', 'org_id', c.org_id, 'project_id', c.project_id,
             'name', coalesce((select display_name from user_profiles up where up.user_id = p_user), 'Team'))
    when exists (select 1 from partners pt join partner_access pa on pa.partner_id = pt.id
                 where pt.user_id = p_user and pa.project_id = c.project_id)
      then jsonb_build_object('ok', true, 'kind', 'partner', 'org_id', c.org_id, 'project_id', c.project_id,
             'name', coalesce((select name from partners where user_id = p_user and org_id = c.org_id limit 1), 'Client contact'))
    else jsonb_build_object('ok', false, 'error', 'forbidden')
  end
  from (select 1) one left join comms c on c.id = p_comm;
$$;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0005', 'client_contact_label', 'f9d22d3aa1a2de7d1004ffffefe38d48acf6ff0401aa7f2e093cca2aa9fed123')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
