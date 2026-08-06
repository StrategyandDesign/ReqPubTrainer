-- fix-updates.sql - run once on the live database to add weekly updates.
-- Idempotent: safe to run again. Fresh installs get this from schema.sql (16).
-- Kept in step with schema.sql: update_publish and update_context below are the
-- v2.34.0 forms, so re-running this file can never restore the pre-panel
-- signatures underneath a v2.34 frontend. The columns they depend on ship in
-- supabase/fix-update-panel.sql; run that first on a live database.
--
-- A weekly update is a published, immutable digest of what moved on the
-- record: the asks, the movement, the open items - every line derived from
-- record truth (approvals, signatures, gates, health) plus one editorial
-- sentence. It is deliberately NOT a tracker surface: nothing here is
-- hand-maintained status. The row is evidence, like a version: published
-- once, never edited, always renderable at its token link. Next week's
-- digest diffs against this one to age closed items off.
--
-- Writes are RPC-only; members read; the client reads through the token.

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
-- Convergence with later releases: v2.35.0 replaces this function with a
-- seven-argument signature (recipient role added). Replaying THIS file on a
-- database that already carries that release must not leave two overloads,
-- so the newer signature is dropped here too; running the fix files in their
-- documented order (this file, then fix-weekly-update.sql) ends on the
-- current seven-argument function either way.
drop function if exists update_publish(text, jsonb, timestamptz, text, text, text, text);
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

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0018', 'updates', 'ca3538f4212d855444792e0b61e7b3eac63f956d689e0a46e99927b289137fff')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
