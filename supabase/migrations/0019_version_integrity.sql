-- ============================================================================
-- ReqPub - version integrity: baselines immutable at the table · v2.20.0
-- ============================================================================
-- Run ONCE in the Supabase SQL editor (idempotent; safe to re-run). Closes a
-- privilege hole found in independent review: the pre-2.20 `ver_update`
-- policy, combined with the table grant, let any project manager UPDATE any
-- column of `versions` directly - snapshot, status, label, author_name,
-- created_at - bypassing version_set_status (the transition whitelist and the
-- all-approvals-green gate) and writing no activity row. The client only ever
-- used that surface for the build tag.
--
-- After this migration, versions match the posture of project_fields,
-- field_rows, and activity: direct write revoked, definer RPCs the only path.
-- Inserts already flowed only through create_version (no insert policy);
-- status already moved only through version_set_status; the build tag now
-- moves through version_set_build, which is manager-gated, size-capped, and
-- logged to the audit trail. Nothing else about a baseline can change.
-- ============================================================================

revoke insert, update, delete on versions from authenticated;
drop policy if exists ver_update on versions;

create or replace function version_set_build(p_version uuid, p_build text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v versions%rowtype;
begin
  select * into v from versions where id = p_version;
  if v.id is null or not is_project_manager(v.project_id) then return false; end if;
  if length(coalesce(p_build, '')) > 120 then return false; end if;
  update versions set build = coalesce(p_build, '') where id = p_version;
  perform log_activity(project_org(v.project_id), v.project_id, 'version.build', 'version',
    p_version::text, 'v' || v.label || ' build tag set', jsonb_build_object('build', coalesce(p_build, '')));
  return true;
end; $$;
grant execute on function version_set_build(uuid, text) to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0019', 'version_integrity', 'fd897961681677c56eacf332029edc7b4f710323e529ad5589fa713e2ca20ed4')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
