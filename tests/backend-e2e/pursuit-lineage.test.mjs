/* ReqPub v2 - lineage backend (node tests/backend-e2e/pursuit-lineage.test.mjs)
   Pins v2.56: migrations/0027_pursuit_lineage.sql twice on the full prior stack; the three
   additive nullable columns defaulting to nothing; project_set_lineage
   requiring a manager on the child, setting once and refusing the second
   attempt, validating the fingerprint format and the sequence; the lineage.set
   activity row landing on the chain; a citation pointing at a record in
   another organization staying valid because nothing joins against it; and
   parity that nothing else moved. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-pl-' + process.pid), user: 'postgres', password: 'pw', port: 55505, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55505, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000a1';
const MEMBER = '11111111-0000-0000-0000-0000000000a2';
const RIVAL = '11111111-0000-0000-0000-0000000000a9';
const ORG = '22222222-0000-0000-0000-0000000000a4';
const RORG = '22222222-0000-0000-0000-0000000000a5';
const FP = 'ab'.repeat(32);

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  await run(sql(rel('../../supabase/migrations/0021_sealing.sql')));
  await run(sql(rel('../../supabase/migrations/0022_attachment_hash.sql')));
  await run(sql(rel('../../supabase/migrations/0023_webhooks.sql')));
  await run(sql(rel('../../supabase/migrations/0024_mcp.sql')));
  await run(sql(rel('../../supabase/migrations/0025_evidence.sql')));
  await run(sql(rel('../../supabase/migrations/0026_book_practice.sql')));
  await run(sql(rel('../../supabase/migrations/0027_pursuit_lineage.sql')));
  await run(sql(rel('../../supabase/migrations/0028_authz_lockdown.sql')));
  await run(sql(rel('../../supabase/migrations/0027_pursuit_lineage.sql')));
  check('migrations/0027_pursuit_lineage.sql applies twice on the full prior stack', true);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${MEMBER}','v@cv.co'),('${RIVAL}','x@rival.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}'),('${RORG}','Rival','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@cv.co','manager'),('${ORG}','${MEMBER}','v@cv.co','viewer'),
    ('${RORG}','${RIVAL}','x@rival.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values
    ('parent','${ORG}','The pursuit','${MGR}'),
    ('child','${ORG}','The engagement','${MGR}'),
    ('child2','${ORG}','Second engagement','${MGR}'),
    ('outsider','${RORG}','Rival record','${RIVAL}')`);

  /* ---- the columns are additive and empty ---- */
  const cols = await one(`select count(*)::int n from information_schema.columns
    where table_name='projects' and column_name in ('born_from_project_id','born_from_seq','born_from_fingerprint')`);
  const empty = await one(`select count(*)::int n from projects
    where born_from_project_id is not null or born_from_seq is not null or born_from_fingerprint is not null`);
  check('three nullable columns land and every existing record keeps its shape', cols.n === 3 && empty.n === 0, [cols.n, empty.n]);

  /* ---- a viewer cannot cite ---- */
  await run(`set role authenticated`); await asUser(MEMBER);
  const asViewer = await one(`select project_set_lineage('child','parent',2,'${FP}') j`);
  check('a viewer is refused', asViewer.j.ok === false && asViewer.j.error === 'forbidden', asViewer.j);

  /* ---- validation before any write ---- */
  await asUser(MGR);
  const badFp = await one(`select project_set_lineage('child','parent',2,'not-a-fingerprint') j`);
  check('a malformed fingerprint is refused with the rule stated',
    badFp.j.ok === false && badFp.j.error === 'bad_fingerprint' && String(badFp.j.message).includes('64 lowercase hexadecimal'), badFp.j);
  const upper = await one(`select project_set_lineage('child','parent',2,'${FP.toUpperCase()}') j`);
  check('an uppercase fingerprint is refused: one canonical form only', upper.j.error === 'bad_fingerprint');
  const badSeq = await one(`select project_set_lineage('child','parent',-1,'${FP}') j`);
  check('a negative sequence is refused', badSeq.j.error === 'bad_seq');
  const badParent = await one(`select project_set_lineage('child','',2,'${FP}') j`);
  check('an empty parent is refused', badParent.j.error === 'bad_parent');
  const missing = await one(`select project_set_lineage('nope','parent',2,'${FP}') j`);
  check('an unknown child is not found', missing.j.error === 'not_found');
  const stillEmpty = await one(`select count(*)::int n from projects where born_from_project_id is not null`);
  check('no refusal wrote anything', stillEmpty.n === 0, stillEmpty.n);

  /* ---- the set-once write ---- */
  const okSet = await one(`select project_set_lineage('child','parent',2,'${FP}') j`);
  check('a manager sets the citation and gets it back', okSet.j.ok === true && okSet.j.bornFromSeq === 2 && okSet.j.bornFromFingerprint === FP, okSet.j);
  const row = await one(`select born_from_project_id p, born_from_seq s, born_from_fingerprint f from projects where id='child'`);
  check('the three columns hold exactly what was cited', row.p === 'parent' && row.s === 2 && row.f === FP, row);

  const second = await one(`select project_set_lineage('child','parent',3,'${'cd'.repeat(32)}') j`);
  check('a second attempt is refused in the doctrine\u2019s words',
    second.j.ok === false && second.j.error === 'already_set' && String(second.j.message).includes('citation that can be rewritten'), second.j);
  const unchanged = await one(`select born_from_seq s, born_from_fingerprint f from projects where id='child'`);
  check('the refused rewrite changed nothing', unchanged.s === 2 && unchanged.f === FP, unchanged);

  /* ---- the log rides the chain ---- */
  const act = await one(`select count(*)::int n from activity where project_id='child' and action='lineage.set'`);
  check('the write logs lineage.set once', act.n === 1, act.n);
  const chained = await one(`select count(*)::int n from chain_events where project_id='child'`);
  check('the log rides the activity chain', chained.n >= 1, chained.n);
  const meta = await one(`select meta from activity where project_id='child' and action='lineage.set' limit 1`);
  check('the entry carries the citation in its meta',
    meta.meta.bornFromProjectId === 'parent' && meta.meta.bornFromSeq === 2 && meta.meta.bornFromFingerprint === FP, meta.meta);

  /* ---- a citation may point outside, and nothing joins against it ---- */
  const outside = await one(`select project_set_lineage('child2','outsider',1,'${'ef'.repeat(32)}') j`);
  check('a record in another organization can be cited: the fingerprint carries the proof',
    outside.j.ok === true, outside.j);
  const gone = await one(`select (select count(*)::int from projects where id='child2' and born_from_project_id='outsider') n`);
  await run(`reset role`);
  await run(`delete from projects where id='outsider'`);
  const survives = await one(`select born_from_project_id p, born_from_fingerprint f from projects where id='child2'`);
  check('deleting the cited record leaves the citation standing: nothing reads back up the chain',
    gone.n === 1 && survives.p === 'outsider' && survives.f === 'ef'.repeat(32), survives);

  /* ---- a rival manager cannot cite into someone else\u2019s record ---- */
  await run(`set role authenticated`); await asUser(RIVAL);
  const rival = await one(`select project_set_lineage('parent','anything',1,'${FP}') j`);
  check('a rival manager is refused on a record they do not manage', rival.j.error === 'forbidden', rival.j);
  await run(`reset role`);

  /* ---- parity ---- */
  const parity = await one(`select
    (to_regprocedure('public.project_set_lineage(text, text, integer, text)') is not null) fn,
    (select count(*)::int from information_schema.columns where table_name='projects' and column_name='practice') practice,
    (to_regprocedure('public.book_export()') is not null) book,
    (select count(*)::int from pg_trigger where tgname='projects_practice_immutable') trg`);
  check('v2.56 adds one function and three columns; every prior surface is untouched',
    parity.fn === true && parity.practice === 1 && parity.book === true && parity.trg === 1, parity);
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + String((e && e.message) || e));
} finally {
  try { await db.end(); } catch {}
  try { await epg.stop(); } catch {}
}
console.log(`pursuit+lineage backend: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
