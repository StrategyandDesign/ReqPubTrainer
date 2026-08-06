/* Version integrity: an approved baseline cannot be rewritten, by anyone,
   through any path except the definer RPCs. Locks the v2.20 fix for the
   independent-review finding: the old ver_update policy + table grant let a
   manager UPDATE snapshot/status/label/created_at directly, silently. Now
   direct write is revoked, the policy is gone, the build tag moves only
   through version_set_build (gated, capped, logged), and the state machine
   plus approvals gate remain the only way status moves. Run:
   node tests/backend-e2e/version-integrity.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-vint-' + process.pid), user: 'postgres', password: 'pw', port: 55475, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55475, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
const denied = async (q) => { try { await run(q); return false; } catch { return true; } };
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000f1';
const VIEWER = '22222222-0000-0000-0000-0000000000f2';
const RIVAL = '33333333-0000-0000-0000-0000000000f3';
const ORG = '44444444-0000-0000-0000-0000000000f4';
const RIVAL_ORG = '55555555-0000-0000-0000-0000000000f5';

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

  await asUser(MGR);
  const made = await one(`select create_version('reqpub', false, 'Initial', '{"answers":{"ov_vision":"V"}}'::jsonb, '') r`);
  check('create_version still allocates the baseline', made.r.ok === true && made.r.label === '1.0', made.r);
  const vid = made.r.id;
  await run(`insert into version_approvals(version_id, approver_role, approver_name) values ('${vid}','Sponsor','Client')`);

  // The hole, closed: every direct write to versions is refused at the grant,
  // for a manager of the very project that owns the row.
  await run('set role authenticated');
  check('manager cannot rewrite the snapshot directly',
    await denied(`update versions set snapshot='{"answers":{"ov_vision":"FORGED"}}'::jsonb where id='${vid}'`));
  check('manager cannot force status to approved directly',
    await denied(`update versions set status='approved' where id='${vid}'`));
  check('manager cannot rewrite label or created_at directly',
    await denied(`update versions set label='9.9', created_at=now() - interval '1 year' where id='${vid}'`));
  check('manager cannot insert a fabricated baseline directly',
    await denied(`insert into versions(project_id, seq, label, snapshot) values ('reqpub', 99, '9.0', '{}'::jsonb)`));
  check('manager cannot delete a baseline directly',
    await denied(`delete from versions where id='${vid}'`));

  // The one legitimate mutation: the build tag, through its definer RPC.
  const b1 = await one(`select version_set_build('${vid}'::uuid, 'build-2026.07.13') r`);
  const bRead = await one(`select build, status, label from versions where id='${vid}'`);
  check('version_set_build sets the build tag for a manager', b1.r === true && bRead.build === 'build-2026.07.13', bRead);
  check('nothing else on the row moved with it', bRead.status === 'draft' && bRead.label === '1.0', bRead);
  const bLog = await one(`select count(*) n from activity where action='version.build' and entity_id='${vid}'`);
  check('the build change landed on the audit trail', bLog.n === '1', bLog.n);
  const bBig = await one(`select version_set_build('${vid}'::uuid, repeat('x', 121)) r`);
  check('an oversized build tag is refused', bBig.r === false);
  await asUser(VIEWER);
  check('a viewer cannot set the build tag', (await one(`select version_set_build('${vid}'::uuid, 'nope') r`)).r === false);
  await asUser(RIVAL);
  check('a rival-org manager cannot set the build tag', (await one(`select version_set_build('${vid}'::uuid, 'nope') r`)).r === false);

  // The state machine and the approvals gate remain the only way status moves.
  await asUser(MGR);
  const toReview = await one(`select version_set_status('${vid}'::uuid, 'in_review') r`);
  check('status still moves through the RPC transition whitelist', toReview.r.ok === true);
  const gate = await one(`select version_set_status('${vid}'::uuid, 'approved') r`);
  check('the approvals gate still blocks Approved with a pending sign-off', gate.r.ok === false && gate.r.error === 'approvals_pending', gate.r);
  const slot = await one(`select id from version_approvals where version_id='${vid}'`);
  // v2.28.1: the decision itself approves the version - no second call.
  const auto = await one(`select approval_decide('${slot.id}'::uuid, 'approved', 'ok') r`);
  check('with every sign-off green, the decision approves the version', auto.r.version_status === 'approved'
    && (await one(`select status from versions where id='${vid}'`)).status === 'approved', auto.r);
  await run('reset role');

  // Live-install path: simulate the pre-2.20 posture, then prove the fix
  // closes it and runs twice cleanly.
  await run(`grant update on versions to authenticated`);
  await run(`create policy ver_update on versions for update using (is_project_manager(project_id)) with check (is_project_manager(project_id))`);
  await run(sql(rel('../../supabase/migrations/0019_version_integrity.sql')));
  await run(sql(rel('../../supabase/migrations/0019_version_integrity.sql')));
  await asUser(MGR); await run('set role authenticated');
  check('migrations/0019_version_integrity.sql closes a legacy install and runs twice cleanly',
    await denied(`update versions set status='approved' where id='${vid}'`));
  await run('reset role');
} catch (e) {
  fail++; console.log('  ✗ suite error → ' + (e && e.message));
} finally {
  try { await db.end(); } catch { /* already closed */ }
  await epg.stop();
}
console.log('\nversion-integrity.test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
