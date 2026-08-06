/* Validates the attachments DB layer: attachment_add's guards (size, type,
   infected, thread, rate limit), the team/partner/SME authorization resolvers,
   RLS (team reads its org only), and audit logging. The Storage bytes and the
   scan itself live in the edge function / Supabase Storage and are exercised
   separately. Run: node tests/backend-e2e/attachments.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-attach-' + process.pid), user: 'postgres', password: 'pw', port: 55461, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55461, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q) => db.query(q);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000d1';
const PARTNER = '22222222-0000-0000-0000-0000000000d2';
const OUTSIDER = '99999999-0000-0000-0000-0000000000d9';
const ORG = '33333333-0000-0000-0000-0000000000d3';
const PDF = 'application/pdf';
const add = (proj, comm, kind, name, user, file, mime, size, path, scan) =>
  one(`select attachment_add($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) j`,
    [proj, comm, null, kind, name, user, file, mime, size, path, scan, '']);

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@collection.co'),('${PARTNER}','p@vendor.co'),('${OUTSIDER}','x@nope.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${ORG}','${MGR}','mgr@collection.co','manager')`);
  await run(`insert into projects(id,org_id,name) values ('fathering','${ORG}','Fathering Excellence Profile'),('other','${ORG}','Other PRD')`);
  // A seated SME (durable workspace thread) + a partner assigned to the project.
  const seat = await one(`insert into comms(org_id,project_id,origin,author_name,author_email,title,reply_token)
    values ('${ORG}','fathering','sme','Dr Ken','ken@fathers.com','SME review workspace','sme-tok-1') returning id`);
  const pid = (await one(`insert into partners(org_id,user_id,email,name) values ('${ORG}','${PARTNER}','p@vendor.co','Vendor Pat') returning id`)).id;
  await run(`insert into partner_access(partner_id,project_id) values ('${pid}','fathering')`);
  // A comm that belongs to a DIFFERENT project, to prove the thread check.
  const otherComm = await one(`insert into comms(org_id,project_id,origin,author_name,title) values ('${ORG}','other','team','Micah','note') returning id`);

  // --- attachment_add guards ---
  const okAdd = await add('fathering', seat.id, 'sme', 'Dr Ken', null, 'spec.pdf', PDF, 12345, 'o/fathering/a/spec.pdf', 'clean');
  check('clean attachment is accepted', okAdd.j.ok === true && !!okAdd.j.id, okAdd.j);
  const inf = await add('fathering', seat.id, 'sme', 'Dr Ken', null, 'evil.pdf', PDF, 999, 'o/fathering/b/evil.pdf', 'infected');
  check('infected attachment is rejected', inf.j.ok === false && inf.j.error === 'infected', inf.j);
  const big = await add('fathering', seat.id, 'sme', 'Dr Ken', null, 'huge.pdf', PDF, 26214401, 'o/fathering/c/huge.pdf', 'clean');
  check('oversize attachment is rejected', big.j.ok === false && big.j.error === 'bad_size', big.j);
  const badType = await add('fathering', seat.id, 'sme', 'Dr Ken', null, 'x.exe', 'application/x-msdownload', 10, 'o/fathering/d/x.exe', 'clean');
  check('disallowed type is rejected', badType.j.ok === false && badType.j.error === 'type_not_allowed', badType.j);
  const wrongThread = await add('fathering', otherComm.id, 'sme', 'Dr Ken', null, 'a.pdf', PDF, 10, 'o/fathering/e/a.pdf', 'clean');
  check('a thread from another project is rejected', wrongThread.j.ok === false && wrongThread.j.error === 'bad_thread', wrongThread.j);
  const unscanned = await add('fathering', seat.id, 'sme', 'Dr Ken', null, 'note.pdf', PDF, 20, 'o/fathering/f/note.pdf', 'unscanned');
  check('unscanned attachment is accepted (flagged, not blocked)', unscanned.j.ok === true, unscanned.j);

  // Audit trail recorded the upload.
  const act = await one(`select count(*)::int n from activity where action='attachment.added' and project_id='fathering'`);
  check('each stored file is written to the audit log', act.n === 2, act.n);

  // --- authorization resolvers ---
  const asTeam = await one(`select attachment_uploader($1,$2) j`, [seat.id, MGR]);
  check('resolver identifies a team member', asTeam.j.ok === true && asTeam.j.kind === 'team', asTeam.j);
  const asPartner = await one(`select attachment_uploader($1,$2) j`, [seat.id, PARTNER]);
  check('resolver identifies an assigned partner', asPartner.j.ok === true && asPartner.j.kind === 'partner', asPartner.j);
  const asOut = await one(`select attachment_uploader($1,$2) j`, [seat.id, OUTSIDER]);
  check('resolver forbids an outsider', asOut.j.ok === false && asOut.j.error === 'forbidden', asOut.j);
  const smeT = await one(`select attachment_sme_target('sme-tok-1') j`);
  check('SME token resolves to its durable thread', smeT.j.ok === true && smeT.j.comm_id === seat.id && smeT.j.project_id === 'fathering', smeT.j);
  const smeBad = await one(`select attachment_sme_target('nope') j`);
  check('a bad SME token resolves to nothing', smeBad.j.ok === false, smeBad.j);

  // --- thread reads include the uploader's OWN files, so they persist across reloads ---
  const smeThread = await one(`select sme_thread('sme-tok-1') j`);
  const smeFiles = (smeThread.j && smeThread.j.attachments) || [];
  check('SME thread returns the SME\'s own uploaded files', smeFiles.some((a) => a.file_name === 'spec.pdf'), smeFiles.map((a) => a.file_name));
  // Partner note thread (on the 'other' project, to keep 'fathering' counts clean).
  const pComm = await one(`insert into comms(org_id,project_id,origin,partner_id,author_name,title,body)
    values ('${ORG}','other','partner','${pid}','Vendor Pat','Partner note','see attached') returning id`);
  await add('other', pComm.id, 'partner', 'Vendor Pat', PARTNER, 'vendor-spec.pdf', PDF, 5000, 'o/other/p/vendor-spec.pdf', 'clean');
  await asUser(PARTNER);
  const pThread = await one(`select partner_thread_v2('other') j`);
  await asUser('');
  const pFiles = ((pThread.j || [])[0] || {}).attachments || [];
  check('partner thread returns the partner\'s own uploaded files', pFiles.some((a) => a.file_name === 'vendor-spec.pdf'), pFiles.map((a) => a.file_name));

  // --- RLS: team reads its org's files; an outsider sees none ---
  await asUser(MGR); await run('set role authenticated');
  const mineN = await one(`select count(*)::int n from attachments where project_id='fathering'`);
  await run('reset role');
  check('a member reads their org attachments', mineN.n === 2, mineN.n);
  await asUser(OUTSIDER); await run('set role authenticated');
  const outN = await one(`select count(*)::int n from attachments`);
  await run('reset role');
  check('an outsider reads zero attachments (RLS)', outN.n === 0, outN.n);
  await asUser('');

  // --- rate limit: 40/hour/project ---
  for (let i = 0; i < 38; i++) await add('fathering', seat.id, 'sme', 'Dr Ken', null, 'f' + i + '.pdf', PDF, 10, 'o/fathering/r/' + i + '.pdf', 'clean');
  const at40 = await one(`select count(*)::int n from attachments where project_id='fathering'`);
  check('40 files land within the hour', at40.n === 40, at40.n);
  const over = await add('fathering', seat.id, 'sme', 'Dr Ken', null, 'f41.pdf', PDF, 10, 'o/fathering/r/41.pdf', 'clean');
  check('the 41st file in an hour is rate-limited', over.j.ok === false && over.j.error === 'rate_limited', over.j);
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\nattachments.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
