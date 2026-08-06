-- ============================================================================
-- ReqPub v2 - relational backend
-- ============================================================================
-- Run once in the Supabase SQL Editor of the EXISTING ReqPub project.
-- Safe to re-run (idempotent). Creates only NEW objects; v1 tables (kv, shares,
-- submissions, partner_notes) are left untouched so the v1 app keeps working
-- until you cut over. Run migrate.sql AFTER this file to move v1 data in.
--
-- Design (see docs/ARCHITECTURE.md):
--   * Every shared collection is rows, not a JSON array under one key.
--     Adds are INSERTs, edits are UPDATEs by id - concurrent adds cannot
--     overwrite each other.
--   * Scalar worksheet fields live one-row-per-field with an integer `rev`.
--     Writes are conditional on `rev` (optimistic concurrency): a stale write
--     is DETECTED and returned to the client instead of silently clobbering.
--   * Version sequence numbers are allocated server-side under a lock.
--   * Realtime uses Broadcast-from-Database (recommended over postgres_changes
--     for multi-editor scale) on private, RLS-authorized channels.
--   * `activity` is an insert-only audit trail written by triggers.
--
-- Roles:
--   manager  (internal) - full write
--   viewer   (internal) - read everything, may post notes/replies, no doc edits
--   partner  (external) - assigned projects only, via SECURITY DEFINER RPCs
--   SME      (external) - no account; tokened share links + tokened reply threads
-- ============================================================================

create extension if not exists pgcrypto;

-- Helper functions below reference tables created later in this file; defer
-- body validation to first execution (the same setting pg_dump emits).
set check_function_bodies = off;

-- ----------------------------------------------------------------------------
-- 0) Helpers (shared with v1 - recreated here so this file stands alone)
-- ----------------------------------------------------------------------------
create or replace function is_org_member(p_org uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid());
$$;

create or replace function is_org_manager(p_org uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'manager');
$$;

-- Org of a project (projects.id is text to preserve v1 ids and share links).
create or replace function project_org(p_project text)
returns uuid language sql security definer stable set search_path = public as $$
  select org_id from projects where id = p_project;
$$;

create or replace function is_project_member(p_project text)
returns boolean language sql security definer stable set search_path = public as $$
  select is_org_member(project_org(p_project));
$$;

create or replace function is_project_manager(p_project text)
returns boolean language sql security definer stable set search_path = public as $$
  select is_org_manager(project_org(p_project));
$$;

-- Partner assigned to a project (external role).
create or replace function is_project_partner(p_project text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from partner_access pa join partners p on p.id = pa.partner_id
    where pa.project_id = p_project and p.user_id = auth.uid());
$$;

-- Display name of the current user (profile, else member email, else 'Member').
create or replace function current_display_name()
returns text language sql security definer stable set search_path = public as $$
  select coalesce(
    nullif(trim((select display_name from user_profiles where user_id = auth.uid())), ''),
    nullif(trim((select email from auth.users where id = auth.uid())), ''),
    'Member');
$$;

-- Random, URL-safe, non-enumerable share/reply tokens.
-- search_path includes `extensions`: on Supabase, pgcrypto (gen_random_bytes)
-- lives there, while a plain Postgres installs it into public. Without this,
-- every function that mints a token fails on Supabase with
-- "function gen_random_bytes does not exist".
create or replace function url_token(p_bytes int default 18)
returns text language sql volatile set search_path = public, extensions as $$
  select translate(encode(gen_random_bytes(p_bytes), 'base64'), '+/=', '-_');
$$;

-- ----------------------------------------------------------------------------
-- 1) User profiles (display names for attribution and presence)
-- ----------------------------------------------------------------------------
create table if not exists user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  updated_at timestamptz not null default now()
);
alter table user_profiles enable row level security;

drop policy if exists up_self_rw on user_profiles;
create policy up_self_rw on user_profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Co-members of any shared org may read your display name.
drop policy if exists up_peers_read on user_profiles;
create policy up_peers_read on user_profiles for select using (
  exists(select 1 from org_members a join org_members b on a.org_id = b.org_id
         where a.user_id = auth.uid() and b.user_id = user_profiles.user_id));

-- ----------------------------------------------------------------------------
-- 2) Projects (one row per PRD; id is text to preserve v1 ids and links)
-- ----------------------------------------------------------------------------
create table if not exists projects (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  practice boolean not null default false,
  born_from_project_id text,               -- v2.56: a citation, not a pipeline; set once by RPC
  born_from_seq integer,
  born_from_fingerprint text,   -- v2.55: set at creation, immutable by trigger; a rehearsal is never evidence
  disc_export boolean not null default false,   -- include discovery appendix in exports
  brand_logo text not null default '',          -- collaborator logo (data URL) shown on the shared PRD + exports
  brand_label text not null default '',         -- collaborator name shown under the logo
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Additive for projects created before this column existed.
alter table projects add column if not exists brand_logo text not null default '';
alter table projects add column if not exists brand_label text not null default '';
-- Monotonic counter for partner-note references (PN-1, PN-2, …); never reused.
alter table projects add column if not exists partner_note_seq int not null default 0;
-- Cap the stored logo (a downscaled data URL is ~10-60 KB; this bounds abuse).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_brand_cap') then
    alter table projects add constraint projects_brand_cap
      check (length(brand_logo) <= 600000 and length(brand_label) <= 160) not valid;
  end if;
end $$;
create index if not exists projects_org on projects(org_id) where not archived;
alter table projects enable row level security;

drop policy if exists projects_read on projects;
create policy projects_read on projects for select using (is_org_member(org_id));
drop policy if exists projects_write on projects;
create policy projects_write on projects for all
  using (is_org_manager(org_id)) with check (is_org_manager(org_id));

-- ----------------------------------------------------------------------------
-- 3) Worksheet storage
--    project_fields - one row per scalar answer (short/long/choice), rev-checked
--    field_rows     - one row per repeating item (rows/list questions)
-- ----------------------------------------------------------------------------
create table if not exists project_fields (
  project_id text not null references projects(id) on delete cascade,
  field_id text not null,
  value jsonb,
  rev integer not null default 1,
  updated_by uuid default auth.uid(),
  updated_by_name text not null default '',
  updated_at timestamptz not null default now(),
  primary key (project_id, field_id)
);
alter table project_fields enable row level security;

drop policy if exists pf_read on project_fields;
create policy pf_read on project_fields for select using (is_project_member(project_id));
-- Writes go through save_field() so rev checks cannot be bypassed by the client.
-- No direct insert/update/delete policies on purpose.

create table if not exists field_rows (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  field_id text not null,
  k integer not null,                       -- stable per-field counter; FR/NFR ids derive from it
  data jsonb not null default '{}'::jsonb,
  pos double precision not null,            -- sort position
  rev integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_by_name text not null default '',
  updated_at timestamptz not null default now(),
  unique (project_id, field_id, k)
);
create index if not exists field_rows_live on field_rows(project_id, field_id, pos) where not deleted;
alter table field_rows enable row level security;

drop policy if exists frow_read on field_rows;
create policy frow_read on field_rows for select using (is_project_member(project_id));
-- Writes via upsert_row()/delete_row() RPCs only.

-- ----------------------------------------------------------------------------
-- 4) Versions (immutable baselines) + approvals (a real state machine)
-- ----------------------------------------------------------------------------
create table if not exists versions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  seq integer not null,
  label text not null,                      -- e.g. 1.0, 1.1, 2.0
  status text not null default 'draft'
    check (status in ('draft','in_review','approved','changes_requested')),
  note text not null default '',
  author_name text not null default '',
  build text not null default '',           -- deployed build tag for pilot feedback
  snapshot jsonb not null,                  -- {answers:{...}, sections:{...}}
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, seq)
);
create index if not exists versions_proj on versions(project_id, seq desc);
alter table versions enable row level security;

drop policy if exists ver_read on versions;
create policy ver_read on versions for select using (is_project_member(project_id));
-- Baselines are immutable at the table, not just at the RPC. No write policy
-- exists and write is revoked below (v2.20): status moves only through
-- version_set_status (transition whitelist + approvals gate), the build tag
-- only through version_set_build, and inserts only through create_version so
-- seq/label allocation cannot race. The pre-2.20 ver_update policy let a
-- manager rewrite snapshot/status/label/created_at directly, bypassing the
-- gate and the audit trail; it is dropped here and must never return.
drop policy if exists ver_update on versions;

create table if not exists version_approvals (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references versions(id) on delete cascade,
  approver_role text not null default '',   -- e.g. Product, Engineering, Sponsor
  approver_name text not null default '',
  approver_user_id uuid,                     -- set when assigned to a team member (in-app flag + self-approve); null = manual sign-off
  status text not null default 'pending'
    check (status in ('pending','approved','changes_requested')),
  comment text not null default '',
  decided_by uuid,
  decided_at timestamptz
);
create index if not exists va_ver on version_approvals(version_id);
create index if not exists va_user on version_approvals(approver_user_id);
alter table version_approvals enable row level security;

drop policy if exists va_read on version_approvals;
create policy va_read on version_approvals for select using (
  exists(select 1 from versions v where v.id = version_id and is_project_member(v.project_id)));
drop policy if exists va_write on version_approvals;
create policy va_write on version_approvals for all
  using (exists(select 1 from versions v where v.id = version_id and is_project_manager(v.project_id)))
  with check (exists(select 1 from versions v where v.id = version_id and is_project_manager(v.project_id)));

-- Approval provenance is enforced, not merely conventional: a new approver
-- row always starts 'pending', and any transition to a decided state stamps
-- decided_by/decided_at from auth.uid() - so a manager cannot forge who
-- signed off, even writing the table directly. Decisions flow through
-- approval_decide(); this trigger is the backstop for direct writes.
create or replace function enforce_approval_provenance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending';                 -- approvers are added pending, never pre-approved
    new.decided_by := null; new.decided_at := null;
  elsif new.status is distinct from old.status then
    if new.status = 'pending' then
      new.decided_by := null; new.decided_at := null;
    else
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists va_provenance on version_approvals;
create trigger va_provenance before insert or update on version_approvals
  for each row execute function enforce_approval_provenance();

-- ----------------------------------------------------------------------------
-- 5) Communications
--    comms    - every inbound/outbound item (app feedback, brief reviews,
--               SME notes, partner notes, team notes, meeting notes)
--    messages - threaded replies on any parent (comm / request)
-- ----------------------------------------------------------------------------
create table if not exists comms (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,                    -- v1 id, for migration dedupe
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  origin text not null check (origin in ('app','brief','sme','partner','team','meeting','update','agent')),
  request_id uuid,                          -- set when this answers an input request
  version_seq integer,                      -- version it was filed against, if any
  author_name text not null default '',
  author_email text not null default '',
  author_user uuid,
  partner_id uuid references partners(id) on delete set null,
  title text not null default '',
  body text not null default '',
  steps text not null default '',           -- steps to reproduce (app feedback)
  fb_type text not null default '',         -- Bug / Idea / Question / Review ...
  severity text not null default '',
  verdict text not null default '',         -- brief review verdict
  status text not null default 'new' check (status in ('new','in_review','actioned','closed')),
  assignee text not null default '',
  promoted_to text not null default '',     -- '', 'discovery', or a requirement id like FR-012
  reply_token text unique,                  -- SME two-way thread token (accountless)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists comms_proj on comms(project_id, created_at desc);
create index if not exists comms_org on comms(org_id, created_at desc);   -- dashboard rollups
create index if not exists comms_req on comms(request_id) where request_id is not null;
-- Human-friendly per-project reference for partner notes (PN-1, PN-2, …) so each
-- is uniquely trackable in the inbox and in conversation.
alter table comms add column if not exists ref text;
-- Team-level "new reply" signal: last_ext_at advances on an external post/reply,
-- team_seen_at advances when any team member opens the thread. A thread is unseen
-- while last_ext_at > team_seen_at (see the triggers and comm_seen() below).
alter table comms add column if not exists last_ext_at  timestamptz;
alter table comms add column if not exists team_seen_at timestamptz;
create index if not exists comms_newext on comms(project_id) where last_ext_at is not null;
alter table comms enable row level security;

drop policy if exists comms_member_read on comms;
create policy comms_member_read on comms for select using (is_org_member(org_id));
drop policy if exists comms_member_insert on comms;
create policy comms_member_insert on comms for insert with check (
  is_org_member(org_id) and origin in ('team','sme','meeting') and author_user = auth.uid());
drop policy if exists comms_manager_update on comms;
create policy comms_manager_update on comms for update
  using (is_org_manager(org_id)) with check (is_org_manager(org_id));
drop policy if exists comms_manager_delete on comms;
create policy comms_manager_delete on comms for delete using (is_org_manager(org_id));
-- External inserts (SME/partner/app) arrive via SECURITY DEFINER RPCs below.

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  parent_kind text not null check (parent_kind in ('comm','request')),
  parent_id uuid not null,
  author_kind text not null check (author_kind in ('team','partner','sme')),
  author_name text not null default '',
  author_user uuid,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_parent on messages(parent_kind, parent_id, created_at);
alter table messages enable row level security;

drop policy if exists msg_member_read on messages;
create policy msg_member_read on messages for select using (is_org_member(org_id));
-- (msg_member_insert is created after input_requests exists - see section 6.)
-- Partner/SME replies via RPCs. No update/delete: messages are permanent record.

-- Team identity is asserted by the server, not the client: a signed-in member
-- posting as the team gets their profile name stamped on, so nobody can put
-- words under a teammate's name (SMEs and partners see these names).
-- Migration and SQL-console runs (auth.uid() is null) keep historical names.
create or replace function enforce_team_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Branch by table first: SQL boolean expressions do not short-circuit, so a
  -- combined condition would touch columns the other table does not have.
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'messages' then
    if new.author_kind = 'team' then
      new.author_name := current_display_name();
      new.author_user := auth.uid();
    end if;
  elsif tg_table_name = 'comms' then
    if new.origin = 'team' then
      new.author_name := current_display_name();
      new.author_user := auth.uid();
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists messages_team_author on messages;
create trigger messages_team_author before insert on messages
  for each row execute function enforce_team_author();
drop trigger if exists comms_team_author on comms;
create trigger comms_team_author before insert on comms
  for each row execute function enforce_team_author();

-- Body-size ceilings for rows written directly (RPC paths enforce their own).
-- NOT VALID: applies to new writes without re-checking migrated history.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'comms_body_cap') then
    alter table comms add constraint comms_body_cap
      check (length(body) <= 20000 and length(title) <= 500) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_body_cap') then
    alter table messages add constraint messages_body_cap
      check (length(body) <= 20000) not valid;
  end if;
  -- Version labels must be numeric (create_version parses them with ::integer;
  -- a hand-edited non-numeric label would otherwise break version creation).
  if not exists (select 1 from pg_constraint where conname = 'versions_label_fmt') then
    alter table versions add constraint versions_label_fmt
      check (label ~ '^[0-9]+(\.[0-9]+)?$') not valid;
  end if;
end $$;

-- Per-user read receipts (v1 stored these org-wide, which was wrong).
create table if not exists read_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  comm_id uuid not null references comms(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, comm_id)
);
alter table read_marks enable row level security;
drop policy if exists rm_self on read_marks;
create policy rm_self on read_marks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Team-level "new reply" flag (see comms.last_ext_at / team_seen_at above).
-- A new external thread with content flags itself; the empty SME-workspace shell
-- (no body, verdict, or steps) does not.
create or replace function comms_flag_external()
returns trigger language plpgsql as $$
begin
  if new.origin in ('app','brief','sme','partner')
     and (coalesce(new.body,'') <> '' or coalesce(new.verdict,'') <> '' or coalesce(new.steps,'') <> '') then
    new.last_ext_at := coalesce(new.last_ext_at, now());
  end if;
  return new;
end; $$;
drop trigger if exists comms_flag_external_t on comms;
create trigger comms_flag_external_t before insert on comms
  for each row execute function comms_flag_external();

-- An external reply (SME or partner) bumps its parent thread; team replies do not.
create or replace function messages_flag_external()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_kind = 'comm' and new.author_kind in ('sme','partner') then
    update comms set last_ext_at = now() where id = new.parent_id;
  end if;
  return new;
end; $$;
drop trigger if exists messages_flag_external_t on messages;
create trigger messages_flag_external_t after insert on messages
  for each row execute function messages_flag_external();

