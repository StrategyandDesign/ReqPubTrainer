/* deploy-fathering-baseline.sql: rebuilds the existing Fathering project in
   place - retitle, erase every SME/partner interchange, replace content, and
   publish an approved v1.1 - without touching any other project. Run:
   node tests/backend-e2e/deploy-fathering.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../../app/js/domain.js';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-depf-' + process.pid), user: 'postgres', password: 'pw', port: 55469, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55469, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MICAH = '11111111-0000-0000-0000-0000000000f1';
const ORG = '22222222-0000-0000-0000-0000000000f2';
const FID = 'prd-fathering-excellence';   // the project the deploy rebuilds
const OTHER = 'other-recordmade';          // a bystander project that must be untouched

async function seedInterchanges() {
  // Old worksheet content (must be replaced).
  await run(`insert into project_fields(project_id,field_id,value,rev) values ($1,'ov_vision','"OLD VISION"'::jsonb,1)`, [FID]);
  await run(`insert into field_rows(project_id,field_id,k,data,pos) values ($1,'fr',1,'{"stmt":"old requirement","fit":"old"}'::jsonb,1)`, [FID]);
  // Interchanges on the Fathering project.
  const c1 = (await one(`insert into comms(org_id,project_id,origin,author_name,title,body) values ($1,$2,'partner','Jeremy','Partner note','Scope question') returning id`, [ORG, FID])).id;
  const c2 = (await one(`insert into comms(org_id,project_id,origin,author_name,body,reply_token) values ($1,$2,'sme','SME','SME feedback','tok-abc') returning id`, [ORG, FID])).id;
  await run(`insert into comms(org_id,project_id,origin,author_name,body) values ($1,$2,'team','Micah','Team note')`, [ORG, FID]);
  await run(`insert into messages(org_id,parent_kind,parent_id,author_kind,body) values ($1,'comm',$2,'partner','a reply')`, [ORG, c1]);
  await run(`insert into input_requests(org_id,project_id,title,prompt) values ($1,$2,'Ask an SME','Please review')`, [ORG, FID]);
  await run(`insert into shares(token,org_id,project_id,version_seq,kind,payload) values ('share-fath',$1,$2,1,'brief','{}'::jsonb)`, [ORG, FID]);
  await run(`insert into attachments(org_id,project_id,uploader_kind,file_name,storage_path) values ($1,$2,'partner','doc.pdf','p/fath/doc.pdf')`, [ORG, FID]);
  const partner = (await one(`insert into partners(org_id,email,name) values ($1,'jeremy@vendor.co','Jeremy') returning id`, [ORG])).id;
  await run(`insert into partner_access(partner_id,project_id) values ($1,$2)`, [partner, FID]);
  // A prior version + a pending approval (must be cleared, replaced by approved v1.1).
  const oldv = (await one(`insert into versions(project_id,seq,label,status,snapshot) values ($1,1,'1.0','draft','{}'::jsonb) returning id`, [FID])).id;
  await run(`insert into version_approvals(version_id,approver_role,approver_name) values ($1,'Product','Someone')`, [oldv]);
  return { c1, c2 };
}

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));

  await run(`insert into auth.users(id,email) values ('${MICAH}','micah@fathers.com')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MICAH}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${ORG}','${MICAH}','micah@fathers.com','manager')`);
  await run(`insert into projects(id,org_id,name) values ('${FID}','${ORG}','Fathering Excellence Profile'), ('${OTHER}','${ORG}','RecordMade')`);
  await seedInterchanges();
  // A bystander interchange on the OTHER project that must survive.
  const oc = (await one(`insert into comms(org_id,project_id,origin,body) values ('${ORG}','${OTHER}','team','other note') returning id`)).id;
  await run(`insert into messages(org_id,parent_kind,parent_id,author_kind,body) values ('${ORG}','comm',$1,'team','other reply')`, [oc]);

  await run(sql(rel('../../supabase/deploy-fathering-baseline.sql')));

  // --- Retitle in place (same id) ---
  const proj = await one(`select name, archived from projects where id='${FID}'`);
  check('project retitled in place to Fathering Baseline Assessment', proj && proj.name === 'Fathering Baseline Assessment', proj);
  check('project id is unchanged (rebuilt in place, not duplicated)',
    (await one(`select count(*)::int n from projects where name ilike '%fathering%'`)).n === 1);

  // --- Interchanges erased ---
  for (const [t, q] of [
    ['threads (comms)', `select count(*)::int n from comms where project_id='${FID}'`],
    ['messages', `select count(*)::int n from messages where parent_id in (select id from comms where project_id='${FID}')`],
    ['input requests', `select count(*)::int n from input_requests where project_id='${FID}'`],
    ['share links', `select count(*)::int n from shares where project_id='${FID}'`],
    ['attachments', `select count(*)::int n from attachments where project_id='${FID}'`],
    ['partner assignments', `select count(*)::int n from partner_access where project_id='${FID}'`],
  ]) check('erased: ' + t, (await one(q)).n === 0, (await one(q)).n);

  // --- Content replaced ---
  check('old worksheet content is gone', (await one(`select count(*)::int n from project_fields where project_id='${FID}' and value::text like '%OLD VISION%'`)).n === 0);
  check('product name field set to the new title',
    (await one(`select value from project_fields where project_id='${FID}' and field_id='ctrl_product'`)).value === 'Fathering Baseline Assessment');
  check('all 27 functional requirements loaded',
    (await one(`select count(*)::int n from field_rows where project_id='${FID}' and field_id='fr'`)).n === 27,
    (await one(`select count(*)::int n from field_rows where project_id='${FID}' and field_id='fr'`)).n);
  check('AI evaluation criteria loaded (has_ai = Yes)',
    (await one(`select count(*)::int n from field_rows where project_id='${FID}' and field_id='eval'`)).n === 4);

  // --- Approved v1.1 baseline ---
  const vers = await db.query(`select id,label,status,author_name,snapshot from versions where project_id='${FID}'`);
  check('exactly one version, labelled 1.1 and Approved',
    vers.rows.length === 1 && vers.rows[0].label === '1.1' && vers.rows[0].status === 'approved',
    vers.rows.map((v) => ({ l: v.label, s: v.status })));
  const snap = vers.rows[0] && vers.rows[0].snapshot;
  check('the v1.1 snapshot assembles into the full document',
    !!snap && assemble(snap.sections, snap.answers).includes('## 7. Functional Requirements'));
  const appr = (await db.query(`select approver_name,status from version_approvals where version_id=$1 order by approver_name`, [vers.rows[0].id])).rows;
  check('three named approvers, all approved', appr.length === 3 && appr.every((a) => a.status === 'approved'), appr);
  check('the document approvers are recorded', appr.map((a) => a.approver_name).join(',') === 'Alon Arad,Dr. Ken Canfield,Micah Canfield', appr.map((a) => a.approver_name));

  // --- Bystander project untouched ---
  check('another project keeps its threads', (await one(`select count(*)::int n from comms where project_id='${OTHER}'`)).n === 1);
  check('another project keeps its messages', (await one(`select count(*)::int n from messages where parent_id in (select id from comms where project_id='${OTHER}')`)).n === 1);

  // --- Idempotent ---
  await run(sql(rel('../../supabase/deploy-fathering-baseline.sql')));
  check('re-run keeps exactly one approved v1.1',
    (await one(`select count(*)::int n from versions where project_id='${FID}' and label='1.1' and status='approved'`)).n === 1);
  check('re-run keeps the content (27 FR, no interchanges)',
    (await one(`select count(*)::int n from field_rows where project_id='${FID}' and field_id='fr'`)).n === 27 &&
    (await one(`select count(*)::int n from comms where project_id='${FID}'`)).n === 0);
  check('re-run does not duplicate approvers',
    (await one(`select count(*)::int n from version_approvals va join versions v on v.id=va.version_id where v.project_id='${FID}'`)).n === 3);
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message); console.error(e.stack);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\ndeploy-fathering.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
