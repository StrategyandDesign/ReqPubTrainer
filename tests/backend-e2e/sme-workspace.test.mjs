/* Proves the durable SME workspace: seating an SME is idempotent (one thread per
   project+email, stable token), the thread returns the current branded PRD, and
   all exchanges over time stay in ONE continuous conversation reachable by the
   same link. Run: node tests/backend-e2e/sme-workspace.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-sme-' + process.pid), user: 'postgres', password: 'pw', port: 55459, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55459, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const MGR = '11111111-0000-0000-0000-0000000000a1';
const OUTSIDER = '99999999-0000-0000-0000-0000000000a9';
const ORG = '33333333-0000-0000-0000-0000000000a3';

try {
  await db.query(sql(rel('shim.sql')));
  await db.query(sql(rel('v1-backend.sql')));
  await db.query(sql(rel('../../supabase/schema.sql')));

  await db.query(`insert into auth.users(id,email) values ($1,'mgr@collection.co'),($2,'outsider@nope.co')`, [MGR, OUTSIDER]);
  await db.query(`insert into orgs(id,name,created_by) values ($1,'Collection Ventures',$2)`, [ORG, MGR]);
  await db.query(`insert into org_members(org_id,user_id,email,role) values ($1,$2,'mgr@collection.co','manager')`, [ORG, MGR]);
  await db.query(`insert into projects(id,org_id,name,brand_logo,brand_label) values ('fathering',$1,'Fathering Excellence Profile',$2,'Fathers.com')`, [ORG, LOGO]);
  // A published brief exists for the PRD.
  await db.query(`insert into shares(token,org_id,project_id,version_seq,kind,payload,revoked)
    values ('brief-tok',$1,'fathering',2,'brief',
      jsonb_build_object('product','Fathering Excellence Profile','label','1.2','logo','','brandLabel','','answers',jsonb_build_object('ctrl_product','Fathering Excellence Profile')),false)`, [ORG]);

  // Only a manager may seat an SME.
  await asUser(OUTSIDER);
  const forbidden = await one(`select sme_seat('fathering','Dr Ken','ken@fathers.com') j`);
  check('non-manager cannot seat an SME', forbidden.j.ok === false && forbidden.j.error === 'forbidden', forbidden.j);

  await asUser(MGR);
  const seat1 = await one(`select sme_seat('fathering','Dr Ken Canfield','Ken@Fathers.com') j`);
  check('manager seats an SME and gets a token', seat1.j.ok === true && !!seat1.j.reply_token, seat1.j);
  check('first seating reports not-existed', seat1.j.existed === false, seat1.j);
  const tok = seat1.j.reply_token;

  // Re-seat the SAME email (different case / name) → SAME token, no new thread.
  const seat2 = await one(`select sme_seat('fathering','Ken Canfield','ken@fathers.com') j`);
  check('re-seating the same email returns the same token', seat2.j.reply_token === tok, { a: tok, b: seat2.j.reply_token });
  check('re-seating reports existed', seat2.j.existed === true, seat2.j);
  const cnt = await one(`select count(*)::int n from comms where project_id='fathering' and origin='sme' and lower(author_email)='ken@fathers.com'`);
  check('exactly one thread exists for that SME', cnt.n === 1, cnt.n);

  // The SME opens their link (anon): sees the branded PRD + their thread.
  await asUser('');
  const t0 = await one(`select sme_thread($1) j`, [tok]);
  check('SME thread loads for the token', t0.j.ok === true, t0.j);
  check('SME thread carries the branded PRD (live logo overlaid)', t0.j.brief && t0.j.brief.logo === LOGO, t0.j.brief && (t0.j.brief.logo || '').slice(0, 24));
  check('SME thread shows the product name', t0.j.product === 'Fathering Excellence Profile', t0.j.product);
  check('SME thread starts with no messages', Array.isArray(t0.j.messages) && t0.j.messages.length === 0, t0.j.messages);

  // A conversation happens over time: SME writes, team replies, SME writes again.
  await one(`select sme_reply($1,'First question about the profile.') ok`, [tok]);
  await asUser(MGR);
  const c = await one(`select id from comms where reply_token=$1`, [tok]);
  await db.query(`insert into messages(org_id,parent_kind,parent_id,author_kind,author_name,body)
                  values ($1,'comm',$2,'team','Micah','Good question - here is the answer.')`, [ORG, c.id]);
  await asUser('');
  await one(`select sme_reply($1,'Thanks, follow-up here.') ok`, [tok]);

  // Re-opening the SAME link shows the WHOLE continuous conversation in order.
  const t1 = await one(`select sme_thread($1) j`, [tok]);
  const bodies = (t1.j.messages || []).map((m) => m.body);
  check('the same link accumulates one continuous thread', bodies.length === 3, bodies);
  check('thread is ordered SME → team → SME', t1.j.messages[0].from === 'sme' && t1.j.messages[1].from === 'team' && t1.j.messages[2].from === 'sme', (t1.j.messages || []).map((m) => m.from));

  // Team roster lists the SME with their reply count.
  await asUser(MGR);
  const roster = await one(`select sme_seats('fathering') j`);
  check('roster lists the seated SME', (roster.j || []).length === 1 && roster.j[0].reply_token === tok, roster.j);
  check('roster counts the SME replies', roster.j[0].replies === 2, roster.j[0] && roster.j[0].replies);

  // A second SME is independent (separate token/thread).
  const seatB = await one(`select sme_seat('fathering','Daniel','daniel@fathers.com') j`);
  check('a different SME gets a different token', seatB.j.reply_token !== tok, seatB.j.reply_token);
  const roster2 = await one(`select sme_seats('fathering') j`);
  check('roster now lists two SMEs', (roster2.j || []).length === 2, (roster2.j || []).length);
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\nsme-workspace.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
