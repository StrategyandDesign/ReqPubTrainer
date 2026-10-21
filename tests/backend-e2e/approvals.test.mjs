/* In-app approval routing, and (v2.28.1) the decisions advance the version
   by themselves: first approval moves a draft to in_review, the last one to
   approved, a changes request to changes_requested, and reopening a decision
   on an approved version drops it to in_review. A slot assigned to a team
   member can be self-approved by that member (and only them or a manager);
   the waiting-on-you feed includes drafts; the approve gate holds in both
   directions. Run: node tests/backend-e2e/approvals.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-appr-' + process.pid), user: 'postgres', password: 'pw', port: 55467, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55467, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const rows = async (q, a) => (await db.query(q, a)).rows;
const run = (q) => db.query(q);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000a1';
const APPR = '22222222-0000-0000-0000-0000000000a2';   // team member, viewer, assigned approver
const RIVAL = '33333333-0000-0000-0000-0000000000a3';  // manager of another org, no access
const ORG = '44444444-0000-0000-0000-0000000000a4';
const RORG = '55555555-0000-0000-0000-0000000000a5';

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  // Prove the standalone migration is idempotent on top of the base schema.
  await run(sql(rel('../../supabase/migrations/0002_approver_assignment.sql')));
  await run(sql(rel('../../supabase/migrations/0001_approval_advance.sql')));
  await run(sql(rel('../../supabase/migrations/0030_record_conformance.sql')));   // v3.1: the shipped state sits on top of the replayed stack

  await run(`insert into auth.users(id,email) values
    ('${MGR}','mgr@collection.co'),('${APPR}','erik@collection.co'),('${RIVAL}','rival@other.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}'),('${RORG}','Rival Co','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@collection.co','manager'),
    ('${ORG}','${APPR}','erik@collection.co','viewer'),
    ('${RORG}','${RIVAL}','rival@other.co','manager')`);
  await run(`insert into user_profiles(user_id,display_name) values ('${APPR}','Erik Lindqvist')`);
  await run(`insert into projects(id,org_id,name) values ('recordmade','${ORG}','RecordMade')`);
  const V = (await one(`insert into versions(project_id,seq,label,status,snapshot) values ('recordmade',1,'1.2','draft','{}') returning id`)).id;
  // One slot assigned to a teammate, one manual (name only).
  const selfSlot = (await one(`insert into version_approvals(version_id,approver_role,approver_name,approver_user_id) values ('${V}','Engineering Lead','Erik','${APPR}') returning id`)).id;
  const manualSlot = (await one(`insert into version_approvals(version_id,approver_role,approver_name) values ('${V}','Sponsor','External Sponsor') returning id`)).id;

  // The provenance trigger forces a fresh slot to 'pending' regardless of insert.
  check('new approver slots start pending', (await one(`select bool_and(status='pending') p from version_approvals where version_id='${V}'`)).p === true);

  // An assignment on a DRAFT is already waiting on the assignee: their click
  // alone will advance the version, so the flag cannot wait for a ceremony.
  await asUser(APPR);
  const draftFeed = await rows(`select * from my_open_approvals()`);
  check('the feed shows a draft-version assignment', draftFeed.length === 1, draftFeed);
  check('the item resolves the project name', draftFeed[0] && draftFeed[0].project_name === 'RecordMade', draftFeed[0]);

  // Send for review remains as the explicit kickoff.
  await asUser(MGR);
  check('manager can still send for review explicitly', (await one(`select version_set_status('${V}','in_review') r`)).r.ok === true);
  check('a non-assigned manager has an empty feed', (await rows(`select * from my_open_approvals()`)).length === 0);

  // Authorization on decisions, now with the jsonb contract.
  await asUser(RIVAL);
  check('an outsider cannot decide any slot', (await one(`select approval_decide('${selfSlot}','approved') r`)).r.error === 'forbidden');
  await asUser(APPR);
  check('the assignee cannot decide someone else\u2019s (manual) slot', (await one(`select approval_decide('${manualSlot}','approved') r`)).r.error === 'forbidden');
  const selfR = (await one(`select approval_decide('${selfSlot}','approved') r`)).r;
  check('the assignee CAN approve their own slot', selfR.ok === true, selfR);
  check('with a slot still pending the version stays in review', selfR.version_status === 'in_review', selfR);
  const decided = await one(`select status, decided_by from version_approvals where id='${selfSlot}'`);
  check('their sign-off is recorded as approved', decided.status === 'approved', decided.status);
  check('provenance attributes the sign-off to the assignee, not a manager', decided.decided_by === APPR, decided.decided_by);
  check('feed clears once they have signed off', (await rows(`select * from my_open_approvals()`)).length === 0);

  // The gate still holds while the manual slot is pending.
  await asUser(MGR);
  check('version cannot be marked approved while the manual slot is pending',
    (await one(`select version_set_status('${V}','approved') r`)).r.error === 'approvals_pending');

  // v3.1: a slot with no assigned teammate is the client's. A manager cannot
  // approve it, by RPC or by direct write; the client's own e-signature can,
  // and that signature approves the version by itself - no second ceremony.
  const lastR = (await one(`select approval_decide('${manualSlot}','approved') r`)).r;
  check('a manager cannot approve the client slot: esign_required', lastR.ok === false && lastR.error === 'esign_required', lastR);
  const direct = await db.query(`update version_approvals set status='approved' where id='${manualSlot}'`).then(() => ({}), (e) => ({ error: e.message }));
  check('a direct write to the client slot is refused by the provenance trigger', !!direct.error && /esign_required/.test(direct.error), direct);
  check('a manager can still request changes on the client slot',
    (await one(`select approval_decide('${manualSlot}','changes_requested','Needs the Q3 figure') r`)).r.ok === true);
  check('and reopen it', (await one(`select approval_decide('${manualSlot}','pending') r`)).r.ok === true);
  check('reopening leaves the version at changes requested until a manager sends it for review',
    (await one(`select status from versions where id='${V}'`)).status === 'changes_requested');
  check('the manager sends it for review again', (await one(`select version_set_status('${V}','in_review') r`)).r.ok === true);
  const sr = (await one(`select sign_request_create('${V}','sponsor@client.co','External Sponsor','Sponsor','fp-1') r`)).r;
  check('the manager opens a signature request for the slot holder', sr.ok === true && !!sr.token, sr);
  await asUser('');
  const signed = (await one(`select sign_request_sign('${sr.token}','External Sponsor','UA') r`)).r;
  check('the signature lands on the slot held for the signer, not on a new row', signed.ok === true && signed.approvalId === manualSlot, signed);
  check('the slot is approved and linked to the signature record',
    (await one(`select status, sign_request_id from version_approvals where id='${manualSlot}'`)).status === 'approved');
  check('the signature reports the version approved', signed.versionStatus === 'approved', signed);
  await asUser(MGR);
  check('the version row is approved', (await one(`select status from versions where id='${V}'`)).status === 'approved');
  check('the auto transition is on the activity log',
    (await one(`select count(*)::int c from activity where entity_id='${V}' and action='version.status' and meta->>'via' in ('approval','esign')`)).c >= 1);

  // The direct path: one approver on a DRAFT, one click, approved. This is
  // the flow the product promises the designated approver.
  const V2 = (await one(`insert into versions(project_id,seq,label,status,snapshot) values ('recordmade',2,'1.3','draft','{}') returning id`)).id;
  const soloSlot = (await one(`insert into version_approvals(version_id,approver_role,approver_name,approver_user_id) values ('${V2}','Engineering Lead','Erik','${APPR}') returning id`)).id;
  await asUser(APPR);
  const soloR = (await one(`select approval_decide('${soloSlot}','approved') r`)).r;
  check('a sole approver approving a DRAFT approves the version in one click', soloR.version_status === 'approved', soloR);
  check('the draft-to-approved version row agrees', (await one(`select status from versions where id='${V2}'`)).status === 'approved');

  // Mixed decisions: first approval lifts a draft into review; a changes
  // request flips the version; approving it after all others completes it;
  // reopening a decision on an approved version drops it back to review.
  const V3 = (await one(`insert into versions(project_id,seq,label,status,snapshot) values ('recordmade',3,'1.4','draft','{}') returning id`)).id;
  const s1 = (await one(`insert into version_approvals(version_id,approver_role,approver_name,approver_user_id) values ('${V3}','Engineering Lead','Erik','${APPR}') returning id`)).id;
  // v3.1: the second slot is assigned to the manager so a manager may decide
  // it; an unassigned slot would take the client's e-signature instead.
  const s2 = (await one(`insert into version_approvals(version_id,approver_role,approver_name,approver_user_id) values ('${V3}','Sponsor','Mia','${MGR}') returning id`)).id;
  await asUser(APPR);
  check('the first approval moves a draft into review',
    (await one(`select approval_decide('${s1}','approved') r`)).r.version_status === 'in_review');
  await asUser(MGR);
  check('a changes request moves the version to changes requested',
    (await one(`select approval_decide('${s2}','changes_requested','tighten scope') r`)).r.version_status === 'changes_requested');
  check('approving the reworked slot completes the version',
    (await one(`select approval_decide('${s2}','approved') r`)).r.version_status === 'approved');
  check('reopening a decision on an approved version drops it to review',
    (await one(`select approval_decide('${s2}','pending') r`)).r.version_status === 'in_review');
  check('the reopened slot is waiting again', (await one(`select status from version_approvals where id='${s2}'`)).status === 'pending');

  // Roster picker: members can read the named roster; outsiders cannot.
  await asUser(MGR);
  const roster = await rows(`select * from org_members_named('${ORG}') order by email`);
  check('roster returns both org members', roster.length === 2, roster.map((r) => r.email));
  check('roster carries display names for the picker', roster.some((r) => r.display_name === 'Erik Lindqvist'), roster);
  await asUser(RIVAL);
  check('a non-member gets nothing from the roster', (await rows(`select * from org_members_named('${ORG}')`)).length === 0);

} catch (e) {
  fail++; console.log('  ✗ threw: ' + (e && e.message)); console.log(e && e.stack);
} finally {
  console.log(`\napprovals.test: ${pass} passed, ${fail} failed`);
  await db.end(); await epg.stop();
  process.exit(fail ? 1 : 0);
}
