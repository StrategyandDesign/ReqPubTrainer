-- ReqPub backend - multi-tenant organizations with role-based access control
-- Run once in your Supabase project (SQL Editor -> paste -> Run).
-- Then enable Email auth under Authentication -> Sign In / Providers -> Email.
--
-- Roles:
--   Manager  (internal) - read + write across all of the org's documents, manage members & partners
--   Viewer   (internal) - read-only across all of the org's documents
--   Partner  (external) - sees only the SME version of assigned PRDs, submits notes (via partner portal)
--   SME      (external) - no account; opens a share/notes link
--
-- Security model: documents live in `kv`, keyed by org_id. Row-level security lets any
-- member READ their org's rows and only Managers WRITE. Membership tests run through
-- SECURITY DEFINER helper functions to avoid RLS recursion.

-- ========================================================================
-- 1) Organizations
-- ========================================================================
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table orgs enable row level security;

-- ========================================================================
-- 2) Members (internal users) and pending invites
-- ========================================================================
create table if not exists org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  role text not null default 'viewer' check (role in ('manager','viewer')),
  created_at timestamptz default now(),
  primary key (org_id, user_id)
);
alter table org_members enable row level security;

create table if not exists org_invites (
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('manager','viewer')),
  invited_by uuid default auth.uid(),
  created_at timestamptz default now(),
  primary key (org_id, email)
);
alter table org_invites enable row level security;

-- Helper functions (SECURITY DEFINER bypasses RLS, so membership checks do not recurse)
create or replace function is_org_member(p_org uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid());
$$;
create or replace function is_org_manager(p_org uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'manager');
$$;

-- orgs policies
drop policy if exists orgs_read on orgs;
create policy orgs_read   on orgs for select using (is_org_member(id));
drop policy if exists orgs_insert on orgs;
create policy orgs_insert on orgs for insert with check (created_by = auth.uid());
drop policy if exists orgs_update on orgs;
create policy orgs_update on orgs for update using (is_org_manager(id)) with check (is_org_manager(id));

-- org_members policies
drop policy if exists om_read on org_members;
create policy om_read  on org_members for select using (is_org_member(org_id));
drop policy if exists om_write on org_members;
create policy om_write on org_members for all using (is_org_manager(org_id)) with check (is_org_manager(org_id));

-- org_invites policies (managers manage)
drop policy if exists oi_mgr on org_invites;
create policy oi_mgr on org_invites for all using (is_org_manager(org_id)) with check (is_org_manager(org_id));

-- ========================================================================
-- 3) Application data: org-scoped key-value (mirrors the app's storage)
-- ========================================================================
create table if not exists kv (
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz default now(),
  primary key (org_id, key)
);
alter table kv enable row level security;
drop policy if exists kv_read on kv;
create policy kv_read  on kv for select using (is_org_member(org_id));
drop policy if exists kv_write on kv;
create policy kv_write on kv for all using (is_org_manager(org_id)) with check (is_org_manager(org_id));
-- => Viewers read every document; only Managers write.

-- ========================================================================
-- 4) Partners (external collaborators with logins) and their PRD assignments
-- ========================================================================
create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,   -- linked when they sign up
  email text not null,
  name text,
  created_at timestamptz default now()
);
alter table partners enable row level security;

create table if not exists partner_access (
  partner_id uuid not null references partners(id) on delete cascade,
  project_id text not null,    -- the app's project id
  created_at timestamptz default now(),
  primary key (partner_id, project_id)
);
alter table partner_access enable row level security;

drop policy if exists partners_mgr on partners;
create policy partners_mgr on partners for all using (is_org_manager(org_id)) with check (is_org_manager(org_id));
drop policy if exists partners_self on partners;
create policy partners_self on partners for select using (user_id = auth.uid());

