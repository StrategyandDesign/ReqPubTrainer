-- ============================================================================
-- ReqPub C1 HARDENING - AUTHORIZATION LOCKDOWN. Run once in the Supabase SQL
-- editor, after fix-pursuit-lineage.sql. Idempotent; safe to run twice.
--
-- FINDING C1-001, CRITICAL, trail forgery by an unauthenticated caller.
--
-- PostgreSQL grants EXECUTE on every new function to PUBLIC by default, and
-- PUBLIC includes anon. ReqPub's public API functions are individually
-- revoked and re-granted, but its INTERNAL helpers never were, because they
-- are only ever called from inside other definer functions and therefore
-- carry no authorization checks of their own. That combination is exploitable:
-- a caller holding nothing but the public anon key could invoke log_activity
-- directly and insert an arbitrary row into any organization's activity
-- trail, naming any project, any action, and any summary. The insert trigger
-- then chained the forged row, committing it as a genuine event. The
-- exception handler inside log_activity, which exists so that a failing audit
-- write never breaks a real write, also meant the attacker saw no error.
--
-- Reproduction, before this file: as role anon with no session,
--   select log_activity('<victim org>','<victim project>','version.approved',
--     'version','v-forged','Baseline 9.9 approved by the client','{}');
-- The row landed and was chained at the next sequence number.
--
-- The fix is the privilege layer, not a new identity check inside each
-- helper: several helpers are legitimately reached by anon through
-- token-scoped flows (a client signing a document is anon), so an identity
-- gate inside log_activity would break signing while still leaving every
-- other helper exposed. Instead: revoke EXECUTE on every function in the
-- public schema from PUBLIC, anon, and authenticated, then grant back
-- exactly the surface the codebase already declares. The intended API is
-- unchanged, byte for byte; only the accidental surface disappears.
--
-- Default privileges are also altered so that any function added later is
-- private until someone grants it deliberately. Reachability is pinned by
-- tests/backend-e2e/authz-matrix.test.mjs, which regenerates AUTHZ_MATRIX.md
-- and fails the build on any drift.
-- ============================================================================

-- 1) Remove the accidental surface, including from future functions.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;
-- Attempted and measured, not assumed: ALTER DEFAULT PRIVILEGES ... REVOKE
-- EXECUTE ON FUNCTIONS FROM PUBLIC stores no pg_default_acl row on this
-- PostgreSQL and leaves a newly created function executable by PUBLIC. The
-- statement is kept because it is correct where it is honored and harmless
-- where it is not, but it is NOT the control. The control is the permanent
-- suite tests/backend-e2e/authz-matrix.test.mjs, which fails the build when
-- any function is reachable by anon or authenticated without appearing in the
-- committed allowlist. A function added later is therefore caught at review
-- time rather than at exploit time.
alter default privileges in schema public revoke execute on functions from public;

-- 2) Grant back exactly the declared public surface. Every function below is
--    token-scoped or identity-scoped inside its own body; the list is the
--    same one the schema already declared, gathered in one place so a reviewer
--    can read the entire externally reachable API at once.

-- 2a) Reachable without a session, each gated by a single-purpose token.
grant execute on function get_share(text) to anon, authenticated;
grant execute on function receipt_for(uuid, text) to anon, authenticated;
grant execute on function receipt_store(uuid, text, jsonb, text, text, text) to anon, authenticated;
grant execute on function receipt_tsa_update(uuid, text, text, text) to anon, authenticated;
grant execute on function request_submit(text, text, text) to anon, authenticated;
grant execute on function request_view(text) to anon, authenticated;
grant execute on function sign_request_context(text) to anon, authenticated;
grant execute on function sign_request_decline(text, text) to anon, authenticated;
grant execute on function sign_request_sign(text, text, text) to anon, authenticated;
grant execute on function sme_reply(text, text) to anon, authenticated;
grant execute on function sme_thread(text) to anon, authenticated;
grant execute on function submit_share_v2(text, jsonb) to anon, authenticated;
grant execute on function update_comment(text, text) to anon, authenticated;
grant execute on function update_context(text) to anon, authenticated;
grant execute on function update_note_save(text, text, integer) to anon, authenticated;
grant execute on function update_thread_create(text, text, text, text) to anon, authenticated;
grant execute on function update_thread_reply(text, uuid, text) to anon, authenticated;

