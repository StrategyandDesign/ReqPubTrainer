-- ============================================================================
-- ReqPub v2.47.0 - fix-chain.sql
-- The activity chain: a per-project hash chain over the existing insert-only
-- activity trail. Silent capture. No visible behavior changes.
-- Deploy order: run AFTER schema.sql is current (any version >= 2.46.5).
-- Idempotent: safe to run twice. Includes the backfill (genesis plus all
-- historical project activity, in insertion order).
-- Recipe: docs/VERIFY.md section 8. The database never canonicalizes JSON.
-- entry_hash = sha256 over UTF-8 bytes of these activity fields joined by
-- U+001F in this frozen order:
--   id, org_id, project_id, actor (or ''), actor_name, action, entity_kind,
--   entity_id, summary, meta::text, created_at as UTC
--   YYYY-MM-DD"T"HH24:MI:SS.US"Z"
-- link_hash = sha256 over UTF-8 of prev_hash || entry_hash (two lowercase
-- hex strings concatenated). Genesis seq 0: prev_hash =
-- sha256('REQPUB-GENESIS:' || project_id), entry covers the chain.genesis
-- activity row. Org-level activity (project_id null) is outside the chain.
-- ============================================================================

-- PRECHECK: fail here, with a named reason, before creating anything.
do $$ begin
  if to_regclass('public.activity') is null then
    raise exception 'PRECHECK failed: the activity table is missing. This database is older than v2.20; run supabase/schema.sql sections first.';
  end if;
  if to_regclass('public.projects') is null then
    raise exception 'PRECHECK failed: the projects table is missing.';
  end if;
  if to_regprocedure('public.is_project_member(text)') is null then
    raise exception 'PRECHECK failed: is_project_member(text) is missing; run the base schema first.';
  end if;
  begin
    perform extensions.digest('x'::bytea, 'sha256');
  exception when others then
    begin
      perform digest('x'::bytea, 'sha256');
    exception when others then
      raise exception 'PRECHECK failed: pgcrypto digest() is unavailable; enable the pgcrypto extension.';
    end;
  end;
end $$;

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

-- Backfill: genesis plus historical activity for every project, in order.
-- Runs as the deploying superuser. Idempotent: chained rows are skipped.
do $$
declare v_p record; v_row activity;
begin
  for v_p in select id from projects loop
    perform pg_advisory_xact_lock(hashtext(v_p.id));
    perform chain_ensure_genesis(v_p.id);
    for v_row in
      select a.* from activity a
      left join chain_events c on c.activity_id = a.id
      where a.project_id = v_p.id and c.id is null
      order by a.id
    loop
      perform chain_append_row(v_row);
    end loop;
  end loop;
end $$;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0004', 'chain', '572f6d46b927044d32f5bbbc486f5b810213b9184e03f82850ea4194190ee795')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
