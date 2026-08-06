/* One partner identity per email per workspace (v2.34.0).

   The defect: partners carried no uniqueness on (org_id, email), so one client
   email could hold two identities in one workspace, each with its own
   partner_access grant to the same project. Every read joining
   partner_access -> partners -> projects then returned that project once per
   identity, and the portal rendered it twice.

   This suite proves the three properties the fix must have:
     1. Two identities with the same email in one workspace cannot be created.
     2. partner_projects_v2 returns each project exactly once.
     3. The dedup pass preserves message history.

   Run: node tests/backend-e2e/partner-identity.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-pi-' + process.pid), user: 'postgres', password: 'pw', port: 55471, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55471, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const all = async (q, a) => (await db.query(q, a)).rows;
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000f1';
const CLIENT = '22222222-0000-0000-0000-0000000000f2';
const ORG = '33333333-0000-0000-0000-0000000000f3';
const ORG2 = '44444444-0000-0000-0000-0000000000f4';

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  // Install v2 first: this models a live database, which is where the
  // duplicates actually accumulated. Dropping the index below returns it to
  // the pre-fix state so the merge has something real to merge.
  await run(sql(rel('../../supabase/schema.sql')));
  await run(`drop index if exists partners_org_email_uniq`);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@collection.co'),('${CLIENT}','ada@client.com')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}'),('${ORG2}','Second Workspace','${MGR}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${ORG}','${MGR}','mgr@collection.co','manager')`);
  await run(`insert into projects(id,org_id,name) values ('northwind','${ORG}','Northwind Field Services')`);
  await run(`insert into shares(token,org_id,project_id,version_seq,kind,payload)
             values ('tok-brief-1','${ORG}','northwind',1,'brief','{"product":"Northwind"}'::jsonb)`);

  /* ---- The defect, reproduced on the pre-fix schema -------------------- */
  // Two identities, one email, one workspace. The older one is the row a
  // manager typed; the newer one is the row that actually got claimed at
  // signup - the ordering that makes the user_id lift necessary.
  const older = (await one(`insert into partners(org_id,user_id,email,name,created_at)
    values ('${ORG}', null, 'ada@client.com', 'Ada', now() - interval '10 days') returning id`)).id;
  const newer = (await one(`insert into partners(org_id,user_id,email,name,title,created_at)
    values ('${ORG}', '${CLIENT}', 'Ada@Client.com', '', 'VP Operations', now() - interval '1 day') returning id`)).id;
  await run(`insert into partner_access(partner_id,project_id) values ($1,'northwind'),($2,'northwind')`, [older, newer]);

  // History on BOTH identities. This is what a naive delete would orphan:
  // comms.partner_id is ON DELETE SET NULL, so the rows would survive but stop
  // being attributable and drop out of partner_thread_v2, which filters on it.
  await run(`insert into comms(org_id,project_id,origin,partner_id,author_name,title,body,ref)
    values ('${ORG}','northwind','partner',$1,'Ada','First note','Scope question from the older identity.','PN-1'),
           ('${ORG}','northwind','partner',$2,'Ada','Second note','Follow-up from the newer identity.','PN-2')`, [older, newer]);
  await run(`insert into partner_notes(org_id,project_id,partner_id,name,text)
    values ('${ORG}','northwind',$1,'Ada','A v1-era note.')`, [older]);

  const dupCount = (await one(`select count(*)::int n from partners where org_id='${ORG}'`)).n;
  check('setup: the pre-fix table holds two identities for one email', dupCount === 2, dupCount);

  /* ---- Apply the fix ---------------------------------------------------- */
  // The same re-run of schema.sql a deploy performs.
  await run(sql(rel('../../supabase/schema.sql')));

  /* 1. Uniqueness is enforced at the table -------------------------------- */
  const remaining = await all(`select id, user_id, name, title from partners where org_id='${ORG}'`);
  check('the dedup pass merges the pair down to one identity', remaining.length === 1, remaining.length);
  check('the keeper is the oldest row', remaining[0] && remaining[0].id === older, { kept: remaining[0] && remaining[0].id, older, newer });
  check('the login link is lifted off the newer row, so the partner keeps their account',
    remaining[0] && remaining[0].user_id === CLIENT, remaining[0] && remaining[0].user_id);
  check('profile text the keeper lacked is lifted too, so a merge never blanks a filled field',
    remaining[0] && remaining[0].title === 'VP Operations', remaining[0] && remaining[0].title);

  let dup = null;
  try {
    await run(`insert into partners(org_id,email,name) values ('${ORG}','ada@client.com','Impostor')`);
    dup = 'inserted';
  } catch (e) { dup = e.code; }
  check('a second identity with the same email in the same workspace cannot be created', dup === '23505', dup);

  let dupCase = null;
  try {
    await run(`insert into partners(org_id,email,name) values ('${ORG}','ADA@CLIENT.COM','Impostor')`);
    dupCase = 'inserted';
  } catch (e) { dupCase = e.code; }
  check('uniqueness is case-insensitive: ADA@CLIENT.COM is the same person', dupCase === '23505', dupCase);

  // The constraint is per workspace, not global. The same person may be a
  // partner of two different orgs.
  let crossOrg = 'blocked';
  try {
    await run(`insert into partners(org_id,email,name) values ('${ORG2}','ada@client.com','Ada')`);
    crossOrg = 'inserted';
  } catch (e) { crossOrg = e.code; }
  check('the same email in a DIFFERENT workspace is still allowed', crossOrg === 'inserted', crossOrg);

  // Blank emails are unclaimed placeholders, not identities: collapsing them
  // would join unrelated people, so they are excluded from the index.
  let blanks = 'blocked';
  try {
    await run(`insert into partners(org_id,email,name) values ('${ORG}','','Placeholder A'),('${ORG}','','Placeholder B')`);
    blanks = 'inserted';
  } catch (e) { blanks = e.code; }
  check('two blank-email placeholders are not collapsed into each other', blanks === 'inserted', blanks);

  /* 2. The portal returns each project exactly once ----------------------- */
  const acc = await all(`select project_id from partner_access where partner_id = $1`, [older]);
  check('access is the union of both identities\u2019 grants, deduplicated by the primary key', acc.length === 1, acc);

  await asUser(CLIENT);
  const projects = (await one(`select partner_projects_v2() p`)).p;
  check('the portal returns the project exactly once', projects.length === 1, projects.map((x) => x.project_id));
  check('the single card still carries its payload', projects[0] && !!projects[0].payload, projects[0]);

  // The distinct is the second layer: prove it holds even if the index is
  // dropped and a duplicate identity is reintroduced underneath the portal.
  await asUser('');
  await run(`drop index if exists partners_org_email_uniq`);
  const ghost = (await one(`insert into partners(org_id,user_id,email,name)
    values ('${ORG}','${CLIENT}','ada@client.com','Ada Ghost') returning id`)).id;
  await run(`insert into partner_access(partner_id,project_id) values ($1,'northwind')`, [ghost]);
  await asUser(CLIENT);
  const stillOne = (await one(`select partner_projects_v2() p`)).p;
  check('with the index dropped and a duplicate identity present, the portal STILL returns one card',
    stillOne.length === 1, stillOne.map((x) => x.project_id));

  /* 3. The dedup pass preserves message history --------------------------- */
  await asUser('');
  const notes = await all(`select ref, partner_id from comms where project_id='northwind' and origin='partner' order by ref`);
  check('both notes survive the merge', notes.length === 2, notes.length);
  check('both are repointed at the keeper, so neither is orphaned',
    notes.every((n) => n.partner_id === older), notes);
  const orphaned = (await one(`select count(*)::int n from comms where origin='partner' and partner_id is null`)).n;
  check('no partner note was left unattributed by the delete', orphaned === 0, orphaned);
  const v1notes = await all(`select partner_id from partner_notes`);
  check('v1-era partner_notes rows are repointed as well', v1notes.every((n) => n.partner_id === older), v1notes);

  // And the thread the partner actually reads still returns both.
  await asUser(CLIENT);
  const thread = (await one(`select partner_thread_v2('northwind') t`)).t;
  check('the partner still sees their whole history in one thread', thread.length === 2, thread.length);

  /* Idempotence: re-running the schema on clean data changes nothing ------- */
  await asUser('');
  await run(`delete from partner_access where partner_id = $1`, [ghost]);
  await run(`delete from partners where id = $1`, [ghost]);
  await run(sql(rel('../../supabase/schema.sql')));
  const after = (await one(`select count(*)::int n from partners where org_id='${ORG}' and coalesce(trim(email),'') <> ''`)).n;
  const notesAfter = (await one(`select count(*)::int n from comms where origin='partner'`)).n;
  check('re-running the merge on clean data is a no-op', after === 1 && notesAfter === 2, { after, notesAfter });

  // The standalone live-DB patch carries identical content and must also be
  // safe to run twice against an already-fixed database.
  await run(sql(rel('../../supabase/migrations/0011_partner_identity.sql')));
  await run(sql(rel('../../supabase/migrations/0011_partner_identity.sql')));
  const afterPatch = (await one(`select count(*)::int n from partners where org_id='${ORG}' and coalesce(trim(email),'') <> ''`)).n;
  check('migrations/0011_partner_identity.sql is idempotent against a fixed database', afterPatch === 1, afterPatch);
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\npartner-identity.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