-- A team member opening a thread clears the flag for the whole team and records
-- their personal read receipt. Any project member may call it (viewers too),
-- so it is SECURITY DEFINER rather than a direct table write.
create or replace function comm_seen(p_comm uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare c comms%rowtype;
begin
  select * into c from comms where id = p_comm;
  if c.id is null or not is_project_member(c.project_id) then return false; end if;
  insert into read_marks(user_id, comm_id, read_at) values (auth.uid(), p_comm, now())
    on conflict (user_id, comm_id) do update set read_at = now();
  update comms set team_seen_at = now() where id = p_comm;
  return true;
end; $$;
grant execute on function comm_seen(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) Input requests (tokened "ask an SME" links) and discovery log
-- ----------------------------------------------------------------------------
create table if not exists input_requests (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  title text not null,
  prompt text not null default '',
  author_name text not null default '',
  due date,
  status text not null default 'open' check (status in ('open','closed')),
  token text not null unique default url_token(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists req_proj on input_requests(project_id, created_at desc);
alter table input_requests enable row level security;

drop policy if exists req_member_read on input_requests;
create policy req_member_read on input_requests for select using (is_org_member(org_id));
drop policy if exists req_manager_write on input_requests;
create policy req_manager_write on input_requests for all
  using (is_org_manager(org_id)) with check (is_org_manager(org_id));

-- Members (managers and viewers) may reply on comms and requests in their org.
-- The parent must belong to the same org - prevents cross-org message injection.
drop policy if exists msg_member_insert on messages;
create policy msg_member_insert on messages for insert with check (
  is_org_member(org_id) and author_kind = 'team' and author_user = auth.uid()
  and ((parent_kind = 'comm' and exists(
          select 1 from comms c where c.id = parent_id and c.org_id = messages.org_id))
    or (parent_kind = 'request' and exists(
          select 1 from input_requests r where r.id = parent_id and r.org_id = messages.org_id))));

create table if not exists discovery_entries (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  takeaway text not null default '',
  context text not null default '',
  heard text not null default '',
  decided text not null default '',
  open_questions text not null default '',
  notes text not null default '',
  tags text not null default '',
  who text not null default '',
  source text not null default '',
  links text not null default '',
  author_name text not null default '',
  rev integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists disc_proj on discovery_entries(project_id, created_at desc);
-- v2.19: promotion back-link. '' | 'FR-012' | 'DEC-003' - the numbered artifact
-- this entry became, mirroring comms.promoted_to, so the relay loop closes:
-- input → discovery → requirement or decision, each step on the record.
alter table discovery_entries add column if not exists promoted_to text not null default '';
alter table discovery_entries enable row level security;

drop policy if exists disc_member_read on discovery_entries;
create policy disc_member_read on discovery_entries for select using (is_org_member(org_id));
drop policy if exists disc_manager_write on discovery_entries;
create policy disc_manager_write on discovery_entries for all
  using (is_org_manager(org_id)) with check (is_org_manager(org_id));

-- ----------------------------------------------------------------------------
-- 7) Activity - insert-only audit trail (Palantir-style: cannot be edited)
-- ----------------------------------------------------------------------------
create table if not exists activity (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id) on delete cascade,   -- audit rows can't outlive or misattribute their org
  project_id text,
  actor uuid,
  actor_name text not null default '',
  action text not null,                     -- e.g. version.created, approval.approved, comm.received
  entity_kind text not null default '',
  entity_id text not null default '',
  summary text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_org on activity(org_id, id desc);
create index if not exists activity_proj on activity(project_id, id desc) where project_id is not null;
alter table activity enable row level security;

drop policy if exists act_member_read on activity;
create policy act_member_read on activity for select using (is_org_member(org_id));
-- No insert/update/delete policies: rows arrive only via the definer function
-- below, and nothing can modify them afterward.

create or replace function log_activity(
  p_org uuid, p_project text, p_action text, p_entity_kind text,
  p_entity_id text, p_summary text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into activity(org_id, project_id, actor, actor_name, action, entity_kind, entity_id, summary, meta)
  values (p_org, p_project, auth.uid(), coalesce(current_display_name(),''), p_action,
          coalesce(p_entity_kind,''), coalesce(p_entity_id,''), coalesce(p_summary,''), coalesce(p_meta,'{}'::jsonb));
exception when others then null;  -- the audit trail must never break a write
end; $$;

-- ----------------------------------------------------------------------------
-- 8) Realtime - broadcast-from-database on private channels
--    Topics:  org:<org_id>      (project list, inbox counters)
--             proj:<project_id> (fields, rows, versions, comms, messages, ...)
-- ----------------------------------------------------------------------------
create or replace function broadcast_project_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_project text; v_topic text;
begin
  v_project := coalesce(new.project_id, old.project_id);
  if v_project is null then return coalesce(new, old); end if;
  v_topic := 'proj:' || v_project;
  begin
    perform realtime.broadcast_changes(v_topic, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  exception when others then null;          -- realtime outage must never block a write
  end;
  return coalesce(new, old);
end; $$;

create or replace function broadcast_org_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := coalesce(new.org_id, old.org_id);
  if v_org is null then return coalesce(new, old); end if;
  begin
    perform realtime.broadcast_changes('org:' || v_org::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  exception when others then null;
  end;
  return coalesce(new, old);
end; $$;

-- messages and version_approvals have no project_id column; resolve it first.
create or replace function broadcast_message_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_project text;
begin
  r := coalesce(new, old);
  if r.parent_kind = 'comm' then
    select project_id into v_project from comms where id = r.parent_id;
  else
    select project_id into v_project from input_requests where id = r.parent_id;
  end if;
  if v_project is not null then
    begin
      perform realtime.broadcast_changes('proj:' || v_project, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
    exception when others then null;
    end;
  end if;
  return r;
end; $$;

create or replace function broadcast_approval_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_project text;
begin
  r := coalesce(new, old);
  select project_id into v_project from versions where id = r.version_id;
  if v_project is not null then
    begin
      perform realtime.broadcast_changes('proj:' || v_project, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
    exception when others then null;
    end;
  end if;
  return r;
end; $$;

do $$
declare t text;
begin
  foreach t in array array['project_fields','field_rows','versions',
                           'comms','input_requests','discovery_entries'] loop
    execute format('drop trigger if exists %I on %I', t || '_bcast', t);
    execute format('create trigger %I after insert or update or delete on %I
                    for each row execute function broadcast_project_change()', t || '_bcast', t);
  end loop;
end $$;

drop trigger if exists messages_bcast on messages;
create trigger messages_bcast after insert or update or delete on messages
  for each row execute function broadcast_message_change();
drop trigger if exists version_approvals_bcast on version_approvals;
create trigger version_approvals_bcast after insert or update or delete on version_approvals
  for each row execute function broadcast_approval_change();
drop trigger if exists projects_bcast on projects;
create trigger projects_bcast after insert or update or delete on projects
  for each row execute function broadcast_org_change();

-- Authorize private channels: org members (and partners, for their projects)
-- may receive; the same set may send (presence tracking uses send).
drop policy if exists rt_recv on realtime.messages;
create policy rt_recv on realtime.messages for select to authenticated using (
  case
    when realtime.topic() like 'org:%'  then is_org_member(substring(realtime.topic() from 5)::uuid)
    when realtime.topic() like 'proj:%' then
      is_project_member(substring(realtime.topic() from 6))
      or is_project_partner(substring(realtime.topic() from 6))
    else false
  end);
-- Sending on a PROJECT channel (presence + client broadcast) is limited to
-- managers - the only role that can edit the document. Since a manager can
-- already make any change through the audited RPCs, a forged broadcast grants
-- them nothing new; and a read-only viewer therefore cannot broadcast
-- fabricated live edits onto teammates' screens. Partners and SMEs receive
-- only. Database state is never touched by broadcast either way.
-- Org channel send stays member-wide (dashboard presence, no document data).
drop policy if exists rt_send on realtime.messages;
create policy rt_send on realtime.messages for insert to authenticated with check (
  case
    when realtime.topic() like 'org:%'  then is_org_member(substring(realtime.topic() from 5)::uuid)
    when realtime.topic() like 'proj:%' then is_project_manager(substring(realtime.topic() from 6))
    else false
  end);

-- ----------------------------------------------------------------------------
-- 9) Write RPCs - the only mutation path for racy structures
-- ----------------------------------------------------------------------------

-- 9.1 Scalar field save with optimistic concurrency.
-- Returns: {ok:true, rev:N}                       - saved
--          {ok:false, conflict:true, rev:N,       - stale base; caller merges
--           value:<current>, by:<who>, at:<when>}
create or replace function save_field(
  p_project text, p_field text, p_value jsonb, p_base_rev integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_rev integer; v_cur project_fields%rowtype;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if pg_column_size(p_value) > 262144 then          -- 256 KB per answer
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;

  if p_base_rev is null or p_base_rev = 0 then
    insert into project_fields(project_id, field_id, value, rev, updated_by, updated_by_name)
    values (p_project, p_field, p_value, 1, auth.uid(), current_display_name())
    on conflict (project_id, field_id) do nothing;
    if found then
      update projects set updated_at = now() where id = p_project;
      return jsonb_build_object('ok', true, 'rev', 1);
    end if;
    -- Row appeared concurrently: fall through and report the conflict.
  else
    update project_fields
       set value = p_value, rev = rev + 1,
           updated_by = auth.uid(), updated_by_name = current_display_name(), updated_at = now()
     where project_id = p_project and field_id = p_field and rev = p_base_rev
    returning rev into v_rev;
    if v_rev is not null then
      update projects set updated_at = now() where id = p_project;
      return jsonb_build_object('ok', true, 'rev', v_rev);
    end if;
  end if;

  select * into v_cur from project_fields where project_id = p_project and field_id = p_field;
  if v_cur.project_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', false, 'conflict', true, 'rev', v_cur.rev,
    'value', v_cur.value, 'by', v_cur.updated_by_name, 'at', v_cur.updated_at);
end; $$;
grant execute on function save_field(text, text, jsonb, integer) to authenticated;

-- 9.2 Repeating rows: insert (id null) or rev-checked update.
create or replace function upsert_row(
  p_project text, p_field text, p_id uuid, p_data jsonb,
  p_pos double precision default null, p_base_rev integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row field_rows%rowtype; v_k integer; v_pos double precision;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if pg_column_size(p_data) > 131072 then           -- 128 KB per row
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;

  if p_id is null then
    -- Serialize k allocation per (project, field): two simultaneous adds get
    -- distinct k values and distinct rows. This was v1's #1 data-loss bug.
    perform pg_advisory_xact_lock(hashtextextended(p_project || '/' || p_field, 42));
    select coalesce(max(k), 0) + 1 into v_k from field_rows
      where project_id = p_project and field_id = p_field;
    select coalesce(max(pos), 0) + 1 into v_pos from field_rows
      where project_id = p_project and field_id = p_field and not deleted;
    insert into field_rows(project_id, field_id, k, data, pos, updated_by, updated_by_name)
    values (p_project, p_field, v_k, coalesce(p_data, '{}'::jsonb), coalesce(p_pos, v_pos),
            auth.uid(), current_display_name())
    returning * into v_row;
  else
    update field_rows
       set data = coalesce(p_data, data), pos = coalesce(p_pos, pos), rev = rev + 1,
           updated_by = auth.uid(), updated_by_name = current_display_name(), updated_at = now()
     where id = p_id and project_id = p_project
       and (p_base_rev is null or rev = p_base_rev)
    returning * into v_row;
    if v_row.id is null then
      select * into v_row from field_rows where id = p_id;
      if v_row.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
      return jsonb_build_object('ok', false, 'conflict', true, 'rev', v_row.rev,
        'data', v_row.data, 'by', v_row.updated_by_name, 'at', v_row.updated_at);
    end if;
  end if;

  update projects set updated_at = now() where id = p_project;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'k', v_row.k, 'rev', v_row.rev, 'pos', v_row.pos);
end; $$;
grant execute on function upsert_row(text, text, uuid, jsonb, double precision, integer) to authenticated;

create or replace function delete_row(p_project text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_project_manager(p_project) then return false; end if;
  update field_rows set deleted = true, rev = rev + 1,
         updated_by = auth.uid(), updated_by_name = current_display_name(), updated_at = now()
   where id = p_id and project_id = p_project and not deleted;
  if found then update projects set updated_at = now() where id = p_project; end if;
  return found;
end; $$;
grant execute on function delete_row(text, uuid) to authenticated;

-- 9.3 Version creation: seq and label allocated under a project lock, so two
-- managers clicking Generate at once produce v1.4 and v1.5 - never two v1.4s.
create or replace function create_version(
  p_project text, p_major boolean, p_note text, p_snapshot jsonb, p_build text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_seq integer; v_maj integer; v_min integer; v_label text; v_prev text; v_id uuid;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ver/' || p_project, 42));

  select coalesce(max(seq), 0) + 1 into v_seq from versions where project_id = p_project;
  select label into v_prev from versions where project_id = p_project order by seq desc limit 1;
  if v_prev is null then
    v_label := '1.0';
  else
    v_maj := coalesce(nullif(split_part(v_prev, '.', 1), ''), '1')::integer;
    v_min := coalesce(nullif(split_part(v_prev, '.', 2), ''), '0')::integer;
    v_label := case when p_major then (v_maj + 1) || '.0' else v_maj || '.' || (v_min + 1) end;
  end if;

  insert into versions(project_id, seq, label, note, author_name, build, snapshot)
  values (p_project, v_seq, v_label, coalesce(p_note, ''), current_display_name(),
          coalesce(p_build, ''), p_snapshot)
  returning id into v_id;

  perform log_activity(v_org, p_project, 'version.created', 'version', v_id::text,
    'Generated v' || v_label, jsonb_build_object('seq', v_seq, 'label', v_label));
  return jsonb_build_object('ok', true, 'id', v_id, 'seq', v_seq, 'label', v_label);
end; $$;
grant execute on function create_version(text, boolean, text, jsonb, text) to authenticated;

-- 9.4 Version status state machine + approvals. Since v2.28.1 an approval
-- decision advances the version by itself: first approval moves a draft to
-- in_review, the last approval moves it to approved, a changes request
-- moves the version to changes_requested, and reopening a decision on an
-- approved version drops it to in_review. version_set_status remains the
-- manual path and keeps the same invariant.
create or replace function version_set_status(p_version uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v versions%rowtype; v_allowed boolean;
begin
  select * into v from versions where id = p_version;
  if v.id is null or not is_project_manager(v.project_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  v_allowed := (v.status, p_status) in (
    ('draft','in_review'),
    ('in_review','approved'), ('in_review','changes_requested'), ('in_review','draft'),
    ('changes_requested','in_review'), ('approved','in_review'));
  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'bad_transition', 'from', v.status);
  end if;
  if p_status = 'approved'
     and exists(select 1 from version_approvals a where a.version_id = p_version and a.status <> 'approved') then
    return jsonb_build_object('ok', false, 'error', 'approvals_pending');
  end if;
  update versions set status = p_status where id = p_version;
  perform log_activity(project_org(v.project_id), v.project_id, 'version.status', 'version',
    p_version::text, 'v' || v.label || ' → ' || p_status, jsonb_build_object('from', v.status, 'to', p_status));
  return jsonb_build_object('ok', true, 'status', p_status);
end; $$;
grant execute on function version_set_status(uuid, text) to authenticated;

-- The build tag is the ONE mutable column on a version (which deployed build a
-- baseline was tested against). Everything else on the row is immutable: with
-- direct write revoked (v2.20), this definer function is the only path, so a
-- build-tag edit cannot be widened into rewriting snapshot, status, label, or
-- dates, and it lands on the audit trail like every other version event.
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

-- A manager may decide any slot; the ASSIGNED team member may decide their own
-- (in-app approval routing). Everyone else is refused. The provenance trigger
-- still stamps decided_by/decided_at from auth.uid(), so a sign-off is always
-- attributed to whoever actually made it.
create or replace function approval_decide(p_approval uuid, p_status text, p_comment text default '')
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

-- Every pending slot assigned to the caller on an in-review version: the
-- "waiting on you" flag shown on the dashboard.
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

-- Team roster with display names, for the approver "assign to" picker.
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

-- ----------------------------------------------------------------------------
-- 10) Shares (SME links) - server-generated tokens; v1 get_share still serves
-- ----------------------------------------------------------------------------
create or replace function share_put(
  p_project text, p_kind text, p_seq integer, p_payload jsonb, p_token text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_token text;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_manager(v_org) then return null; end if;
  v_token := coalesce(p_token,
    (select token from shares where project_id = p_project and kind = p_kind and version_seq = p_seq
       and org_id = v_org limit 1),
    url_token());
  -- The conflict update is fenced to the caller's own org and project: a
  -- colliding token that belongs to someone else is refused, never overwritten.
  insert into shares(token, org_id, project_id, version_seq, kind, payload, revoked, updated_at)
  values (v_token, v_org, p_project, p_seq, p_kind, p_payload, false, now())
  on conflict (token) do update set payload = excluded.payload, revoked = false, updated_at = now()
  where shares.org_id = v_org and shares.project_id = p_project;
  if not found then return null; end if;
  return v_token;
end; $$;
grant execute on function share_put(text, text, integer, jsonb, text) to authenticated;

create or replace function share_revoke(p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from shares where token = p_token;
  if v_org is null or not is_org_manager(v_org) then return false; end if;
  update shares set revoked = true, updated_at = now() where token = p_token;
  return true;
end; $$;
grant execute on function share_revoke(text) to authenticated;

-- SME submission → comms row + reply token for an accountless two-way thread.
create or replace function submit_share_v2(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s shares%rowtype; v_reply text; v_id uuid; v_origin text;
begin
  select * into s from shares where token = p_token and revoked = false;
  if s.token is null or s.org_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_link');
  end if;
  if length(coalesce(p_payload->>'body', '')) > 20000 or length(coalesce(p_payload->>'title', '')) > 500 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  v_origin := case s.kind when 'brief' then 'brief' when 'pilot' then 'app' else 'sme' end;
  -- Throttle: this endpoint is reachable with only a link. 60 submissions per
  -- project per hour covers a busy pilot sprint and stops a flood. An advisory
  -- lock per project serializes the count-then-insert so parallel calls cannot
  -- each read a below-limit count and all slip through (TOCTOU). The cap counts
  -- ALL anon origins together, so it can't be multiplied by splitting kinds.
  perform pg_advisory_xact_lock(hashtextextended('anon/' || s.project_id, 7));
  if (select count(*) from comms c
       where c.project_id = s.project_id and c.origin in ('brief','app','sme')
         and c.created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  v_reply := url_token();
  insert into comms(org_id, project_id, origin, version_seq, author_name, author_email,
                    title, body, steps, fb_type, severity, verdict, reply_token)
  values (s.org_id, s.project_id, v_origin, nullif(s.version_seq, 0),
          left(coalesce(p_payload->>'name',''), 200), left(coalesce(p_payload->>'email',''), 320),
          left(coalesce(p_payload->>'title',''), 500), coalesce(p_payload->>'body',''),
          coalesce(p_payload->>'steps',''), left(coalesce(p_payload->>'type',''), 40),
          left(coalesce(p_payload->>'severity',''), 40), left(coalesce(p_payload->>'verdict',''), 60), v_reply)
  returning id into v_id;
  perform log_activity(s.org_id, s.project_id, 'comm.received', 'comm', v_id::text,
    'New ' || v_origin || ' submission', jsonb_build_object('kind', s.kind));
  return jsonb_build_object('ok', true, 'reply_token', v_reply);
end; $$;
grant execute on function submit_share_v2(text, jsonb) to anon, authenticated;

-- Accountless SME thread reached by a durable personal link. Returns the one
-- persistent thread for that token PLUS the current branded PRD (latest
-- published brief, live brand overlaid) so the SME's link is a real workspace:
-- read-only PRD + one continuous conversation, device-independent and stable
-- across versions. `brief` is null until the team publishes a brief.
create or replace function sme_thread(p_reply_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when c.id is null then jsonb_build_object('ok', false) else jsonb_build_object(
    'ok', true, 'title', c.title, 'body', c.body, 'status', c.status, 'at', c.created_at,
    'name', c.author_name, 'product', pr.name,
    'brief', (select s.payload || jsonb_build_object('logo', pr.brand_logo, 'brandLabel', pr.brand_label)
              from shares s where s.project_id = c.project_id and s.kind = 'brief' and s.revoked = false
              order by s.version_seq desc limit 1),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('from', m.author_kind, 'name', m.author_name,
                                          'body', m.body, 'at', m.created_at) order by m.created_at)
      from messages m where m.parent_kind = 'comm' and m.parent_id = c.id), '[]'::jsonb),
    -- The SME's own uploads on their durable thread, so they persist across visits.
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'size_bytes', a.size_bytes,
                                          'mime', a.mime, 'scan_status', a.scan_status, 'created_at', a.created_at) order by a.created_at)
      from attachments a where a.comm_id = c.id), '[]'::jsonb))
  end
  from (select 1) one
  left join comms c on c.reply_token = p_reply_token
  left join projects pr on pr.id = c.project_id;
$$;
grant execute on function sme_thread(text) to anon, authenticated;

create or replace function sme_reply(p_reply_token text, p_body text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c comms%rowtype;
begin
  select * into c from comms where reply_token = p_reply_token;
  if c.id is null or coalesce(trim(p_body), '') = '' or length(p_body) > 20000 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('smerep/' || c.id::text, 7));
  if (select count(*) from messages m
       where m.parent_kind = 'comm' and m.parent_id = c.id
         and m.created_at > now() - interval '1 hour') >= 30 then
    return false;
  end if;
  insert into messages(org_id, parent_kind, parent_id, author_kind, author_name, body)
  values (c.org_id, 'comm', c.id, 'sme', coalesce(nullif(c.author_name, ''), 'Reviewer'), p_body);
  update comms set updated_at = now(), status = case when status = 'closed' then 'new' else status end
    where id = c.id;
  return true;
end; $$;
grant execute on function sme_reply(text, text) to anon, authenticated;

-- Durable SME workspace. A manager seats an SME (name + email) on a PRD; this
-- finds-or-creates ONE persistent thread for that (project, email) and returns
-- its stable reply_token. Re-seating the same email returns the same token, so
-- every exchange with that SME on that PRD stays in one place across versions -
-- the SME's personal link never changes and needs no login. url_token() lives
-- in extensions; keep it on the search_path.
create or replace function sme_seat(p_project text, p_name text, p_email text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; c comms%rowtype; v_email text; v_name text; v_existed boolean;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  v_email := lower(nullif(trim(p_email), ''));
  if v_email is null then return jsonb_build_object('ok', false, 'error', 'email_required'); end if;
  v_name := left(coalesce(nullif(trim(p_name), ''), split_part(v_email, '@', 1)), 200);
  -- Serialize concurrent seating of the same SME so we never mint two threads.
  perform pg_advisory_xact_lock(hashtextextended('smeseat/' || p_project || '/' || v_email, 11));
  select * into c from comms
    where project_id = p_project and origin = 'sme' and lower(author_email) = v_email
    order by created_at limit 1;
  v_existed := c.id is not null;
  if not v_existed then
    insert into comms(org_id, project_id, origin, author_name, author_email, title, body, reply_token)
    values (v_org, p_project, 'sme', v_name, v_email, 'SME review workspace', '', url_token())
    returning * into c;
    perform log_activity(v_org, p_project, 'sme.seated', 'comm', c.id::text,
      'Seated SME ' || v_name, jsonb_build_object('email', v_email));
  elsif v_name <> '' and c.author_name is distinct from v_name then
    update comms set author_name = v_name where id = c.id returning * into c;
  end if;
  return jsonb_build_object('ok', true, 'reply_token', c.reply_token,
    'name', c.author_name, 'email', c.author_email, 'existed', v_existed);
end; $$;
grant execute on function sme_seat(text, text, text) to authenticated;

-- The SME roster for a PRD (managers only): who is seated, their personal link
-- token, and how many times they have written back. Powers the team-side list.
create or replace function sme_seats(p_project text)
returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', c.author_name, 'email', c.author_email, 'reply_token', c.reply_token, 'at', c.created_at,
    'replies', (select count(*) from messages m
                where m.parent_kind = 'comm' and m.parent_id = c.id and m.author_kind = 'sme')
  ) order by c.created_at), '[]'::jsonb)
  from comms c
  where c.project_id = p_project and c.origin = 'sme' and c.reply_token is not null
    and is_org_manager(c.org_id);
$$;
grant execute on function sme_seats(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6c) Attachments - files the team, partners, and seated SMEs upload onto a
--     conversation. The bytes live in the private 'attachments' Storage bucket
--     (see storage-attachments.sql); this table is the metadata + audit anchor.
--     Every row is written by attachment_add, which the upload edge function
--     calls only AFTER it type/size-checks and virus-scans the file - so a
--     stored file is always clean or explicitly flagged, never silently unsafe.
-- ----------------------------------------------------------------------------
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  comm_id uuid references comms(id) on delete cascade,        -- the thread it lands on
  message_id uuid references messages(id) on delete set null,
  uploader_kind text not null check (uploader_kind in ('team','partner','sme')),
  uploader_name text not null default '',
  uploader_user uuid,
  file_name text not null,
  mime text not null default '',
  size_bytes bigint not null default 0,
  storage_path text not null unique,                          -- key in the bucket
  scan_status text not null default 'unscanned'
    check (scan_status in ('clean','unscanned','infected','error')),
  scan_detail text not null default '',
  sha256_hex text not null default '',                        -- exact-bytes digest, '' when unrecorded (v2.49)
  created_at timestamptz not null default now()
);
create index if not exists attachments_proj on attachments(project_id, created_at desc);
create index if not exists attachments_comm on attachments(comm_id, created_at);
alter table attachments enable row level security;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attachments_caps') then
    alter table attachments add constraint attachments_caps
      check (size_bytes >= 0 and size_bytes <= 26214400
             and length(file_name) <= 300 and length(storage_path) <= 600) not valid;
  end if;
end $$;
-- v2.49: existing databases gain the digest column here; fresh installs got it above.
alter table attachments add column if not exists sha256_hex text not null default '';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attachments_sha256_shape') then
    alter table attachments add constraint attachments_sha256_shape
      check (sha256_hex = '' or sha256_hex ~ '^[0-9a-f]{64}$') not valid;
  end if;
end $$;

-- Team members read their org's attachments; managers may delete. Nobody writes
-- directly - inserts go through attachment_add (service role, post-scan).
drop policy if exists attach_member_read on attachments;
create policy attach_member_read on attachments for select using (is_org_member(org_id));
drop policy if exists attach_manager_delete on attachments;
create policy attach_manager_delete on attachments for delete using (is_org_manager(org_id));
grant select, delete on attachments to authenticated;
-- Live: a new file surfaces in the team inbox + Files list within the second.
drop trigger if exists attachments_bcast on attachments;
create trigger attachments_bcast after insert or update or delete on attachments
  for each row execute function broadcast_project_change();

-- The single validated insert path. The upload edge function calls this with the
-- service role after it has scanned the file and put the bytes in Storage.
-- v2.49: the function also hashes the bytes in the same pass and records the
-- digest here. The 12-parameter signature is dropped first because a
-- create-or-replace cannot change a signature.
drop function if exists attachment_add(text, uuid, uuid, text, text, uuid, text, text, bigint, text, text, text);
create or replace function attachment_add(
  p_project text, p_comm uuid, p_message uuid,
  p_uploader_kind text, p_uploader_name text, p_uploader_user uuid,
  p_file_name text, p_mime text, p_size bigint, p_path text,
  p_scan_status text, p_scan_detail text, p_sha256 text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
  v_allow text[] := array[
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv','text/markdown',
    'image/png','image/jpeg','image/gif','image/webp','image/heic','application/zip'];
begin
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  if p_uploader_kind is null or p_uploader_kind not in ('team','partner','sme') then
    return jsonb_build_object('ok', false, 'error', 'bad_uploader'); end if;
  if coalesce(p_size, 0) <= 0 or p_size > 26214400 then
    return jsonb_build_object('ok', false, 'error', 'bad_size'); end if;
  if p_mime is null or not (p_mime = any(v_allow)) then
    return jsonb_build_object('ok', false, 'error', 'type_not_allowed'); end if;
  if p_scan_status = 'infected' then
    return jsonb_build_object('ok', false, 'error', 'infected'); end if;
  if p_scan_status is null or not (p_scan_status = any(array['clean','unscanned','error'])) then
    return jsonb_build_object('ok', false, 'error', 'bad_scan_status'); end if;
  -- A digest is 64 lowercase hex characters or absent. Anything else is a
  -- caller bug and is refused rather than stored looking like evidence.
  if coalesce(p_sha256, '') <> '' and p_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_hash'); end if;
  if p_comm is not null and not exists (select 1 from comms c where c.id = p_comm and c.project_id = p_project) then
    return jsonb_build_object('ok', false, 'error', 'bad_thread'); end if;
  -- Throttle external floods: 40 files/hour/project.
  perform pg_advisory_xact_lock(hashtextextended('attach/' || p_project, 13));
  if (select count(*) from attachments a
        where a.project_id = p_project and a.created_at > now() - interval '1 hour') >= 40 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;

  insert into attachments(org_id, project_id, comm_id, message_id, uploader_kind, uploader_name,
                          uploader_user, file_name, mime, size_bytes, storage_path, scan_status, scan_detail, sha256_hex)
  values (v_org, p_project, p_comm, p_message, p_uploader_kind,
          left(coalesce(p_uploader_name, ''), 200), p_uploader_user,
          left(p_file_name, 300), left(coalesce(p_mime, ''), 120), p_size, p_path,
          coalesce(p_scan_status, 'unscanned'), left(coalesce(p_scan_detail, ''), 500),
          coalesce(p_sha256, ''))
  returning id into v_id;

  if p_comm is not null then
    update comms set updated_at = now(), status = case when status = 'closed' then 'new' else status end
      where id = p_comm;
  end if;
  perform log_activity(v_org, p_project, 'attachment.added', 'attachment', v_id::text,
    coalesce(nullif(p_uploader_name, ''), 'Someone') || ' attached ' || left(p_file_name, 120),
    jsonb_build_object('mime', p_mime, 'size', p_size, 'scan', p_scan_status, 'by', p_uploader_kind)
      || case when coalesce(p_sha256, '') <> '' then jsonb_build_object('sha256', p_sha256) else '{}'::jsonb end);
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function attachment_add(text, uuid, uuid, text, text, uuid, text, text, bigint, text, text, text, text) from public;
do $$ begin
  execute 'grant execute on function attachment_add(text, uuid, uuid, text, text, uuid, text, text, bigint, text, text, text, text) to service_role';
exception when undefined_object then null; end $$;

-- Authorize a signed-in uploader (team or partner) against a thread. The upload
-- edge function verifies the JWT, then passes the user id here to resolve who
-- they are and which project/org the thread belongs to.
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
-- Resolve a seated SME's durable thread from their personal reply_token.
create or replace function attachment_sme_target(p_reply_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when c.id is null then jsonb_build_object('ok', false, 'error', 'invalid_link')
    else jsonb_build_object('ok', true, 'org_id', c.org_id, 'project_id', c.project_id,
           'comm_id', c.id, 'name', coalesce(nullif(c.author_name, ''), 'Reviewer')) end
  from (select 1) one left join comms c on c.reply_token = p_reply_token and c.origin = 'sme';
$$;
do $$ begin
  execute 'grant execute on function attachment_uploader(uuid, uuid) to service_role';
  execute 'grant execute on function attachment_sme_target(text) to service_role';
exception when undefined_object then null; end $$;

-- Input-request intake (tokened, accountless).
create or replace function request_view(p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when r.id is null then jsonb_build_object('ok', false) else jsonb_build_object(
    'ok', true, 'title', r.title, 'prompt', r.prompt, 'status', r.status,
    'product', (select name from projects where id = r.project_id),
    'thread', coalesce((
      select jsonb_agg(jsonb_build_object('name', m.author_name, 'body', m.body, 'at', m.created_at)
                       order by m.created_at)
      from messages m where m.parent_kind = 'request' and m.parent_id = r.id and m.author_kind = 'team'),
      '[]'::jsonb))
  end
  from (select 1) one left join input_requests r on r.token = p_token;
$$;
grant execute on function request_view(text) to anon, authenticated;

create or replace function request_submit(p_token text, p_name text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r input_requests%rowtype; v_reply text; v_id uuid;
begin
  select * into r from input_requests where token = p_token and status = 'open';
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_link'); end if;
  if coalesce(trim(p_body), '') = '' or length(p_body) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('req/' || r.id::text, 7));
  if (select count(*) from comms c
       where c.request_id = r.id and c.created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  v_reply := url_token();
  insert into comms(org_id, project_id, origin, request_id, author_name, title, body, reply_token)
  values (r.org_id, r.project_id, 'sme', r.id, left(coalesce(p_name, ''), 200),
          'Re: ' || r.title, p_body, v_reply)
  returning id into v_id;
  perform log_activity(r.org_id, r.project_id, 'comm.received', 'comm', v_id::text,
    'Input received: ' || r.title, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'reply_token', v_reply);
end; $$;
grant execute on function request_submit(text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 11) Partner portal RPCs (account-holding external collaborators)
-- ----------------------------------------------------------------------------

-- Partner-editable profile. Columns are additive and default-safe for v1 rows.
alter table partners add column if not exists title text not null default '';
alter table partners add column if not exists company text not null default '';

-- One partner identity per email per workspace (v2.34.0). partners carried no
-- uniqueness on (org_id, email), so one client email could hold two identities
-- in one workspace, each with its own partner_access grant to the same project
-- - and every read joining partner_access -> partners -> projects returned that
-- project once per identity, so the portal rendered it twice.
--
-- The merge below must precede the index: the index cannot be created while
-- the condition it forbids still exists. Both are idempotent, so re-running
-- schema.sql is a no-op once the table is clean. See
-- supabase/migrations/0011_partner_identity.sql (identical content) for the live-DB patch
-- and the full rationale on what the merge preserves.
do $$
declare g record; v_keep uuid; v_dups uuid[];
begin
  for g in
    select org_id, lower(email) as key from partners
    where coalesce(trim(email), '') <> ''
    group by org_id, lower(email) having count(*) > 1
  loop
    select id into v_keep from partners
    where org_id = g.org_id and lower(email) = g.key
    order by created_at asc nulls last, id asc limit 1;
    select array_agg(id) into v_dups from partners
    where org_id = g.org_id and lower(email) = g.key and id <> v_keep;

    -- The oldest row is often the one a manager typed; the newer one is often
    -- the one claimed at signup. Lift user_id (and any profile text the keeper
    -- lacks) so a merge never costs the partner their own login.
    update partners k set
      user_id = coalesce(k.user_id, (select d.user_id from partners d
        where d.id = any(v_dups) and d.user_id is not null
        order by d.created_at asc nulls last, d.id asc limit 1)),
      name = coalesce(nullif(trim(k.name), ''), (select nullif(trim(d.name), '') from partners d
        where d.id = any(v_dups) and coalesce(trim(d.name), '') <> ''
        order by d.created_at asc nulls last, d.id asc limit 1)),
      title = coalesce(nullif(trim(k.title), ''), (select nullif(trim(d.title), '') from partners d
        where d.id = any(v_dups) and coalesce(trim(d.title), '') <> ''
        order by d.created_at asc nulls last, d.id asc limit 1), ''),
      company = coalesce(nullif(trim(k.company), ''), (select nullif(trim(d.company), '') from partners d
        where d.id = any(v_dups) and coalesce(trim(d.company), '') <> ''
        order by d.created_at asc nulls last, d.id asc limit 1), '')
    where k.id = v_keep;

    -- Access is the union of both identities' grants. Two statements because
    -- (partner_id, project_id) is the primary key: a blind update collides on
    -- every project both identities already reach.
    update partner_access pa set partner_id = v_keep
    where pa.partner_id = any(v_dups)
      and not exists (select 1 from partner_access k
                      where k.partner_id = v_keep and k.project_id = pa.project_id);
    delete from partner_access where partner_id = any(v_dups);

    -- Repoint history BEFORE the delete. comms.partner_id and
    -- partner_notes.partner_id are both ON DELETE SET NULL, so deleting first
    -- would leave every note that partner wrote unattributed and would drop it
    -- out of partner_thread_v2, which filters on partner_id.
    update comms set partner_id = v_keep where partner_id = any(v_dups);
    if to_regclass('public.partner_notes') is not null then
      execute 'update partner_notes set partner_id = $1 where partner_id = any($2)'
        using v_keep, v_dups;
    end if;

    delete from partners where id = any(v_dups);
  end loop;
end $$;

-- Case-insensitive: Ada@client.com and ada@client.com are one person, and that
-- pair is exactly what the portal duplicated. Blank emails are excluded rather
-- than collapsed - they are unclaimed placeholders, not identities, and
-- merging them would join unrelated people.
create unique index if not exists partners_org_email_uniq
  on partners (org_id, lower(email))
  where coalesce(trim(email), '') <> '';

create or replace function partner_update_profile(p_name text, p_title text, p_company text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update partners
     set name = left(coalesce(trim(p_name), ''), 120),
         title = left(coalesce(trim(p_title), ''), 120),
         company = left(coalesce(trim(p_company), ''), 160)
   where user_id = auth.uid();
  return found;
end; $$;
grant execute on function partner_update_profile(text, text, text) to authenticated;
create or replace function partner_projects_v2()
returns jsonb language sql security definer stable set search_path = public as $$
  -- Every PRD assigned to the signed-in partner. `name` is the project's own
  -- name, so an assignment with no published brief yet still shows a real title
  -- instead of its internal id. The brief payload is a version snapshot, but the
  -- collaborator logo/label is a *current* property of the project, so overlay
  -- the live brand at read time (jsonb || overwrites the two keys) - a logo added
  -- after the brief was shared reaches the partner with no re-publish.
  -- The distinct is deliberately redundant with partners_org_email_uniq above.
  -- The index is the guarantee; this is the blast radius if that guarantee is
  -- ever dropped, bypassed by a later migration, or defeated by an identity
  -- path that does not exist yet. A duplicate identity should be a data
  -- problem, never a visible defect in the client's portal.
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', t.project_id,
    'name', t.name,
    'payload', (select s.payload || jsonb_build_object('logo', t.brand_logo, 'brandLabel', t.brand_label)
                 from shares s
                 where s.project_id = t.project_id and s.kind = 'brief' and s.revoked = false
                 order by s.version_seq desc limit 1))), '[]'::jsonb)
  from (
    select distinct pr.id as project_id, pr.name, pr.brand_logo, pr.brand_label
    from partner_access pa
    join partners p on p.id = pa.partner_id
    join projects pr on pr.id = pa.project_id
    where p.user_id = auth.uid()
      -- Only surface PRDs the team has actually published a brief for: a partner
      -- should see things ready to review, not assignments still being drafted.
      and exists (select 1 from shares s2
                  where s2.project_id = pa.project_id and s2.kind = 'brief' and s2.revoked = false)
  ) t;
$$;
grant execute on function partner_projects_v2() to authenticated;

-- Same live-brand overlay for the accountless SME brief and the read-only
-- presentation link (both served by get_share). Redefines the v1 function so an
-- uploaded logo shows on every external surface the moment it is saved, even for
-- links shared before the logo existed. Falls back to the stored payload's own
-- brand when a share has no backing project row (defensive; all shares do).
create or replace function get_share(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select case when p.id is null then s.payload
              else s.payload || jsonb_build_object('logo', p.brand_logo, 'brandLabel', p.brand_label,
                                                   'practice', p.practice) end
  from shares s left join projects p on p.id = s.project_id
  where s.token = p_token and s.revoked = false limit 1;
$$;
grant execute on function get_share(text) to anon, authenticated;

-- The public read-only presentation token for an assigned project: the latest
-- non-revoked brief share the team has already published. Returns nothing if
-- no public brief exists. Creates nothing; only surfaces an existing token so
-- the partner can share the same read-only PRD the team made public.
create or replace function partner_present_token(p_project text)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when s.token is null then jsonb_build_object('ok', false)
              else jsonb_build_object('ok', true, 'token', s.token, 'seq', s.version_seq) end
  from (select 1) one
  left join shares s on s.project_id = p_project and s.kind = 'brief' and s.revoked = false
       and exists (select 1 from partner_access pa join partners p on p.id = pa.partner_id
                   where pa.project_id = p_project and p.user_id = auth.uid())
  order by s.version_seq desc
  limit 1;
$$;
grant execute on function partner_present_token(text) to authenticated;

create or replace function partner_thread_v2(p_project text)
returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'ref', c.ref, 'title', c.title, 'body', c.body, 'status', c.status, 'at', c.created_at,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('from', m.author_kind, 'name', m.author_name,
                                          'body', m.body, 'at', m.created_at) order by m.created_at)
      from messages m where m.parent_kind = 'comm' and m.parent_id = c.id), '[]'::jsonb),
    -- The partner's own uploads on this thread, so they persist across reloads.
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'size_bytes', a.size_bytes,
                                          'mime', a.mime, 'scan_status', a.scan_status, 'created_at', a.created_at) order by a.created_at)
      from attachments a where a.comm_id = c.id), '[]'::jsonb))
    order by c.created_at), '[]'::jsonb)
  from comms c
  where c.project_id = p_project
    and c.partner_id in (select id from partners where user_id = auth.uid());