drop policy if exists pa_mgr on partner_access;
create policy pa_mgr on partner_access for all
  using (exists(select 1 from partners p where p.id = partner_access.partner_id and is_org_manager(p.org_id)))
  with check (exists(select 1 from partners p where p.id = partner_access.partner_id and is_org_manager(p.org_id)));
drop policy if exists pa_self on partner_access;
create policy pa_self on partner_access for select
  using (exists(select 1 from partners p where p.id = partner_access.partner_id and p.user_id = auth.uid()));

-- ========================================================================
-- 5) Curated shares (SME-version payloads) + submissions (feedback / notes)
-- ========================================================================
create table if not exists shares (
  token text primary key,
  org_id uuid references orgs(id) on delete cascade,
  project_id text not null,
  version_seq integer not null default 0,
  kind text not null,                 -- 'brief' | 'pilot' | 'note'
  payload jsonb not null,             -- curated, public-safe content only
  revoked boolean default false,
  updated_at timestamptz default now()
);
alter table shares enable row level security;
drop policy if exists shares_view on shares;
create policy shares_view on shares for select using (org_id is null or is_org_member(org_id));
drop policy if exists shares_mgr on shares;
create policy shares_mgr on shares for all using (org_id is null or is_org_manager(org_id)) with check (org_id is null or is_org_manager(org_id));

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  kind text not null,                 -- 'pilot' | 'brief' | 'note'
  payload jsonb not null,             -- includes project_id and the record
  created_at timestamptz default now()
);
alter table submissions enable row level security;
drop policy if exists subs_read on submissions;
create policy subs_read on submissions for select using (
  exists(select 1 from shares s where s.token = submissions.token and (s.org_id is null or is_org_member(s.org_id)))
);
-- External writes happen through the RPC below (security definer), so no public INSERT policy is needed.

-- ========================================================================
-- 6) Public RPCs for no-login SMEs
-- ========================================================================
create or replace function get_share(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select payload from shares where token = p_token and revoked = false limit 1;
$$;
grant execute on function get_share(text) to anon, authenticated;

create or replace function submit_share_feedback(p_token text, p_kind text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select exists(select 1 from shares where token = p_token and revoked = false) into ok;
  if not ok then return false; end if;
  insert into submissions(token, kind, payload) values (p_token, p_kind, p_payload);
  return true;
end; $$;
grant execute on function submit_share_feedback(text, text, jsonb) to anon, authenticated;

-- ========================================================================
-- 7) Partner portal read: assigned PRDs + their curated brief payloads
-- ========================================================================
create or replace function partner_projects()
returns table(project_id text, payload jsonb)
language sql security definer set search_path = public as $$
  select pa.project_id,
         (select s.payload from shares s
            where s.project_id = pa.project_id and s.kind = 'brief' and s.revoked = false
            order by s.version_seq desc limit 1)
  from partner_access pa
  join partners p on p.id = pa.partner_id
  where p.user_id = auth.uid();
$$;
grant execute on function partner_projects() to authenticated;

-- Partner-submitted notes (org members read; partners write via the RPC below)
create table if not exists partner_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id text not null,
  partner_id uuid references partners(id) on delete set null,
  name text,
  text text not null,
  created_at timestamptz default now()
);
alter table partner_notes enable row level security;
drop policy if exists pn_read on partner_notes;
create policy pn_read on partner_notes for select using (is_org_member(org_id));

