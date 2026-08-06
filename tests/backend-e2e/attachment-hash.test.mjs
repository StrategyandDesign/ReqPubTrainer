/* ReqPub v2 - attachment hashing backend (node tests/backend-e2e/attachment-hash.test.mjs)
   Pins v2.49: sha256_hex recorded through attachment_add and refused when
   malformed, the verify target's member scope, the backfill's manager gate,
   paging, idempotence, the hashed-after-upload marker written exactly once
   and an at-upload digest never overwritten, the attachmentsAtSend snapshot
   in sign evidence (clean + hashed files only, no tokens, no emails), the
   sign-time evidence merge that keeps the snapshot alive, and the receipt
   carrying it through seal_context. migrations/0022_attachment_hash.sql applied twice
   on schema.sql plus migrations/0004_chain.sql plus migrations/0021_sealing.sql. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-atthash-' + process.pid), user: 'postgres', password: 'pw', port: 55496, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55496, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000e1';
const MEMBER = '11111111-0000-0000-0000-0000000000e2';
const OUTSIDER = '11111111-0000-0000-0000-0000000000e9';
const ORG = '22222222-0000-0000-0000-0000000000e4';
const RORG = '22222222-0000-0000-0000-0000000000e5';
const VID = 'aaaaaaaa-0000-0000-0000-0000000000e6';
const PDF = 'application/pdf';
const HEX = (c) => c.repeat(64);
const add = (proj, file, size, path, scan, sha) =>
  one(`select attachment_add($1,null,null,'team','Micah','${MGR}',$2,'${PDF}',$3,$4,$5,'',$6) j`,
    [proj, file, size, path, scan, sha]);

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  await run(sql(rel('../../supabase/migrations/0004_chain.sql')));
  await run(sql(rel('../../supabase/migrations/0021_sealing.sql')));
  await run(sql(rel('../../supabase/migrations/0022_attachment_hash.sql')));
  await run(sql(rel('../../supabase/migrations/0022_attachment_hash.sql')));
  check('migrations/0022_attachment_hash.sql applies twice on schema.sql + fix-chain + fix-sealing', true);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${MEMBER}','viewer@cv.co'),('${OUTSIDER}','x@other.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}'),('${RORG}','Rival','${OUTSIDER}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@cv.co','manager'),
    ('${ORG}','${MEMBER}','viewer@cv.co','viewer'),
    ('${RORG}','${OUTSIDER}','x@other.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values ('p1','${ORG}','Fathering Excellence Profile','${MGR}')`);
  await run(`insert into versions(id,project_id,seq,label,status,author_name,snapshot) values ('${VID}','p1',1,'1.0','approved','Micah','{"answers":{},"sections":{}}'::jsonb)`);

  /* ---- attachment_add records the digest, and guards its shape ---- */
  const withHash = await add('p1', 'spec.pdf', 1000, 'o/p1/a/spec.pdf', 'clean', HEX('a'));
  check('a clean upload with a digest is accepted', withHash.j.ok === true, withHash.j);
  const stored = await one(`select sha256_hex from attachments where id='${withHash.j.id}'`);
  check('the digest lands on the row exactly as sent', stored.sha256_hex === HEX('a'), stored);
  const meta = await one(`select meta->>'sha256' s from activity where action='attachment.added' and entity_id='${withHash.j.id}'`);
  check('the audit line carries the digest', meta.s === HEX('a'), meta);

  const noHash = await add('p1', 'legacy.pdf', 900, 'o/p1/b/legacy.pdf', 'clean', '');
  check('a call without a digest still lands (legacy callers unchanged)', noHash.j.ok === true, noHash.j);
  const legacyRow = await one(`select sha256_hex from attachments where id='${noHash.j.id}'`);
  check('an absent digest stores as the empty string, never null', legacyRow.sha256_hex === '', legacyRow);

  const badHex = await add('p1', 'bad.pdf', 10, 'o/p1/c/bad.pdf', 'clean', 'nothex');
  check('a malformed digest is refused', badHex.j.ok === false && badHex.j.error === 'bad_hash', badHex.j);
  const upper = await add('p1', 'up.pdf', 10, 'o/p1/d/up.pdf', 'clean', HEX('A'));
  check('an uppercase digest is refused (lowercase hex only)', upper.j.ok === false && upper.j.error === 'bad_hash', upper.j);

  const unscanned = await add('p1', 'flag.pdf', 800, 'o/p1/e/flag.pdf', 'unscanned', HEX('b'));
  check('an unscanned file may still carry a digest', unscanned.j.ok === true, unscanned.j);

  /* ---- verify target: member scope, honest errors ---- */
  const vt = await one(`select attachment_verify_target('${withHash.j.id}','${MEMBER}') j`);
  check('a member gets the path and stored digest to verify against', vt.j.ok === true && vt.j.sha256_hex === HEX('a') && vt.j.storage_path === 'o/p1/a/spec.pdf', vt.j);
  const vout = await one(`select attachment_verify_target('${withHash.j.id}','${OUTSIDER}') j`);
  check('an outsider is forbidden before any storage read', vout.j.ok === false && vout.j.error === 'forbidden', vout.j);
  const vmiss = await one(`select attachment_verify_target(gen_random_uuid(),'${MEMBER}') j`);
  check('an unknown attachment is not_found', vmiss.j.ok === false && vmiss.j.error === 'not_found', vmiss.j);
  const vun = await one(`select attachment_verify_target('${noHash.j.id}','${MEMBER}') j`);
  check('a file without a stored digest reports unhashed', vun.j.ok === false && vun.j.error === 'unhashed', vun.j);

  /* ---- backfill: manager gate, paging, remaining count ---- */
  const extra = await add('p1', 'old2.pdf', 700, 'o/p1/f/old2.pdf', 'clean', '');
  check('a second unhashed file is in place for paging', extra.j.ok === true, extra.j);
  const page = await one(`select attachment_backfill_targets('p1','${MGR}',1) j`);
  check('the backfill pages oldest first and reports the remainder', page.j.ok === true && page.j.rows.length === 1 && page.j.remaining === 1 && page.j.rows[0].id === noHash.j.id, page.j);
  const pageAll = await one(`select attachment_backfill_targets('p1','${MGR}',25) j`);
  check('a full page returns every unhashed row with zero remaining', pageAll.j.ok === true && pageAll.j.rows.length === 2 && pageAll.j.remaining === 0, pageAll.j);
  const pv = await one(`select attachment_backfill_targets('p1','${MEMBER}',25) j`);
  check('a non-manager cannot list backfill targets', pv.j.ok === false && pv.j.error === 'forbidden', pv.j);

  /* ---- set_hash: idempotent, marker once, at-upload digest never rewritten ---- */
  const s1 = await one(`select attachment_set_hash('${noHash.j.id}','${HEX('c')}',true) j`);
  check('a backfilled digest lands', s1.j.ok === true && s1.j.already === false, s1.j);
  const marked = await one(`select sha256_hex, scan_detail from attachments where id='${noHash.j.id}'`);
  check('the row carries the digest and the hashed-after-upload marker', marked.sha256_hex === HEX('c') && marked.scan_detail.includes('hashed-after-upload'), marked);
  const s2 = await one(`select attachment_set_hash('${noHash.j.id}','${HEX('d')}',true) j`);
  const marked2 = await one(`select sha256_hex, scan_detail from attachments where id='${noHash.j.id}'`);
  check('re-running is idempotent: digest unchanged, marker not duplicated',
    s2.j.already === true && marked2.sha256_hex === HEX('c') && marked2.scan_detail.split('hashed-after-upload').length === 2, { s2: s2.j, marked2 });
  const s3 = await one(`select attachment_set_hash('${withHash.j.id}','${HEX('e')}',true) j`);
  const orig = await one(`select sha256_hex, scan_detail from attachments where id='${withHash.j.id}'`);
  check('an at-upload digest is never overwritten or re-marked', s3.j.already === true && orig.sha256_hex === HEX('a') && !orig.scan_detail.includes('hashed-after-upload'), { s3: s3.j, orig });
  const sbad = await one(`select attachment_set_hash('${extra.j.id}','NOTHEX',true) j`);
  check('set_hash refuses a malformed digest', sbad.j.ok === false && sbad.j.error === 'bad_hash', sbad.j);

  /* ---- one audit line per backfill page, manager-gated ---- */
  const note = await one(`select attachment_backfill_note('p1','${MGR}',3) j`);
  const noteAct = await one(`select count(*)::int n, max(summary) s from activity where action='attachment.hashed' and project_id='p1'`);
  check('the backfill writes one audit line with the count', note.j.ok === true && noteAct.n === 1 && noteAct.s.includes('3 existing files'), { note: note.j, noteAct });
  const noteV = await one(`select attachment_backfill_note('p1','${MEMBER}',1) j`);
  check('a non-manager cannot write the backfill line', noteV.j.ok === false && noteV.j.error === 'forbidden', noteV.j);

  /* ---- attachmentsAtSend: clean + hashed only, ordered, boundary clean ---- */
  await run(`select attachment_set_hash('${extra.j.id}','${HEX('f')}',true)`);
  // At this point p1 holds: spec.pdf clean+hashed(a), legacy.pdf clean+hashed(c),
  // old2.pdf clean+hashed(f), flag.pdf unscanned+hashed(b). flag.pdf must not ride.
  await run(`set role authenticated`); await asUser(MGR);
  const sr = await one(`select sign_request_create('${VID}','jane@acme.com','Jane Roe','CTO','fp123') j`);
  check('a manager creates a sign request', sr.j.ok === true && !!sr.j.token, sr.j);
  await run('reset role');
  const ev = await one(`select evidence from sign_requests where id='${sr.j.id}'`);
  const snap = ev.evidence.attachmentsAtSend;
  check('evidence snapshots the clean, hashed files at send, oldest first',
    Array.isArray(snap) && snap.length === 3 && snap[0].file_name === 'spec.pdf' && snap[0].sha256_hex === HEX('a') && snap[0].size_bytes === 1000, snap);
  check('an unscanned file never rides in the snapshot', !snap.some((f) => f.file_name === 'flag.pdf'), snap);
  check('the snapshot carries exactly file_name, sha256_hex, size_bytes', snap.every((f) => Object.keys(f).sort().join(',') === 'file_name,sha256_hex,size_bytes'), snap);
  const evText = JSON.stringify(ev.evidence);
  check('the snapshot leaks no token and no email', evText.indexOf(sr.j.token) === -1 && evText.indexOf('@') === -1, evText.slice(0, 120));

  /* ---- a project with nothing to pin keeps evidence empty ---- */
  await run(`insert into projects(id,org_id,name,created_by) values ('p2','${ORG}','Bare','${MGR}')`);
  await run(`insert into versions(id,project_id,seq,label,status,author_name,snapshot) values ('aaaaaaaa-0000-0000-0000-0000000000e7','p2',1,'1.0','approved','Micah','{"answers":{},"sections":{}}'::jsonb)`);
  await run(`set role authenticated`); await asUser(MGR);
  const sr2 = await one(`select sign_request_create('aaaaaaaa-0000-0000-0000-0000000000e7','bob@acme.com','Bob','','') j`);
  await run('reset role');
  const ev2 = await one(`select evidence from sign_requests where id='${sr2.j.id}'`);
  check('with no qualifying files, evidence stays {} exactly as before', JSON.stringify(ev2.evidence) === '{}', ev2.evidence);

  /* ---- signing merges evidence; the snapshot survives to the seal ---- */
  const signed = await one(`select sign_request_sign('${sr.j.token}','Jane Roe','UA/1.0') j`);
  check('the request signs', signed.j.ok === true, signed.j);
  const evAfter = await one(`select evidence from sign_requests where id='${sr.j.id}'`);
  check('signing merges ua and channel without erasing attachmentsAtSend',
    evAfter.evidence.channel === 'email_token' && evAfter.evidence.ua === 'UA/1.0' && Array.isArray(evAfter.evidence.attachmentsAtSend) && evAfter.evidence.attachmentsAtSend.length === 3, evAfter.evidence);

  await run(`set role authenticated`); await asUser(MGR);
  const sc = await one(`select seal_context('${sr.j.id}') as c`);
  check('seal_context carries the snapshot into the receipt', Array.isArray(sc.c.evidence.attachmentsAtSend) && sc.c.evidence.attachmentsAtSend.length === 3, sc.c.evidence);
  check('the sealed context still leaks no token and no email', JSON.stringify(sc.c).indexOf(sr.j.token) === -1 && JSON.stringify(sc.c.evidence).indexOf('@') === -1);
  await run('reset role');
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + (e && e.message));
} finally {
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
}
console.log(`attachment-hash backend: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