$$;
grant execute on function partner_thread_v2(text) to authenticated;

create or replace function partner_post(p_project text, p_body text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_org uuid; v_name text; v_id uuid; v_n int; v_title text; v_ref text;
begin
  select p.id, p.org_id, coalesce(nullif(trim(p.name), ''), 'Partner')
    into v_pid, v_org, v_name
  from partners p join partner_access pa on pa.partner_id = p.id
  where p.user_id = auth.uid() and pa.project_id = p_project limit 1;
  if v_pid is null or coalesce(trim(p_body), '') = '' or length(p_body) > 20000 then return false; end if;
  -- A self-describing headline from the note's first line, so no two notes read
  -- the same "Partner note" in the inbox.
  v_title := left(regexp_replace(split_part(btrim(p_body), E'\n', 1), '\s+', ' ', 'g'), 72);
  if length(v_title) < length(regexp_replace(btrim(p_body), '\s+', ' ', 'g')) then v_title := v_title || '…'; end if;
  if v_title = '' then v_title := 'Partner note'; end if;
  -- A stable per-project reference so every partner note is trackable: PN-1, PN-2…
  -- A monotonic counter means references are never reused, even after a delete;
  -- the row update also serializes concurrent posts.
  update projects set partner_note_seq = partner_note_seq + 1 where id = p_project returning partner_note_seq into v_n;
  v_ref := 'PN-' || v_n;
  insert into comms(org_id, project_id, origin, partner_id, author_name, title, body, ref)
  values (v_org, p_project, 'partner', v_pid, v_name, v_title, p_body, v_ref)
  returning id into v_id;
  perform log_activity(v_org, p_project, 'comm.received', 'comm', v_id::text,
    v_ref || ' from ' || v_name, jsonb_build_object('ref', v_ref));
  return true;
end; $$;
grant execute on function partner_post(text, text) to authenticated;

create or replace function partner_reply(p_comm uuid, p_body text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c comms%rowtype; v_name text;
begin
  select * into c from comms where id = p_comm;
  if c.id is null or coalesce(trim(p_body), '') = '' or length(p_body) > 20000 then return false; end if;
  -- The caller must be the comm's partner AND still hold access to its project.
  -- (partner_post enforces the same; without the partner_access join a
  --  de-assigned partner could keep replying on historical threads.)
  select coalesce(nullif(trim(p.name), ''), 'Partner') into v_name
    from partners p
    join partner_access pa on pa.partner_id = p.id and pa.project_id = c.project_id
    where p.id = c.partner_id and p.user_id = auth.uid();
  if v_name is null then return false; end if;
  insert into messages(org_id, parent_kind, parent_id, author_kind, author_name, body)
  values (c.org_id, 'comm', c.id, 'partner', v_name, p_body);
  update comms set updated_at = now() where id = c.id;
  return true;
end; $$;
grant execute on function partner_reply(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 12) Session context (one round-trip at boot)
-- ----------------------------------------------------------------------------
create or replace function v2_context()
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'display_name', coalesce((select display_name from user_profiles where user_id = auth.uid()), ''),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('org_id', m.org_id, 'org_name', o.name, 'role', m.role))
      from org_members m join orgs o on o.id = m.org_id where m.user_id = auth.uid()), '[]'::jsonb),
    'partner', (select jsonb_build_object('id', p.id, 'org_id', p.org_id, 'name', p.name,
                                          'title', p.title, 'company', p.company, 'email', p.email)
                from partners p where p.user_id = auth.uid() limit 1));
$$;
grant execute on function v2_context() to authenticated;

-- ----------------------------------------------------------------------------
-- 13) Grants (RLS still gates every row)
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on projects, comms, messages, read_marks,
  input_requests, discovery_entries, version_approvals, user_profiles to authenticated;
grant select on project_fields, field_rows, activity, versions to authenticated;

-- Defense in depth: this schema shares a project with v1, whose setup ran a
-- blanket `grant ... on all tables to authenticated`. Revoke write on the
-- four tables that must only ever be written by their SECURITY DEFINER RPCs,
-- so their protection does not rest on the absence of an RLS policy alone.
-- (project_fields/field_rows → save_field/upsert_row/delete_row; activity is
--  the append-only audit trail, written only by log_activity; versions are
--  immutable baselines → create_version/version_set_status/version_set_build.)
revoke insert, update, delete on project_fields, field_rows, activity, versions from authenticated;
revoke insert, update, delete on activity from anon;

-- New foreign-key / RLS-subquery indexes (partner paths run on every partner
-- RPC and every project channel subscribe; without these they seq-scan).
create index if not exists partners_user on partners(user_id);
create index if not exists partner_access_project on partner_access(project_id);

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 14) E-sign v1 - recorded electronic signatures on a version
--     A signature request is an evidence row: token, signer identity channel,
--     the fingerprint captured at send, timestamps, and an audit trail. The
--     signature itself lands as a normal version_approvals row (inserted and
--     decided inside sign_request_sign), so the state machine, covers, gate
--     packets, and health signals all see it with zero new concepts. This is
--     a recorded signature with an audit trail, not cryptographic sealing;
--     sealing is the v2 phase and the receipt says so in plain words.
--     Writes are RPC-only; members read; signers act through the token.
-- ----------------------------------------------------------------------------
create table if not exists sign_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  version_id uuid not null references versions(id) on delete cascade,
  token text not null unique,
  signer_email text not null default '',
  signer_name text not null default '',
  signer_role text not null default '',
  status text not null default 'pending'
    check (status in ('pending','signed','declined')),
  doc_fingerprint text not null default '',   -- captured client-side at send; the signer's browser recomputes and compares
  sent_by uuid,
  sent_at timestamptz not null default now(),
  signed_name text not null default '',       -- the name the signer typed
  signed_at timestamptz,
  decline_reason text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  approval_id uuid,                            -- the version_approvals row the signature created
  revoked boolean not null default false
);
create index if not exists sr_ver on sign_requests(version_id);
create index if not exists sr_proj on sign_requests(project_id);
alter table sign_requests enable row level security;

drop policy if exists sr_read on sign_requests;
create policy sr_read on sign_requests for select using (is_project_member(project_id));
grant select on sign_requests to authenticated;
revoke insert, update, delete on sign_requests from authenticated, anon;

-- The approval row remembers which signature created it, so covers and
-- exports can mark a sign-off as e-signed without a join at render time.
alter table version_approvals add column if not exists sign_request_id uuid;

