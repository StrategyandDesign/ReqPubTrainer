-- Seed a realistic v1 dataset: one org, a manager, a partner (with a linked
-- account), kv blobs covering every key family, partner notes with replies,
-- legacy shares (hash tokens), and submissions (one already folded into kv,
-- one never seen by a manager).

insert into auth.users(id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'micah@fathers.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'partner@client.com'),
  ('11111111-0000-0000-0000-000000000008', 'viewer@fathers.com'),
  ('22222222-0000-0000-0000-000000000009', 'rival@elsewhere.com');

insert into orgs(id, name, created_by) values
  ('cccccccc-0000-0000-0000-000000000003', 'Collection Ventures', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-00000000000a', 'Rival Org', '22222222-0000-0000-0000-000000000009');

insert into org_members(org_id, user_id, email, role) values
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'micah@fathers.com', 'manager'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000008', 'viewer@fathers.com', 'viewer'),
  ('33333333-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-000000000009', 'rival@elsewhere.com', 'manager');

-- Rival org's own project (used to prove cross-org fencing)
insert into kv(org_id, key, value) values
('33333333-0000-0000-0000-00000000000a', 'rm:index',
 '[{"id":"p2","name":"RivalProduct","createdAt":"2026-06-01T10:00:00Z","updatedAt":"2026-06-28T10:00:00Z","latestSeq":0,"latestLabel":"Draft"}]');

insert into partners(id, org_id, user_id, email, name)
values ('dddddddd-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003',
        'bbbbbbbb-0000-0000-0000-000000000002', 'partner@client.com', 'Pat Partner');
insert into partner_access(partner_id, project_id)
values ('dddddddd-0000-0000-0000-000000000004', 'p1');

-- kv blobs (org-scoped, exactly the shapes v1 wrote)
insert into kv(org_id, key, value) values
('cccccccc-0000-0000-0000-000000000003', 'rm:index',
 '[{"id":"p1","name":"RecordMade","createdAt":"2026-06-01T10:00:00Z","updatedAt":"2026-06-28T10:00:00Z","latestSeq":2,"latestLabel":"1.1"}]'),

('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:answers',
 '{"ctrl_product":"RecordMade","ctrl_org":"Collection Ventures","ctrl_status":"In Review",
   "ov_vision":"A record for every family","ov_goals":["Goal one","","Goal two"],
   "staged":"Yes",
   "fr":[{"_k":1,"stmt":"System records a session","fit":"Recorded within 2s. Test.","pri":"Must","comp":""},
         {"_k":3,"stmt":"System exports a transcript","fit":"","pri":"Should","comp":""}],
   "__k_fr":3,
   "ctrl_approvers":[{"_k":1,"role":"Product","name":"Micah"}],
   "__k_ctrl_approvers":1}'),

('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:versions',
 '[{"seq":1,"label":"1.0","createdAt":"2026-06-10T10:00:00Z","author":"Micah","note":"Initial baseline"},
   {"seq":2,"label":"1.1","createdAt":"2026-06-20T10:00:00Z","author":"Micah","note":"Added FR-003"}]'),

('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:ver:1',
 '{"answersSnapshot":{"ctrl_product":"RecordMade","fr":[{"_k":1,"stmt":"System records a session","fit":"Recorded within 2s. Test.","pri":"Must"}]},
   "sections":{"overview":"## 1. Overview v1"}}'),
('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:ver:2',
 '{"answersSnapshot":{"ctrl_product":"RecordMade","fr":[{"_k":1,"stmt":"System records a session","fit":"Recorded within 2s. Test.","pri":"Must"},{"_k":3,"stmt":"System exports a transcript","pri":"Should"}]},
   "sections":{"overview":"## 1. Overview v2"}}'),

('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:builds', '{"2":"0.9.4"}'),

('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:feedback',
 '[{"id":"fb1","at":"2026-06-21T10:00:00Z","name":"Sam Tester","email":"sam@x.com","title":"Recorder crashes on stop",
    "detail":"Crashes every time","steps":"1. record 2. stop","type":"Bug","severity":"Major","status":"Triaged",
    "seq":2,"label":"1.1","origin":"pilot","assignee":"Lee",
    "notes":[{"author":"Lee","at":"2026-06-21T11:00:00Z","text":"Reproduced, fixing"}]},
   {"id":"eeeeeeee-0000-0000-0000-000000000005","at":"2026-06-22T10:00:00Z","name":"Ria Reviewer","title":"PRD review: Needs changes",
    "detail":"Section 3 is thin","type":"Review","verdict":"Needs changes","status":"New","seq":2,"label":"1.1","origin":"brief","notes":[]}]'),

('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:notes',
 '[{"id":"n1","at":"2026-06-23T10:00:00Z","text":"SMEs want offline mode","source":"SME","by":"Dr X","status":"Inbox",
    "replies":[{"author":"Team","at":"2026-06-23T11:00:00Z","text":"Noted, scoping it"}]},
   {"id":"ffffffff-0000-0000-0000-000000000006","at":"2026-06-24T10:00:00Z","text":"Clients ask about pricing","source":"Partner","by":"Pat Partner","status":"Inbox","replies":[]}]'),

