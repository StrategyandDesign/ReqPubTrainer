-- ============================================================================
-- ReqPub - trackable partner notes · v2.11.0
-- ============================================================================
-- Run ONCE in the Supabase SQL editor (idempotent). Gives every partner note a
-- stable per-project reference (PN-1, PN-2, …) and a self-describing headline
-- taken from the note's first line, so no two read the same "Partner note" in
-- the inbox. Backfills references + headlines for notes already sent.
-- ============================================================================

alter table comms add column if not exists ref text;
alter table projects add column if not exists partner_note_seq int not null default 0;

create or replace function partner_post(p_project text, p_body text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_org uuid; v_name text; v_id uuid; v_n int; v_title text; v_ref text;
begin
  select p.id, p.org_id, coalesce(nullif(trim(p.name), ''), 'Partner')
    into v_pid, v_org, v_name
  from partners p join partner_access pa on pa.partner_id = p.id
  where p.user_id = auth.uid() and pa.project_id = p_project limit 1;
  if v_pid is null or coalesce(trim(p_body), '') = '' or length(p_body) > 20000 then return false; end if;
  v_title := left(regexp_replace(split_part(btrim(p_body), E'\n', 1), '\s+', ' ', 'g'), 72);
  if length(v_title) < length(regexp_replace(btrim(p_body), '\s+', ' ', 'g')) then v_title := v_title || '…'; end if;
  if v_title = '' then v_title := 'Partner note'; end if;
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

-- Partner thread read returns the reference and the thread's own files.
create or replace function partner_thread_v2(p_project text)
returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'ref', c.ref, 'title', c.title, 'body', c.body, 'status', c.status, 'at', c.created_at,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('from', m.author_kind, 'name', m.author_name,
                                          'body', m.body, 'at', m.created_at) order by m.created_at)
      from messages m where m.parent_kind = 'comm' and m.parent_id = c.id), '[]'::jsonb),
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

-- Backfill: number existing partner notes by age (PN-1 oldest) and give the
-- generic "Partner note" ones a headline from their first line.
with ordered as (
  select id, project_id, body,
         row_number() over (partition by project_id order by created_at) rn
  from comms where origin = 'partner'
)
update comms c set
  ref = coalesce(c.ref, 'PN-' || o.rn),
  title = case when coalesce(c.title, '') in ('', 'Partner note')
    then coalesce(nullif(left(regexp_replace(split_part(btrim(o.body), E'\n', 1), '\s+', ' ', 'g'), 72), ''), 'Partner note')
         || case when length(regexp_replace(btrim(o.body), '\s+', ' ', 'g')) > 72 then '…' else '' end
    else c.title end
from ordered o
where c.id = o.id and c.origin = 'partner';

-- Seed each project's counter to its highest existing note number, so live posts
-- continue the sequence (and never reuse a backfilled number).
update projects p set partner_note_seq = greatest(p.partner_note_seq, sub.n)
from (select project_id, count(*) n from comms where origin = 'partner' group by project_id) sub
where sub.project_id = p.id;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0012', 'partner_notes', '883efb65bd11b09a768b75aaf6804e6b41d27ffd83c11ed263fa330cc2cdcabc')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