create or replace function sign_request_create(
  p_version uuid, p_email text, p_name text default '', p_role text default '', p_fingerprint text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ver versions%rowtype; v_id uuid; v_token text; v_atts jsonb;
begin
  select * into v_ver from versions where id = p_version;
  if v_ver.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_project_manager(v_ver.project_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(trim(p_email), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;
  -- v2.49: snapshot the project's clean, hashed attachments at the moment of
  -- send. A file that cannot prove its bytes (unscanned, scan error, or
  -- unhashed) is excluded because the snapshot is evidence, not inventory.
  -- The receipt carries evidence through unchanged (seal_context, v2.48).
  select jsonb_agg(jsonb_build_object(
           'file_name', a.file_name, 'sha256_hex', a.sha256_hex, 'size_bytes', a.size_bytes)
         order by a.created_at)
    into v_atts
    from attachments a
   where a.project_id = v_ver.project_id and a.scan_status = 'clean' and a.sha256_hex <> '';
  v_token := url_token();
  insert into sign_requests(org_id, project_id, version_id, token, signer_email, signer_name, signer_role, doc_fingerprint, sent_by, evidence)
  values (project_org(v_ver.project_id), v_ver.project_id, p_version, v_token,
          trim(p_email), coalesce(trim(p_name), ''), coalesce(trim(p_role), ''), coalesce(p_fingerprint, ''), auth.uid(),
          case when v_atts is null then '{}'::jsonb else jsonb_build_object('attachmentsAtSend', v_atts) end)
  returning id into v_id;
  perform log_activity(project_org(v_ver.project_id), v_ver.project_id, 'sign.requested',
    'sign', v_id::text, 'v' || v_ver.label || ' signature requested from ' || trim(p_email), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token);
end; $$;
grant execute on function sign_request_create(uuid, text, text, text, text) to authenticated;

-- Everything the signer's page needs, keyed by token: the exact stored
-- snapshot (versions are immutable, so this IS the artifact), the fingerprint
-- captured at send, branding, and the request state. Anon-callable.
create or replace function sign_request_context(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true,
    'status', r.status,
    'revoked', r.revoked,
    'signer', jsonb_build_object('email', r.signer_email, 'name', r.signer_name, 'role', r.signer_role),
    'signedName', r.signed_name, 'signedAt', r.signed_at, 'declineReason', r.decline_reason,
    'fingerprint', r.doc_fingerprint,
    'project', p.name, 'logo', p.brand_logo, 'brandLabel', p.brand_label,
    'practice', p.practice,
    'label', v.label, 'seq', v.seq, 'versionStatus', v.status,
    'note', v.note, 'author', v.author_name, 'created', v.created_at,
    'snapshot', v.snapshot)
  from sign_requests r
  join versions v on v.id = r.version_id
  join projects p on p.id = r.project_id
  where r.token = p_token and r.revoked = false
  limit 1;
$$;
grant execute on function sign_request_context(text) to anon, authenticated;

create or replace function sign_request_sign(p_token text, p_typed_name text, p_ua text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r sign_requests%rowtype; v_ver versions%rowtype; v_appr uuid; v_deliv jsonb;
begin
  select * into r from sign_requests where token = p_token and revoked = false;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_link'); end if;
  if r.status = 'signed' then
    return jsonb_build_object('ok', true, 'already', true, 'signedAt', r.signed_at, 'signedName', r.signed_name);
  end if;
  if r.status = 'declined' then return jsonb_build_object('ok', false, 'error', 'declined'); end if;
  if coalesce(trim(p_typed_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  select * into v_ver from versions where id = r.version_id;
  -- The signature manifests as a normal approval row. The provenance trigger
  -- forces the insert to pending and stamps decided_at on the decision;
  -- decided_by stays null for an accountless signer - attribution lives here,
  -- in the signature record (typed name, email channel, token, timestamps).
  insert into version_approvals(version_id, approver_role, approver_name)
  values (r.version_id, coalesce(nullif(trim(r.signer_role), ''), 'Signer'), trim(p_typed_name))
  returning id into v_appr;
  update version_approvals
     set status = 'approved', comment = 'Signed electronically', sign_request_id = r.id
   where id = v_appr;
  update sign_requests
     set status = 'signed', signed_name = trim(p_typed_name), signed_at = now(), approval_id = v_appr,
         evidence = coalesce(evidence, '{}'::jsonb)
           || jsonb_build_object('ua', left(coalesce(p_ua, ''), 400), 'channel', 'email_token')
   where id = r.id;
  perform log_activity(r.org_id, r.project_id, 'sign.signed',
    'sign', r.id::text, 'v' || v_ver.label || ' signed by ' || trim(p_typed_name) || ' (' || r.signer_email || ')', '{}'::jsonb);
  select coalesce(jsonb_agg(d.id), '[]'::jsonb) into v_deliv
    from webhook_deliveries d
   where d.event_type = 'sign.signed' and d.state = 'pending' and d.attempt = 0
     and d.payload->>'signRequestId' = r.id::text;
  return jsonb_build_object('ok', true, 'signedAt', now(), 'approvalId', v_appr,
    'pendingDeliveries', v_deliv);
end; $$;
grant execute on function sign_request_sign(text, text, text) to anon, authenticated;

create or replace function sign_request_decline(p_token text, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r sign_requests%rowtype; v_ver versions%rowtype; v_deliv jsonb;
begin
  select * into r from sign_requests where token = p_token and revoked = false;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_link'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'already_decided'); end if;
  select * into v_ver from versions where id = r.version_id;
  update sign_requests
     set status = 'declined', decline_reason = left(coalesce(p_reason, ''), 2000)
   where id = r.id;
  perform log_activity(r.org_id, r.project_id, 'sign.declined',
    'sign', r.id::text, 'v' || v_ver.label || ' declined by ' || r.signer_email, '{}'::jsonb);
  select coalesce(jsonb_agg(d.id), '[]'::jsonb) into v_deliv
    from webhook_deliveries d
   where d.event_type = 'sign.declined' and d.state = 'pending' and d.attempt = 0
     and d.payload->>'signRequestId' = r.id::text;
  return jsonb_build_object('ok', true, 'pendingDeliveries', v_deliv);
end; $$;
grant execute on function sign_request_decline(text, text) to anon, authenticated;

create or replace function sign_request_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r sign_requests%rowtype;
begin
  select * into r from sign_requests where id = p_id;
  if r.id is null or not is_project_manager(r.project_id) then return false; end if;
  if r.status <> 'pending' then return false; end if;   -- a signed record is never un-signed from here
  update sign_requests set revoked = true where id = p_id;
  perform log_activity(r.org_id, r.project_id, 'sign.revoked',
    'sign', r.id::text, 'signature request to ' || r.signer_email || ' revoked', '{}'::jsonb);
  return true;
end; $$;
grant execute on function sign_request_revoke(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 15) Project name sync (v2.26.1)
--     The worksheet's "Product or project name" answer (ctrl_product) is the
--     name people actually edit, but the dashboard, the approvals feed,
--     invites, the signer's page (sign_request_context), and both signature
--     mailers read projects.name - written once at creation and never again.
--     Rename the record in the worksheet and every other surface, including
--     the email a client signs from, kept the stale name. The sync is a
--     trigger, not a client write: it runs inside the same transaction as
--     the save, covers every write path (save_field, seeds, migrations),
--     and cannot be forgotten by a future caller.
--     jsonb note: value holds a jsonb string ("RecordMade"); value #>> '{}'
--     extracts the bare text of a top-level scalar. value::text keeps the
--     JSON quotes and would rename the project to "RecordMade" with literal
--     quotation marks on every surface.
--     Live databases get this from supabase/migrations/0014_project_name_sync.sql,
--     which also repairs records that drifted before the trigger existed.
-- ----------------------------------------------------------------------------
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

-- Convergence for databases built by re-running this file: same expression
-- as the trigger, `is distinct from` makes it a no-op when nothing drifted.
update projects p
   set name = left(btrim(pf.value #>> '{}'), 200), updated_at = now()
  from project_fields pf
 where pf.project_id = p.id
   and pf.field_id = 'ctrl_product'
   and pf.value is not null
   and jsonb_typeof(pf.value) = 'string'
   and btrim(pf.value #>> '{}') <> ''
   and p.name is distinct from left(btrim(pf.value #>> '{}'), 200);

-- ----------------------------------------------------------------------------
-- 16) Weekly updates (v2.27.0)
--     Published, immutable digests of what moved on the record. See
--     supabase/migrations/0018_updates.sql (identical content) for the live-DB patch
--     and the full rationale. Not a tracker: every line derives from
--     record truth; the row is evidence, published once, never edited.
-- ----------------------------------------------------------------------------

create table if not exists updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  seq integer not null,
  token text not null unique,
  window_from timestamptz,                    -- null on the first update
  window_to timestamptz not null default now(),
  prepared_by text not null default '',       -- the engagement lead's own name line
  payload jsonb not null,                     -- the frozen digest the link renders
  published_by uuid default auth.uid(),
  published_at timestamptz not null default now(),
  revoked boolean not null default false,     -- kill switch for a bad publish; the page says withdrawn
  unique (project_id, seq)
);
create index if not exists upd_proj on updates(project_id, seq desc);
alter table updates enable row level security;

drop policy if exists upd_read on updates;
create policy upd_read on updates for select using (is_project_member(project_id));
grant select on updates to authenticated;
revoke insert, update, delete on updates from authenticated, anon;

-- Publish: seq allocated under a project lock (the create_version discipline),
-- server-generated token, size-capped payload, activity logged. The payload
-- arrives assembled and approved by the composer; publishing freezes it.
-- v2.34.0 added two recipient arguments. `create or replace` cannot change an
-- argument list - it would leave the old four-argument version in place as a
-- second overload and make the PostgREST call ambiguous - so the previous
-- signature is dropped explicitly first.
drop function if exists update_publish(text, jsonb, timestamptz, text);
create or replace function update_publish(
  p_project text, p_payload jsonb, p_window_from timestamptz default null,
  p_prepared_by text default '', p_recipient_name text default '',
  p_recipient_email text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_seq integer; v_token text; v_id uuid; v_ver uuid;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_payload');
  end if;
  if pg_column_size(p_payload) > 262144 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('upd/' || p_project, 42));
  select coalesce(max(seq), 0) + 1 into v_seq from updates where project_id = p_project;
  -- The baseline this update reported on, taken from the record rather than
  -- from the payload the composer assembled, so the link's signature panel and
  -- the printed footer can never point at two different versions.
  select id into v_ver from versions where project_id = p_project order by seq desc limit 1;
  v_token := url_token();
  insert into updates(org_id, project_id, seq, token, window_from, prepared_by, payload,
                      version_id, recipient_name, recipient_email)
  values (v_org, p_project, v_seq, v_token, p_window_from,
          left(coalesce(trim(p_prepared_by), ''), 120), p_payload, v_ver,
          left(coalesce(trim(p_recipient_name), ''), 120),
          left(coalesce(trim(p_recipient_email), ''), 200))
  returning id into v_id;
  perform log_activity(v_org, p_project, 'update.published', 'update', v_id::text,
    'Weekly update #' || v_seq || ' published', jsonb_build_object('seq', v_seq));
  return jsonb_build_object('ok', true, 'id', v_id, 'seq', v_seq, 'token', v_token);
end; $$;
grant execute on function update_publish(text, jsonb, timestamptz, text, text, text) to authenticated;

-- Everything the client's page needs, keyed by token. Revoked rows return
-- a marker instead of the payload, so the page can say "withdrawn" plainly
-- rather than pretending the link never existed.
-- v2.34.0: the page is now a panel, and every panel below is a READ of state
-- that already exists elsewhere in the record.
--
--   signatures  every signature request on this update's baseline, pending and
--               completed, each carrying its own sign token so the recipient
--               lands on the real sign page rather than an approval built into
--               this link. Authorization happens at #sign/<token>, on the exact
--               baseline, through the machinery that already produces evidence.
--               Revoked requests are omitted: a revoked link is not a pending
--               signature and showing it would invite a dead click.
--   baselines   every baseline of this project, newest first, with a read-only
--               present-mode token WHERE ONE HAS ALREADY BEEN PUBLISHED and a
--               fingerprint WHERE ONE HAS ALREADY BEEN RECORDED. This function
--               mints no share tokens and computes no fingerprints. Publishing
--               a baseline to a link is a manager's disclosure decision, and
--               reading an update must never make it on their behalf; a
--               fingerprint is a fact captured at a moment, and inventing one
--               here would put an unverified hash next to a signature.
--   recipient   who the link was issued to. Drives attribution on comments and
--               nothing else.
create or replace function update_context(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select case when u.revoked then
    jsonb_build_object('ok', true, 'revoked', true, 'project', p.name, 'seq', u.seq)
  else
    jsonb_build_object(
      'ok', true, 'revoked', false,
      'project', p.name, 'logo', p.brand_logo, 'brandLabel', p.brand_label,
      'seq', u.seq, 'preparedBy', u.prepared_by,
      'windowFrom', u.window_from, 'windowTo', u.window_to,
      'publishedAt', u.published_at, 'payload', u.payload,
      'recipient', jsonb_build_object('name', u.recipient_name, 'email', u.recipient_email),
      -- The project id is already client-visible: every present-mode link the
      -- team shares carries it in the URL. The panel needs it to build those
      -- same links, and it exposes nothing a shared baseline has not already.
      'projectId', u.project_id,
      'baselineLabel', (select v.label from versions v where v.id = u.version_id),
      'signatures', coalesce((
        select jsonb_agg(jsonb_build_object(
                 -- SECURITY (v2.34.2). A sign token IS the signing credential:
                 -- sign_request_sign() takes the token and a typed name, is
                 -- granted to anon, and asks for nothing else. Returning every
                 -- signer's token here therefore turned a forwardable weekly
                 -- update into the power to forge every signature on the
                 -- baseline. The token is now released only to the person the
                 -- update was issued to, matched on email, so this panel grants
                 -- nobody anything they were not already sent directly. Every
                 -- other signer appears as status only, with no link.
                 'token', case
                    when coalesce(trim(u.recipient_email), '') <> ''
                     and lower(trim(u.recipient_email)) = lower(trim(r.signer_email))
                    then r.token else null end,
                 -- signer_email is deliberately NOT returned. The panel needs a
                 -- name and a role to be readable; it does not need to hand a
                 -- client contact the mailbox of everyone else who signed.
                 'name', r.signer_name,
                 'role', r.signer_role, 'status', r.status,
                 'sentAt', r.sent_at, 'signedAt', r.signed_at, 'signedName', r.signed_name)
                 order by r.sent_at)
        from sign_requests r
        where r.version_id = u.version_id and r.revoked = false), '[]'::jsonb),
      'baselines', coalesce((
        select jsonb_agg(b order by b.seq desc) from (
          select v.seq, v.label, v.status, v.created_at,
            (select s.token from shares s
              where s.project_id = v.project_id and s.kind = 'present'
                and s.version_seq = v.seq and s.revoked = false
              order by s.updated_at desc limit 1) as "presentToken",
            coalesce(
              (select r.doc_fingerprint from sign_requests r
                where r.version_id = v.id and coalesce(r.doc_fingerprint, '') <> ''
                order by r.sent_at desc limit 1),
              (select u2.payload #>> '{baseline,fp}' from updates u2
                where u2.version_id = v.id and u2.payload #>> '{baseline,fp}' is not null
                order by u2.seq desc limit 1),
              '') as fingerprint
          from versions v where v.project_id = u.project_id) b), '[]'::jsonb))
  end
  from updates u
  join projects p on p.id = u.project_id
  where u.token = p_token
  limit 1;
$$;
grant execute on function update_context(text) to anon, authenticated;

create or replace function update_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r updates%rowtype;
begin
  select * into r from updates where id = p_id;
  if r.id is null or not is_project_manager(r.project_id) then return false; end if;
  if r.revoked then return true; end if;
  update updates set revoked = true where id = p_id;
  perform log_activity(r.org_id, r.project_id, 'update.revoked', 'update', r.id::text,
    'Weekly update #' || r.seq || ' withdrawn', '{}'::jsonb);
  return true;
end; $$;
grant execute on function update_revoke(uuid) to authenticated;

-- A comment from the update link. It lands in comms as external input, filed
-- against the same baseline the update reported on, and it is the ONLY thing
-- the token page writes.
--
-- Attribution is the recipient the token was issued to, never anonymous and
-- never typed by the sender: the box has no name field, so the name on the
-- record is the one the manager addressed the link to. A link issued with no
-- recipient at all therefore cannot accept comments - refusing is correct,
-- because an unattributed comment on an accountability record is worse than
-- no comment. That is also why the token is not shareable as a comment
-- channel: whoever it is forwarded to still writes as the named recipient,
-- which is exactly the property the record needs and the reason the composer
-- asks for a name.
--
-- What it is not: an approval, an authorization, or a change to the
-- agreement. It is a message. It becomes part of the record only if a manager
-- promotes it, through the same promotion path as every other inbound note.
create or replace function update_comment(p_token text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u updates%rowtype; v_name text; v_title text; v_n int; v_ref text;
        v_seq integer; v_id uuid;
begin
  select * into u from updates where token = p_token and revoked = false;
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_link'); end if;
  if coalesce(trim(p_body), '') = '' or length(p_body) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'bad_body');
  end if;
  v_name := coalesce(nullif(trim(u.recipient_name), ''), nullif(trim(u.recipient_email), ''));
  if v_name is null then return jsonb_build_object('ok', false, 'error', 'no_recipient'); end if;

  -- A self-describing headline from the first line, so no two comments read
  -- the same in the inbox (the partner_post convention).
  v_title := left(regexp_replace(split_part(btrim(p_body), E'\n', 1), '\s+', ' ', 'g'), 72);
  if length(v_title) < length(regexp_replace(btrim(p_body), '\s+', ' ', 'g')) then
    v_title := v_title || '…';
  end if;
  if v_title = '' then v_title := 'Update comment'; end if;

  -- Shares the monotonic per-project note counter, so a reference is never
  -- reused across the two external note paths.
  update projects set partner_note_seq = partner_note_seq + 1
    where id = u.project_id returning partner_note_seq into v_n;
  v_ref := 'UC-' || v_n;

  select seq into v_seq from versions where id = u.version_id;
  insert into comms(org_id, project_id, origin, version_seq, author_name, author_email,
                    title, body, ref)
  values (u.org_id, u.project_id, 'update', v_seq, v_name, u.recipient_email,
          v_title, p_body, v_ref)
  returning id into v_id;
  perform log_activity(u.org_id, u.project_id, 'comm.received', 'comm', v_id::text,
    v_ref || ' from ' || v_name || ' on update no. ' || u.seq,
    jsonb_build_object('ref', v_ref, 'update_seq', u.seq));
  return jsonb_build_object('ok', true, 'ref', v_ref, 'author', v_name);
end; $$;
grant execute on function update_comment(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 17. Firm templates (v2.30.0). The standing structure of an engagement,
-- saved by a manager, readable by members, applied at creation through the
-- same rev-checked write RPCs as live editing. reviewed_at makes staleness
-- visible at the moment of use. Reads via RLS; writes via RPCs only.
-- ---------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 18) Org bootstrap (folded from the v1 baseline, v2.31)
-- ----------------------------------------------------------------------------
-- Both functions have existed in production since v1 but were never committed
-- here, so a fresh install from this file alone could not create its first
-- workspace or honor an invite. Folded in verbatim from the deployed
-- definitions (mirrored by tests/backend-e2e/v1-backend.sql, which the backend
-- suite applies before this file and re-applies after, proving the two copies
-- agree). They reference the v1 org tables (orgs, org_members, org_invites,
-- partners); on a bare project, create those from the v1 baseline first.

-- Create a workspace and make the caller its first manager.
create or replace function create_org(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into orgs(name, created_by) values (coalesce(nullif(trim(p_name),''),'My workspace'), auth.uid())
    returning id into new_id;
  insert into org_members(org_id, user_id, email, role)
    values (new_id, auth.uid(), (select email from auth.users where id = auth.uid()), 'manager');
  return new_id;
end; $$;
grant execute on function create_org(text) to authenticated;

-- Claim any pending invites for my email, and link any partner row by email.
-- Returns the number of memberships joined plus partner rows linked, so
-- partner-only invites are recognized at sign-up.
-- The jsonb return type replaced the original int in v2.39.0; CREATE OR
-- REPLACE cannot change a return type (42P13), so any database holding the
-- old function, including the harness's own baseline, needs the drop first.
drop function if exists claim_invites();
create or replace function claim_invites()
returns jsonb language plpgsql security definer set search_path = public as $$
declare my_email text; n int := 0; p int := 0; ids jsonb := '[]'::jsonb;
begin
  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then return jsonb_build_object('n', 0, 'org_ids', '[]'::jsonb); end if;
  with joined as (
    insert into org_members(org_id, user_id, email, role)
      select i.org_id, auth.uid(), my_email, i.role from org_invites i where lower(i.email) = lower(my_email)
      on conflict (org_id, user_id) do nothing
      returning org_id)
  select count(*), coalesce(jsonb_agg(org_id), '[]'::jsonb) into n, ids from joined;
  delete from org_invites where lower(email) = lower(my_email);
  update partners set user_id = auth.uid() where lower(email) = lower(my_email) and user_id is null;
  get diagnostics p = row_count;
  return jsonb_build_object('n', n + p, 'org_ids', ids);
end; $$;
grant execute on function claim_invites() to authenticated;

-- ----------------------------------------------------------------------------
-- 19) Demo walkthrough (v2.32)
--     An ordered set of screenshots, each with a caption describing the action
--     on screen, attached to the project for the build team. Bytes ride the
--     existing attachment pipeline (edge scan -> Storage -> attachment_add);
--     this layer only holds order and captions. Shots are working material:
--     any team member curates them; removing a shot detaches it and leaves the
--     underlying file (whose deletion stays manager-only on attachments).
--     A generated version freezes the walkthrough (captions, order, file
--     references) inside its snapshot, under the same fingerprint.
-- ----------------------------------------------------------------------------
create table if not exists walkthrough_shots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  position int not null,
  caption text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, attachment_id)
);
create index if not exists wt_shots_proj on walkthrough_shots(project_id, position);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wt_shots_caps') then
    alter table walkthrough_shots add constraint wt_shots_caps
      check (position >= 1 and length(caption) <= 500) not valid;
  end if;
end $$;
alter table walkthrough_shots enable row level security;
drop policy if exists wt_member_read on walkthrough_shots;
create policy wt_member_read on walkthrough_shots for select using (is_org_member(org_id));
grant select on walkthrough_shots to authenticated;
revoke insert, update, delete on walkthrough_shots from authenticated, anon;
-- Live: curation surfaces for every open teammate within the second.
drop trigger if exists wt_shots_bcast on walkthrough_shots;
create trigger wt_shots_bcast after insert or update or delete on walkthrough_shots
  for each row execute function broadcast_project_change();

-- The upload edge function verifies the JWT, then resolves a project-anchored
-- team upload here (no thread): org membership is the whole gate.
create or replace function attachment_team_target(p_project text, p_user uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case
    when p.id is null then jsonb_build_object('ok', false, 'error', 'unknown_project')
    when exists (select 1 from org_members m where m.org_id = p.org_id and m.user_id = p_user)
      then jsonb_build_object('ok', true, 'org_id', p.org_id,
             'name', coalesce((select display_name from user_profiles up where up.user_id = p_user), 'Team'))
    else jsonb_build_object('ok', false, 'error', 'forbidden')
  end
  from (select 1) one left join projects p on p.id = p_project;
$$;
revoke execute on function attachment_team_target(text, uuid) from public;
do $$ begin
  execute 'grant execute on function attachment_team_target(text, uuid) to service_role';
exception when undefined_object then null; end $$;

-- Append a shot. The attachment must belong to this project, be an image, and
-- not be flagged infected. Position is assigned under a per-project lock, so
-- concurrent adds cannot collide.
create or replace function walkthrough_add(p_project text, p_attachment uuid, p_caption text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_att attachments%rowtype; v_pos int; v_id uuid;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_member(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into v_att from attachments a where a.id = p_attachment;
  if v_att.id is null or v_att.project_id <> p_project then
    return jsonb_build_object('ok', false, 'error', 'bad_attachment'); end if;
  if v_att.mime not like 'image/%' then
    return jsonb_build_object('ok', false, 'error', 'not_an_image'); end if;
  if v_att.scan_status = 'infected' then
    return jsonb_build_object('ok', false, 'error', 'infected'); end if;
  if length(coalesce(p_caption, '')) > 500 then
    return jsonb_build_object('ok', false, 'error', 'caption_too_long'); end if;
  perform pg_advisory_xact_lock(hashtextextended('wt/' || p_project, 19));
  if exists (select 1 from walkthrough_shots w
             where w.project_id = p_project and w.attachment_id = p_attachment) then
    return jsonb_build_object('ok', false, 'error', 'duplicate'); end if;
  select coalesce(max(position), 0) + 1 into v_pos from walkthrough_shots where project_id = p_project;
  insert into walkthrough_shots(org_id, project_id, attachment_id, position, caption)
  values (v_org, p_project, p_attachment, v_pos, coalesce(p_caption, ''))
  returning id into v_id;
  perform log_activity(v_org, p_project, 'walkthrough.added', 'walkthrough', v_id::text,
    'Added shot ' || v_pos || ' to the demo walkthrough (' || left(v_att.file_name, 120) || ')',
    jsonb_build_object('position', v_pos, 'attachment', p_attachment));
  return jsonb_build_object('ok', true, 'id', v_id, 'position', v_pos);
end; $$;
grant execute on function walkthrough_add(text, uuid, text) to authenticated;

-- Caption edits and reorders are working-material churn: allowed for any team
-- member, deliberately kept off the activity trail. Add and remove are logged.
create or replace function walkthrough_caption(p_shot uuid, p_caption text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w walkthrough_shots%rowtype;
begin
  select * into w from walkthrough_shots where id = p_shot;
  if w.id is null or not is_org_member(w.org_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if length(coalesce(p_caption, '')) > 500 then
    return jsonb_build_object('ok', false, 'error', 'caption_too_long'); end if;
  update walkthrough_shots set caption = coalesce(p_caption, ''), updated_at = now() where id = p_shot;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function walkthrough_caption(uuid, text) to authenticated;

-- Swap with the neighbor above (-1) or below (+1). At an edge this is a clean
-- no-op, reported as moved:false, so the client needs no bounds bookkeeping.
create or replace function walkthrough_move(p_shot uuid, p_dir int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w walkthrough_shots%rowtype; n walkthrough_shots%rowtype;
begin
  if p_dir is null or p_dir not in (-1, 1) then
    return jsonb_build_object('ok', false, 'error', 'bad_dir'); end if;
  select * into w from walkthrough_shots where id = p_shot;
  if w.id is null or not is_org_member(w.org_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended('wt/' || w.project_id, 19));
  select * into n from walkthrough_shots
    where project_id = w.project_id
      and ((p_dir = -1 and position < w.position) or (p_dir = 1 and position > w.position))
    order by case when p_dir = -1 then -position else position end limit 1;
  if n.id is null then return jsonb_build_object('ok', true, 'moved', false); end if;
  -- Position carries no unique constraint, so a straight swap is safe; the
  -- advisory lock above serializes concurrent reorders on the project.
  update walkthrough_shots set position = n.position, updated_at = now() where id = w.id;
  update walkthrough_shots set position = w.position, updated_at = now() where id = n.id;
  return jsonb_build_object('ok', true, 'moved', true);
end; $$;
grant execute on function walkthrough_move(uuid, int) to authenticated;

-- Detach a shot. The attachment row and its stored bytes stay; deleting those
-- remains the manager-only path that already exists on attachments.
create or replace function walkthrough_remove(p_shot uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w walkthrough_shots%rowtype;
begin
  select * into w from walkthrough_shots where id = p_shot;
  if w.id is null or not is_org_member(w.org_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  delete from walkthrough_shots where id = p_shot;
  perform log_activity(w.org_id, w.project_id, 'walkthrough.removed', 'walkthrough', p_shot::text,
    'Removed shot ' || w.position || ' from the demo walkthrough',
    jsonb_build_object('position', w.position, 'attachment', w.attachment_id));
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function walkthrough_remove(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 20) Walkthrough images on shared PRDs (v2.33)
--     External readers are accountless; the attachments bucket is private.
--     The walkthrough-image edge function serves a shot to a share reader by
--     validating here first: the token must be a live brief share, and the
--     attachment must sit inside the walkthrough that FROZE into the exact
--     version that share points at. Nothing else in the bucket is reachable
--     through this path, and revoking the share closes it instantly.
-- ----------------------------------------------------------------------------
create or replace function walkthrough_image_access(p_token text, p_attachment uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case
    when s.token is null then jsonb_build_object('ok', false, 'error', 'invalid_link')
    when v.id is null then jsonb_build_object('ok', false, 'error', 'no_version')
    when not exists (
      select 1 from jsonb_array_elements(coalesce(v.snapshot->'walkthrough', '[]'::jsonb)) e
      where e->>'attachment_id' = p_attachment::text)
      then jsonb_build_object('ok', false, 'error', 'not_in_walkthrough')
    when a.id is null then jsonb_build_object('ok', false, 'error', 'file_gone')
    else jsonb_build_object('ok', true, 'path', a.storage_path)
  end
  from (select 1) one
  left join shares s on s.token = p_token and s.revoked = false and s.kind = 'brief'
  left join versions v on v.project_id = s.project_id and v.seq = s.version_seq
  left join attachments a on a.id = p_attachment and a.project_id = s.project_id
       and a.scan_status <> 'infected';
$$;
revoke execute on function walkthrough_image_access(text, uuid) from public;
do $$ begin
  execute 'grant execute on function walkthrough_image_access(text, uuid) to service_role';
exception when undefined_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 21) Notes at a baseline + the update panel (v2.34.0)
--     Two related moves, both of which keep the record the only source of
--     record state:
--
--     a. discovery_entries gains version_seq, the column comms has carried
--        since v2. A note or a discovery entry is now filed against the
--        baseline that was current when it was written, so "what was said
--        around v1.3" is answerable without inference. The stamp is metadata
--        ABOUT a note, never content IN a baseline: snapshots still contain
--        only answers and sections, and promotion remains the only path by
--        which a note becomes part of the agreement.
--
--     b. update_context grows from "the frozen digest" into a view onto the
--        record around it: the signature requests on the update's baseline,
--        the prior baselines with their recorded fingerprints, and a comment
--        box attributed to the named recipient. Every one of those is a READ
--        of state that already exists. The single exception is the comment,
--        which is an inbound message, not record state - it lands in comms
--        exactly like a reviewer's note and changes nothing about the
--        agreement until a manager promotes it.
-- ----------------------------------------------------------------------------

-- a) Parity with comms.
alter table discovery_entries add column if not exists version_seq integer;
create index if not exists disc_ver on discovery_entries(project_id, version_seq)
  where version_seq is not null;
create index if not exists comms_ver on comms(project_id, version_seq)
  where version_seq is not null;

-- b) The update row learns which baseline it reported on and who it was for.
-- version_id is stamped server-side from the project's newest baseline at
-- publish, so it cannot disagree with the seq the composer used. The recipient
-- is the attribution for any comment that arrives back through the link; a
-- link issued to nobody accepts no comments (see update_comment).
alter table updates add column if not exists version_id uuid references versions(id) on delete set null;
alter table updates add column if not exists recipient_name text not null default '';
alter table updates add column if not exists recipient_email text not null default '';

-- A comment from an update link is external input, and the inbox should say so
-- rather than disguising it as a reviewer or a client contact. The origin
-- vocabulary is additive; every existing value keeps its meaning.
alter table comms drop constraint if exists comms_origin_check;
alter table comms add constraint comms_origin_check
  check (origin in ('app','brief','sme','partner','team','meeting','update','agent'));

-- The external-origin flag now covers it, so an update comment raises the same
-- "new reply" signal to the team as any other outside voice.
create or replace function comms_flag_external()
returns trigger language plpgsql as $$
begin
  if new.origin in ('app','brief','sme','partner','update')
     and (coalesce(new.body,'') <> '' or coalesce(new.verdict,'') <> '' or coalesce(new.steps,'') <> '') then
    new.last_ext_at := coalesce(new.last_ext_at, now());
  end if;
  return new;
end; $$;
drop trigger if exists comms_flag_external_t on comms;
create trigger comms_flag_external_t before insert on comms
  for each row execute function comms_flag_external();

-- ----------------------------------------------------------------------------
-- 22) The weekly update dashboard: recipient role, permanent phase-prefixed
--     row IDs, recipient notes, and threads on the comms spine (v2.35.0)
--
--     The update link renders AUTHORED content frozen at publish - the
--     engagement phase, the objectives and key results, and the risk and
--     issue rows, each with a permanent phase-prefixed ID - and gives the
--     named recipient two capabilities: a private note scoped to their
--     token, and real threads that land in the team Inbox through the same
--     last_ext_at / team_seen_at signal as every other outside voice. No
--     parallel messaging or notification system exists. Nothing here is
--     computed over the record: no rollup, no verdict, no derived status
--     (docs/POSITIONING.md). Definitions below intentionally supersede the
--     earlier update_publish / update_context / sme_thread / sme_reply
--     forms, the section-21 pattern. Mirrored in
--     supabase/migrations/0020_weekly_update.sql for live databases.
-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- a) The update row learns the recipient's role.
-- ----------------------------------------------------------------------------
alter table updates add column if not exists recipient_role text not null default '';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'updates_recipient_role_chk') then
    alter table updates add constraint updates_recipient_role_chk
      check (recipient_role in ('', 'Client', 'Partner'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- b) Threads live on comms; a thread knows which update link opened it.
--    update_id is provenance and the server-side scope for the token page:
--    a token renders and replies to the threads of ITS update, nobody else's.
-- ----------------------------------------------------------------------------
alter table comms add column if not exists update_id uuid references updates(id) on delete set null;
create index if not exists comms_update on comms(update_id) where update_id is not null;

-- The recipient is a third author voice, distinct from the team, from client
-- contacts with accounts (partner), and from SMEs.
alter table messages drop constraint if exists messages_author_kind_check;
alter table messages add constraint messages_author_kind_check
  check (author_kind in ('team','partner','sme','client'));

-- A client reply bumps the thread's team-level "new reply" signal exactly like
-- an SME or partner reply. No new notification machinery: this trigger IS the
-- inbox signal, and extending its list is the whole change.
create or replace function messages_flag_external()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_kind = 'comm' and new.author_kind in ('sme','partner','client') then
    update comms set last_ext_at = now() where id = new.parent_id;
  end if;
  return new;
end; $$;
drop trigger if exists messages_flag_external_t on messages;
create trigger messages_flag_external_t after insert on messages
  for each row execute function messages_flag_external();

-- ----------------------------------------------------------------------------
-- c) Permanent phase-prefixed row IDs for the updates worksheet rows.
--    D01, D02, V01: the letter is the phase the row was created under, the
--    number is allocated server-side per (project, field, letter) and NEVER
--    reused, so deleting a row cannot renumber the others and a replayed
--    add cannot collide. The id3 discipline (permanent key, allocated under
--    a lock, formatted for reading) applied per phase bucket.
-- ----------------------------------------------------------------------------
create table if not exists row_id_seq (
  project_id text not null references projects(id) on delete cascade,
  field_id text not null,
  bucket text not null,
  n integer not null default 0,
  primary key (project_id, field_id, bucket)
);
alter table row_id_seq enable row level security;
-- No policies on purpose: nothing reads or writes this table except the
-- SECURITY DEFINER allocator below.
revoke all on row_id_seq from authenticated, anon;

create or replace function updates_next_id(p_project text, p_letter text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- One letter per phase: S Discovery, D Design, V Development, T Test,
  -- I Implement, M Manage. The vocabulary is closed; anything else is a bug.
  if p_letter is null or p_letter not in ('S','D','V','T','I','M') then
    return jsonb_build_object('ok', false, 'error', 'bad_letter');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('updid/' || p_project || '/' || p_letter, 91));
  insert into row_id_seq(project_id, field_id, bucket, n)
  values (p_project, 'updates', p_letter, 1)
  on conflict (project_id, field_id, bucket) do update set n = row_id_seq.n + 1
  returning n into v_n;
  return jsonb_build_object('ok', true, 'id', p_letter || lpad(v_n::text, 2, '0'));
end; $$;
grant execute on function updates_next_id(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- d) Publish learns the role. `create or replace` cannot change an argument
--    list, so the previous six-argument signature is dropped explicitly
--    first (the migrations/0018_updates.sql precedent).
-- ----------------------------------------------------------------------------
drop function if exists update_publish(text, jsonb, timestamptz, text, text, text);
create or replace function update_publish(
  p_project text, p_payload jsonb, p_window_from timestamptz default null,
  p_prepared_by text default '', p_recipient_name text default '',
  p_recipient_email text default '', p_recipient_role text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_seq integer; v_token text; v_id uuid; v_ver uuid;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_payload');
  end if;
  if pg_column_size(p_payload) > 262144 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  if coalesce(p_recipient_role, '') not in ('', 'Client', 'Partner') then
    return jsonb_build_object('ok', false, 'error', 'bad_role');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('upd/' || p_project, 42));
  select coalesce(max(seq), 0) + 1 into v_seq from updates where project_id = p_project;
  -- The baseline this update reported on, taken from the record rather than
  -- from the payload the composer assembled, so the link's signature panel and
  -- the printed footer can never point at two different versions.
  select id into v_ver from versions where project_id = p_project order by seq desc limit 1;
  v_token := url_token();
  insert into updates(org_id, project_id, seq, token, window_from, prepared_by, payload,
                      version_id, recipient_name, recipient_email, recipient_role)
  values (v_org, p_project, v_seq, v_token, p_window_from,
          left(coalesce(trim(p_prepared_by), ''), 120), p_payload, v_ver,
          left(coalesce(trim(p_recipient_name), ''), 120),
          left(coalesce(trim(p_recipient_email), ''), 200),
          coalesce(p_recipient_role, ''))
  returning id into v_id;
  perform log_activity(v_org, p_project, 'update.published', 'update', v_id::text,
    'Weekly update #' || v_seq || ' published', jsonb_build_object('seq', v_seq));
  return jsonb_build_object('ok', true, 'id', v_id, 'seq', v_seq, 'token', v_token);
end; $$;
grant execute on function update_publish(text, jsonb, timestamptz, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- e) Recipient notes. One note document per update link, keyed by the update
--    row, written and read ONLY through the token RPCs below. No read
--    policy exists even for org members: the words on the dashboard promise
--    the notes are visible only on the recipient's link, and the schema is
--    where that promise is kept. They are scoped to a token, not encrypted
--    at rest; a database administrator can read them, and the page says so.
-- ----------------------------------------------------------------------------
create table if not exists update_notes (
  update_id uuid primary key references updates(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  body text not null default '',
  rev integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table update_notes enable row level security;
revoke all on update_notes from authenticated, anon;

-- Rev-checked save, the save_field discipline applied to the one field a
-- recipient owns. Identical content returns ok whatever the base rev, so a
-- replayed submission can never duplicate or corrupt; a genuine conflict
-- returns the current body and rev for the client to resolve deliberately.
create or replace function update_note_save(p_token text, p_body text, p_base_rev integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u updates%rowtype; cur update_notes%rowtype;
begin
  select * into u from updates where token = p_token and revoked = false;
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_link'); end if;
  if coalesce(nullif(trim(u.recipient_name), ''), nullif(trim(u.recipient_email), '')) is null then
    return jsonb_build_object('ok', false, 'error', 'no_recipient');
  end if;
  if p_body is null or length(p_body) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('updnote/' || u.id::text, 17));
  select * into cur from update_notes where update_id = u.id;
  if cur.update_id is null then
    insert into update_notes(update_id, org_id, project_id, body)
    values (u.id, u.org_id, u.project_id, p_body);
    return jsonb_build_object('ok', true, 'rev', 1);
  end if;
  if cur.body = p_body then
    return jsonb_build_object('ok', true, 'rev', cur.rev);
  end if;
  update update_notes set body = p_body, rev = rev + 1, updated_at = now()
   where update_id = u.id and rev = coalesce(p_base_rev, 0);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'body', cur.body, 'rev', cur.rev);
  end if;
  return jsonb_build_object('ok', true, 'rev', coalesce(p_base_rev, 0) + 1);
end; $$;
grant execute on function update_note_save(text, text, integer) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- f) Threads. A question, comment, or request for information from the
--    recipient opens a real thread on comms. Attribution is the recipient
--    the token was issued to, never typed by the sender; a link issued to
--    nobody accepts no posts, because an unattributed post on an
--    accountability record is worse than none.
-- ----------------------------------------------------------------------------
create or replace function update_thread_create(p_token text, p_kind text, p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u updates%rowtype; v_name text; v_kind text; v_title text; v_n int; v_ref text;
        v_seq integer; v_id uuid; v_reply text; v_partner uuid; prior comms%rowtype;
begin
  select * into u from updates where token = p_token and revoked = false;
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_link'); end if;
  v_name := coalesce(nullif(trim(u.recipient_name), ''), nullif(trim(u.recipient_email), ''));
  if v_name is null then return jsonb_build_object('ok', false, 'error', 'no_recipient'); end if;
  if coalesce(trim(p_body), '') = '' or length(p_body) > 20000 or length(coalesce(p_title, '')) > 200 then
    return jsonb_build_object('ok', false, 'error', 'bad_body');
  end if;
  v_kind := case when p_kind in ('Question','Comment','Request for information') then p_kind else 'Question' end;

  -- Serialize per link: the dedupe read and the rate count below are then
  -- race-free, and a double-submitted form cannot open the thread twice.
  perform pg_advisory_xact_lock(hashtextextended('updthr/' || u.id::text, 23));

  -- A replayed or double-clicked submission returns the thread it already
  -- opened instead of opening a second one.
  select * into prior from comms
   where update_id = u.id and origin = 'update'
     and title = left(coalesce(nullif(trim(p_title), ''),
                   regexp_replace(split_part(btrim(p_body), E'\n', 1), '\s+', ' ', 'g')), 200)
     and body = p_body and created_at > now() - interval '2 minutes'
   order by created_at desc limit 1;
  if prior.id is not null then
    return jsonb_build_object('ok', true, 'id', prior.id, 'ref', prior.ref,
      'reply_token', prior.reply_token, 'deduped', true);
  end if;

  -- The anonymous-endpoint ceiling, per link.
  if (select count(*) from comms c
       where c.update_id = u.id and c.origin = 'update'
         and c.created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  v_title := left(coalesce(nullif(trim(p_title), ''),
    regexp_replace(split_part(btrim(p_body), E'\n', 1), '\s+', ' ', 'g')), 200);
  if v_title = '' then v_title := v_kind; end if;

  -- Shares the monotonic per-project note counter, so a reference is never
  -- reused across the external note paths.
  update projects set partner_note_seq = partner_note_seq + 1
    where id = u.project_id returning partner_note_seq into v_n;
  v_ref := 'UQ-' || v_n;

  select seq into v_seq from versions where id = u.version_id;

  -- When the link carries an email, the recipient resolves to a client
  -- contact row (find-or-create, deduplicated case-insensitively), so their
  -- threads follow them into the portal if they ever take a seat. A link
  -- with no email still posts under the recipient's name; there is simply
  -- no durable identity to key a contact row on.
  if coalesce(trim(u.recipient_email), '') <> '' then
    insert into partners(org_id, email, name)
    values (u.org_id, trim(u.recipient_email), v_name)
    on conflict (org_id, lower(email)) where coalesce(trim(email), '') <> ''
    do update set name = coalesce(nullif(partners.name, ''), excluded.name)
    returning id into v_partner;
  end if;

  v_reply := url_token();
  insert into comms(org_id, project_id, origin, update_id, partner_id, version_seq,
                    author_name, author_email, fb_type, title, body, reply_token)
  values (u.org_id, u.project_id, 'update', u.id, v_partner, v_seq,
          v_name, u.recipient_email, v_kind, v_title, p_body, v_reply)
  returning id into v_id;
  perform log_activity(u.org_id, u.project_id, 'comm.received', 'comm', v_id::text,
    v_ref || ' ' || lower(v_kind) || ' from ' || v_name ||
    case when u.recipient_role <> '' then ' (' || u.recipient_role || ')' else '' end ||
    ' on update no. ' || u.seq,
    jsonb_build_object('ref', v_ref, 'update_seq', u.seq, 'kind', v_kind));
  update comms set ref = v_ref where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref, 'reply_token', v_reply);
end; $$;
grant execute on function update_thread_create(text, text, text, text) to anon, authenticated;

-- A reply from the recipient onto one of their link's threads. The comm must
-- belong to THIS token's update: that check is the server-side scope, so no
-- token can post into another link's thread, or into any other conversation.
create or replace function update_thread_reply(p_token text, p_comm uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u updates%rowtype; c comms%rowtype; v_name text; v_id uuid; dup uuid;
begin
  select * into u from updates where token = p_token and revoked = false;
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_link'); end if;
  v_name := coalesce(nullif(trim(u.recipient_name), ''), nullif(trim(u.recipient_email), ''));
  if v_name is null then return jsonb_build_object('ok', false, 'error', 'no_recipient'); end if;
  select * into c from comms where id = p_comm and update_id = u.id and origin = 'update';
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_thread'); end if;
  if coalesce(trim(p_body), '') = '' or length(p_body) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'bad_body');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('updrep/' || c.id::text, 29));
  select m.id into dup from messages m
   where m.parent_kind = 'comm' and m.parent_id = c.id and m.author_kind = 'client'
     and m.body = p_body and m.created_at > now() - interval '2 minutes'
   order by m.created_at desc limit 1;
  if dup is not null then
    return jsonb_build_object('ok', true, 'id', dup, 'deduped', true);
  end if;
  if (select count(*) from messages m
       where m.parent_kind = 'comm' and m.parent_id = c.id
         and m.created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into messages(org_id, parent_kind, parent_id, author_kind, author_name, body)
  values (c.org_id, 'comm', c.id, 'client', v_name, p_body)
  returning id into v_id;
  update comms set updated_at = now(),
                   status = case when status = 'closed' then 'new' else status end
    where id = c.id;
  perform log_activity(u.org_id, u.project_id, 'comm.replied', 'comm', c.id::text,
    coalesce(c.ref, 'Thread') || ' reply from ' || v_name || ' on update no. ' || u.seq,
    jsonb_build_object('ref', c.ref, 'update_seq', u.seq));
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function update_thread_reply(text, uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- g) The context the token page loads, extended with the role, the note, and
--    the threads. Every prior boundary holds, including the v2.34.2 rule
--    that a sign token is released only to the addressed recipient, matched
--    on email. A revoked link still returns only the withdrawn marker, so
--    the note and the threads are dead on that path too.
-- ----------------------------------------------------------------------------
create or replace function update_context(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select case when u.revoked then
    jsonb_build_object('ok', true, 'revoked', true, 'project', p.name, 'seq', u.seq)
  else
    jsonb_build_object(
      'ok', true, 'revoked', false,
      'project', p.name, 'logo', p.brand_logo, 'brandLabel', p.brand_label,
      'seq', u.seq, 'preparedBy', u.prepared_by,
      'windowFrom', u.window_from, 'windowTo', u.window_to,
      'publishedAt', u.published_at, 'payload', u.payload,
      'recipient', jsonb_build_object('name', u.recipient_name, 'email', u.recipient_email,
                                      'role', u.recipient_role),
      -- The project id is already client-visible: every present-mode link the
      -- team shares carries it in the URL. The panel needs it to build those
      -- same links, and it exposes nothing a shared baseline has not already.
      'projectId', u.project_id,
      'baselineLabel', (select v.label from versions v where v.id = u.version_id),
      -- The recipient's own note, scoped to this token by construction.
      'note', (select jsonb_build_object('body', n.body, 'rev', n.rev)
               from update_notes n where n.update_id = u.id),
      -- The threads this link opened, each with its messages. Team replies
      -- appear here; that is the whole loop.
      'threads', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'ref', c.ref, 'kind', c.fb_type, 'title', c.title,
                 'body', c.body, 'status', c.status, 'at', c.created_at,
                 'messages', coalesce((
                   select jsonb_agg(jsonb_build_object('from', m.author_kind,
                            'name', m.author_name, 'body', m.body, 'at', m.created_at)
                          order by m.created_at)
                   from messages m where m.parent_kind = 'comm' and m.parent_id = c.id), '[]'::jsonb))
               order by c.created_at)
        from comms c where c.update_id = u.id and c.origin = 'update'), '[]'::jsonb),
      'signatures', coalesce((
        select jsonb_agg(jsonb_build_object(
                 -- SECURITY (v2.34.2). A sign token IS the signing credential:
                 -- sign_request_sign() takes the token and a typed name, is
                 -- granted to anon, and asks for nothing else. Returning every
                 -- signer's token here therefore turned a forwardable weekly
                 -- update into the power to forge every signature on the
                 -- baseline. The token is now released only to the person the
                 -- update was issued to, matched on email, so this panel grants
                 -- nobody anything they were not already sent directly. Every
                 -- other signer appears as status only, with no link.
                 'token', case
                    when coalesce(trim(u.recipient_email), '') <> ''
                     and lower(trim(u.recipient_email)) = lower(trim(r.signer_email))
                    then r.token else null end,
                 -- signer_email is deliberately NOT returned. The panel needs a
                 -- name and a role to be readable; it does not need to hand a
                 -- client contact the mailbox of everyone else who signed.
                 'name', r.signer_name,
                 'role', r.signer_role, 'status', r.status,
                 'sentAt', r.sent_at, 'signedAt', r.signed_at, 'signedName', r.signed_name)
                 order by r.sent_at)
        from sign_requests r
        where r.version_id = u.version_id and r.revoked = false), '[]'::jsonb),
      'baselines', coalesce((
        select jsonb_agg(b order by b.seq desc) from (
          select v.seq, v.label, v.status, v.created_at,
            (select s.token from shares s
              where s.project_id = v.project_id and s.kind = 'present'
                and s.version_seq = v.seq and s.revoked = false
              order by s.updated_at desc limit 1) as "presentToken",
            coalesce(
              (select r.doc_fingerprint from sign_requests r
                where r.version_id = v.id and coalesce(r.doc_fingerprint, '') <> ''
                order by r.sent_at desc limit 1),
              (select u2.payload #>> '{baseline,fp}' from updates u2
                where u2.version_id = v.id and u2.payload #>> '{baseline,fp}' is not null
                order by u2.seq desc limit 1),
              '') as fingerprint
          from versions v where v.project_id = u.project_id) b), '[]'::jsonb))
  end
  from updates u
  join projects p on p.id = u.project_id
  where u.token = p_token
  limit 1;
$$;
grant execute on function update_context(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- h) The thread is reachable at its reply token exactly like an SME
--    workspace thread. Two adjustments keep that path honest for the new
--    origin: the reply posts under the author kind the thread actually has
--    (a recipient is 'client', not 'sme'), and the brief payload is NOT
--    attached to an update thread, because publishing a brief to a link is
--    a separate disclosure decision the update link never made.
-- ----------------------------------------------------------------------------
create or replace function sme_thread(p_reply_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  -- A withdrawn update takes its threads' reply links with it: the recipient
  -- was handed this token BY the update page, so revoking the update revokes
  -- the whole grant. The thread itself survives on the record for the team.
  select case when c.id is null
              or (c.origin = 'update' and exists (
                    select 1 from updates ur where ur.id = c.update_id and ur.revoked))
         then jsonb_build_object('ok', false) else jsonb_build_object(
    'ok', true, 'title', c.title, 'body', c.body, 'status', c.status, 'at', c.created_at,
    'name', c.author_name, 'product', pr.name,
    'brief', case when c.origin = 'update' then null else
             (select s.payload || jsonb_build_object('logo', pr.brand_logo, 'brandLabel', pr.brand_label)
              from shares s where s.project_id = c.project_id and s.kind = 'brief' and s.revoked = false
              order by s.version_seq desc limit 1) end,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('from', m.author_kind, 'name', m.author_name,
                                          'body', m.body, 'at', m.created_at) order by m.created_at)
      from messages m where m.parent_kind = 'comm' and m.parent_id = c.id), '[]'::jsonb),
    -- The SME's own uploads on their durable thread, so they persist across visits.
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'size_bytes', a.size_bytes,
                                          'mime', a.mime, 'scan_status', a.scan_status, 'created_at', a.created_at) order by a.created_at)
      from attachments a where a.comm_id = c.id), '[]'::jsonb))
  end
  from (select 1) one
  left join comms c on c.reply_token = p_reply_token
  left join projects pr on pr.id = c.project_id;
$$;
grant execute on function sme_thread(text) to anon, authenticated;

create or replace function sme_reply(p_reply_token text, p_body text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c comms%rowtype;
begin
  select * into c from comms where reply_token = p_reply_token;
  if c.id is null or coalesce(trim(p_body), '') = '' or length(p_body) > 20000 then return false; end if;
  -- Same rule as the read: a withdrawn update's grant is withdrawn whole.
  if c.origin = 'update' and exists (
       select 1 from updates ur where ur.id = c.update_id and ur.revoked) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('smerep/' || c.id::text, 7));
  if (select count(*) from messages m
       where m.parent_kind = 'comm' and m.parent_id = c.id
         and m.created_at > now() - interval '1 hour') >= 30 then
    return false;
  end if;
  insert into messages(org_id, parent_kind, parent_id, author_kind, author_name, body)
  values (c.org_id, 'comm', c.id,
          case when c.origin = 'update' then 'client' else 'sme' end,
          coalesce(nullif(c.author_name, ''), 'Reviewer'), p_body);
  update comms set updated_at = now(), status = case when status = 'closed' then 'new' else status end
    where id = c.id;
  return true;
end; $$;
grant execute on function sme_reply(text, text) to anon, authenticated;

-- ============================================================================
-- 24) In-app help: org-scoped educational content, per-user state, minimal
--     analytics. Managers author in the Help Studio; members read published.
--     Idempotent: safe to run twice.
-- ============================================================================
create table if not exists help_topics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null default '',
  body_md text not null default '',
  routes text[] not null default '{*}',
  audience text not null default 'all' check (audience in ('all','manager','viewer')),
  sort_order int not null default 100,
  is_published boolean not null default false,
  created_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists help_steps (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references help_topics(id) on delete cascade,
  step_order int not null default 1,
  anchor_key text not null default '',
  title text not null default '',
  body_md text not null default ''
);
create table if not exists help_state (
  user_id uuid not null,
  topic_id uuid not null references help_topics(id) on delete cascade,
  seen boolean not null default false,
  dismissed boolean not null default false,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);
create table if not exists help_prefs (
  user_id uuid primary key,
  beacon_hidden boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists help_events (
  id bigint generated always as identity primary key,
  topic_id uuid not null references help_topics(id) on delete cascade,
  user_id uuid,
  event_type text not null check (event_type in ('view','complete')),
  occurred_at timestamptz not null default now()
);
create index if not exists help_topics_org on help_topics(org_id);
create index if not exists help_steps_topic on help_steps(topic_id, step_order);
create index if not exists help_events_topic on help_events(topic_id);

alter table help_topics enable row level security;
alter table help_steps enable row level security;
alter table help_state enable row level security;
alter table help_prefs enable row level security;
alter table help_events enable row level security;

drop policy if exists help_topics_read on help_topics;
create policy help_topics_read on help_topics for select to authenticated
  using (is_org_member(org_id) and (is_published or is_org_manager(org_id)));
drop policy if exists help_topics_write on help_topics;
create policy help_topics_write on help_topics for all to authenticated
  using (is_org_manager(org_id)) with check (is_org_manager(org_id));

drop policy if exists help_steps_read on help_steps;
create policy help_steps_read on help_steps for select to authenticated
  using (exists (select 1 from help_topics t where t.id = topic_id
    and is_org_member(t.org_id) and (t.is_published or is_org_manager(t.org_id))));
drop policy if exists help_steps_write on help_steps;
create policy help_steps_write on help_steps for all to authenticated
  using (exists (select 1 from help_topics t where t.id = topic_id and is_org_manager(t.org_id)))
  with check (exists (select 1 from help_topics t where t.id = topic_id and is_org_manager(t.org_id)));

drop policy if exists help_state_self on help_state;
create policy help_state_self on help_state for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists help_prefs_self on help_prefs;
create policy help_prefs_self on help_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Events: any member of the topic's org may record their own view/complete;
-- reading raw events is manager-only (the stats RPC is the normal read path).
drop policy if exists help_events_insert on help_events;
create policy help_events_insert on help_events for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from help_topics t
    where t.id = topic_id and is_org_member(t.org_id)));
drop policy if exists help_events_read on help_events;
create policy help_events_read on help_events for select to authenticated
  using (exists (select 1 from help_topics t where t.id = topic_id and is_org_manager(t.org_id)));

create or replace function help_stats(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not is_org_manager(p_org) then jsonb_build_object('ok', false, 'error', 'forbidden')
  else jsonb_build_object('ok', true, 'topics', coalesce((
    select jsonb_agg(jsonb_build_object('topic_id', t.id, 'views', v.views, 'completes', v.completes) order by t.sort_order)
    from help_topics t
    left join lateral (
      select count(*) filter (where e.event_type = 'view') as views,
             count(*) filter (where e.event_type = 'complete') as completes
      from help_events e where e.topic_id = t.id) v on true
    where t.org_id = p_org), '[]'::jsonb)) end;
$$;
grant select, insert, update, delete on help_topics, help_steps, help_state, help_prefs to authenticated;
grant select, insert on help_events to authenticated;
grant execute on function help_stats(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 25) The activity chain (v2.47) - per-project hash chain over the activity
--     trail. Recipe frozen in docs/VERIFY.md section 8. Silent capture.
-- ----------------------------------------------------------------------------
create table if not exists chain_events (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  activity_id bigint not null unique references activity(id),
  seq bigint not null,
  entry_hash text not null,
  prev_hash text not null,
  link_hash text not null,
  created_at timestamptz not null default now(),
  unique (project_id, seq)
);
create index if not exists chain_events_proj on chain_events(project_id, seq desc);

alter table chain_events enable row level security;
drop policy if exists chain_events_select on chain_events;
create policy chain_events_select on chain_events
  for select using (is_project_member(project_id));
revoke insert, update, delete on chain_events from authenticated, anon;
grant select on chain_events to authenticated;

-- Append-only guard: even the table owner cannot rewrite history.
create or replace function chain_events_guard()
returns trigger language plpgsql as $$
begin
  raise exception 'chain_events is append-only';
end; $$;
drop trigger if exists chain_events_no_rewrite on chain_events;
create trigger chain_events_no_rewrite
  before update or delete on chain_events
  for each row execute function chain_events_guard();

-- The frozen entry-hash recipe. One place, used by writer and verifier.
create or replace function chain_entry_hash(a activity)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(digest(convert_to(
    a.id::text || chr(31) ||
    a.org_id::text || chr(31) ||
    coalesce(a.project_id, '') || chr(31) ||
    coalesce(a.actor::text, '') || chr(31) ||
    a.actor_name || chr(31) ||
    a.action || chr(31) ||
    a.entity_kind || chr(31) ||
    a.entity_id || chr(31) ||
    a.summary || chr(31) ||
    a.meta::text || chr(31) ||
    to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  , 'UTF8'), 'sha256'), 'hex');
$$;

-- Internal appender: caller must hold the per-project advisory lock.
create or replace function chain_append_row(a activity)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_head record; v_prev text; v_seq bigint; v_entry text;
begin
  if a.project_id is null then return; end if;
  if exists (select 1 from chain_events where activity_id = a.id) then return; end if;
  select seq, link_hash into v_head
    from chain_events where project_id = a.project_id
    order by seq desc limit 1;
  if v_head is null then
    v_seq := 0;
    v_prev := encode(digest(convert_to('REQPUB-GENESIS:' || a.project_id, 'UTF8'), 'sha256'), 'hex');
  else
    v_seq := v_head.seq + 1;
    v_prev := v_head.link_hash;
  end if;
  v_entry := chain_entry_hash(a);
  insert into chain_events(project_id, activity_id, seq, entry_hash, prev_hash, link_hash)
  values (a.project_id, a.id, v_seq, v_entry, v_prev,
          encode(digest(convert_to(v_prev || v_entry, 'UTF8'), 'sha256'), 'hex'));
end; $$;

-- Ensures the chain for a project starts with an honest genesis marker.
create or replace function chain_ensure_genesis(p_project text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; v_gen activity;
begin
  if exists (select 1 from chain_events where project_id = p_project and seq = 0) then return; end if;
  select org_id into v_org from projects where id = p_project;
  if v_org is null then return; end if;
  insert into activity(org_id, project_id, actor, actor_name, action, entity_kind, entity_id, summary, meta)
  values (v_org, p_project, null, 'system', 'chain.genesis', 'chain', p_project,
          'The chain begins at this event. Earlier activity rows are enumerated after it by the backfill, in insertion order. Baseline integrity before this point rests on the per-version fingerprints.',
          '{}'::jsonb)
  returning * into v_gen;
  perform chain_append_row(v_gen);
end; $$;

-- The writer: AFTER INSERT on activity, wrapped so a chain failure can never
-- fail the business write. Depth guard: rows this machinery itself inserts
-- (the genesis marker) are chained explicitly, not recursively.
create or replace function chain_link_activity()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.project_id is null then return null; end if;
  if pg_trigger_depth() > 1 then return null; end if;
  begin
    perform pg_advisory_xact_lock(hashtext(new.project_id));
    perform chain_ensure_genesis(new.project_id);
    perform chain_append_row(new);
  exception when others then
    raise warning 'chain link failed for activity %: %', new.id, sqlerrm;
  end;
  return null;
end; $$;
drop trigger if exists activity_chain_link on activity;
create trigger activity_chain_link
  after insert on activity
  for each row execute function chain_link_activity();

-- Repair: walks unchained project activity in insertion order and appends it.
-- Manager-gated. Recovers any warning-swallowed miss, provably.
create or replace function chain_repair(p_project text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_row activity; v_n int := 0;
begin
  if not is_project_manager(p_project) then raise exception 'managers only'; end if;
  perform pg_advisory_xact_lock(hashtext(p_project));
  perform chain_ensure_genesis(p_project);
  for v_row in
    select a.* from activity a
    left join chain_events c on c.activity_id = a.id
    where a.project_id = p_project and c.id is null
    order by a.id
  loop
    perform chain_append_row(v_row);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('repaired', v_n);
end; $$;
grant execute on function chain_repair(text) to authenticated;

-- Verification: recomputes every link from the joined activity rows.
create or replace function verify_project_chain(p_project text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_prev text; v_c record; v_a activity; v_entry text; v_link text;
        v_head_seq bigint := -1; v_head_hash text := ''; v_unchained int;
begin
  if not is_project_member(p_project) then raise exception 'not a member'; end if;
  v_prev := encode(digest(convert_to('REQPUB-GENESIS:' || p_project, 'UTF8'), 'sha256'), 'hex');
  for v_c in
    select seq, entry_hash, prev_hash, link_hash, activity_id
    from chain_events where project_id = p_project order by seq
  loop
    select * into v_a from activity where id = v_c.activity_id;
    v_entry := chain_entry_hash(v_a);
    v_link := encode(digest(convert_to(v_prev || v_entry, 'UTF8'), 'sha256'), 'hex');
    if v_entry <> v_c.entry_hash or v_c.prev_hash <> v_prev or v_link <> v_c.link_hash then
      return jsonb_build_object('ok', false, 'divergence_seq', v_c.seq);
    end if;
    v_prev := v_link; v_head_seq := v_c.seq; v_head_hash := v_link;
  end loop;
  select count(*) into v_unchained from activity a
    left join chain_events c on c.activity_id = a.id
    where a.project_id = p_project and c.id is null;
  return jsonb_build_object('ok', true, 'head_seq', v_head_seq,
    'head_hash', v_head_hash, 'unchained', v_unchained);
end; $$;
grant execute on function verify_project_chain(text) to authenticated;


-- ----------------------------------------------------------------------------
-- 26) Cryptographic sealing (v2.48) - acceptance receipts, Ed25519 plus dual
--     RFC 3161. Writes are RPC-only. docs/VERIFY.md section 9 is the spec.
-- ----------------------------------------------------------------------------
create table if not exists receipt_keys (
  kid text primary key,
  alg text not null default 'Ed25519',
  public_key_spki_base64 text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
alter table receipt_keys enable row level security;
drop policy if exists receipt_keys_select on receipt_keys;
create policy receipt_keys_select on receipt_keys for select using (true);
revoke insert, update, delete on receipt_keys from authenticated, anon;
grant select on receipt_keys to authenticated, anon;

create table if not exists acceptance_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  sign_request_id uuid not null unique references sign_requests(id) on delete cascade,
  receipt_json jsonb not null,
  canonical_hash text not null,
  signature_base64 text not null,
  key_id text not null,
  tsa_primary_der text,
  tsa_secondary_der text,
  tsa_status text not null default 'pending'
    check (tsa_status in ('pending','single','dual')),
  sealed_at timestamptz not null default now()
);
create index if not exists acceptance_receipts_proj on acceptance_receipts(project_id);
alter table acceptance_receipts enable row level security;
drop policy if exists acceptance_receipts_select on acceptance_receipts;
create policy acceptance_receipts_select on acceptance_receipts
  for select using (is_project_member(project_id));
revoke insert, update, delete on acceptance_receipts from authenticated, anon;
grant select on acceptance_receipts to authenticated;

-- Store a sealed receipt. Insert-once per sign request; the caller proves
-- authority by the sign token or by project membership. Validates the sign
-- request is signed and not revoked. Never returns tokens or emails.
create or replace function receipt_store(
  p_sign_request uuid, p_token text, p_receipt jsonb,
  p_hash text, p_sig text, p_kid text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r sign_requests; existing acceptance_receipts; created acceptance_receipts;
begin
  select * into r from sign_requests where id = p_sign_request;
  if r.id is null then raise exception 'no such sign request'; end if;
  if r.revoked then raise exception 'revoked'; end if;
  if r.status <> 'signed' then raise exception 'not signed'; end if;
  if not (r.token = coalesce(p_token,'') or is_project_member(r.project_id)) then
    raise exception 'not allowed';
  end if;
  select * into existing from acceptance_receipts where sign_request_id = p_sign_request;
  if existing.id is not null then
    return jsonb_build_object('id', existing.id, 'existing', true,
      'canonical_hash', existing.canonical_hash, 'tsa_status', existing.tsa_status);
  end if;
  insert into acceptance_receipts(org_id, project_id, sign_request_id,
    receipt_json, canonical_hash, signature_base64, key_id)
  values (r.org_id, r.project_id, p_sign_request, p_receipt, p_hash, p_sig, p_kid)
  returning * into created;
  perform log_activity(r.org_id, r.project_id, 'seal.issued', 'receipt',
    created.id::text, 'Acceptance receipt sealed for v' ||
    coalesce((select label from versions where id = r.version_id), '?'), '{}'::jsonb);
  return jsonb_build_object('id', created.id, 'existing', false,
    'canonical_hash', created.canonical_hash, 'tsa_status', created.tsa_status);
end; $$;
grant execute on function receipt_store(uuid, text, jsonb, text, text, text) to anon, authenticated;

-- Upgrade timestamp columns only. Same authority rule. Never downgrades.
create or replace function receipt_tsa_update(
  p_receipt uuid, p_token text, p_primary text, p_secondary text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec acceptance_receipts; r sign_requests; v_status text;
begin
  select * into rec from acceptance_receipts where id = p_receipt;
  if rec.id is null then raise exception 'no such receipt'; end if;
  select * into r from sign_requests where id = rec.sign_request_id;
  if not (r.token = coalesce(p_token,'') or is_project_member(rec.project_id)) then
    raise exception 'not allowed';
  end if;
  v_status := case
    when coalesce(p_primary, rec.tsa_primary_der) is not null
     and coalesce(p_secondary, rec.tsa_secondary_der) is not null then 'dual'
    when coalesce(p_primary, rec.tsa_primary_der) is not null
      or coalesce(p_secondary, rec.tsa_secondary_der) is not null then 'single'
    else 'pending' end;
  update acceptance_receipts set
    tsa_primary_der = coalesce(p_primary, tsa_primary_der),
    tsa_secondary_der = coalesce(p_secondary, tsa_secondary_der),
    tsa_status = v_status
  where id = p_receipt;
  if v_status <> rec.tsa_status then
    perform log_activity(rec.org_id, rec.project_id, 'seal.timestamped', 'receipt',
      rec.id::text, 'Receipt timestamps: ' || v_status, '{}'::jsonb);
  end if;
  return jsonb_build_object('id', p_receipt, 'tsa_status', v_status);
end; $$;
grant execute on function receipt_tsa_update(uuid, text, text, text) to anon, authenticated;

-- Context for sealing by sign-request id (member path). Mirrors
-- sign_request_context without the token; email never leaves.
create or replace function seal_context(p_sign_request uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true, 'status', r.status, 'revoked', r.revoked,
    'signRequestId', r.id,
    'signer', jsonb_build_object('name', r.signer_name, 'role', r.signer_role,
      'emailDomain', split_part(r.signer_email, '@', 2)),
    'signedName', r.signed_name, 'signedAt', r.signed_at,
    'fingerprint', r.doc_fingerprint, 'evidence', r.evidence,
    'project', p.name, 'projectId', p.id, 'practice', p.practice,
    'label', v.label, 'seq', v.seq, 'snapshot', v.snapshot)
  from sign_requests r
  join versions v on v.id = r.version_id
  join projects p on p.id = r.project_id
  where r.id = p_sign_request and auth.uid() is not null and is_project_member(r.project_id)
  limit 1;
$$;
revoke execute on function seal_context(uuid) from public, anon;
grant execute on function seal_context(uuid) to authenticated;

-- Reader for the signer archive page and the app. Token or membership.
create or replace function receipt_for(p_sign_request uuid, p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'receipt', a.receipt_json,
    'canonical_hash', a.canonical_hash, 'signature_base64', a.signature_base64,
    'key_id', a.key_id, 'tsa_status', a.tsa_status,
    'tsa_primary_der', a.tsa_primary_der, 'tsa_secondary_der', a.tsa_secondary_der,
    'sealed_at', a.sealed_at)
  from acceptance_receipts a join sign_requests r on r.id = a.sign_request_id
  where a.sign_request_id = p_sign_request
    and ((p_token <> '' and r.token = p_token)
      or (auth.uid() is not null and is_project_member(a.project_id)))
  limit 1;
$$;
grant execute on function receipt_for(uuid, text) to anon, authenticated;

-- List sealed receipts for a project, member-scoped, for the workflow panel.
-- Facts only: the sign request it seals, the hash, kid, tsa status, time.
create or replace function receipts_for_project(p_project text)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'sign_request_id', a.sign_request_id, 'id', a.id,
    'canonical_hash', a.canonical_hash, 'key_id', a.key_id,
    'tsa_status', a.tsa_status, 'sealed_at', a.sealed_at)), '[]'::jsonb)
  from acceptance_receipts a
  where a.project_id = p_project and auth.uid() is not null and is_project_member(p_project);
$$;
revoke all on function receipts_for_project(text) from public, anon;
revoke execute on function receipts_for_project(text) from public, anon;
grant execute on function receipts_for_project(text) to authenticated;

-- ============================================================================
-- 27) Attachment hashing (v2.49) - the digest column and its verify and
--     backfill surface. The upload function computes sha256 over the exact
--     bytes in the same pass that scans them and records it through
--     attachment_add. These definer functions serve the function's 'verify'
--     and 'backfill' modes: service-role only, caller identity passed in
--     explicitly after JWT verification, exactly like the upload resolvers.
--     Live databases get all of this from supabase/migrations/0022_attachment_hash.sql.
-- ============================================================================

-- Verification target: read scope matches the table's RLS, any org member.
create or replace function attachment_verify_target(p_id uuid, p_user uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select case
    when a.id is null then jsonb_build_object('ok', false, 'error', 'not_found')
    when not exists (select 1 from org_members m where m.org_id = a.org_id and m.user_id = p_user)
      then jsonb_build_object('ok', false, 'error', 'forbidden')
    when a.sha256_hex = '' then jsonb_build_object('ok', false, 'error', 'unhashed', 'file_name', a.file_name)
    else jsonb_build_object('ok', true, 'storage_path', a.storage_path,
           'sha256_hex', a.sha256_hex, 'file_name', a.file_name, 'project_id', a.project_id)
  end
  from (select 1) one left join attachments a on a.id = p_id;
$$;
revoke execute on function attachment_verify_target(uuid, uuid) from public;
do $$ begin
  execute 'grant execute on function attachment_verify_target(uuid, uuid) to service_role';
exception when undefined_object then null; end $$;

-- Backfill targets: manager-gated, one page oldest first, plus what remains.
create or replace function attachment_backfill_targets(p_project text, p_user uuid, p_limit int default 25)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_org uuid; v_total int; v_rows jsonb;
begin
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  if not exists (select 1 from org_members m where m.org_id = v_org and m.user_id = p_user and m.role = 'manager') then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select count(*)::int into v_total from attachments a where a.project_id = p_project and a.sha256_hex = '';
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'storage_path', t.storage_path) order by t.created_at), '[]'::jsonb)
    into v_rows
    from (select a.id, a.storage_path, a.created_at from attachments a
           where a.project_id = p_project and a.sha256_hex = ''
           order by a.created_at asc
           limit least(greatest(coalesce(p_limit, 25), 1), 100)) t;
  return jsonb_build_object('ok', true, 'rows', v_rows,
    'remaining', greatest(v_total - jsonb_array_length(v_rows), 0));
end; $$;
revoke execute on function attachment_backfill_targets(text, uuid, int) from public;
do $$ begin
  execute 'grant execute on function attachment_backfill_targets(text, uuid, int) to service_role';
exception when undefined_object then null; end $$;

-- Record one backfilled hash: idempotent, never overwrites, marks provenance.
create or replace function attachment_set_hash(p_id uuid, p_sha256 text, p_backfilled boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a attachments%rowtype;
begin
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_hash'); end if;
  select * into a from attachments where id = p_id for update;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if a.sha256_hex <> '' then
    return jsonb_build_object('ok', true, 'already', true); end if;
  update attachments
     set sha256_hex = p_sha256,
         scan_detail = case
           when p_backfilled and position('hashed-after-upload' in scan_detail) = 0
             then left(case when scan_detail = '' then 'hashed-after-upload'
                            else scan_detail || ' | hashed-after-upload' end, 500)
           else scan_detail end
   where id = p_id;
  return jsonb_build_object('ok', true, 'already', false);
end; $$;
revoke execute on function attachment_set_hash(uuid, text, boolean) from public;
do $$ begin
  execute 'grant execute on function attachment_set_hash(uuid, text, boolean) to service_role';
exception when undefined_object then null; end $$;

-- One audit line per backfill page, with the count.
create or replace function attachment_backfill_note(p_project text, p_user uuid, p_count int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_name text;
begin
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  if not exists (select 1 from org_members m where m.org_id = v_org and m.user_id = p_user and m.role = 'manager') then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(p_count, 0) <= 0 then return jsonb_build_object('ok', true, 'skipped', true); end if;
  v_name := coalesce((select display_name from user_profiles up where up.user_id = p_user), 'A manager');
  perform log_activity(v_org, p_project, 'attachment.hashed', 'attachment', p_project,
    v_name || ' hashed ' || p_count || ' existing file' || case when p_count = 1 then '' else 's' end,
    jsonb_build_object('count', p_count, 'mode', 'backfill'));
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function attachment_backfill_note(text, uuid, int) from public;
do $$ begin
  execute 'grant execute on function attachment_backfill_note(text, uuid, int) to service_role';
exception when undefined_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 28) Signed webhooks (v2.50) - endpoints and deliveries, RPC-managed,
--     platform Ed25519 signing under whk-1, lazy dispatch (U1 unconsumed),
--     retry ladder 1m 5m 30m 2h 12h then dead. Inert until an endpoint
--     exists. Contract in docs/WEBHOOKS.md.
-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- Tables. Direct DML revoked; every write goes through a definer RPC below.
-- ----------------------------------------------------------------------------
create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  url text not null,                             -- https only, enforced at create and again at delivery
  description text not null default '',
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists whe_proj on webhook_endpoints(project_id) where active;

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  attempt int not null default 0,
  status_code int,
  response_snippet text not null default '',
  state text not null default 'pending'
    check (state in ('pending','delivered','failed','dead')),
  next_retry_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists whd_ep on webhook_deliveries(endpoint_id, created_at desc);
create index if not exists whd_due on webhook_deliveries(state, next_retry_at) where state in ('pending','failed');

alter table webhook_endpoints enable row level security;
alter table webhook_deliveries enable row level security;
drop policy if exists whe_select on webhook_endpoints;
create policy whe_select on webhook_endpoints
  for select using (is_project_manager(project_id));
drop policy if exists whd_select on webhook_deliveries;
create policy whd_select on webhook_deliveries
  for select using (exists (
    select 1 from webhook_endpoints e
     where e.id = endpoint_id and is_project_manager(e.project_id)));
revoke insert, update, delete on webhook_endpoints from authenticated, anon;
revoke insert, update, delete on webhook_deliveries from authenticated, anon;
grant select on webhook_endpoints to authenticated;
grant select on webhook_deliveries to authenticated;

-- ----------------------------------------------------------------------------
-- Enqueue. Builds the payload contract and one pending row per active
-- endpoint. Called only from the triggers below; no grant.
-- Payload: event, deliveryId, occurredAt, projectId, versionLabel, seq,
-- signRequestId, receiptId where applicable, docFingerprint, chainHead
-- {seq, linkHash}, signerName, signerRole. Never a token, never an email,
-- never snapshot content.
-- ----------------------------------------------------------------------------
create or replace function webhook_enqueue(p_event text, p_sr sign_requests, p_receipt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ver versions%rowtype; v_head record; v_base jsonb; v_ep record; v_id uuid;
begin
  if coalesce((select practice from projects where id = p_sr.project_id), false) then
    return;  -- practice records are non-evidence by construction; nothing announces them
  end if;
  select * into v_ver from versions where id = p_sr.version_id;
  select seq, link_hash into v_head
    from chain_events where project_id = p_sr.project_id
    order by seq desc limit 1;
  v_base := jsonb_build_object(
    'event', p_event,
    'occurredAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'projectId', p_sr.project_id,
    'versionLabel', coalesce(v_ver.label, ''),
    'seq', v_ver.seq,
    'signRequestId', p_sr.id::text,
    'docFingerprint', coalesce(p_sr.doc_fingerprint, ''),
    'chainHead', case when v_head is null then null
                 else jsonb_build_object('seq', v_head.seq, 'linkHash', v_head.link_hash) end,
    'signerName', coalesce(p_sr.signed_name, ''),
    'signerRole', coalesce(p_sr.signer_role, ''));
  if p_receipt is not null then
    v_base := v_base || jsonb_build_object('receiptId', p_receipt::text);
  end if;
  for v_ep in select id from webhook_endpoints
      where project_id = p_sr.project_id and active loop
    v_id := gen_random_uuid();
    insert into webhook_deliveries(id, endpoint_id, event_type, payload)
    values (v_id, v_ep.id, p_event, v_base || jsonb_build_object('deliveryId', v_id::text));
  end loop;
end; $$;
revoke execute on function webhook_enqueue(text, sign_requests, uuid) from public;

-- ----------------------------------------------------------------------------
-- Triggers. Wrapped non-blocking like every other trigger side effect: a
-- webhook problem must never break a signature or a seal.
-- ----------------------------------------------------------------------------
create or replace function webhook_on_sign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform webhook_enqueue(
      case new.status when 'signed' then 'sign.signed' else 'sign.declined' end,
      new, null);
  exception when others then null;  -- enqueue must never block the signature
  end;
  return new;
end; $$;
drop trigger if exists trg_webhook_sign on sign_requests;
create trigger trg_webhook_sign
  after update on sign_requests
  for each row
  when (old.status = 'pending' and new.status in ('signed','declined'))
  execute function webhook_on_sign();

create or replace function webhook_on_seal()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sr sign_requests%rowtype; v_event text;
begin
  begin
    select * into v_sr from sign_requests where id = new.sign_request_id;
    if v_sr.id is not null then
      if tg_op = 'INSERT' then v_event := 'seal.issued'; else v_event := 'seal.timestamped'; end if;
      perform webhook_enqueue(v_event, v_sr, new.id);
    end if;
  exception when others then null;  -- enqueue must never block the seal
  end;
  return new;
end; $$;
drop trigger if exists trg_webhook_seal_issued on acceptance_receipts;
create trigger trg_webhook_seal_issued
  after insert on acceptance_receipts
  for each row execute function webhook_on_seal();
drop trigger if exists trg_webhook_seal_timestamped on acceptance_receipts;
create trigger trg_webhook_seal_timestamped
  after update on acceptance_receipts
  for each row
  when (old.tsa_status = 'pending' and new.tsa_status in ('single','dual'))
  execute function webhook_on_seal();

-- ----------------------------------------------------------------------------
-- Manager RPCs: create, toggle, list, redeliver, due. Every config change is
-- written via log_activity('webhook.endpoint_changed') and therefore chained.
-- ----------------------------------------------------------------------------
create or replace function webhook_host(p_url text)
returns text language sql immutable as $$
  select coalesce(substring(p_url from '^https://([^/?#]+)'), '');
$$;
revoke execute on function webhook_host(text) from public;
grant execute on function webhook_host(text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function webhook_host(text) to service_role';
  end if;
end $$;

create or replace function endpoint_create(p_project text, p_url text, p_description text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_host text;
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  if p_url !~ '^https://[^[:space:]]+$' or length(p_url) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'https_required'); end if;
  v_host := webhook_host(p_url);
  if v_host = '' then return jsonb_build_object('ok', false, 'error', 'https_required'); end if;
  insert into webhook_endpoints(org_id, project_id, url, description, created_by)
  values (v_org, p_project, p_url, left(coalesce(p_description, ''), 300), auth.uid())
  returning id into v_id;
  perform log_activity(v_org, p_project, 'webhook.endpoint_changed', 'webhook',
    v_id::text, 'Webhook endpoint added: ' || v_host,
    jsonb_build_object('host', v_host, 'change', 'added'));
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function endpoint_create(text, text, text) from public;
grant execute on function endpoint_create(text, text, text) to authenticated;

create or replace function endpoint_set_active(p_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e webhook_endpoints%rowtype;
begin
  select * into e from webhook_endpoints where id = p_id;
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_project_manager(e.project_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if e.active = p_active then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  update webhook_endpoints set active = p_active where id = p_id;
  perform log_activity(e.org_id, e.project_id, 'webhook.endpoint_changed', 'webhook',
    e.id::text,
    'Webhook endpoint ' || case when p_active then 'activated' else 'deactivated' end
      || ': ' || webhook_host(e.url),
    jsonb_build_object('host', webhook_host(e.url),
      'change', case when p_active then 'activated' else 'deactivated' end));
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function endpoint_set_active(uuid, boolean) from public;
grant execute on function endpoint_set_active(uuid, boolean) to authenticated;

create or replace function deliveries_list(p_project text, p_limit int default 50)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'endpoint_id', x.endpoint_id, 'url', x.url,
      'event_type', x.event_type, 'state', x.state, 'attempt', x.attempt,
      'status_code', x.status_code, 'response_snippet', x.response_snippet,
      'next_retry_at', x.next_retry_at, 'created_at', x.created_at)
      order by x.created_at desc)
    from (select dd.id, dd.endpoint_id, ee.url, dd.event_type, dd.state,
                 dd.attempt, dd.status_code, dd.response_snippet,
                 dd.next_retry_at, dd.created_at
            from webhook_deliveries dd
            join webhook_endpoints ee on ee.id = dd.endpoint_id
           where ee.project_id = p_project
           order by dd.created_at desc
           limit greatest(1, least(coalesce(p_limit, 50), 200))) x), '[]'::jsonb));
end; $$;
revoke execute on function deliveries_list(text, int) from public;
grant execute on function deliveries_list(text, int) to authenticated;

create or replace function delivery_redeliver(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d webhook_deliveries%rowtype; v_proj text;
begin
  select dd.* into d from webhook_deliveries dd where dd.id = p_id;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select project_id into v_proj from webhook_endpoints where id = d.endpoint_id;
  if not is_project_manager(v_proj) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if d.state not in ('failed', 'dead') then
    return jsonb_build_object('ok', false, 'error', 'not_redeliverable'); end if;
  update webhook_deliveries set state = 'pending', next_retry_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end; $$;
revoke execute on function delivery_redeliver(uuid) from public;
grant execute on function delivery_redeliver(uuid) to authenticated;

create or replace function deliveries_due(p_project text, p_limit int default 20)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'ids', coalesce((
    select jsonb_agg(d.id order by d.created_at)
    from (select dd.id, dd.created_at
            from webhook_deliveries dd
            join webhook_endpoints ee on ee.id = dd.endpoint_id
           where ee.project_id = p_project and ee.active
             and dd.state in ('pending', 'failed')
             and coalesce(dd.next_retry_at, now()) <= now()
           order by dd.created_at
           limit greatest(1, least(coalesce(p_limit, 20), 50))) d), '[]'::jsonb));
end; $$;
revoke execute on function deliveries_due(text, int) from public;
grant execute on function deliveries_due(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Delivery engine RPCs, service role only: deliver-webhooks takes one due
-- delivery, attempts it, and records the result. The ladder lives here so
-- every writer walks the same schedule.
-- ----------------------------------------------------------------------------
create or replace function webhook_delivery_take(p_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare d webhook_deliveries%rowtype; e webhook_endpoints%rowtype;
begin
  select * into d from webhook_deliveries where id = p_id;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into e from webhook_endpoints where id = d.endpoint_id;
  if not e.active then return jsonb_build_object('ok', false, 'error', 'endpoint_inactive'); end if;
  if d.state not in ('pending', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'not_due', 'state', d.state); end if;
  if d.next_retry_at is not null and d.next_retry_at > now() then
    return jsonb_build_object('ok', false, 'error', 'not_due', 'state', d.state); end if;
  return jsonb_build_object('ok', true, 'url', e.url, 'event_type', d.event_type,
    'attempt', d.attempt, 'payload', d.payload);
end; $$;
revoke execute on function webhook_delivery_take(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function webhook_delivery_take(uuid) to service_role';
  end if;
end $$;

create or replace function webhook_delivery_result(p_id uuid, p_ok boolean, p_status int, p_snippet text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d webhook_deliveries%rowtype; v_attempt int; v_state text; v_next timestamptz;
        v_ladder int[] := array[60, 300, 1800, 7200, 43200];  -- 1m 5m 30m 2h 12h
begin
  select * into d from webhook_deliveries where id = p_id for update;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if d.state in ('delivered', 'dead') then
    return jsonb_build_object('ok', true, 'state', d.state, 'unchanged', true); end if;
  v_attempt := d.attempt + 1;
  if p_ok then
    v_state := 'delivered'; v_next := null;
  elsif v_attempt >= 6 then
    v_state := 'dead'; v_next := null;
  else
    v_state := 'failed'; v_next := now() + make_interval(secs => v_ladder[v_attempt]);
  end if;
  update webhook_deliveries
     set attempt = v_attempt, state = v_state, next_retry_at = v_next,
         status_code = p_status, response_snippet = left(coalesce(p_snippet, ''), 200)
   where id = p_id;
  return jsonb_build_object('ok', true, 'state', v_state, 'attempt', v_attempt,
    'next_retry_at', v_next);
end; $$;
revoke execute on function webhook_delivery_result(uuid, boolean, int, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function webhook_delivery_result(uuid, boolean, int, text) to service_role';
  end if;
end $$;

-- ----------------------------------------------------------------------------

-- ============================================================================
-- 29) The MCP server (v2.51): a read surface for the record and a door into
--     the inbox, never a hand on the pen. Keys hashed at rest, the audit
--     log insert-only, the one write doubly gated. Inert until a key
--     exists. supabase/migrations/0024_mcp.sql applies this to a live database and
--     also extends comms.origin with 'agent' by drop and re-add.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables. Direct DML revoked; every write goes through a definer RPC.
-- ----------------------------------------------------------------------------
create table if not exists mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key_hash text not null unique,             -- sha256 hex of the full presented key
  label text not null,
  project_ids text[],                        -- null means every project the org grants
  propose_enabled boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists mak_org on mcp_api_keys(org_id, created_at desc);

create table if not exists mcp_audit_log (
  id bigint generated always as identity primary key,
  key_id uuid not null references mcp_api_keys(id) on delete cascade,
  tool text not null,
  params_hash text not null default '',
  status text not null,                      -- ok | denied | error | rate_limited
  at timestamptz not null default now()
);
create index if not exists mal_key_at on mcp_audit_log(key_id, at desc);

alter table mcp_api_keys enable row level security;
alter table mcp_audit_log enable row level security;
drop policy if exists mak_select on mcp_api_keys;
create policy mak_select on mcp_api_keys
  for select using (is_org_manager(org_id));
drop policy if exists mal_select on mcp_audit_log;
create policy mal_select on mcp_audit_log
  for select using (exists (
    select 1 from mcp_api_keys k where k.id = key_id and is_org_manager(k.org_id)));
revoke insert, update, delete on mcp_api_keys from authenticated, anon;
revoke insert, update, delete on mcp_audit_log from authenticated, anon;
grant select on mcp_api_keys to authenticated;
grant select on mcp_audit_log to authenticated;

-- Append-only guard: the audit trail cannot be rewritten, even by the owner.
create or replace function mcp_audit_guard()
returns trigger language plpgsql as $$
begin
  raise exception 'mcp_audit_log is append-only';
end; $$;
drop trigger if exists mcp_audit_no_rewrite on mcp_audit_log;
create trigger mcp_audit_no_rewrite
  before update or delete on mcp_audit_log
  for each row execute function mcp_audit_guard();

-- ----------------------------------------------------------------------------
-- Manager RPCs: issue, revoke, list. The key material exists only in the
-- issue response; the audit line carries the label, never the key.
-- ----------------------------------------------------------------------------
create or replace function mcp_key_issue(p_org uuid, p_label text, p_propose boolean default false, p_project_ids text[] default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        v_secret text := ''; v_byte int; v_key text; v_id uuid; v_bad int;
begin
  if not is_org_manager(p_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(trim(p_label), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'label_required'); end if;
  if p_project_ids is not null then
    select count(*) into v_bad from unnest(p_project_ids) s(pid)
     where not exists (select 1 from projects p where p.id = s.pid and p.org_id = p_org);
    if v_bad > 0 then return jsonb_build_object('ok', false, 'error', 'unknown_project_in_scope'); end if;
  end if;
  -- 32 base62 characters, rejection-sampled so no character is favored.
  while length(v_secret) < 32 loop
    v_byte := get_byte(gen_random_bytes(1), 0);
    if v_byte < 248 then
      v_secret := v_secret || substr(v_alphabet, 1 + (v_byte % 62), 1);
    end if;
  end loop;
  v_key := 'rqp_live_' || v_secret;
  insert into mcp_api_keys(org_id, key_hash, label, project_ids, propose_enabled, created_by)
  values (p_org, encode(digest(v_key, 'sha256'), 'hex'), left(trim(p_label), 120),
          p_project_ids, coalesce(p_propose, false), auth.uid())
  returning id into v_id;
  perform log_activity(p_org, null, 'mcp.key_issued', 'mcp_key', v_id::text,
    'MCP key issued: ' || left(trim(p_label), 120),
    jsonb_build_object('label', left(trim(p_label), 120),
      'propose', coalesce(p_propose, false),
      'scope', case when p_project_ids is null then 'all' else cardinality(p_project_ids)::text end));
  return jsonb_build_object('ok', true, 'id', v_id, 'key', v_key);
end; $$;
revoke execute on function mcp_key_issue(uuid, text, boolean, text[]) from public;
grant execute on function mcp_key_issue(uuid, text, boolean, text[]) to authenticated;

create or replace function mcp_key_revoke(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k mcp_api_keys%rowtype;
begin
  select * into k from mcp_api_keys where id = p_id;
  if k.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_org_manager(k.org_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if k.revoked_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  update mcp_api_keys set revoked_at = now() where id = p_id;
  perform log_activity(k.org_id, null, 'mcp.key_revoked', 'mcp_key', k.id::text,
    'MCP key revoked: ' || k.label, jsonb_build_object('label', k.label));
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function mcp_key_revoke(uuid) from public;
grant execute on function mcp_key_revoke(uuid) to authenticated;

create or replace function mcp_keys_list(p_org uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not is_org_manager(p_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k.id, 'label', k.label,
      'scope', case when k.project_ids is null then 'all' else cardinality(k.project_ids)::text end,
      'propose_enabled', k.propose_enabled, 'created_at', k.created_at,
      'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at)
      order by k.created_at desc)
    from mcp_api_keys k where k.org_id = p_org), '[]'::jsonb));
end; $$;
revoke execute on function mcp_keys_list(uuid) from public;
grant execute on function mcp_keys_list(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Service-role RPCs: the mcp function's whole database surface. Reads only,
-- plus one gated comm insert. Scope is enforced here, on every call, so the
-- function cannot forget it.
-- ----------------------------------------------------------------------------
create or replace function mcp_auth(p_key_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k mcp_api_keys%rowtype;
begin
  select * into k from mcp_api_keys where key_hash = p_key_hash;
  if k.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_key'); end if;
  if k.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  update mcp_api_keys set last_used_at = now() where id = k.id;
  return jsonb_build_object('ok', true, 'keyId', k.id, 'orgId', k.org_id,
    'label', k.label, 'projectIds', to_jsonb(k.project_ids),
    'proposeEnabled', k.propose_enabled);
end; $$;
revoke execute on function mcp_auth(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_auth(text) to service_role';
  end if;
end $$;

-- Admission and rate limit in one atomic step, in the house throttle
-- pattern: a per-key advisory lock serializes count-then-insert, so
-- parallel calls cannot each read a below-limit count and all slip through.
-- Every admitted call appends status ok; every refusal appends
-- rate_limited; later denials and errors append their own row. The window
-- counts every row, so refusals and errors consume budget too, which is
-- stated in docs/MCP.md.
create or replace function mcp_gate(p_key uuid, p_tool text, p_params_hash text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('mcp/' || p_key::text, 7));
  if (select count(*) from mcp_audit_log a
       where a.key_id = p_key and a.at > now() - interval '1 minute') >= 60 then
    insert into mcp_audit_log(key_id, tool, params_hash, status)
    values (p_key, left(coalesce(p_tool, ''), 80), left(coalesce(p_params_hash, ''), 64), 'rate_limited');
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into mcp_audit_log(key_id, tool, params_hash, status)
  values (p_key, left(coalesce(p_tool, ''), 80), left(coalesce(p_params_hash, ''), 64), 'ok');
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function mcp_gate(uuid, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_gate(uuid, text, text) to service_role';
  end if;
end $$;

create or replace function mcp_audit_append(p_key uuid, p_tool text, p_params_hash text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into mcp_audit_log(key_id, tool, params_hash, status)
  values (p_key, left(coalesce(p_tool, ''), 80), left(coalesce(p_params_hash, ''), 64),
          left(coalesce(p_status, 'error'), 40));
end; $$;
revoke execute on function mcp_audit_append(uuid, text, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_audit_append(uuid, text, text, text) to service_role';
  end if;
end $$;

-- Scope helper: a project is visible to a key when it belongs to the key's
-- org and, when the key is scoped, appears in the scope list.
create or replace function mcp_in_scope(p_org uuid, p_scope text[], p_project text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
     where p.id = p_project and p.org_id = p_org
       and (p_scope is null or p.id = any(p_scope)));
$$;
revoke execute on function mcp_in_scope(uuid, text[], text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_in_scope(uuid, text[], text) to service_role';
  end if;
end $$;

create or replace function mcp_list_projects(p_org uuid, p_scope text[])
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'projects', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'createdAt', p.created_at,
      'latestBaselineLabel', v.label, 'latestBaselineStatus', v.status,
      'practice', coalesce((to_jsonb(p) ->> 'practice')::boolean, false))
      order by p.created_at)
    from projects p
    left join lateral (
      select label, status from versions vv
       where vv.project_id = p.id order by vv.seq desc limit 1) v on true
    where p.org_id = p_org
      and coalesce((to_jsonb(p) ->> 'archived')::boolean, false) = false
      and (p_scope is null or p.id = any(p_scope))), '[]'::jsonb));
end; $$;
revoke execute on function mcp_list_projects(uuid, text[]) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_list_projects(uuid, text[]) to service_role';
  end if;
end $$;

create or replace function mcp_get_baseline(p_org uuid, p_scope text[], p_project text, p_seq int default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v versions%rowtype;
begin
  if not mcp_in_scope(p_org, p_scope, p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  select * into v from versions
   where project_id = p_project and (p_seq is null or seq = p_seq)
   order by seq desc limit 1;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'no_baseline'); end if;
  return jsonb_build_object('ok', true, 'projectId', p_project,
    'label', v.label, 'seq', v.seq, 'status', v.status, 'note', coalesce(v.note, ''),
    'authorName', coalesce(v.author_name, ''), 'createdAt', v.created_at,
    'snapshot', v.snapshot,
    'practice', coalesce((select (to_jsonb(p) ->> 'practice')::boolean from projects p where p.id = p_project), false));
end; $$;
revoke execute on function mcp_get_baseline(uuid, text[], text, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_get_baseline(uuid, text[], text, int) to service_role';
  end if;
end $$;

create or replace function mcp_signature_status(p_org uuid, p_scope text[], p_project text, p_seq int default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v versions%rowtype;
begin
  if not mcp_in_scope(p_org, p_scope, p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  select * into v from versions
   where project_id = p_project and (p_seq is null or seq = p_seq)
   order by seq desc limit 1;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'no_baseline'); end if;
  return jsonb_build_object('ok', true, 'projectId', p_project,
    'label', v.label, 'seq', v.seq,
    'practice', coalesce((select (to_jsonb(p) ->> 'practice')::boolean from projects p where p.id = p_project), false),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'signerName', coalesce(nullif(s.signed_name, ''), s.signer_name),
        'signerRole', s.signer_role, 'status', s.status,
        'sentAt', s.sent_at, 'signedAt', s.signed_at,
        'receiptId', r.id)
        order by s.sent_at)
      from sign_requests s
      left join acceptance_receipts r on r.sign_request_id = s.id
      where s.version_id = v.id and s.revoked = false), '[]'::jsonb));
end; $$;
revoke execute on function mcp_signature_status(uuid, text[], text, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_signature_status(uuid, text[], text, int) to service_role';
  end if;
end $$;

create or replace function mcp_get_receipt(p_org uuid, p_scope text[], p_receipt uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare r acceptance_receipts%rowtype;
begin
  select * into r from acceptance_receipts where id = p_receipt;
  if r.id is null or not mcp_in_scope(p_org, p_scope, r.project_id) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  return jsonb_build_object('ok', true, 'receiptId', r.id,
    'receiptJson', r.receipt_json, 'signatureBase64', r.signature_base64,
    'keyId', r.key_id, 'tsaStatus', r.tsa_status,
    'practice', coalesce((select (to_jsonb(p) ->> 'practice')::boolean from projects p where p.id = r.project_id), false));
end; $$;
revoke execute on function mcp_get_receipt(uuid, text[], uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_get_receipt(uuid, text[], uuid) to service_role';
  end if;
end $$;

create or replace function mcp_verify_chain(p_org uuid, p_scope text[], p_project text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not mcp_in_scope(p_org, p_scope, p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  return verify_project_chain(p_project);
end; $$;
revoke execute on function mcp_verify_chain(uuid, text[], text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_verify_chain(uuid, text[], text) to service_role';
  end if;
end $$;

-- Whether tools/list should offer reqpub_propose: the key gate is on and at
-- least one in-scope project has authored the control on.
create or replace function mcp_propose_visible(p_org uuid, p_scope text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'visible', exists (
    select 1 from project_fields f
      join projects p on p.id = f.project_id
     where p.org_id = p_org
       and (p_scope is null or p.id = any(p_scope))
       and f.field_id = 'ctrl_mcp_propose'
       and f.value #>> '{}' = 'on'));
$$;
revoke execute on function mcp_propose_visible(uuid, text[]) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_propose_visible(uuid, text[]) to service_role';
  end if;
end $$;

-- The one write: a proposal onto the comms spine. Both gates re-checked
-- here, server side, against live rows; the function's copy of the flags is
-- never trusted for the write itself.
create or replace function mcp_propose(p_key uuid, p_project text, p_subject text, p_body text, p_target text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare k mcp_api_keys%rowtype; v_org uuid; v_gate text; v_id uuid; v_body text;
begin
  select * into k from mcp_api_keys where id = p_key;
  if k.id is null or k.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_key'); end if;
  if not k.propose_enabled then
    return jsonb_build_object('ok', false, 'error', 'propose_disabled'); end if;
  if not mcp_in_scope(k.org_id, k.project_ids, p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_in_scope'); end if;
  select f.value #>> '{}' into v_gate from project_fields f
   where f.project_id = p_project and f.field_id = 'ctrl_mcp_propose';
  if coalesce(v_gate, 'off') <> 'on' then
    return jsonb_build_object('ok', false, 'error', 'propose_disabled'); end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_body), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'subject_and_body_required'); end if;
  v_org := project_org(p_project);
  v_body := case when coalesce(trim(p_target), '') <> ''
                 then 'Target: ' || left(trim(p_target), 40) || E'\n\n' else '' end
            || left(p_body, 20000);
  insert into comms(org_id, project_id, origin, author_name, title, body, fb_type, status)
  values (v_org, p_project, 'agent', left(k.label, 200), left(trim(p_subject), 500), v_body,
          'Proposal', 'new')
  returning id into v_id;
  perform log_activity(v_org, p_project, 'comm.agent', 'comm', v_id::text,
    'Agent proposal from ' || k.label || ': ' || left(trim(p_subject), 120),
    jsonb_build_object('label', k.label,
      'targetRef', left(coalesce(trim(p_target), ''), 40)));
  return jsonb_build_object('ok', true, 'commId', v_id,
    'message', 'Proposal recorded for human review. Agents propose; humans accept.');
end; $$;
revoke execute on function mcp_propose(uuid, text, text, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function mcp_propose(uuid, text, text, text, text) to service_role';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 31) v2.52 THE EVIDENCE PACK - one gather, one chained export line.
--     evidence_gather is the single throat for the pack's leak assertions:
--     no token, no email address, domains only, meta omitted and stated.
--     Practice projects are refused: practice records are non-evidence by
--     construction. Mirrors supabase/migrations/0025_evidence.sql exactly.
-- ----------------------------------------------------------------------------
create or replace function evidence_gather(p_project text)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_org uuid; v_practice boolean;
begin
  v_org := project_org(p_project);
  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce((to_jsonb(p) ->> 'practice')::boolean, false) into v_practice
    from projects p where p.id = p_project;
  if v_practice then
    return jsonb_build_object('ok', false, 'error', 'practice_project',
      'message', 'Practice records are non-evidence by construction. No pack is produced.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'project', (select jsonb_build_object('id', p.id, 'name', p.name, 'createdAt', p.created_at)
                  from projects p where p.id = p_project),
    'metaOmitted', true,
    'metaNote', 'Activity meta is omitted from this gather by standing decision D2; the omission is part of the record.',
    'chronology', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', a.created_at, 'action', a.action, 'kind', a.entity_kind,
        'ref', a.entity_id, 'actor', a.actor_name, 'message', a.summary)
        order by a.id)
      from activity a where a.project_id = p_project and a.org_id = v_org), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', v.label, 'seq', v.seq, 'status', v.status, 'note', v.note,
        'authorName', v.author_name, 'createdAt', v.created_at, 'snapshot', v.snapshot)
        order by v.seq)
      from versions v where v.project_id = p_project), '[]'::jsonb),
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'signerName', coalesce(nullif(s.signed_name, ''), s.signer_name),
        'signerRole', s.signer_role,
        'signerEmailDomain', nullif(split_part(s.signer_email, '@', 2), ''),
        'status', s.status, 'sentAt', s.sent_at, 'signedAt', s.signed_at,
        'docFingerprint', s.doc_fingerprint, 'versionSeq', v.seq,
        'versionLabel', v.label, 'receiptId', r.id)
        order by s.sent_at)
      from sign_requests s
      join versions v on v.id = s.version_id
      left join acceptance_receipts r on r.sign_request_id = s.id
      where s.project_id = p_project and s.revoked = false), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'receiptId', r.id, 'canonicalHash', r.canonical_hash, 'keyId', r.key_id,
        'tsaStatus', r.tsa_status, 'sealedAt', r.sealed_at,
        'receiptJson', r.receipt_json, 'signatureBase64', r.signature_base64,
        'tsaPrimaryDer', r.tsa_primary_der, 'tsaSecondaryDer', r.tsa_secondary_der,
        'versionSeq', v.seq)
        order by r.sealed_at)
      from acceptance_receipts r
      join sign_requests s on s.id = r.sign_request_id
      join versions v on v.id = s.version_id
      where r.project_id = p_project), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fileName', a.file_name, 'mime', a.mime, 'sizeBytes', a.size_bytes,
        'sha256Hex', coalesce(a.sha256_hex, ''), 'scanStatus', a.scan_status,
        'createdAt', a.created_at)
        order by a.created_at)
      from attachments a where a.project_id = p_project), '[]'::jsonb),
    'keys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kid', k.kid, 'publicKeySpkiBase64', k.public_key_spki_base64)
        order by k.kid)
      from receipt_keys k where k.kid in (
        select distinct r.key_id from acceptance_receipts r where r.project_id = p_project)), '[]'::jsonb),
    'chain', verify_project_chain(p_project));
