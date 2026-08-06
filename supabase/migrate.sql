-- ============================================================================
-- ReqPub v1 → v2 data migration
-- ============================================================================
-- Run AFTER schema.sql, in the same Supabase project.
-- Idempotent: every insert is keyed on a primary key or legacy_id and uses
-- ON CONFLICT DO NOTHING, so re-running never duplicates. v1 tables are only
-- READ - kv, shares, submissions and partner_notes stay intact as a fallback
-- until you retire the v1 frontend.
--
-- What moves where:
--   kv 'rm:index'                    → projects
--   kv 'rm:proj:<id>:answers'        → project_fields (scalars) + field_rows (arrays)
--   kv ':versions' + ':ver:<seq>'    → versions (snapshot, build, status)
--   kv ':noteReqs'                   → input_requests (+ thread → messages)
--   partner_notes                    → comms(origin partner) + messages
--   kv ':feedback' / ':notes'        → comms + messages
--   submissions (not already in kv)  → comms
--   kv ':discovery'                  → discovery_entries
-- Old share links keep working: brief/pilot links resolve through the shares
-- table as before; legacy note-request tokens are adopted into input_requests.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Projects - from each org's index, plus any orphaned answers blobs
-- ----------------------------------------------------------------------------
insert into projects (id, org_id, name, created_at, updated_at)
select p->>'id', kv.org_id,
       coalesce(nullif(trim(p->>'name'), ''), 'Untitled'),
       coalesce(nullif(p->>'updatedAt', '')::timestamptz, now()),
       coalesce(nullif(p->>'updatedAt', '')::timestamptz, now())
from kv, jsonb_array_elements(kv.value) as p
where kv.key = 'rm:index' and jsonb_typeof(kv.value) = 'array' and coalesce(p->>'id', '') <> ''
on conflict (id) do nothing;

insert into projects (id, org_id, name)
select substring(kv.key from '^rm:proj:([^:]+):answers$'), kv.org_id,
       coalesce(nullif(trim(kv.value->>'ctrl_product'), ''), 'Untitled')
from kv
where kv.key ~ '^rm:proj:[^:]+:answers$'
  and substring(kv.key from '^rm:proj:([^:]+):answers$') not in (select id from projects)
on conflict (id) do nothing;

-- Discovery-appendix export flag
update projects p set disc_export = true
from kv
where kv.key = 'rm:proj:' || p.id || ':discExport'
  and kv.org_id = p.org_id and kv.value = 'true'::jsonb;

-- ----------------------------------------------------------------------------
-- 2) Worksheet answers → project_fields (scalars) + field_rows (arrays)
--    '__k_*' counter keys are dropped; k is preserved from each row's _k.
-- ----------------------------------------------------------------------------
with answers as (
  select substring(kv.key from '^rm:proj:([^:]+):answers$') as project_id,
         kv.org_id, kv.value, kv.updated_at
  from kv
  where kv.key ~ '^rm:proj:[^:]+:answers$' and jsonb_typeof(kv.value) = 'object'
)
insert into project_fields (project_id, field_id, value, rev, updated_by_name, updated_at)
select a.project_id, f.key, f.value, 1, 'v1 import', a.updated_at
from answers a
join projects p on p.id = a.project_id and p.org_id = a.org_id
cross join lateral jsonb_each(a.value) as f(key, value)
where f.key not like '\_\_k\_%' escape '\'
  and jsonb_typeof(f.value) <> 'array'
on conflict (project_id, field_id) do nothing;

