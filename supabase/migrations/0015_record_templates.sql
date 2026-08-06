-- fix-record-templates.sql · v2.30.0
-- Firm templates: a manager saves the STANDING structure of a record
-- (organization, document type, non-functional requirements, glossary) as
-- a named template; any member starts a new record from it. The payload is
-- an opaque jsonb the app builds and consumes through a whitelist on both
-- sides; the server enforces size, count, and role. Every template carries
-- reviewed_at so a stale template is visible at the moment of use, which
-- is the documented failure mode of template systems. Reads through RLS,
-- writes through RPCs only. Run once per environment. Idempotent.

create table if not exists record_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz not null default now()
);
alter table record_templates enable row level security;
drop policy if exists record_templates_select on record_templates;
create policy record_templates_select on record_templates
  for select using (is_org_member(org_id));
revoke insert, update, delete on record_templates from authenticated;
grant select on record_templates to authenticated;

create or replace function record_template_put(p_org uuid, p_name text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_id uuid; v_count int;
begin
  if not is_org_manager(p_org) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_name := trim(coalesce(p_name, ''));
  if v_name = '' or length(v_name) > 80 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if length(coalesce(p_payload, '{}'::jsonb)::text) > 65536 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  select count(*) into v_count from record_templates where org_id = p_org;
  if v_count >= 50 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  insert into record_templates(org_id, name, payload, created_by)
    values (p_org, v_name, coalesce(p_payload, '{}'::jsonb), auth.uid())
    returning id into v_id;
  perform log_activity(p_org, null, 'template.saved', 'template', v_id::text,
    'Firm template saved: ' || v_name, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function record_template_put(uuid, text, jsonb) to authenticated;

create or replace function record_templates_list(p_org uuid)
returns table(id uuid, name text, created_at timestamptz, reviewed_at timestamptz)
language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.created_at, t.reviewed_at
    from record_templates t
   where t.org_id = p_org and is_org_member(p_org)
   order by t.name;
$$;
grant execute on function record_templates_list(uuid) to authenticated;

create or replace function record_template_get(p_id uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object('id', t.id, 'name', t.name, 'payload', t.payload, 'reviewed_at', t.reviewed_at)
    from record_templates t
   where t.id = p_id and is_org_member(t.org_id);
$$;
grant execute on function record_template_get(uuid) to authenticated;

create or replace function record_template_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record_templates%rowtype;
begin
  select * into v from record_templates where id = p_id;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_org_manager(v.org_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  delete from record_templates where id = p_id;
  perform log_activity(v.org_id, null, 'template.deleted', 'template', p_id::text,
    'Firm template deleted: ' || v.name, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function record_template_delete(uuid) to authenticated;

create or replace function record_template_touch(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record_templates%rowtype;
begin
  select * into v from record_templates where id = p_id;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_org_manager(v.org_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update record_templates set reviewed_at = now() where id = p_id;
  perform log_activity(v.org_id, null, 'template.reviewed', 'template', p_id::text,
    'Firm template reviewed: ' || v.name, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function record_template_touch(uuid) to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0015', 'record_templates', 'ec077044e884369da6ea39646eff3a0edc4bec5379dd940e3161cddeeea0fc53')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
