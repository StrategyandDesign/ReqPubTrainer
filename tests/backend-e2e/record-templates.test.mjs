/* Firm templates (v2.30.0): a manager saves the standing structure of a
   record; members read and apply it; nobody outside the org sees it. The
   server enforces the caps: name 1..80, payload 64 KB, 50 per org.
   reviewed_at makes staleness visible and only a manager can refresh it.
   Direct table writes are revoked. Run:
   node tests/backend-e2e/record-templates.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-rtpl-' + process.pid), user: 'postgres', password: 'pw', port: 55481, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55481, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const rows = async (q, a) => (await db.query(q, a)).rows;
const run = (q) => db.query(q);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000b1';
const MEM = '22222222-0000-0000-0000-0000000000b2';    // member, viewer role
const RIVAL = '33333333-0000-0000-0000-0000000000b3';  // manager of another org
const ORG = '44444444-0000-0000-0000-0000000000b4';
const RORG = '55555555-0000-0000-0000-0000000000b5';

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  // Prove the standalone migration is idempotent on top of the base schema.
  await run(sql(rel('../../supabase/migrations/0015_record_templates.sql')));

  await run(`insert into auth.users(id,email) values
    ('${MGR}','mgr@collection.co'),('${MEM}','mem@collection.co'),('${RIVAL}','rival@other.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}'),('${RORG}','Rival Co','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@collection.co','manager'),
    ('${ORG}','${MEM}','mem@collection.co','viewer'),
    ('${RORG}','${RIVAL}','rival@other.co','manager')`);

  const payload = JSON.stringify({ scalars: { ctrl_org: 'Collection Ventures', ctrl_doctype: 'engagement' },
    rows: { nfr: [{ stmt: 'Single tenant isolation.', fit: 'Default deny on every table.', pri: 'Must' }],
            glossary: [{ term: 'Baseline', meaning: 'An immutable numbered snapshot.' }] } });

  await asUser(MGR);
  const put = (await one(`select record_template_put('${ORG}','Standard engagement','${payload}'::jsonb) r`)).r;
  check('a manager saves a firm template', put.ok === true && !!put.id, put);
  const TID = put.id;

  check('a blank name is rejected', (await one(`select record_template_put('${ORG}','   ','{}'::jsonb) r`)).r.error === 'bad_name');
  check('an over-long name is rejected', (await one(`select record_template_put('${ORG}','${'x'.repeat(81)}','{}'::jsonb) r`)).r.error === 'bad_name');
  check('an oversize payload is rejected',
    (await one(`select record_template_put('${ORG}','Big', jsonb_build_object('blob', repeat('x', 70000))) r`)).r.error === 'too_large');

  await asUser(MEM);
  const list = await rows(`select * from record_templates_list('${ORG}')`);
  check('a member lists the org templates', list.length === 1 && list[0].name === 'Standard engagement', list);
  const got = (await one(`select record_template_get('${TID}') r`)).r;
  check('a member reads the payload for apply', got && got.payload && got.payload.scalars.ctrl_doctype === 'engagement', got);
  check('a member cannot save a template', (await one(`select record_template_put('${ORG}','Nope','{}'::jsonb) r`)).r.error === 'forbidden');
  check('a member cannot delete a template', (await one(`select record_template_delete('${TID}') r`)).r.error === 'forbidden');
  check('a member cannot mark a template reviewed', (await one(`select record_template_touch('${TID}') r`)).r.error === 'forbidden');

  await asUser(RIVAL);
  await run('set role authenticated');
  check('an outsider sees no templates via RLS', (await rows(`select * from record_templates`)).length === 0);
  await run('reset role');
  check('an outsider gets nothing from the list RPC', (await rows(`select * from record_templates_list('${ORG}')`)).length === 0);
  check('an outsider cannot read a payload', (await one(`select record_template_get('${TID}') r`)).r === null);
  check('an outsider manager cannot delete across orgs', (await one(`select record_template_delete('${TID}') r`)).r.error === 'forbidden');

  await asUser(MEM);
  await run('set role authenticated');
  let denied = false;
  try { await run(`insert into record_templates(org_id,name) values ('${ORG}','Direct')`); } catch { denied = true; }
  check('direct table writes are revoked', denied);
  await run('reset role');

  await asUser(MGR);
  const before = (await one(`select reviewed_at from record_templates where id='${TID}'`)).reviewed_at;
  await run(`update record_templates set reviewed_at = reviewed_at - interval '90 days' where id='${TID}'`).catch(() => {});
  const touch = (await one(`select record_template_touch('${TID}') r`)).r;
  const after = (await one(`select reviewed_at from record_templates where id='${TID}'`)).reviewed_at;
  check('a manager marks a template reviewed and the date moves', touch.ok === true && after >= before, { touch });
  check('the activity log carries the template actions',
    (await one(`select count(*)::int c from activity where action in ('template.saved','template.reviewed')`)).c >= 2);

  check('the 50-per-org cap holds', await (async () => {
    for (let i = 0; i < 49; i++) {
      const r = (await one(`select record_template_put('${ORG}','T${i}','{}'::jsonb) r`)).r;
      if (!r.ok) return false;
    }
    return (await one(`select record_template_put('${ORG}','T-over','{}'::jsonb) r`)).r.error === 'too_many';
  })());

  const del = (await one(`select record_template_delete('${TID}') r`)).r;
  check('a manager deletes a template', del.ok === true
    && (await one(`select count(*)::int c from record_templates where id='${TID}'`)).c === 0, del);
} finally {
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
}
console.log(`record-templates.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