with answers as (
  select substring(kv.key from '^rm:proj:([^:]+):answers$') as project_id,
         kv.org_id, kv.value, kv.updated_at
  from kv
  where kv.key ~ '^rm:proj:[^:]+:answers$' and jsonb_typeof(kv.value) = 'object'
),
rows_src as (
  select a.project_id, a.updated_at, f.key as field_id,
         item.value as item, item.ordinality as ord
  from answers a
  join projects p on p.id = a.project_id and p.org_id = a.org_id
  cross join lateral jsonb_each(a.value) as f(key, value)
  cross join lateral jsonb_array_elements(f.value) with ordinality as item(value, ordinality)
  where f.key not like '\_\_k\_%' escape '\' and jsonb_typeof(f.value) = 'array'
)
insert into field_rows (project_id, field_id, k, data, pos, updated_by_name, updated_at)
select project_id, field_id,
       -- rows-type items carry a numeric _k (requirement ids derive from it);
       -- list-type items (plain strings) fall back to their position
       coalesce((case when jsonb_typeof(item) = 'object' then nullif(item->>'_k','') end)::integer,
                ord::integer),
       case when jsonb_typeof(item) = 'object' then item - '_k'
            else jsonb_build_object('text', item#>>'{}') end,
       ord::double precision, 'v1 import', updated_at
from rows_src
where not (jsonb_typeof(item) = 'string' and coalesce(trim(item#>>'{}'), '') = '')
on conflict (project_id, field_id, k) do nothing;

-- ----------------------------------------------------------------------------
-- 3) Versions - metadata + per-version snapshot + build tags + doc status
-- ----------------------------------------------------------------------------
with vmeta as (
  select substring(kv.key from '^rm:proj:([^:]+):versions$') as project_id,
         kv.org_id, v.value as v
  from kv, jsonb_array_elements(kv.value) as v
  where kv.key ~ '^rm:proj:[^:]+:versions$' and jsonb_typeof(kv.value) = 'array'
),
vsnap as (
  select substring(kv.key from '^rm:proj:([^:]+):ver:[0-9]+$') as project_id,
         substring(kv.key from ':ver:([0-9]+)$')::integer as seq,
         kv.org_id, kv.value as snap
  from kv where kv.key ~ '^rm:proj:[^:]+:ver:[0-9]+$'
),
vbuilds as (
  select substring(kv.key from '^rm:proj:([^:]+):builds$') as project_id,
         kv.org_id, kv.value as builds
  from kv where kv.key ~ '^rm:proj:[^:]+:builds$' and jsonb_typeof(kv.value) = 'object'
)
insert into versions (project_id, seq, label, status, note, author_name, build, snapshot, created_at)
select m.project_id,
       (m.v->>'seq')::integer,
       coalesce(nullif(m.v->>'label', ''), (m.v->>'seq')),
       'draft',
       coalesce(m.v->>'note', ''),
       coalesce(m.v->>'author', ''),
       coalesce(b.builds->>((m.v->>'seq')), ''),
       jsonb_build_object('answers', coalesce(s.snap->'answersSnapshot', '{}'::jsonb),
                          'sections', coalesce(s.snap->'sections', '{}'::jsonb)),
       coalesce(nullif(m.v->>'createdAt', '')::timestamptz, now())
from vmeta m
join projects p on p.id = m.project_id and p.org_id = m.org_id
left join vsnap s on s.project_id = m.project_id and s.seq = (m.v->>'seq')::integer and s.org_id = m.org_id
left join vbuilds b on b.project_id = m.project_id and b.org_id = m.org_id
where coalesce(m.v->>'seq', '') ~ '^[0-9]+$'
on conflict (project_id, seq) do nothing;

-- Latest version inherits the worksheet's document status (Draft / In Review / Approved)
update versions v set status = c.status
from (
  select pf.project_id,
         case lower(coalesce(pf.value#>>'{}', ''))
           when 'in review' then 'in_review'
           when 'approved' then 'approved'
           else 'draft' end as status,
         (select max(seq) from versions vv where vv.project_id = pf.project_id) as maxseq
  from project_fields pf where pf.field_id = 'ctrl_status'
) c
where v.project_id = c.project_id and v.seq = c.maxseq and c.maxseq is not null
  and v.status = 'draft' and c.status <> 'draft';

-- ----------------------------------------------------------------------------
-- 4) Input requests (v1 noteReqs) - adopting legacy share tokens so old
--    #note/... links continue to resolve
-- ----------------------------------------------------------------------------
with reqs as (
  select substring(kv.key from '^rm:proj:([^:]+):noteReqs$') as project_id,
         kv.org_id, r.value as r
  from kv, jsonb_array_elements(kv.value) as r
  where kv.key ~ '^rm:proj:[^:]+:noteReqs$' and jsonb_typeof(kv.value) = 'array'
)
insert into input_requests (legacy_id, org_id, project_id, title, prompt, author_name,
                            due, status, token, created_at)
select r.r->>'id', r.org_id, r.project_id,
       coalesce(nullif(r.r->>'title', ''), 'Request for input'),
       coalesce(r.r->>'prompt', ''),
       coalesce(r.r->>'by', ''),
       nullif(r.r->>'due', '')::date,
       case when lower(coalesce(r.r->>'status', '')) = 'closed' then 'closed' else 'open' end,
       coalesce((select s.token from shares s
                  where s.project_id = r.project_id and s.kind = 'note'
                    and s.payload->'request'->>'title' = r.r->>'title'
                  order by s.updated_at desc limit 1),
                url_token()),
       coalesce(nullif(r.r->>'at', '')::timestamptz, now())
from reqs r
join projects p on p.id = r.project_id and p.org_id = r.org_id
where coalesce(r.r->>'id', '') <> ''
on conflict (legacy_id) do nothing;

-- Request threads (team prompts and any inline SME lines) → messages
with reqs as (
  select substring(kv.key from '^rm:proj:([^:]+):noteReqs$') as project_id,
         kv.org_id, r.value as r
  from kv, jsonb_array_elements(kv.value) as r
  where kv.key ~ '^rm:proj:[^:]+:noteReqs$' and jsonb_typeof(kv.value) = 'array'
)
insert into messages (id, org_id, parent_kind, parent_id, author_kind, author_name, body, created_at)
select gen_random_uuid(), r.org_id, 'request', ir.id,
       case when t.value->>'from' = 'team' then 'team' else 'sme' end,
       coalesce(nullif(t.value->>'name', ''), case when t.value->>'from' = 'team' then 'Team' else 'Reviewer' end),
       coalesce(t.value->>'text', ''),
       coalesce(nullif(t.value->>'at', '')::timestamptz, now())
from reqs r
join input_requests ir on ir.legacy_id = r.r->>'id'
cross join lateral jsonb_array_elements(coalesce(r.r->'thread', '[]'::jsonb)) as t(value)
where coalesce(t.value->>'text', '') <> ''
  and not exists (select 1 from messages m where m.parent_kind = 'request' and m.parent_id = ir.id);

-- ----------------------------------------------------------------------------
-- 5) Partner notes (authoritative for partner threads) → comms + messages
-- ----------------------------------------------------------------------------
insert into comms (legacy_id, org_id, project_id, origin, partner_id, author_name,
                   title, body, status, created_at)
select pn.id::text, pn.org_id, pn.project_id, 'partner', pn.partner_id,
       coalesce(nullif(trim(pn.name), ''), 'Partner'),
       'Partner note', pn.text, 'new', pn.created_at
from partner_notes pn
join projects p on p.id = pn.project_id and p.org_id = pn.org_id
on conflict (legacy_id) do nothing;

insert into messages (org_id, parent_kind, parent_id, author_kind, author_name, body, created_at)
select pn.org_id, 'comm', c.id,
       case when rp.value->>'from' = 'partner' then 'partner' else 'team' end,
       coalesce(nullif(rp.value->>'name', ''), 'Team'),
       coalesce(rp.value->>'text', ''),
       coalesce(nullif(rp.value->>'at', '')::timestamptz, now())
from partner_notes pn
join comms c on c.legacy_id = pn.id::text
cross join lateral jsonb_array_elements(coalesce(pn.replies, '[]'::jsonb)) as rp(value)
where coalesce(rp.value->>'text', '') <> ''
  and not exists (select 1 from messages m where m.parent_kind = 'comm' and m.parent_id = c.id);

-- ----------------------------------------------------------------------------
-- 6) kv feedback arrays → comms (+ internal notes → messages)
-- ----------------------------------------------------------------------------
create or replace function _v1_uni_status(p text)
returns text language sql immutable as $$
  select case lower(coalesce(p, ''))
    when 'triaged' then 'in_review' when 'in progress' then 'in_review' when 'in review' then 'in_review'
    when 'resolved' then 'actioned' when 'decided' then 'actioned' when 'kept' then 'actioned' when 'actioned' then 'actioned'
    when 'won''t fix' then 'closed' when 'duplicate' then 'closed' when 'archived' then 'closed'
    when 'parked' then 'closed' when 'closed' then 'closed'
    else 'new' end;
$$;

with fb as (
  select substring(kv.key from '^rm:proj:([^:]+):feedback$') as project_id,
         kv.org_id, f.value as f
  from kv, jsonb_array_elements(kv.value) as f
  where kv.key ~ '^rm:proj:[^:]+:feedback$' and jsonb_typeof(kv.value) = 'array'
)
insert into comms (legacy_id, org_id, project_id, origin, version_seq, author_name, author_email,
                   title, body, steps, fb_type, severity, verdict, status, assignee, promoted_to, created_at)
select f.f->>'id', f.org_id, f.project_id,
       case when coalesce(f.f->>'origin', case when f.f->>'type' = 'Review' then 'brief' else 'pilot' end) = 'brief'
            then 'brief' else 'app' end,
       nullif(f.f->>'seq', '')::integer,
       coalesce(f.f->>'name', ''), coalesce(f.f->>'email', ''),
       coalesce(nullif(f.f->>'title', ''), '(untitled)'),
       coalesce(f.f->>'detail', ''), coalesce(f.f->>'steps', ''),
       coalesce(f.f->>'type', ''), coalesce(f.f->>'severity', ''), coalesce(f.f->>'verdict', ''),
       _v1_uni_status(f.f->>'status'),
       coalesce(f.f->>'assignee', ''),
       case when (f.f->>'promotedDisc') = 'true' then 'discovery' else '' end,
       coalesce(nullif(f.f->>'at', '')::timestamptz, now())
from fb f
join projects p on p.id = f.project_id and p.org_id = f.org_id
where coalesce(f.f->>'id', '') <> ''
on conflict (legacy_id) do nothing;

with fb as (
  select substring(kv.key from '^rm:proj:([^:]+):feedback$') as project_id,
         kv.org_id, f.value as f
  from kv, jsonb_array_elements(kv.value) as f
  where kv.key ~ '^rm:proj:[^:]+:feedback$' and jsonb_typeof(kv.value) = 'array'
)
insert into messages (org_id, parent_kind, parent_id, author_kind, author_name, body, created_at)
select f.org_id, 'comm', c.id, 'team',
       coalesce(nullif(n.value->>'author', ''), 'Team'),
       coalesce(n.value->>'text', ''),
       coalesce(nullif(n.value->>'at', '')::timestamptz, now())
from fb f
join comms c on c.legacy_id = f.f->>'id'
cross join lateral jsonb_array_elements(coalesce(f.f->'notes', '[]'::jsonb)) as n(value)
where coalesce(n.value->>'text', '') <> ''
  and not exists (select 1 from messages m where m.parent_kind = 'comm' and m.parent_id = c.id);

-- ----------------------------------------------------------------------------
-- 7) kv notes arrays → comms (skipping partner notes already migrated in 5)
-- ----------------------------------------------------------------------------
with nt as (
  select substring(kv.key from '^rm:proj:([^:]+):notes$') as project_id,
         kv.org_id, n.value as n
  from kv, jsonb_array_elements(kv.value) as n
  where kv.key ~ '^rm:proj:[^:]+:notes$' and jsonb_typeof(kv.value) = 'array'
)
insert into comms (legacy_id, org_id, project_id, origin, request_id, author_name,
                   title, body, status, promoted_to, created_at)
select n.n->>'id', n.org_id, n.project_id,
       case coalesce(n.n->>'source', 'Me')
         when 'Me' then 'team' when 'Meeting' then 'meeting'
         when 'Partner' then 'partner' else 'sme' end,
       (select ir.id from input_requests ir where ir.legacy_id = n.n->>'reqId'),
       coalesce(nullif(n.n->>'by', ''), case when coalesce(n.n->>'source','Me') = 'Me' then 'Team' else '' end),
       coalesce(nullif(n.n->>'reqTitle', ''), case when coalesce(n.n->>'source','Me') = 'Me' then 'Note' else 'Note' end),
       coalesce(n.n->>'text', ''),
       case coalesce(n.n->>'status', 'Kept')
         when 'Inbox' then 'new' when 'Archived' then 'closed' else 'actioned' end,
       case when coalesce(n.n->>'promotedReq', '') <> '' then n.n->>'promotedReq'
            when (n.n->>'promotedDisc') = 'true' then 'discovery' else '' end,
       coalesce(nullif(n.n->>'at', '')::timestamptz, now())
from nt n
join projects p on p.id = n.project_id and p.org_id = n.org_id
where coalesce(n.n->>'id', '') <> ''
on conflict (legacy_id) do nothing;

with nt as (
  select substring(kv.key from '^rm:proj:([^:]+):notes$') as project_id,
         kv.org_id, n.value as n
  from kv, jsonb_array_elements(kv.value) as n
  where kv.key ~ '^rm:proj:[^:]+:notes$' and jsonb_typeof(kv.value) = 'array'
)
insert into messages (org_id, parent_kind, parent_id, author_kind, author_name, body, created_at)
select n.org_id, 'comm', c.id,
       case when c.origin = 'partner' and coalesce(rp.value->>'author', '') = c.author_name
            then 'partner' else 'team' end,
       coalesce(nullif(rp.value->>'author', ''), 'Team'),
       coalesce(rp.value->>'text', ''),
       coalesce(nullif(rp.value->>'at', '')::timestamptz, now())
from nt n
join comms c on c.legacy_id = n.n->>'id'
cross join lateral jsonb_array_elements(coalesce(n.n->'replies', '[]'::jsonb)) as rp(value)
where coalesce(rp.value->>'text', '') <> ''
  and not exists (select 1 from messages m where m.parent_kind = 'comm' and m.parent_id = c.id);

-- ----------------------------------------------------------------------------
-- 8) Submissions that never made it into kv (received while no manager was
--    online) → comms
-- ----------------------------------------------------------------------------
-- The project is taken from the SHARE the submission was made against
-- (s.project_id), never from the submission's own payload->>'project_id':
-- that field was written by an unauthenticated v1 client and could name a
-- different project. Trusting it risked landing feedback on the wrong thread.
insert into comms (legacy_id, org_id, project_id, origin, version_seq, author_name, author_email,
                   title, body, steps, fb_type, severity, verdict, status, created_at)