end; $$;
revoke execute on function evidence_gather(text) from public;
grant execute on function evidence_gather(text) to authenticated;

-- ----------------------------------------------------------------------------
-- The export is itself on the record: one chained activity line, written
-- only when a manager exports, carrying no meta worth omitting.
-- ----------------------------------------------------------------------------
create or replace function evidence_log_export(p_project text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := project_org(p_project);
  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform log_activity(v_org, p_project, 'evidence.exported', 'evidence',
    p_project, 'Evidence pack exported', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function evidence_log_export(text) from public;
grant execute on function evidence_log_export(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 32) v2.55 THE BOOK AND PRACTICE MODE. practice is immutable after
--     creation, both directions, by trigger; the Book lists facts and never
--     scores them. Mirrors supabase/migrations/0026_book_practice.sql exactly.
-- ----------------------------------------------------------------------------
create or replace function projects_practice_guard()
returns trigger language plpgsql as $$
begin
  if new.practice is distinct from old.practice then
    raise exception 'practice is immutable after creation: a rehearsal never becomes evidence and evidence never becomes a rehearsal';
  end if;
  return new;
end; $$;
drop trigger if exists projects_practice_immutable on projects;
create trigger projects_practice_immutable
  before update on projects
  for each row execute function projects_practice_guard();

-- ----------------------------------------------------------------------------
-- The Book's facts: one batched member-scoped call for the projects grid.
-- Latest baseline facts already ride client state; this adds the signature
-- counts and the sealed truth, keyed by project id.
-- ----------------------------------------------------------------------------
create or replace function project_acceptance_facts()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(t.pid, t.facts), '{}'::jsonb) from (
    select p.id as pid, jsonb_build_object(
      'pending', (select count(*) from sign_requests s
                   where s.project_id = p.id and s.revoked = false and s.status = 'pending'),
      'signed',  (select count(*) from sign_requests s
                   where s.project_id = p.id and s.revoked = false and s.status = 'signed'),
      'sealed',  exists (select 1 from acceptance_receipts r where r.project_id = p.id)) as facts
    from projects p
    where p.archived = false and is_org_member(p.org_id)
  ) t;
$$;
revoke execute on function project_acceptance_facts() from public;
grant execute on function project_acceptance_facts() to authenticated;

-- ----------------------------------------------------------------------------
-- The Book export: every project where the caller is a manager, practice
-- excluded, one row per signature, the evidence.csv columns exactly, plus
-- engagement_value where authored. Chain head columns carry each receipt's
-- own at-seal chain snapshot where sealed, and the project's current chain
-- tail otherwise: authored and recorded facts, never a fresh verdict.
-- ----------------------------------------------------------------------------
create or replace function book_export()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'project_name', p.name,
      'version_label', v.label,
      'seq', v.seq,
      'doc_fingerprint', s.doc_fingerprint,
      'signer_name', coalesce(nullif(s.signed_name, ''), s.signer_name),
      'signer_role', s.signer_role,
      'signer_email_domain', coalesce(nullif(split_part(s.signer_email, '@', 2), ''), ''),
      'signed_at', s.signed_at,
      'receipt_id', r.id,
      'canonical_hash', coalesce(r.canonical_hash, ''),
      'tsa_status', coalesce(r.tsa_status, ''),
      'sealed_at', r.sealed_at,
      'chain_head_seq', coalesce((r.receipt_json #>> '{chain,headSeq}'),
        (select ce.seq::text from chain_events ce where ce.project_id = p.id order by ce.seq desc limit 1), ''),
      'chain_head_hash', coalesce((r.receipt_json #>> '{chain,headHash}'),
        (select ce.link_hash from chain_events ce where ce.project_id = p.id order by ce.seq desc limit 1), ''),
      'engagement_value', coalesce((select f.value #>> '{}' from project_fields f
        where f.project_id = p.id and f.field_id = 'ctrl_engagement_value'), ''))
    order by p.name, v.seq, s.sent_at), '[]'::jsonb)
  from sign_requests s
  join projects p on p.id = s.project_id
  join versions v on v.id = s.version_id
  left join acceptance_receipts r on r.sign_request_id = s.id
  where s.revoked = false
    and p.archived = false
    and p.practice = false
    and is_org_manager(p.org_id);