-- 2b) Reachable with a session, each gated by membership or role inside the
--     function body. Signatures are pinned so that adding an overload does
--     not silently inherit a grant.
do $$
declare v text; v_missing text := '';
begin
  foreach v in array array[
    'approval_decide(uuid, text, text)',
    'book_export()',
    'chain_repair(text)',
    'claim_invites()',
    'comm_seen(uuid)',
    'create_org(text)',
    'create_version(text, boolean, text, jsonb, text)',
    'delete_row(text, uuid)',
    'deliveries_due(text, int)',
    'deliveries_list(text, int)',
    'delivery_redeliver(uuid)',
    'endpoint_create(text, text, text)',
    'endpoint_set_active(uuid, boolean)',
    'evidence_gather(text)',
    'evidence_log_export(text)',
    'help_stats(uuid)',
    'mcp_key_issue(uuid, text, boolean, text[])',
    'mcp_key_revoke(uuid)',
    'mcp_keys_list(uuid)',
    -- my_context() was never granted explicitly: it relied on the PUBLIC
    -- default this file removes, and the client calls it on every load.
    -- Caught by checking the live client surface after the lockdown, not
    -- by assuming the grant list was complete.
    'my_context()',
    'my_open_approvals()',
    'org_members_named(uuid)',
    'partner_post(text, text)',
    'partner_present_token(text)',
    'partner_projects_v2()',
    'partner_reply(uuid, text)',
    'partner_thread_v2(text)',
    'partner_update_profile(text, text, text)',
    'project_acceptance_facts()',
    'project_set_lineage(text, text, integer, text)',
    'receipts_for_project(text)',
    'record_template_delete(uuid)',
    'record_template_get(uuid)',
    'record_template_put(uuid, text, jsonb)',
    'record_template_touch(uuid)',
    'record_templates_list(uuid)',
    'save_field(text, text, jsonb, integer)',
    'seal_context(uuid)',
    'share_put(text, text, integer, jsonb, text)',
    'share_revoke(text)',
    'sign_request_create(uuid, text, text, text, text)',
    'sign_request_revoke(uuid)',
    'sme_seat(text, text, text)',
    'sme_seats(text)',
    'update_publish(text, jsonb, timestamptz, text, text, text, text)',
    'update_revoke(uuid)',
    'updates_next_id(text, text)',
    'upsert_row(text, text, uuid, jsonb, double precision, integer)',
    'v2_context()',
    'verify_project_chain(text)',
    'version_set_build(uuid, text)',
    'version_set_status(uuid, text)',
    'walkthrough_add(text, uuid, text)',
    'walkthrough_caption(uuid, text)',
    'walkthrough_move(uuid, int)',
    'walkthrough_remove(uuid)',
    'webhook_host(text)'
  ] loop
    if to_regprocedure('public.' || v) is null then
      v_missing := v_missing || ' ' || v;
    else
      execute 'grant execute on function public.' || v || ' to authenticated';
    end if;
  end loop;
  if v_missing <> '' then
    raise notice 'authz lockdown: these declared functions were not found and were skipped:%', v_missing;
  end if;
end $$;

-- 2b-i) The five membership predicates. Row-level security policies call
--      these, and a policy is evaluated as the querying role, so revoking
--      them from authenticated does not harden anything: it breaks every
--      policy-protected read and write. Measured, not assumed: the backend
--      suites failed with "permission denied for function is_org_manager"
--      until these were granted back.
--
--      Exposure is bounded by construction. Each predicate answers a question
--      about the caller's own membership, derived from auth.uid() inside the
--      function, and returns a boolean. A caller learns whether they are a
--      member of an organization they can already name; they learn nothing
--      about anyone else, and no row is returned by any of them.
grant execute on function is_org_member(uuid) to authenticated;
grant execute on function is_org_manager(uuid) to authenticated;
grant execute on function is_project_member(text) to authenticated;
grant execute on function is_project_manager(text) to authenticated;
grant execute on function is_project_partner(text) to authenticated;

-- 2c) Functions the edge functions call with the service role. The service
--     role is not PUBLIC and is granted here explicitly rather than by
--     inheritance, so the list is reviewable.
do $$
declare v text;
begin
  foreach v in array array[
    'mcp_auth(text)',
    'mcp_gate(uuid, text)',
    'mcp_audit(uuid, text, text, text, jsonb)',
    'webhook_enqueue(text, sign_requests, uuid)',
    'webhook_claim_batch(integer)',
    'webhook_mark(uuid, boolean, integer, text)'
  ] loop
    -- service_role exists in Supabase; guard so the file also applies on a
    -- bare Postgres used by the test harness.
    if to_regprocedure('public.' || v) is not null
       and exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function public.' || v || ' to service_role';
    end if;
  end loop;
end $$;

-- 3) Belt and braces on the trail itself. log_activity exists so that a
--    failing audit write never breaks a real write, which is right, but it
--    should never write a row for an organization that does not exist, and
--    it should refuse a project that does not belong to the organization
--    named. Neither check costs anything on the legitimate paths, where the
--    caller is already inside a definer function that resolved both.
create or replace function log_activity(
  p_org uuid, p_project text, p_action text, p_entity_kind text,
  p_entity_id text, p_summary text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_org is null or not exists (select 1 from orgs where id = p_org) then return; end if;
  if p_project is not null and p_project <> ''
     and not exists (select 1 from projects where id = p_project and org_id = p_org) then return; end if;
  insert into activity(org_id, project_id, actor, actor_name, action, entity_kind, entity_id, summary, meta)
  values (p_org, p_project, auth.uid(), coalesce(current_display_name(),''), p_action,
          coalesce(p_entity_kind,''), coalesce(p_entity_id,''), coalesce(p_summary,''), coalesce(p_meta,'{}'::jsonb));
exception when others then null;  -- the audit trail must never break a write
end; $$;
revoke execute on function log_activity(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0028', 'authz_lockdown', 'c7e9f5776ad64b51af9ce4da6de974f4af0cfcf3506d0dfb56f5d89457f8f3e3')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
