/* ReqPub C1.6 - storage probing (node tests/backend-e2e/storage-probing.test.mjs)

   Attachments are the one place customer bytes leave the database, so they get
   their own sweep. Four questions, each asked the way an attacker asks it:

   Can a stranger enumerate what exists. Can a member of one organization read
   another organization's file, by row or by path. Can a file that has not
   passed scanning be served. And is the signed URL a genuinely short-lived
   grant rather than a permanent one wearing a signature.

   The bucket itself is private and reached only through a signed URL minted by
   the client library, so the boundary that decides everything is the row: if a
   caller cannot see the attachment row, they never learn the storage path, and
   without the path there is nothing to sign. That makes row visibility the
   control under test, and it is tested from every role. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-store-' + process.pid), user: 'postgres', password: 'pw', port: 55509, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55509, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const all = async (q, a) => (await db.query(q, a)).rows;
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = 'bbbbcccc-0000-0000-0000-0000000000e1';
const MEMBER = 'bbbbcccc-0000-0000-0000-0000000000e2';
const RIVAL = 'bbbbcccc-0000-0000-0000-0000000000e9';
const ORG = 'ddddeeee-0000-0000-0000-0000000000e1';
const RORG = 'ddddeeee-0000-0000-0000-0000000000e2';

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  for (const f of ['schema.sql', 'migrations/0021_sealing.sql', 'migrations/0022_attachment_hash.sql', 'migrations/0023_webhooks.sql',
                   'migrations/0024_mcp.sql', 'migrations/0025_evidence.sql', 'migrations/0026_book_practice.sql', 'migrations/0027_pursuit_lineage.sql',
                   'migrations/0028_authz_lockdown.sql', 'migrations/0029_ssrf_guard.sql'])
    await run(sql(rel('../../supabase/' + f)));

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${MEMBER}','m@cv.co'),('${RIVAL}','x@rival.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}'),('${RORG}','Rival','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@cv.co','manager'),('${ORG}','${MEMBER}','m@cv.co','viewer'),
    ('${RORG}','${RIVAL}','x@rival.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values
    ('sp1','${ORG}','Ours','${MGR}'),('rp1','${RORG}','Theirs','${RIVAL}')`);

  const ourPath = ORG + '/sp1/2026/confidential-contract.pdf';
  const theirPath = RORG + '/rp1/2026/their-secret.pdf';
  await run(`insert into attachments(id,org_id,project_id,uploader_kind,uploader_name,file_name,mime,size_bytes,storage_path,scan_status,sha256_hex)
    values (gen_random_uuid(),'${ORG}','sp1','team','Micah','confidential-contract.pdf','application/pdf',1024,$1,'clean',repeat('ab',32)),
           (gen_random_uuid(),'${ORG}','sp1','team','Micah','unscanned-file.pdf','application/pdf',512,$2,'unscanned',repeat('cd',32)),
           (gen_random_uuid(),'${ORG}','sp1','team','Micah','infected.doc','application/msword',256,$3,'infected',repeat('ef',32)),
           (gen_random_uuid(),'${RORG}','rp1','team','Rival','their-secret.pdf','application/pdf',2048,$4,'clean',repeat('99',32))`,
    [ourPath, ORG + '/sp1/2026/unscanned-file.pdf', ORG + '/sp1/2026/infected.doc', theirPath]);

  /* ---- 1. A stranger enumerates nothing ---- */
  await run(`set role anon`);
  let anonRows = [], anonErr = null;
  try { anonRows = await all(`select storage_path from attachments`); } catch (e) { anonErr = e.message; }
  await run(`reset role`);
  check('an unauthenticated caller reads no attachment row and therefore no path',
    anonRows.length === 0, { rows: anonRows.length, err: anonErr });

  /* ---- 2. Cross-organization isolation, by row and by path ---- */
  await run(`set role authenticated`); await asUser(RIVAL);
  const rivalSeesOurs = await all(`select storage_path from attachments where org_id = '${ORG}'`);
  const rivalByPath = await all(`select id from attachments where storage_path = $1`, [ourPath]);
  const rivalByGuess = await all(`select id from attachments where storage_path like $1`, [ORG + '/%']);
  const rivalOwn = await all(`select storage_path from attachments where org_id = '${RORG}'`);
  await run(`reset role`);
  check('a rival manager cannot read our attachment rows', rivalSeesOurs.length === 0, rivalSeesOurs.length);
  check('knowing the exact storage path does not help: the row is still invisible',
    rivalByPath.length === 0, rivalByPath.length);
  check('a prefix guess across our whole organization returns nothing',
    rivalByGuess.length === 0, rivalByGuess.length);
  check('the rival still sees their own file, so the test is measuring isolation, not a broken query',
    rivalOwn.length === 1, rivalOwn.length);

  /* ---- 3. A member of the owning organization sees only their organization ---- */
  await run(`set role authenticated`); await asUser(MEMBER);
  const oursVisible = await all(`select storage_path, scan_status from attachments`);
  await run(`reset role`);
  check('a member sees their own organization\u2019s files and no others',
    oursVisible.length === 3 && oursVisible.every((r) => r.storage_path.startsWith(ORG)), oursVisible.length);

  /* ---- 4. Scan gating: only a clean file is servable ---- */
  {
    const client = readFileSync(rel('../../app/js/data.js'), 'utf8');
    const views = readFileSync(rel('../../app/js/views-collab.js'), 'utf8');
    check('a signed URL is minted with an explicit, short lifetime rather than a default',
      /createSignedUrl\([^,]+,\s*\d+\)/.test(client), (client.match(/createSignedUrl\([^)]*\)/g) || []).slice(0, 2));
    const lifetimes = [...client.matchAll(/createSignedUrl\([^,]+,\s*(\d+)\)/g)].map((m) => Number(m[1]));
    check('every signed URL lifetime is an hour or less',
      lifetimes.length > 0 && lifetimes.every((s) => s <= 3600), lifetimes);
    // C1-006, found by this suite: the interface marked an infected file as
    // blocked but the download handler minted a signed URL regardless, from a
    // path carried in the markup. Marking is not refusing.
    const main = readFileSync(rel('../../app/js/main.js'), 'utf8');
    const handler = main.slice(main.indexOf("case 'dlattach'"), main.indexOf("case 'attverify'"));
    check('the download handler refuses an infected file rather than merely labelling it',
      /scan === 'infected'/.test(handler) && /break;/.test(handler));
    check('it refuses a file whose scan failed, and one not yet scanned',
      /scan === 'error'/.test(handler) && /scan !== 'clean'/.test(handler));
    check('it checks the loaded record, not only the markup, because markup is editable',
      /APP\.attach/.test(handler) && /storage_path === path/.test(handler));
    check('the refusal reaches the signed URL call only after the gate',
      handler.indexOf("scan !== 'clean'") < handler.indexOf('repo.signedUrl'));
    check('the control still carries the status so the gate has something to read',
      /data-scan=/.test(views) && /data-scan=/.test(readFileSync(rel('../../app/js/core.js'), 'utf8')));
  }

  /* ---- 5. The path itself carries no secret, and no path leaks into an export ---- */
  {
    await run(`set role authenticated`); await asUser(MGR);
    const gather = await one(`select evidence_gather('sp1') j`);
    await run(`reset role`);
    const blob = JSON.stringify(gather.j || {});
    check('the evidence pack lists attachments by name and hash, never by storage path',
      !blob.includes(ourPath) && (blob.includes('confidential-contract.pdf') || blob.includes('sha256')), blob.slice(0, 120));
    check('and it carries no token or address', !/TOK_|rqp_live_/.test(blob) &&
      !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(blob));
  }

  /* ---- 6. Direct writes to the attachment table are refused ---- */
  {
    await run(`set role authenticated`); await asUser(RIVAL);
    let wrote = 'landed';
    try {
      await run(`insert into attachments(id,org_id,project_id,uploader_kind,uploader_name,file_name,mime,size_bytes,storage_path,scan_status,sha256_hex)
        values (gen_random_uuid(),'${ORG}','sp1','team','Impostor','planted.pdf','application/pdf',1,'${ORG}/sp1/planted.pdf','clean',repeat('11',32))`);
    } catch { wrote = 'refused'; }
    let stole = 'landed';
    try { await run(`update attachments set scan_status = 'clean' where storage_path = $1`, [ORG + '/sp1/2026/infected.doc']); } catch { stole = 'refused'; }
    await run(`reset role`);
    const planted = await one(`select count(*)::int n from attachments where file_name='planted.pdf'`);
    const infected = await one(`select scan_status s from attachments where file_name='infected.doc'`);
    check('a rival cannot plant an attachment row in our organization',
      planted.n === 0, { wrote, planted: planted.n });
    check('a rival cannot mark an infected file clean', infected.s === 'infected', { stole, status: infected.s });
  }
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + String((e && e.message) || e));
} finally {
  try { await db.end(); } catch {}
  try { await epg.stop(); } catch {}
}
console.log(`storage probing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
