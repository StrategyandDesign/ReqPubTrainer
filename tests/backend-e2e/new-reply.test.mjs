/* Team-level "new reply" flag: an external post/reply flags the thread
   (last_ext_at), any team member opening it clears it for everyone
   (team_seen_at via comm_seen), a team note never flags, the empty SME shell
   never flags, and a later reply re-flags. Run:
   node tests/backend-e2e/new-reply.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-nr-' + process.pid), user: 'postgres', password: 'pw', port: 55471, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55471, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
// A thread is unseen while an external post/reply is newer than the team's last look.
const unseen = async (id) => (await one(
  `select (last_ext_at is not null and (team_seen_at is null or team_seen_at < last_ext_at)) u from comms where id=$1`, [id])).u;

const MGR = '11111111-0000-0000-0000-0000000000d1';
const VIEWER = '22222222-0000-0000-0000-0000000000d2';   // team member, viewer role
const RIVAL = '33333333-0000-0000-0000-0000000000d3';    // outside the org
const ORG = '44444444-0000-0000-0000-0000000000d4';
const RORG = '55555555-0000-0000-0000-0000000000d5';

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));

  await run(`insert into auth.users(id,email) values ('${MGR}','m@cv.co'),('${VIEWER}','v@cv.co'),('${RIVAL}','r@other.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}'),('${RORG}','Rival','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','m@cv.co','manager'),('${ORG}','${VIEWER}','v@cv.co','viewer'),('${RORG}','${RIVAL}','r@other.co','manager')`);
  await run(`insert into projects(id,org_id,name) values ('p1','${ORG}','RecordMade')`);

  // Partner note (external, has content) → flags the thread.
  const partnerNote = (await one(`insert into comms(org_id,project_id,origin,author_name,body) values ('${ORG}','p1','partner','Jeremy','Scope question') returning id`)).id;
  check('an external post with content flags the thread', await unseen(partnerNote) === true);

  // Empty SME workspace shell (no body/verdict/steps) → does NOT flag.
  const shell = (await one(`insert into comms(org_id,project_id,origin,author_name,body,title) values ('${ORG}','p1','sme','SME','','SME review workspace') returning id`)).id;
  check('the empty SME workspace shell does not flag', await unseen(shell) === false);

  // Team note → never flags.
  const teamNote = (await one(`insert into comms(org_id,project_id,origin,author_name,body) values ('${ORG}','p1','team','Micah','Internal note') returning id`)).id;
  check('a team note never flags', await unseen(teamNote) === false);

  // A team member opening the partner note clears it for the whole team.
  await sleep(5);
  await asUser(MGR);
  check('a manager can mark a thread seen', (await one(`select comm_seen('${partnerNote}') ok`)).ok === true);
  check('opening the thread clears the flag for the team', await unseen(partnerNote) === false);

  // An SME reply on that same thread re-flags it.
  await sleep(5);
  await run(`insert into messages(org_id,parent_kind,parent_id,author_kind,body) values ('${ORG}','comm','${partnerNote}','sme','a new reply')`);
  check('a later external reply re-flags the thread', await unseen(partnerNote) === true);

  // A viewer (not a manager) can also clear it - "any team member".
  await sleep(5);
  await asUser(VIEWER);
  check('a viewer can clear the flag too', (await one(`select comm_seen('${partnerNote}') ok`)).ok === true);
  check('the reply is cleared for everyone once the viewer looked', await unseen(partnerNote) === false);

  // A team reply does NOT flag (only external replies do).
  await sleep(5);
  await run(`insert into messages(org_id,parent_kind,parent_id,author_kind,body) values ('${ORG}','comm','${partnerNote}','team','team answer')`);
  check('a team reply does not flag the thread', await unseen(partnerNote) === false);

  // Authorization: an outsider cannot mark a thread seen.
  await asUser(RIVAL);
  check('a rival-org user cannot mark the thread seen', (await one(`select comm_seen('${partnerNote}') ok`)).ok === false);

  // Personal read receipt is recorded alongside the team flag.
  const rm = await one(`select count(*)::int n from read_marks where comm_id='${partnerNote}'`);
  check('comm_seen also records per-user read receipts', rm.n >= 2, rm.n);
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message); console.error(e.stack);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\nnew-reply.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
