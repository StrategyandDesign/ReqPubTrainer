-- ReqPub fix: in-app help system (v2.40.0). Run once in the Supabase SQL
-- editor. Idempotent.
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

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0008', 'help', '1f416761a997b8b3ddf39892b7232530d60f392802c30fc18cbe06821276432c')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