('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:noteReqs',
 '[{"id":"r1","title":"Kickoff input","prompt":"What are the must-haves?","at":"2026-06-05T10:00:00Z","by":"Micah","status":"Open","due":"2026-07-15",
    "thread":[{"from":"team","name":"Micah","text":"Please focus on safeguarding","at":"2026-06-06T10:00:00Z"}]}]'),

('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:discovery',
 '[{"id":"d1","at":"2026-06-02T10:00:00Z","takeaway":"Fathers want privacy first","notes":"From 4 interviews","tags":"privacy,trust","who":"Cohort A","source":"Interviews","author":"Micah"}]'),

('cccccccc-0000-0000-0000-000000000003', 'rm:proj:p1:discExport', 'true');

-- partner_notes (authoritative thread source; ffffffff… also appears in kv notes → must dedupe)
insert into partner_notes(id, org_id, project_id, partner_id, name, text, created_at, replies) values
('ffffffff-0000-0000-0000-000000000006', 'cccccccc-0000-0000-0000-000000000003', 'p1',
 'dddddddd-0000-0000-0000-000000000004', 'Pat Partner', 'Clients ask about pricing', '2026-06-24T10:00:00Z',
 '[{"from":"team","name":"Team","text":"Pricing page ships with v1.2","at":"2026-06-24T12:00:00Z"},
   {"from":"partner","name":"Pat Partner","text":"Great, will relay","at":"2026-06-24T13:00:00Z"}]');

-- legacy shares (v1 hash tokens) - brief/pilot for v2 links, note for the request
insert into shares(token, org_id, project_id, version_seq, kind, payload) values
('legacybrief2', 'cccccccc-0000-0000-0000-000000000003', 'p1', 2, 'brief',
 '{"product":"RecordMade","label":"1.1","answers":{"ov_vision":"A record for every family"}}'),
('legacypilot2', 'cccccccc-0000-0000-0000-000000000003', 'p1', 2, 'pilot',
 '{"product":"RecordMade","label":"1.1","build":"0.9.4","answers":{"components":[]}}'),
('legacynote1', 'cccccccc-0000-0000-0000-000000000003', 'p1', 0, 'note',
 '{"product":"RecordMade","request":{"title":"Kickoff input","prompt":"What are the must-haves?","thread":[]}}');

-- submissions: eeeeeeee… was already folded into kv feedback (dedupe);
-- 99999999… arrived while no manager was online (must be migrated)
insert into submissions(id, token, kind, payload, created_at) values
('eeeeeeee-0000-0000-0000-000000000005', 'legacybrief2', 'brief',
 '{"project_id":"p1","record":{"id":"eeeeeeee-0000-0000-0000-000000000005","name":"Ria Reviewer","title":"PRD review: Needs changes","detail":"Section 3 is thin","type":"Review","verdict":"Needs changes","seq":2,"at":"2026-06-22T10:00:00Z"}}',
 '2026-06-22T10:00:00Z'),
('99999999-0000-0000-0000-000000000007', 'legacypilot2', 'pilot',
 '{"project_id":"p1","record":{"id":"99999999-0000-0000-0000-000000000007","name":"Quiet Tester","title":"Export button hidden on mobile","detail":"Cannot find export","type":"Bug","severity":"Minor","seq":2,"at":"2026-06-25T10:00:00Z"}}',
 '2026-06-25T10:00:00Z');
