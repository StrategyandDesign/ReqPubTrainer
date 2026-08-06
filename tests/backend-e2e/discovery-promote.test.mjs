/* Discovery promotion back-link: an entry becomes a numbered FR-/DEC- artifact
   and records what it became (promoted_to), mirroring comms. The column ships
   in schema.sql for fresh installs and in migrations/0006_discovery_promote.sql for live
   ones; both paths are idempotent, RLS keeps writes manager-only, and the
   value rides through a schema re-apply untouched. Run:
   node tests/backend-e2e/discovery-promote.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-disc-' + process.pid), user: 'postgres', password: 'pw', port: 55473, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55473, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000d1';
const VIEWER = '22222222-0000-0000-0000-0000000000d2';
const RIVAL = '33333333-0000-0000-0000-0000000000d3';
const ORG = '44444444-0000-0000-0000-0000000000d4';
const RIVAL_ORG = '55555555-0000-0000-0000-0000000000d5';

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@collection.co'),('${VIEWER}','v@collection.co'),('${RIVAL}','r@elsewhere.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}'),('${RIVAL_ORG}','Elsewhere','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@collection.co','manager'),
    ('${ORG}','${VIEWER}','v@collection.co','viewer'),
    ('${RIVAL_ORG}','${RIVAL}','r@elsewhere.co','manager')`);
  await run(`insert into projects(id,org_id,name) values ('reqpub','${ORG}','ReqPub Platform')`);

  // 1) Fresh install: schema.sql carries the column with its default.
  const col = await one(`select column_default, is_nullable from information_schema.columns
    where table_name='discovery_entries' and column_name='promoted_to'`);
  check('fresh schema carries promoted_to', !!col);
  check('promoted_to defaults to the empty string, not null', col && col.is_nullable === 'NO' && /''/.test(col.column_default), col);

  await run(`insert into discovery_entries(id,org_id,project_id,takeaway,notes,who)
    values ('99999999-0000-0000-0000-0000000000e1','${ORG}','reqpub','Pilot needs Spanish flow','Heard in the workshop','Jane')`);
  const fresh = await one(`select promoted_to from discovery_entries where takeaway like 'Pilot%'`);
  check('an entry inserted without the column lands as unpromoted', fresh.promoted_to === '', fresh.promoted_to);

  // 2) Live install: a pre-2.19 database (no column) upgrades via the fix,
  //    and the fix is idempotent alongside a later schema re-apply.
  await run(`alter table discovery_entries drop column promoted_to`);
  await run(sql(rel('../../supabase/migrations/0006_discovery_promote.sql')));
  await run(sql(rel('../../supabase/migrations/0006_discovery_promote.sql')));
  const back = await one(`select promoted_to from discovery_entries where takeaway like 'Pilot%'`);
  check('migrations/0006_discovery_promote.sql restores the column and runs twice cleanly', back.promoted_to === '', back);

  // 3) RLS: the existing manager-only write policy governs the new column.
  await asUser(MGR); await run('set role authenticated');
  const upd = await run(`update discovery_entries set promoted_to='FR-012' where takeaway like 'Pilot%'`);
  check('a manager promotes under RLS (existing policy, no new grant)', upd.rowCount === 1, upd.rowCount);
  const mine = await one(`select promoted_to from discovery_entries where takeaway like 'Pilot%'`);
  check('the back-link reads back for org members', mine && mine.promoted_to === 'FR-012', mine);

  await asUser(VIEWER);
  const vUpd = await run(`update discovery_entries set promoted_to='DEC-001' where takeaway like 'Pilot%'`);
  check('a viewer cannot write the back-link', vUpd.rowCount === 0, vUpd.rowCount);
  const vRead = await one(`select promoted_to from discovery_entries where takeaway like 'Pilot%'`);
  check('a viewer still reads it (member read policy)', vRead && vRead.promoted_to === 'FR-012', vRead);

  await asUser(RIVAL);
  const rSel = await run(`select id from discovery_entries`);
  const rUpd = await run(`update discovery_entries set promoted_to='' where takeaway like 'Pilot%'`);
  check('a rival-org manager sees no entries and writes nothing', rSel.rowCount === 0 && rUpd.rowCount === 0, { sel: rSel.rowCount, upd: rUpd.rowCount });
  await run('reset role');

  // 4) Durability: re-applying the full schema (the upgrade path run.mjs
  //    exercises) must not disturb a recorded promotion.
  await run(sql(rel('../../supabase/schema.sql')));
  const kept = await one(`select promoted_to from discovery_entries where takeaway like 'Pilot%'`);
  check('a recorded promotion survives a schema re-apply', kept.promoted_to === 'FR-012', kept);

  // 5) The pattern matches comms: both back-links coexist on one record.
  await run(`insert into comms(org_id,project_id,origin,author_name,title,body,promoted_to)
    values ('${ORG}','reqpub','sme','Jane','Spanish flow','Please add it','FR-012')`);
  const pair = await one(`select
    (select count(*) from comms where promoted_to='FR-012') c,
    (select count(*) from discovery_entries where promoted_to='FR-012') d`);
  check('comms and discovery back-link the same artifact id', pair.c === '1' && pair.d === '1', pair);
} catch (e) {
  fail++; console.log('  ✗ suite error → ' + (e && e.message));
} finally {
  try { await db.end(); } catch { /* already closed */ }
  await epg.stop();
}
console.log('\ndiscovery-promote.test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
