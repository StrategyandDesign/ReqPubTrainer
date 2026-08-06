-- ============================================================================
-- ReqPub v2 - post-migration verification
-- Run after schema.sql + migrate.sql. Every row should read true (or show
-- matching v1/v2 counts). Investigate any false before cutting the app over.
-- ============================================================================

-- 1) Schema present
select 'tables exist' as check, count(*) = 11 as pass
from information_schema.tables
where table_schema = 'public' and table_name in
  ('user_profiles','projects','project_fields','field_rows','versions',
   'version_approvals','comms','messages','input_requests','discovery_entries','activity');

select 'rls enabled everywhere' as check, bool_and(rowsecurity) as pass
from pg_tables
where schemaname = 'public' and tablename in
  ('user_profiles','projects','project_fields','field_rows','versions',
   'version_approvals','comms','messages','input_requests','discovery_entries','activity');

select 'rpcs exist' as check, count(*) >= 23 as pass
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('save_field','upsert_row','delete_row','create_version','version_set_status',
   'approval_decide','share_put','share_revoke','submit_share_v2','sme_thread','sme_reply',
   'request_view','request_submit','partner_projects_v2','partner_thread_v2','partner_post',
   'partner_reply','v2_context','url_token','log_activity',
   'record_template_put','record_templates_list','record_template_get',
   'record_template_delete','record_template_touch');

select 'broadcast triggers wired' as check, count(*) = 9 as pass
from pg_trigger where tgname like '%_bcast' and not tgisinternal;

select 'realtime channel policies' as check, count(*) = 2 as pass
from pg_policies where schemaname = 'realtime' and tablename = 'messages'
  and policyname in ('rt_recv','rt_send');

-- Broadcast-from-database must exist, or live sync silently degrades.
select 'realtime broadcast function available' as check,
       exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'realtime' and p.proname = 'broadcast_changes') as pass;

select 'team-identity triggers wired' as check, count(*) = 2 as pass
from pg_trigger where tgname in ('messages_team_author','comms_team_author') and not tgisinternal;

select 'body-size constraints present' as check, count(*) = 2 as pass
from pg_constraint where conname in ('comms_body_cap','messages_body_cap');

-- v2.5 hardening
select 'version label format guard present' as check,
       exists(select 1 from pg_constraint where conname = 'versions_label_fmt') as pass;

select 'approval-provenance trigger wired' as check,
       exists(select 1 from pg_trigger where tgname = 'va_provenance' and not tgisinternal) as pass;

select 'activity has org FK' as check,
       exists(select 1 from pg_constraint where conrelid = 'activity'::regclass and contype = 'f') as pass;

select 'realtime send is manager-only on projects' as check,
       (select pg_get_expr(polwithcheck, polrelid) from pg_policy where polname = 'rt_send')
         like '%is_project_manager%' as pass;

select 'audit-only tables have write revoked from authenticated' as check,
       not has_table_privilege('authenticated', 'activity', 'INSERT')
       and not has_table_privilege('authenticated', 'project_fields', 'UPDATE')
       and not has_table_privilege('authenticated', 'field_rows', 'UPDATE') as pass;

select 'partner FK indexes present' as check,
       (select count(*) from pg_indexes
        where indexname in ('partners_user', 'partner_access_project')) = 2 as pass;

-- v2.6
select 'project brand columns present' as check,
       (select count(*) from information_schema.columns
        where table_name = 'projects' and column_name in ('brand_logo', 'brand_label')) = 2 as pass;

-- v2.7
select 'partner present-token RPC exists' as check,
       exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'partner_present_token') as pass;

select 'activity is append-only (no write policies)' as check,
       count(*) = 0 as pass
from pg_policies where schemaname = 'public' and tablename = 'activity'
  and cmd in ('INSERT','UPDATE','DELETE','ALL');

-- 2) Migration counts: v1 vs v2 side by side (all three columns should match
--    per row; small deltas can appear if v1 arrays held empty/blank items,
--    which are intentionally not migrated)
select 'projects' as entity,
  (select count(distinct p->>'id') from kv, jsonb_array_elements(kv.value) p
    where kv.key = 'rm:index' and jsonb_typeof(kv.value) = 'array') as v1,
  (select count(*) from projects) as v2;

select 'versions' as entity,
  (select count(*) from kv, jsonb_array_elements(kv.value)
    where kv.key ~ '^rm:proj:[^:]+:versions$' and jsonb_typeof(kv.value) = 'array') as v1,
  (select count(*) from versions) as v2;

select 'feedback comms' as entity,
  (select count(*) from kv, jsonb_array_elements(kv.value)
    where kv.key ~ '^rm:proj:[^:]+:feedback$' and jsonb_typeof(kv.value) = 'array') as v1,
  (select count(*) from comms where origin in ('app','brief')) as v2;

select 'notes + partner comms (v2 dedupes the partner overlap)' as entity,
  (select count(*) from kv, jsonb_array_elements(kv.value)
    where kv.key ~ '^rm:proj:[^:]+:notes$' and jsonb_typeof(kv.value) = 'array')
  + (select count(*) from partner_notes) as v1_upper_bound,
  (select count(*) from comms where origin in ('team','sme','meeting','partner')) as v2;

select 'input requests' as entity,
  (select count(*) from kv, jsonb_array_elements(kv.value)
    where kv.key ~ '^rm:proj:[^:]+:noteReqs$' and jsonb_typeof(kv.value) = 'array') as v1,
  (select count(*) from input_requests) as v2;

select 'discovery entries' as entity,
  (select count(*) from kv, jsonb_array_elements(kv.value)
    where kv.key ~ '^rm:proj:[^:]+:discovery$' and jsonb_typeof(kv.value) = 'array') as v1,
  (select count(*) from discovery_entries) as v2;

-- 3) Integrity spot checks
select 'no orphan field rows' as check,
  not exists(select 1 from field_rows fr left join projects p on p.id = fr.project_id where p.id is null) as pass;

select 'no orphan comms' as check,
  not exists(select 1 from comms c left join projects p on p.id = c.project_id where p.id is null) as pass;

select 'requirement ids unique per field' as check,
  not exists(select 1 from field_rows group by project_id, field_id, k having count(*) > 1) as pass;

select 'version labels unique per project' as check,
  not exists(select 1 from versions group by project_id, label having count(*) > 1) as pass;

select 'legacy request tokens adopted' as check,
  (select count(*) from input_requests ir join shares s on s.token = ir.token where s.kind = 'note')
  || ' of ' || (select count(*) from input_requests where legacy_id is not null) || ' legacy requests keep their old link' as info;
