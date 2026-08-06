-- fix-update-panel.sql - run once on the live database for v2.34.0.
-- Idempotent: safe to run again. Fresh installs get all of this from
-- schema.sql (section 21 plus the update RPCs in section 16).
--
-- Order on a live database:
--   1. this file            (columns, origin vocabulary, update_comment)
--   2. supabase/fix-updates.sql   (the v2.34.0 update_publish / update_context,
--                                  which read the columns added here)
-- Running schema.sql end to end does both and needs neither file.
--
-- Two related moves. discovery_entries gains the version_seq column comms has
-- carried since v2, so a note and a discovery entry are both filed against the
-- baseline that was current when they were written. And the update link grows
-- from a frozen digest into a panel: the signature requests on its baseline,
-- the prior baselines, and a comment box attributed to the named recipient.
--
-- The doctrine, unchanged: the stamp is metadata ABOUT a note, never content
-- IN a baseline. Snapshots still hold answers and sections only, and promotion
-- is still the only path by which a note becomes part of the agreement.

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
  check (origin in ('app','brief','sme','partner','team','meeting','update'));

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

notify pgrst, 'reload schema';

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0017', 'update_panel', '228ad71fb1da87cc77e40a69149e7cca224ac8532e4b319ed41174ddbf1bdf75')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
