-- ============================================================================
-- ReqPub - durable SME workspace (v2.9.0)   ← run this ONE file in Supabase
-- ============================================================================
-- Adds a persistent, no-login workspace for each SME on a PRD: one stable
-- personal link that always reopens the SAME thread (read-only PRD + one
-- continuous conversation), instead of a new link/thread per submission.
-- Additive and idempotent; safe to run any time. No data is modified.
--
-- Supabase → SQL Editor → New query → paste all of this → Run.
-- ============================================================================

-- SME thread + the current branded PRD (latest published brief, live brand).
create or replace function sme_thread(p_reply_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select case when c.id is null then jsonb_build_object('ok', false) else jsonb_build_object(
    'ok', true, 'title', c.title, 'body', c.body, 'status', c.status, 'at', c.created_at,
    'name', c.author_name, 'product', pr.name,
    'brief', (select s.payload || jsonb_build_object('logo', pr.brand_logo, 'brandLabel', pr.brand_label)
              from shares s where s.project_id = c.project_id and s.kind = 'brief' and s.revoked = false
              order by s.version_seq desc limit 1),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('from', m.author_kind, 'name', m.author_name,
                                          'body', m.body, 'at', m.created_at) order by m.created_at)
      from messages m where m.parent_kind = 'comm' and m.parent_id = c.id), '[]'::jsonb))
  end
  from (select 1) one
  left join comms c on c.reply_token = p_reply_token
  left join projects pr on pr.id = c.project_id;
$$;
grant execute on function sme_thread(text) to anon, authenticated;

-- Find-or-create the durable thread for (project, SME email). Idempotent.
create or replace function sme_seat(p_project text, p_name text, p_email text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_org uuid; c comms%rowtype; v_email text; v_name text; v_existed boolean;
begin
  v_org := project_org(p_project);
  if v_org is null or not is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  v_email := lower(nullif(trim(p_email), ''));
  if v_email is null then return jsonb_build_object('ok', false, 'error', 'email_required'); end if;
  v_name := left(coalesce(nullif(trim(p_name), ''), split_part(v_email, '@', 1)), 200);
  perform pg_advisory_xact_lock(hashtextextended('smeseat/' || p_project || '/' || v_email, 11));
  select * into c from comms
    where project_id = p_project and origin = 'sme' and lower(author_email) = v_email
    order by created_at limit 1;
  v_existed := c.id is not null;
  if not v_existed then
    insert into comms(org_id, project_id, origin, author_name, author_email, title, body, reply_token)
    values (v_org, p_project, 'sme', v_name, v_email, 'SME review workspace', '', url_token())
    returning * into c;
    perform log_activity(v_org, p_project, 'sme.seated', 'comm', c.id::text,
      'Seated SME ' || v_name, jsonb_build_object('email', v_email));
  elsif v_name <> '' and c.author_name is distinct from v_name then
    update comms set author_name = v_name where id = c.id returning * into c;
  end if;
  return jsonb_build_object('ok', true, 'reply_token', c.reply_token,
    'name', c.author_name, 'email', c.author_email, 'existed', v_existed);
end; $$;
grant execute on function sme_seat(text, text, text) to authenticated;

-- The SME roster for a PRD (managers only).
create or replace function sme_seats(p_project text)
returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', c.author_name, 'email', c.author_email, 'reply_token', c.reply_token, 'at', c.created_at,
    'replies', (select count(*) from messages m
                where m.parent_kind = 'comm' and m.parent_id = c.id and m.author_kind = 'sme')
  ) order by c.created_at), '[]'::jsonb)
  from comms c
  where c.project_id = p_project and c.origin = 'sme' and c.reply_token is not null
    and is_org_manager(c.org_id);
$$;
grant execute on function sme_seats(text) to authenticated;

-- Ledger. Idempotent, like the rest of this file. The checksum is of the body
-- above this block, so editing a shipped migration is detectable.
insert into schema_migrations (version, name, checksum)
values ('0016', 'sme_workspace', '5fea12c646b7019f0c77082edab1c8e643e8431a26a3160ef74a7057ae64051d')
on conflict (version) do update set name = excluded.name, checksum = excluded.checksum;
