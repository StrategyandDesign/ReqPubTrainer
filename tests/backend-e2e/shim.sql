-- TEST-ONLY Supabase shims for local validation (never deployed).
create role anon nologin;
create role authenticated nologin;

-- Supabase parity: pgcrypto lives in the `extensions` schema there, NOT in
-- public. Installing it the same way here catches any function that calls
-- gen_random_bytes without `extensions` on its search_path - a bug class
-- that passes on plain Postgres and fails in production.
create schema extensions;
create extension pgcrypto with schema extensions;

create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create schema if not exists realtime;
create table realtime.messages (
  id bigserial primary key,
  topic text, event text, payload jsonb, created_at timestamptz default now()
);
create or replace function realtime.topic() returns text
language sql stable as $$ select coalesce(current_setting('test.topic', true), '') $$;
create or replace function realtime.broadcast_changes(
  topic_name text, event_name text, operation text,
  table_name text, table_schema text, new record, old record)
returns void language plpgsql as $$
begin
  insert into realtime.messages(topic, event, payload)
  values (topic_name, event_name,
          jsonb_build_object('table', table_name, 'operation', operation));
end $$;