$$;
revoke execute on function book_export() from public;
grant execute on function book_export() to authenticated;

-- ----------------------------------------------------------------------------
-- 33) v2.56 ENGAGEMENT LINEAGE. Three additive nullable columns and one
--     set-once definer RPC. Nothing is inherited, computed, or propagated
--     across the link. Mirrors supabase/migrations/0027_pursuit_lineage.sql exactly.
-- ----------------------------------------------------------------------------
create or replace function project_set_lineage(
  p_project text, p_from_project text, p_from_seq integer, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row projects%rowtype;
begin
  v_org := project_org(p_project);
  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select * into v_row from projects where id = p_project;
  if v_row.born_from_project_id is not null
     or v_row.born_from_seq is not null
     or v_row.born_from_fingerprint is not null then
    return jsonb_build_object('ok', false, 'error', 'already_set',
      'message', 'lineage is set once: a citation that can be rewritten is not a citation');
  end if;

  if coalesce(p_from_project, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_parent'); end if;
  if p_from_seq is null or p_from_seq < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_seq'); end if;
  if p_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_fingerprint',
      'message', 'a fingerprint is 64 lowercase hexadecimal characters');
  end if;

  update projects
     set born_from_project_id = p_from_project,
         born_from_seq = p_from_seq,
         born_from_fingerprint = p_fingerprint
   where id = p_project;

  perform log_activity(v_org, p_project, 'lineage.set', 'project', p_project,
    'Born from ' || p_from_project || ' baseline seq ' || p_from_seq,
    jsonb_build_object('bornFromProjectId', p_from_project,
                       'bornFromSeq', p_from_seq,
                       'bornFromFingerprint', p_fingerprint));

  return jsonb_build_object('ok', true, 'bornFromProjectId', p_from_project,
    'bornFromSeq', p_from_seq, 'bornFromFingerprint', p_fingerprint);
end; $$;
revoke execute on function project_set_lineage(text, text, integer, text) from public, anon;
grant execute on function project_set_lineage(text, text, integer, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 34) C1 HARDENING: AUTHORIZATION LOCKDOWN. PostgreSQL grants EXECUTE on new
--     functions to PUBLIC, which includes anon. Finding C1-001 (critical):
--     an unauthenticated caller could invoke log_activity directly and insert
--     a forged, chained row into any organization's trail. This section
--     removes the accidental surface and grants back only the declared API.
--     Mirrors supabase/migrations/0028_authz_lockdown.sql exactly; see HARDENING_REPORT.md.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 35) C1 HARDENING: EGRESS GUARD. Finding C1-004 (high): any project manager
--     could point a webhook at loopback, private space, or cloud metadata and
--     make the service-role delivery worker sign and POST to it. Mirrors
--     supabase/migrations/0029_ssrf_guard.sql exactly.
-- ----------------------------------------------------------------------------
create or replace function webhook_host_refusal(p_url text)
returns text language plpgsql immutable set search_path = public as $$
declare v_auth text; v_host text; v_label text;
begin
  if p_url is null or p_url !~ '^https://[^[:space:]]+$' or length(p_url) > 2000 then
    return 'https_required';
  end if;
  -- The authority is everything after the scheme and before the first / ? #
  v_auth := substring(p_url from '^https://([^/?#]+)');
  if v_auth is null or v_auth = '' then return 'https_required'; end if;

  -- Userinfo in the authority: https://real.example@internal.host/
  if position('@' in v_auth) > 0 then return 'userinfo_not_allowed'; end if;

  -- Strip the port. A bracketed IPv6 literal is refused outright.
  if left(v_auth, 1) = '[' then return 'ip_literal_not_allowed'; end if;
  v_host := lower(split_part(v_auth, ':', 1));
  if v_host = '' then return 'https_required'; end if;

  -- Any IP literal, in any notation. A destination worth trusting has a name.
  if v_host ~ '^[0-9]+$' then return 'ip_literal_not_allowed'; end if;                 -- decimal, 2130706433
  if v_host ~ '^0[xX][0-9a-fA-F]+$' then return 'ip_literal_not_allowed'; end if;      -- hexadecimal
  if v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){1,3}$' then return 'ip_literal_not_allowed'; end if;
  if v_host ~ '^0[0-7]*(\.[0-7]+){1,3}$' then return 'ip_literal_not_allowed'; end if; -- octal
  if v_host ~ ':' then return 'ip_literal_not_allowed'; end if;                        -- bare IPv6

  -- Names that only mean something inside a network.
  if v_host = 'localhost' or v_host like '%.localhost' then return 'internal_host'; end if;
  if v_host like '%.local' or v_host like '%.internal' or v_host like '%.home.arpa'
     or v_host like '%.intranet' or v_host like '%.lan' or v_host like '%.corp'
     then return 'internal_host'; end if;

  -- A single-label name has no public meaning and resolves only via a local
  -- search domain.
  if position('.' in v_host) = 0 then return 'internal_host'; end if;

  -- A trailing dot is a valid absolute name but a common filter bypass; the
  -- normalised form is what gets stored, so refuse rather than silently edit.
  if right(v_host, 1) = '.' then return 'internal_host'; end if;

  return null;
