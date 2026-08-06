/* Project name sync: the worksheet's ctrl_product answer is the name people
   edit; projects.name is the name every other surface reads - the dashboard,
   invites, the signer's page, both signature mailers. v2.26.1 adds a trigger
   so a rename in the worksheet lands on projects.name in the same
   transaction, through every write path, with the jsonb-safe extraction
   (value #>> '{}' - value::text keeps the JSON quotes), plus a one-time
   repair in migrations/0014_project_name_sync.sql for records that drifted before the
   trigger existed. This file pins all of it. Run:
   node tests/backend-e2e/name-sync.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-nsync-' + process.pid), user: 'postgres', password: 'pw', port: 55477, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55477, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q) => db.query(q);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000a1';
const ORG = '44444444-0000-0000-0000-0000000000a4';

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@collection.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${ORG}','${MGR}','mgr@collection.co','manager')`);

  console.log('- the one-time repair (drift created before the trigger ran) -');
  // Simulate a pre-trigger record: name written at creation, then renamed in
  // the worksheet while the trigger did not exist. Direct inserts as the
  // superuser fire the schema trigger, so create the drift by rewriting
  // projects.name afterward - exactly the state a live database is in.
  await run(`insert into projects(id,org_id,name) values ('drifted','${ORG}','Fresh Name')`);
  await run(`insert into project_fields(project_id,field_id,value,rev,updated_by_name) values ('drifted','ctrl_product','"Fresh Name"'::jsonb,3,'MC')`);
  await run(`update projects set name='Stale Creation Name' where id='drifted'`);
  await run(sql(rel('../../supabase/migrations/0014_project_name_sync.sql')));
  check('repair converges projects.name to the worksheet answer',
    (await one(`select name from projects where id='drifted'`)).name === 'Fresh Name');
  await run(sql(rel('../../supabase/migrations/0014_project_name_sync.sql')));
  check('the fix file is idempotent (second run leaves one trigger, same name)',
    +(await one(`select count(*) c from pg_trigger where tgname='pf_sync_name'`)).c === 1 &&
    (await one(`select name from projects where id='drifted'`)).name === 'Fresh Name');

  console.log('- the live path: save_field is the only writer the app has -');
  await run(`insert into projects(id,org_id,name) values ('recordmade','${ORG}','RecordMade')`);
  await asUser(MGR);
  const first = await one(`select save_field('recordmade','ctrl_product','"RecordMade OA"'::jsonb, 0) r`);
  check('first save of ctrl_product syncs the project name',
    first.r.ok === true && (await one(`select name from projects where id='recordmade'`)).name === 'RecordMade OA', first.r);
  const renamed = await one(`select save_field('recordmade','ctrl_product','"RecordArmor"'::jsonb, 1) r`);
  check('a rev-checked rename lands on projects.name in the same transaction',
    renamed.r.ok === true && (await one(`select name from projects where id='recordmade'`)).name === 'RecordArmor', renamed.r);
  check('the extraction is jsonb-safe: no JSON quotes leak into the name',
    !(await one(`select name from projects where id='recordmade'`)).name.includes('"'));

  console.log('- the guard rails -');
  await one(`select save_field('recordmade','ctrl_product','"   "'::jsonb, 2) r`);
  check('a cleared answer never blanks the project name',
    (await one(`select name from projects where id='recordmade'`)).name === 'RecordArmor');
  await one(`select save_field('recordmade','ctrl_product','null'::jsonb, 3) r`);
  check('a jsonb null leaves the name alone (no cast guessing)',
    (await one(`select name from projects where id='recordmade'`)).name === 'RecordArmor');
  await one(`select save_field('recordmade','ov_vision','"A different field entirely"'::jsonb, 0) r`);
  check('other worksheet fields never touch the name',
    (await one(`select name from projects where id='recordmade'`)).name === 'RecordArmor');
  const long = 'X'.repeat(400);
  await one(`select save_field('recordmade','ctrl_product','"  ${long}  "'::jsonb, 4) r`);
  const capped = (await one(`select name from projects where id='recordmade'`)).name;
  check('the synced name is trimmed and capped at 200 characters',
    capped.length === 200 && capped === 'X'.repeat(200), capped.length);

  console.log('- the surface the drift actually hurt -');
  await one(`select save_field('recordmade','ctrl_product','"RecordMade Final"'::jsonb, 5) r`);
  const V = (await one(`insert into versions(project_id,seq,label,status,snapshot) values
    ('recordmade',1,'1.0','draft','{"answers":{}}') returning id`)).id;
  const sr = await one(`select sign_request_create('${V}','client@northwind.com','Dana','Sponsor','fp-1') r`);
  const ctx = await one(`select sign_request_context('${sr.r.token}') r`);
  check('sign_request_context serves the renamed project, so the signer and both mailers see the current name',
    ctx.r.project === 'RecordMade Final', ctx.r.project);
} catch (e) {
  fail++; console.error('SUITE ERROR:', e.message || e);
} finally {
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
}
console.log(`\nname-sync.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
