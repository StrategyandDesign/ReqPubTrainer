/* Proves the read-time brand overlay: a collaborator logo uploaded AFTER a brief
   was shared still reaches every external viewer (partner portal, SME brief,
   presentation link) without re-publishing, and without mutating the stored
   snapshot. Guards the v2.8.1 fix. Run: node tests/backend-e2e/brand-overlay.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-brand-' + process.pid), user: 'postgres', password: 'pw', port: 55457, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55457, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

// A real (tiny) PNG data URL - the shape okLogo() accepts and downscaleLogo() emits.
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const MGR = '11111111-0000-0000-0000-000000000001';
const PARTNER = '22222222-0000-0000-0000-000000000002';
const ORG = '33333333-0000-0000-0000-000000000003';

try {
  await db.query(sql(rel('shim.sql')));
  await db.query(sql(rel('v1-backend.sql')));
  await db.query(sql(rel('../../supabase/schema.sql')));

  await db.query(`insert into auth.users(id,email) values ($1,'mgr@collection.co'),($2,'partner@vendor.co')`, [MGR, PARTNER]);
  await db.query(`insert into orgs(id,name,created_by) values ($1,'Collection Ventures',$2)`, [ORG, MGR]);
  await db.query(`insert into org_members(org_id,user_id,email,role) values ($1,$2,'mgr@collection.co','manager')`, [ORG, MGR]);
  // Fathering PRD - created with NO logo yet (as the SQL seed leaves it).
  await db.query(`insert into projects(id,org_id,name,brand_logo,brand_label) values ('fathering',$1,'Fathering Excellence Profile','','')`, [ORG]);
  // A partner is assigned to it.
  const pid = (await one(`insert into partners(org_id,user_id,email,name) values ($1,$2,'partner@vendor.co','Vendor') returning id`, [ORG, PARTNER])).id;
  await db.query(`insert into partner_access(partner_id,project_id) values ($1,'fathering')`, [pid]);

  // The team shares the brief NOW - before any logo exists. Snapshot has empty brand.
  await db.query(`insert into shares(token,org_id,project_id,version_seq,kind,payload,revoked)
    values ('tok-brief',$1,'fathering',1,'brief',
      jsonb_build_object('product','Fathering Excellence Profile','label','1.0','logo','','brandLabel','','answers',jsonb_build_object('ctrl_product','Fathering Excellence Profile')),
      false)`, [ORG]);

  // Sanity: before the fix would apply, the stored snapshot logo is empty.
  const stored0 = await one(`select payload->>'logo' logo from shares where token='tok-brief'`);
  check('stored snapshot starts with empty logo', stored0.logo === '', stored0.logo);

  // The manager uploads the logo LATER (updates projects.brand_logo directly).
  await db.query(`update projects set brand_logo=$1, brand_label='Fathers.com' where id='fathering'`, [LOGO]);

  // 1) SME brief / presentation link (get_share) now reflects the live logo.
  const gs = await one(`select get_share('tok-brief') p`);
  check('get_share overlays the current logo', gs.p.logo === LOGO, (gs.p.logo || '').slice(0, 24));
  check('get_share overlays the current brand label', gs.p.brandLabel === 'Fathers.com', gs.p.brandLabel);
  check('get_share preserves the rest of the snapshot', gs.p.product === 'Fathering Excellence Profile' && gs.p.answers.ctrl_product === 'Fathering Excellence Profile', gs.p);

  // 2) Partner portal (partner_projects_v2), read AS the partner. Assign a SECOND
  //    project with NO published brief: the partner should NOT see it (only
  //    review-ready PRDs surface), and the published one carries its real name.
  await db.query(`insert into projects(id,org_id,name) values ('nobrief',$1,'Unpublished PRD')`, [ORG]);
  await db.query(`insert into partner_access(partner_id,project_id) values ($1,'nobrief')`, [pid]);
  await asUser(PARTNER);
  const pp = await one(`select partner_projects_v2() arr`);
  const byId = Object.fromEntries((pp.arr || []).map((e) => [e.project_id, e]));
  const fe = byId['fathering'];
  check('partner sees only the PRD with a published brief', (pp.arr || []).length === 1 && !!fe, (pp.arr || []).map((e) => e.project_id));
  check('assignment with no published brief is hidden', !byId['nobrief'], Object.keys(byId));
  check('partner view returns the project name', fe && fe.name === 'Fathering Excellence Profile', fe && fe.name);
  check('partner view overlays the current logo', fe && fe.payload.logo === LOGO, fe && (fe.payload.logo || '').slice(0, 24));
  check('partner view overlays the current brand label', fe && fe.payload.brandLabel === 'Fathers.com', fe && fe.payload.brandLabel);
  await asUser('');

  // 3) The overlay is read-time only: stored snapshot is never mutated.
  const stored1 = await one(`select payload->>'logo' logo from shares where token='tok-brief'`);
  check('stored snapshot remains untouched (overlay is read-time)', stored1.logo === '', stored1.logo);

  // 4) No logo set → overlay yields empty, not null (no accidental broken <img>).
  await db.query(`insert into projects(id,org_id,name) values ('nologo',$1,'No Logo PRD')`, [ORG]);
  await db.query(`insert into shares(token,org_id,project_id,version_seq,kind,payload,revoked)
    values ('tok-nologo',$1,'nologo',1,'brief',jsonb_build_object('product','No Logo PRD','logo','','brandLabel',''),false)`, [ORG]);
  const gz = await one(`select get_share('tok-nologo') p`);
  check('get_share yields empty logo when none is set', gz.p.logo === '', gz.p.logo);

  // 5) Defensive: a share whose project row is gone falls back to the raw payload.
  await db.query(`insert into shares(token,org_id,project_id,version_seq,kind,payload,revoked)
    values ('tok-orphan',$1,'ghost',1,'brief',jsonb_build_object('product','Ghost','logo','','brandLabel',''),false)`, [ORG]);
  const go = await one(`select get_share('tok-orphan') p`);
  check('get_share tolerates a missing project row', go.p && go.p.product === 'Ghost', go.p);
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\nbrand-overlay.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
