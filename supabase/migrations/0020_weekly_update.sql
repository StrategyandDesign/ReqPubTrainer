-- fix-weekly-update.sql - run once on the live database for v2.35.0.
-- Idempotent: safe to run again. Fresh installs get all of this from
-- schema.sql (section 22 plus the reworked update RPCs).
--
-- Order on a live database: fix-update-panel.sql, then fix-updates.sql, then
-- this file. Running schema.sql end to end does everything and needs none of
-- the fix files.
--
-- What this release adds to the update link, and the doctrine it keeps.
--
-- The update link grows from a digest-plus-panel into a dashboard of AUTHORED
-- content frozen at publish: the engagement phase the team set, the
-- objectives and key results they wrote, and the risk and issue rows they
-- wrote, each with a permanent phase-prefixed ID. Nothing on the dashboard is
-- computed by the platform: no rollup, no verdict, no derived status. The
-- phase tab strip renders one authored answer (ctrl_phase) against the fixed
-- option order, which is presentation of a choice, not a judgment about
-- delivery. See docs/POSITIONING.md; that line is load-bearing.
--
-- The recipient side grows two capabilities:
--
--   Notes.   A private scratch area saved against the recipient's own link.
--            Scoped to the link's token, readable and writable through that
--            token only, rev-checked like every other field write. Notes are
--            NOT encrypted at rest and the words on the page say so.
--
--   Threads. A question, comment, or request for information opens a REAL
--            thread on the existing comms spine: origin 'update', the named
--            recipient and their role as the author, version_seq stamped to
--            the baseline the update reported on, a reply_token minted via
--            url_token so the thread is reachable without login exactly like
--            an SME workspace thread. Replies land in messages with a new
--            author_kind 'client'. No parallel messaging system exists: the
--            team sees the thread in the Inbox through the same
--            last_ext_at / team_seen_at signal as every other outside voice,
--            and a team reply from inside the app appears on the recipient's
--            link. Never anonymous: a link issued to nobody accepts no posts.
--
-- Writes are RPC-only. Direct table writes on every new surface are revoked.

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
--    first (the fix-updates.sql precedent).
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

notify pgrst, 'reload schema';

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0020', 'weekly_update', '67544bfadbbbc1fe1fee43d7e2a862447c6f3e6d54b0e9934aa9475dec4cbb87')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