select sub.id::text, s.org_id, s.project_id,
       case sub.kind when 'brief' then 'brief' when 'pilot' then 'app' else 'sme' end,
       nullif(sub.payload->'record'->>'seq', '')::integer,
       coalesce(sub.payload->'record'->>'name', coalesce(sub.payload->'record'->>'by', '')),
       coalesce(sub.payload->'record'->>'email', ''),
       coalesce(nullif(sub.payload->'record'->>'title', ''),
                nullif(sub.payload->'record'->>'reqTitle', ''), '(untitled)'),
       coalesce(sub.payload->'record'->>'detail', coalesce(sub.payload->'record'->>'text', '')),
       coalesce(sub.payload->'record'->>'steps', ''),
       coalesce(sub.payload->'record'->>'type', ''),
       coalesce(sub.payload->'record'->>'severity', ''),
       coalesce(sub.payload->'record'->>'verdict', ''),
       'new',
       coalesce(nullif(sub.payload->'record'->>'at', '')::timestamptz, sub.created_at)
from submissions sub
join shares s on s.token = sub.token
join projects p on p.id = s.project_id and p.org_id = s.org_id
where s.org_id is not null and coalesce(s.project_id, '') <> ''
on conflict (legacy_id) do nothing;

-- ----------------------------------------------------------------------------
-- 9) Discovery log → discovery_entries
-- ----------------------------------------------------------------------------
with d as (
  select substring(kv.key from '^rm:proj:([^:]+):discovery$') as project_id,
         kv.org_id, e.value as e
  from kv, jsonb_array_elements(kv.value) as e
  where kv.key ~ '^rm:proj:[^:]+:discovery$' and jsonb_typeof(kv.value) = 'array'
)
insert into discovery_entries (legacy_id, org_id, project_id, takeaway, context, heard, decided,
                               open_questions, notes, tags, who, source, links, author_name, created_at)
select d.e->>'id', d.org_id, d.project_id,
       coalesce(d.e->>'takeaway', ''), coalesce(d.e->>'context', ''), coalesce(d.e->>'heard', ''),
       coalesce(d.e->>'decided', ''), coalesce(d.e->>'open', ''), coalesce(d.e->>'notes', ''),
       coalesce(d.e->>'tags', ''), coalesce(d.e->>'who', ''), coalesce(d.e->>'source', ''),
       coalesce(d.e->>'links', ''), coalesce(d.e->>'author', ''),
       coalesce(nullif(d.e->>'at', '')::timestamptz, now())
from d
join projects p on p.id = d.project_id and p.org_id = d.org_id
where coalesce(d.e->>'id', '') <> ''
on conflict (legacy_id) do nothing;

drop function if exists _v1_uni_status(text);

commit;

-- Post-run: execute verify.sql to compare v1 and v2 counts side by side.