end; $$;
revoke execute on function webhook_host_refusal(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function webhook_host_refusal(text) to service_role';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Refuse at creation. House replacement of the v2.50 body; the only change is
-- the guard and the reason it returns.
-- ----------------------------------------------------------------------------
create or replace function endpoint_create(p_project text, p_url text, p_description text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_host text; v_refusal text;
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_org := project_org(p_project);
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'unknown_project'); end if;
  v_refusal := webhook_host_refusal(p_url);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal,
      'message', case v_refusal
        when 'https_required' then 'A webhook destination must be an https URL.'
        when 'userinfo_not_allowed' then 'A webhook destination cannot carry a username in the URL.'
        when 'ip_literal_not_allowed' then 'A webhook destination must be a hostname, not an IP address.'
        else 'That destination is inside a private network and cannot be reached from ReqPub.' end);
  end if;
  v_host := webhook_host(p_url);
  insert into webhook_endpoints(org_id, project_id, url, description, created_by)
  values (v_org, p_project, p_url, left(coalesce(p_description, ''), 300), auth.uid())
  returning id into v_id;
  perform log_activity(v_org, p_project, 'webhook.endpoint_changed', 'webhook',
    v_id::text, 'Webhook endpoint added: ' || v_host,
    jsonb_build_object('host', v_host, 'change', 'added'));
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function endpoint_create(text, text, text) from public, anon;
grant execute on function endpoint_create(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Refuse again at dispatch. A row stored before this file existed, or edited
-- by any other means, still never gets bytes sent to it.
-- ----------------------------------------------------------------------------
create or replace function deliveries_due(p_project text, p_limit int default 20)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not is_project_manager(p_project) then
    return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'ids', coalesce((
    select jsonb_agg(d.id order by d.created_at)
    from (select dd.id, dd.created_at
            from webhook_deliveries dd
            join webhook_endpoints ee on ee.id = dd.endpoint_id
           where ee.project_id = p_project and ee.active
             and dd.state in ('pending', 'failed')
             and coalesce(dd.next_retry_at, now()) <= now()
             and webhook_host_refusal(ee.url) is null   -- C1-004: never dispatch to an internal destination
           order by dd.created_at
           limit greatest(1, least(coalesce(p_limit, 20), 50))) d), '[]'::jsonb));
end; $$;
revoke execute on function deliveries_due(text, int) from public, anon;
grant execute on function deliveries_due(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 36) MIGRATION LEDGER. An operator must be able to answer "what revision is
--     this database at" with one query. Every file under supabase/migrations
--     ends with an idempotent insert recording its own ordinal, name, and the
--     SHA-256 of its body. A database built from this file alone needs no
--     migration and carries no rows; a database built by replay carries one
--     row per file.
-- ----------------------------------------------------------------------------
create table if not exists schema_migrations (
  version    text primary key,
  name       text not null,
  checksum   text not null,
  applied_at timestamptz not null default now()
);
revoke all on schema_migrations from public, anon, authenticated;
