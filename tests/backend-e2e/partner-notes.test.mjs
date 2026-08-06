/* Trackable partner notes: each gets a stable per-project reference (PN-1, PN-2…)
   and a self-describing headline from its first line; references survive deletion
   (max+1, never reused); and existing notes are backfilled. Run:
   node tests/backend-e2e/partner-notes.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-pn-' + process.pid), user: 'postgres', password: 'pw', port: 55463, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55463, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q) => db.query(q);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000e1';
const PARTNER = '22222222-0000-0000-0000-0000000000e2';
const ORG = '33333333-0000-0000-0000-0000000000e3';
const post = (body) => one(`select partner_post('fathering', $1) ok`, [body]);
const latest = () => one(`select ref, title from comms where origin='partner' order by created_at desc, ref desc limit 1`);

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@collection.co'),('${PARTNER}','p@vendor.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${ORG}','${MGR}','mgr@collection.co','manager')`);
  await run(`insert into projects(id,org_id,name) values ('fathering','${ORG}','Fathering Excellence Profile')`);
  const pid = (await one(`insert into partners(org_id,user_id,email,name) values ('${ORG}','${PARTNER}','p@vendor.co','Jeremy') returning id`)).id;
  await run(`insert into partner_access(partner_id,project_id) values ('${pid}','fathering')`);

  // A legacy partner note from before this feature (generic title, no ref).
  await run(`insert into comms(org_id,project_id,origin,partner_id,author_name,title,body,created_at)
    values ('${ORG}','fathering','partner','${pid}','Jeremy','Partner note','Our SMEs need the Spanish flow in scope for pilot.', now() - interval '1 day')`);

  // Backfill runs inside migrations/0012_partner_notes.sql.
  await run(sql(rel('../../supabase/migrations/0012_partner_notes.sql')));
  const bf = await one(`select ref, title from comms where origin='partner' order by created_at limit 1`);
  check('legacy note is backfilled with PN-1', bf.ref === 'PN-1', bf.ref);
  check('legacy note gets a headline from its body', bf.title.startsWith('Our SMEs need the Spanish flow'), bf.title);

  // Live posts continue the sequence and self-title.
  await asUser(PARTNER);
  check('partner can post', (await post('Can we add an offline capture window for rural units?')).ok === true);
  let l = await latest();
  check('a new note gets the next reference (PN-2)', l.ref === 'PN-2', l.ref);
  check('a new note is titled from its first line', l.title === 'Can we add an offline capture window for rural units?', l.title);

  await post('Second question.\nWith a second line that should not appear in the title.');
  l = await latest();
  check('multi-line note titles from the first line only', l.title === 'Second question.…', l.title);
  check('the third note is PN-3', l.ref === 'PN-3', l.ref);

  // References survive deletion - the next is max+1, never a reused number.
  await asUser('');
  await run(`delete from comms where ref='PN-3'`);
  await asUser(PARTNER);
  await post('After a deletion.');
  l = await latest();
  check('after deleting PN-3, the next note is PN-4 (not reused)', l.ref === 'PN-4', l.ref);

  // The partner sees the reference on their own thread.
  const th = await one(`select partner_thread_v2('fathering') j`);
  await asUser('');
  const refs = (th.j || []).map((t) => t.ref).filter(Boolean);
  check('partner thread returns references', refs.includes('PN-1') && refs.includes('PN-4'), refs);

  // Long single-line notes are truncated with an ellipsis.
  await asUser(PARTNER);
  await post('x'.repeat(120));
  l = await latest();
  check('an over-long note is truncated to 72 chars + ellipsis', l.title.length === 73 && l.title.endsWith('…'), l.title.length);
  await asUser('');
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\npartner-notes.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
