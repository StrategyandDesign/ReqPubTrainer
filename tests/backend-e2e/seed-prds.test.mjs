/* Validates supabase/seed-prds.sql end to end: fresh Postgres → schema.sql →
   a seeded Collection Ventures org → seed-prds.sql → assert the PRDs landed,
   BotYield is gone, and the content assembles into a document via the real
   builders. Run: node tests/backend-e2e/seed-prds.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleAnswers, buildSections, assemble } from '../../app/js/domain.js';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-seed-' + process.pid), user: 'postgres', password: 'pw', port: 55455, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55455, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

try {
  await db.query(sql(rel('shim.sql')));
  await db.query(sql(rel('v1-backend.sql')));
  await db.query(sql(rel('../../supabase/schema.sql')));

  // Seed a Collection Ventures org with a BotYield PRD and an old Fathering PRD.
  await db.query(`insert into auth.users(id,email) values ('aaaaaaaa-0000-0000-0000-0000000000cf','micah@fathers.com')`);
  await db.query(`insert into orgs(id,name,created_by) values ('bbbbbbbb-0000-0000-0000-0000000000c1','Collection Ventures','aaaaaaaa-0000-0000-0000-0000000000cf')`);
  await db.query(`insert into projects(id,org_id,name) values ('old-botyield','bbbbbbbb-0000-0000-0000-0000000000c1','BotYield'),('old-fathering','bbbbbbbb-0000-0000-0000-0000000000c1','Fathering Excellence Profile')`);
  await db.query(`insert into project_fields(project_id,field_id,value,rev) values ('old-fathering','ov_vision','"stale content"'::jsonb,1)`);

  await db.query(sql(rel('../../supabase/seed-prds.sql')));

  const bot = await one(`select count(*)::int n from projects where name ilike '%botyield%'`);
  check('BotYield removed', bot.n === 0, bot.n);
  const fath = await one(`select count(*)::int n from projects where name ilike '%fathering%'`);
  check('exactly one Fathering PRD (clean rebuild)', fath.n === 1, fath.n);
  const stale = await one(`select count(*)::int n from project_fields where value::text = '"stale content"'`);
  check('old Fathering content replaced', stale.n === 0, stale.n);

  for (const id of ['prd-fathering-excellence', 'prd-reqpub-platform', 'prd-esign-api']) {
    const p = await one(`select p.name, o.name org from projects p join orgs o on o.id=p.org_id where p.id=$1`, [id]);
    check(id + ' exists in Collection Ventures', p && p.org === 'Collection Ventures', p);
    const nf = await one(`select count(*)::int n from project_fields where project_id=$1`, [id]);
    const nr = await one(`select count(*)::int n from field_rows where project_id=$1`, [id]);
    check(id + ' has fields and rows', nf.n > 5 && nr.n > 20, { fields: nf.n, rows: nr.n });

    // Read it back exactly as the app would and assemble the document.
    const fr = await db.query(`select field_id,value,rev from project_fields where project_id=$1`, [id]);
    const rr = await db.query(`select id,field_id,k,data,pos,rev from field_rows where project_id=$1 order by pos`, [id]);
    const fields = {}; fr.rows.forEach((x) => { fields[x.field_id] = { value: x.value, rev: x.rev }; });
    const rows = {}; rr.rows.forEach((x) => { (rows[x.field_id] = rows[x.field_id] || []).push(x); });
    const a = assembleAnswers(fields, rows);
    const md = assemble(buildSections(a, null, []), a);
    check(id + ' assembles into a full document', md.includes('## 7. Functional Requirements') && md.includes('## Part I: Product Definition'), md.slice(0, 40));
    check(id + ' preserves permanent FR ids from k', md.includes('FR-001') && md.includes('FR-0'), null);
  }

  // FR ids are contiguous from k (no gaps) for a freshly seeded PRD.
  const frk = (await db.query(`select k from field_rows where project_id='prd-reqpub-platform' and field_id='fr' order by k`)).rows.map((x) => +x.k);
  check('ReqPub FR ids are 1..N contiguous', frk[0] === 1 && frk[frk.length - 1] === frk.length, frk);

  // Re-run is idempotent (no duplication).
  await db.query(sql(rel('../../supabase/seed-prds.sql')));
  const dup = await one(`select count(*)::int n from projects where id='prd-reqpub-platform'`);
  check('seed is idempotent on re-run', dup.n === 1, dup.n);

  // The standalone Esign file adds only its own project and is idempotent, so it
  // can be run on an existing workspace without disturbing the other examples.
  await db.query(sql(rel('../../supabase/seed-esign-api.sql')));
  const solo = await one(`select count(*)::int n from projects where id='prd-esign-api'`);
  check('standalone esign seed keeps exactly one Esign API', solo.n === 1, solo.n);
  const others = await one(`select count(*)::int n from projects where id in ('prd-fathering-excellence','prd-reqpub-platform')`);
  check('standalone esign seed leaves the other examples intact', others.n === 2, others.n);
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\nseed-prds.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
