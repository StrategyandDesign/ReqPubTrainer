-- ============================================================================
-- fix-new-reply.sql  (idempotent)
--
-- Team-level "new reply" signal on each thread. It answers one question for the
-- team: has an external party (app reviewer, brief reviewer, SME, or partner)
-- posted or replied on this PRD since anyone on the team last looked?
--
--   comms.last_ext_at   advances whenever an external party posts a new thread
--                       with content, or replies on an existing thread.
--   comms.team_seen_at  advances the moment any team member opens the thread.
--
-- A thread has an unseen external reply while last_ext_at > team_seen_at. Because
-- the flag lives on the thread (not per user), the first teammate to look clears
-- it for everyone. The per-user read receipts in read_marks are left unchanged.
--
-- Run ONCE in the Supabase SQL editor, AFTER schema.sql. Re-runnable.
-- ============================================================================

alter table comms add column if not exists last_ext_at  timestamptz;
alter table comms add column if not exists team_seen_at timestamptz;
create index if not exists comms_newext on comms(project_id) where last_ext_at is not null;

-- A new external thread that carries content flags itself on insert. The empty
-- SME-workspace shell (no body, verdict, or steps) does not count.
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

-- An external reply (from an SME or partner) bumps its parent thread. Team
-- replies do not flag. SECURITY DEFINER so the update lands regardless of the
-- caller's role (external replies arrive through accountless/definer paths).
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
-- which is why it is SECURITY DEFINER rather than a direct table write.
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

-- Backfill: mark existing external threads as already seen, so the signal starts
-- clean and does not light up historical activity on first deploy.
update comms set last_ext_at = greatest(created_at, updated_at)
  where origin in ('app','brief','sme','partner')
    and (coalesce(body,'') <> '' or coalesce(verdict,'') <> '' or coalesce(steps,'') <> '')
    and last_ext_at is null;
update comms set team_seen_at = now() where last_ext_at is not null and team_seen_at is null;

notify pgrst, 'reload schema';

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0010', 'new_reply', 'e60654afa685c19ceabf89fa728594fc15cd5b186620571679e5af0004fd329d')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
