-- ============================================================================
-- ReqPub v2.56 - ENGAGEMENT LINEAGE. Run once in the Supabase SQL editor,
-- after fix-book-practice.sql. Idempotent; safe to run twice.
--
-- A lineage is a citation, not a pipeline. Three additive nullable columns
-- record where an engagement came from: the record it was born from, the
-- baseline sequence that was signed, and that baseline's fingerprint. Nothing
-- is inherited, computed, or propagated across the link. Nothing reads back
-- up the chain. The child is an ordinary record that happens to name its
-- parent, and a reader can verify the citation offline with the fingerprint
-- alone.
--
-- Set exactly once, through a definer RPC, by a manager on the child. A
-- second attempt is refused rather than silently overwritten, because a
-- citation that can be rewritten is not a citation. The write is logged as
-- lineage.set and rides the activity chain like every other action.
--
-- Pursuit Mode needs no schema: it is an authored control field on the
-- existing project_fields mechanism, and the worksheet trim rides the
-- per-section condition mechanism that has shipped since v2.20.
-- ============================================================================

do $$
declare missing text := '';
begin
  if to_regclass('public.projects') is null then missing := missing || ' projects'; end if;
  if to_regprocedure('public.log_activity(uuid, text, text, text, text, text, jsonb)') is null
     and to_regprocedure('public.log_activity(uuid, text, text, text, text, text)') is null
     then missing := missing || ' log_activity'; end if;
  if to_regprocedure('public.is_org_manager(uuid)') is null then missing := missing || ' is_org_manager'; end if;
  if to_regprocedure('public.project_org(text)') is null then missing := missing || ' project_org'; end if;
  if missing <> '' then raise exception 'fix-pursuit-lineage.sql prerequisites missing:%', missing; end if;
end $$;

-- ----------------------------------------------------------------------------
-- The three columns. Additive and nullable: every existing project keeps
-- exactly the shape it had, and a record without lineage is the normal case.
-- ----------------------------------------------------------------------------
alter table projects add column if not exists born_from_project_id text;
alter table projects add column if not exists born_from_seq integer;
alter table projects add column if not exists born_from_fingerprint text;

-- ----------------------------------------------------------------------------
-- project_set_lineage: manager on the child, set once, format validated.
-- The parent is named but never joined against: a citation may point at a
-- record in another organization, or at one that was later archived, and it
-- stays true either way. The fingerprint is what makes it checkable.
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

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0027', 'pursuit_lineage', 'ef7d6552e5e5d6189da351778219ded437a8794b330315a4dc8f0244354c76ee')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