create or replace function partner_submit_note(p_project text, p_text text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_oid uuid; v_name text;
begin
  select p.id, p.org_id, p.name into v_pid, v_oid, v_name
  from partners p join partner_access pa on pa.partner_id = p.id
  where p.user_id = auth.uid() and pa.project_id = p_project limit 1;
  if v_pid is null then return false; end if;
  insert into partner_notes(org_id, project_id, partner_id, name, text)
    values (v_oid, p_project, v_pid, v_name, p_text);
  return true;
end; $$;
grant execute on function partner_submit_note(text, text) to authenticated;

-- ---- Two-way partner threads: replies on partner notes, visible to the owning partner ----
alter table partner_notes add column if not exists replies jsonb not null default '[]'::jsonb;
drop policy if exists pn_read_partner on partner_notes;
create policy pn_read_partner on partner_notes for select using (
  partner_id in (select id from partners where user_id = auth.uid())
);

-- Append a reply to a partner note. Either an org member (the team) or the owning partner may reply.
create or replace function partner_note_reply(p_note uuid, p_text text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_partner uuid; v_from text; v_name text;
begin
  select pn.org_id, pn.partner_id into v_org, v_partner from partner_notes pn where pn.id = p_note;
  if v_org is null then return false; end if;
  if is_org_member(v_org) then
    v_from := 'team'; v_name := 'Team';
  elsif exists(select 1 from partners p where p.id = v_partner and p.user_id = auth.uid()) then
    v_from := 'partner';
    select coalesce(nullif(trim(p.name),''),'Partner') into v_name from partners p where p.id = v_partner;
  else
    return false;
  end if;
  update partner_notes
    set replies = replies || jsonb_build_object('from',v_from,'name',v_name,'text',p_text,'at',now())
    where id = p_note;
  return true;
end; $$;
grant execute on function partner_note_reply(uuid, text) to authenticated;

-- The calling partner's own notes + replies for a project (their side of the conversation).
create or replace function partner_thread(p_project text)
returns table(id uuid, text text, replies jsonb, created_at timestamptz)
language sql security definer set search_path = public as $$
  select pn.id, pn.text, pn.replies, pn.created_at
  from partner_notes pn join partners p on p.id = pn.partner_id
  where p.user_id = auth.uid() and pn.project_id = p_project
  order by pn.created_at;
$$;
grant execute on function partner_thread(text) to authenticated;

-- ========================================================================
-- 8) Onboarding RPCs
-- ========================================================================
-- Create an org and become its first Manager.
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

-- Claim any pending invites for my email, and link any partner row by email. Returns # of memberships joined.
create or replace function claim_invites()
returns int language plpgsql security definer set search_path = public as $$
declare my_email text; n int := 0; p int := 0;
begin
  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then return 0; end if;
  insert into org_members(org_id, user_id, email, role)
    select i.org_id, auth.uid(), my_email, i.role from org_invites i where lower(i.email) = lower(my_email)
    on conflict (org_id, user_id) do nothing;
  get diagnostics n = row_count;
  delete from org_invites where lower(email) = lower(my_email);
  -- Link any partner row invited under my email, and COUNT it too, so partner-only
  -- invites are recognized at sign-up (previously only teammate joins were counted).
  update partners set user_id = auth.uid() where lower(email) = lower(my_email) and user_id is null;
  get diagnostics p = row_count;
  return n + p;
end; $$;
grant execute on function claim_invites() to authenticated;

-- Convenience: who am I? returns my org_id, org name, and role (empty if I'm only a partner / no org).
create or replace function my_context()
returns table(org_id uuid, org_name text, role text)
language sql security definer set search_path = public as $$
  select m.org_id, o.name, m.role
  from org_members m join orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
  limit 1;
$$;
grant execute on function my_context() to authenticated;

-- Table privileges for the logged-in (authenticated) role, so a Manager can always save share
-- links. Supabase usually grants these by default; we set them explicitly to remove any doubt.
-- Row-level security still applies (a manager can only write org-null / their-own-org rows).
-- The logged-in (authenticated) role needs table access for every direct read/write the app does
-- as a Manager: org_invites, partners, partner_access, project storage (kv), org_members, orgs,
-- shares, submissions, partner_notes. Row-level security still restricts WHICH rows they can touch,
-- so this is safe. (This is the grant Supabase normally applies by default.)
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Reload PostgREST's schema cache so the new tables/functions are exposed to the API immediately.
notify pgrst, 'reload schema';
