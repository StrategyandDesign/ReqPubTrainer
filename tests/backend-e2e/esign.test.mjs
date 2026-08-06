/* E-sign v1: a manager creates a token-keyed signature request on a version;
   the signer (accountless, via token) reads the exact stored snapshot, signs
   with a typed name, and the signature lands as a normal version_approvals
   row - decided, timestamped by the provenance trigger, linked both ways.
   Declines and revocations are terminal and logged; direct table writes are
   revoked; the approve gate accepts an e-signed slot like any other. Run:
   node tests/backend-e2e/esign.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-esign-' + process.pid), user: 'postgres', password: 'pw', port: 55471, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55471, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const rows = async (q, a) => (await db.query(q, a)).rows;
const run = (q) => db.query(q);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async (q) => { try { await db.query(q); return false; } catch { await db.query('rollback').catch(() => {}); return true; } };
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000e1';
const VIEW = '22222222-0000-0000-0000-0000000000e2';
const RIVAL = '33333333-0000-0000-0000-0000000000e3';
const ORG = '44444444-0000-0000-0000-0000000000e4';
const RORG = '55555555-0000-0000-0000-0000000000e5';

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  // The standalone live-DB migration must be idempotent on top of the schema.
  await run(sql(rel('../../supabase/migrations/0007_esign.sql')));
  await run(sql(rel('../../supabase/migrations/0007_esign.sql')));

  await run(`insert into auth.users(id,email) values
    ('${MGR}','mgr@collection.co'),('${VIEW}','viewer@collection.co'),('${RIVAL}','rival@other.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}'),('${RORG}','Rival Co','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@collection.co','manager'),
    ('${ORG}','${VIEW}','viewer@collection.co','viewer'),
    ('${RORG}','${RIVAL}','rival@other.co','manager')`);
  await run(`insert into projects(id,org_id,name,brand_label) values ('recordmade','${ORG}','RecordMade','Northwind')`);
  const V = (await one(`insert into versions(project_id,seq,label,status,snapshot) values
    ('recordmade',1,'1.2','draft','{"answers":{"ctrl_product":"RecordMade"}}') returning id`)).id;

  console.log('- authorization on create -');
  await asUser(VIEW);
  check('a viewer cannot create a signature request',
    (await one(`select sign_request_create('${V}','client@northwind.com','Dana','Sponsor','fp-abc') r`)).r.ok === false);
  await asUser(RIVAL);
  check('a manager of another org cannot create one',
    (await one(`select sign_request_create('${V}','client@northwind.com','Dana','Sponsor','fp-abc') r`)).r.ok === false);
  await asUser(MGR);
  check('an empty email is refused',
    (await one(`select sign_request_create('${V}','  ','Dana','Sponsor','fp-abc') r`)).r.error === 'email_required');
  const made = (await one(`select sign_request_create('${V}','client@northwind.com','Dana','Sponsor','fp-abc') r`)).r;
  check('a manager creates a request and gets a token', made.ok === true && typeof made.token === 'string' && made.token.length >= 20, made);
  check('the row starts pending with the fingerprint captured at send',
    (await one(`select status, doc_fingerprint from sign_requests where id='${made.id}'`)).doc_fingerprint === 'fp-abc');

  console.log('- the signer page context, by token, accountless -');
  await asUser('');
  const ctx = (await one(`select sign_request_context('${made.token}') c`)).c;
  check('context returns ok with the request state', ctx && ctx.ok === true && ctx.status === 'pending', ctx && ctx.status);
  check('context carries the exact stored snapshot', ctx.snapshot && ctx.snapshot.answers && ctx.snapshot.answers.ctrl_product === 'RecordMade');
  check('context carries version label, project, and branding', ctx.label === '1.2' && ctx.project === 'RecordMade' && ctx.brandLabel === 'Northwind');
  check('context carries the send-time fingerprint for browser verification', ctx.fingerprint === 'fp-abc');
  check('a wrong token yields nothing', (await one(`select sign_request_context('not-a-token') c`)).c === null);

  console.log('- signing: the approval row is the signature\u2019s landing -');
  await asUser(MGR);
  check('manager sends the version for review', (await one(`select version_set_status('${V}','in_review') r`)).r.ok === true);
  await asUser('');
  check('signing without a typed name is refused',
    (await one(`select sign_request_sign('${made.token}','  ','UA') r`)).r.error === 'name_required');
  const signed = (await one(`select sign_request_sign('${made.token}','Dana Whitfield','Mozilla/5.0 test') r`)).r;
  check('the signer signs with a typed name', signed.ok === true && !!signed.approvalId, signed);
  const appr = await one(`select * from version_approvals where id='${signed.approvalId}'`);
  check('the approval row is approved, named as typed, role carried',
    appr.status === 'approved' && appr.approver_name === 'Dana Whitfield' && appr.approver_role === 'Sponsor');
  check('the provenance trigger stamped the decision time; decided_by stays null for an accountless signer',
    appr.decided_at !== null && appr.decided_by === null);
  check('the approval row links back to the signature record', appr.sign_request_id === made.id);
  const req = await one(`select * from sign_requests where id='${made.id}'`);
  check('the signature record is signed, timestamped, linked, with evidence',
    req.status === 'signed' && req.signed_name === 'Dana Whitfield' && req.approval_id === signed.approvalId
    && req.signed_at !== null && req.evidence.ua === 'Mozilla/5.0 test' && req.evidence.channel === 'email_token');
  const again = (await one(`select sign_request_sign('${made.token}','Someone Else','UA2') r`)).r;
  check('signing twice is idempotent and keeps the first signature',
    again.ok === true && again.already === true && again.signedName === 'Dana Whitfield', again);
  await asUser(MGR);
  check('the approve gate accepts the e-signed slot like any other',
    (await one(`select version_set_status('${V}','approved') r`)).r.ok === true);

  console.log('- decline and revoke are terminal, honest states -');
  const V2 = (await one(`insert into versions(project_id,seq,label,status,snapshot) values
    ('recordmade',2,'1.3','draft','{"answers":{}}') returning id`)).id;
  const d = (await one(`select sign_request_create('${V2}','legal@northwind.com','','Legal','fp-2') r`)).r;
  await asUser('');
  check('a signer can decline with a reason',
    (await one(`select sign_request_decline('${d.token}','Scope changed since our call') r`)).r.ok === true);
  check('the decline reason is on the record',
    (await one(`select decline_reason from sign_requests where id='${d.id}'`)).decline_reason === 'Scope changed since our call');
  check('signing after a decline is refused',
    (await one(`select sign_request_sign('${d.token}','Legal Person','UA') r`)).r.error === 'declined');
  await asUser(MGR);
  const r3 = (await one(`select sign_request_create('${V2}','third@northwind.com','','Sponsor','fp-3') r`)).r;
  check('a manager can revoke a pending request', (await one(`select sign_request_revoke('${r3.id}') ok`)).ok === true);
  await asUser('');
  check('a revoked token yields no context', (await one(`select sign_request_context('${r3.token}') c`)).c === null);
  check('a revoked token cannot sign',
    (await one(`select sign_request_sign('${r3.token}','X','UA') r`)).r.error === 'invalid_link');
  await asUser(MGR);
  check('a signed request cannot be revoked', (await one(`select sign_request_revoke('${made.id}') ok`)).ok === false);

  console.log('- boundaries: direct writes are revoked; the trail is written -');
  await asUser(MGR); await run('set role authenticated');
  check('direct insert into sign_requests is refused even for a manager',
    await fails(`insert into sign_requests(org_id,project_id,version_id,token) values ('${ORG}','recordmade','${V}','forged-token')`));
  check('direct update of a signature record is refused',
    await fails(`update sign_requests set status='signed' where id='${d.id}'`));
  await run('reset role');
  const kinds = (await rows(`select action from activity where project_id='recordmade' and action like 'sign.%' order by created_at`)).map((x) => x.action);
  check('the activity trail carries every signature event',
    kinds.includes('sign.requested') && kinds.includes('sign.signed') && kinds.includes('sign.declined') && kinds.includes('sign.revoked'), kinds);
} catch (e) {
  fail++; console.log('  ✗ suite error → ' + (e && e.message));
} finally {
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
}
console.log(`\nesign.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
