-- fix-project-name-sync.sql - run once on the live database to keep
-- projects.name in step with the worksheet's own name answer, and to repair
-- every record that drifted before the trigger existed.
-- Idempotent: safe to run again. Fresh installs get this from schema.sql (15).
--
-- The defect: the worksheet's "Product or project name" answer (ctrl_product)
-- is the name people actually edit, but the dashboard, the approvals feed,
-- invites, the signer's page (sign_request_context), and both signature
-- mailers all read projects.name - which was written once at creation and
-- never again. Rename the record in the worksheet and every other surface,
-- including the email a client signs from, kept the stale name.
--
-- The fix is a trigger, not a client write: it runs inside the same
-- transaction as the save, covers every write path (save_field, seeds,
-- migrations), and cannot be forgotten by a future caller.
--
-- jsonb note: project_fields.value holds a jsonb string ("RecordMade").
-- value #>> '{}' extracts the bare text of a top-level scalar. value::text
-- keeps the JSON quotes and would rename the project to "RecordMade" with
-- literal quotation marks on every surface - so #>> '{}' it is, in both the
-- trigger and the repair, from the same expression.

create or replace function sync_project_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.field_id <> 'ctrl_product' then return new; end if;
  -- Only a jsonb string syncs. SQL null, jsonb null, and non-string shapes
  -- leave the name alone rather than guessing at a cast.
  if new.value is null or jsonb_typeof(new.value) <> 'string' then return new; end if;
  v_name := left(btrim(new.value #>> '{}'), 200);
  -- A cleared answer never blanks the project: the last real name stands
  -- until a new one is typed. 200 chars caps what a rename can push into
  -- every list, email subject, and receipt (the field itself allows 256 KB).
  if v_name = '' then return new; end if;
  update projects set name = v_name, updated_at = now()
   where id = new.project_id and name is distinct from v_name;
  return new;
end; $$;

drop trigger if exists pf_sync_name on project_fields;
create trigger pf_sync_name after insert or update of value on project_fields
  for each row execute function sync_project_name();

-- One-time repair: records renamed in the worksheet before this trigger
-- existed still carry the creation-time name. Same expression as the
-- trigger, so the repair and the sync cannot disagree; the `is distinct
-- from` guard makes a second run a no-op.
update projects p
   set name = left(btrim(pf.value #>> '{}'), 200), updated_at = now()
  from project_fields pf
 where pf.project_id = p.id
   and pf.field_id = 'ctrl_product'
   and pf.value is not null
   and jsonb_typeof(pf.value) = 'string'
   and btrim(pf.value #>> '{}') <> ''
   and p.name is distinct from left(btrim(pf.value #>> '{}'), 200);

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0014', 'project_name_sync', 'ec1406a54945d2c30ada1eba727d06946a8f675d93574b770dbbb63d722514c4')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
