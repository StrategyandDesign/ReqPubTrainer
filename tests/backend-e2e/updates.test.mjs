/* Weekly updates: a published update is evidence - manager-published under a
   project lock, immutable at the grant, member-readable, client-readable
   only through its token, withdrawable but never editable. This file pins
   the whole lifecycle plus the boundaries. Run:
   node tests/backend-e2e/updates.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-upd-' + process.pid), user: 'postgres', password: 'pw', port: 55479, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55479, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q) => db.query(q);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
const denied = async (q) => { try { await run(q); return false; } catch { await db.query('rollback').catch(() => {}); return true; } };
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000b1';
const VIEW = '22222222-0000-0000-0000-0000000000b2';
const RIVAL = '33333333-0000-0000-0000-0000000000b3';
const ORG = '44444444-0000-0000-0000-0000000000b4';
const RORG = '55555555-0000-0000-0000-0000000000b5';

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  // The standalone live-DB migration must be idempotent on top of the schema.
  await run(sql(rel('../../supabase/migrations/0018_updates.sql')));
  await run(sql(rel('../../supabase/migrations/0018_updates.sql')));
  check('migrations/0018_updates.sql applies twice cleanly on top of schema.sql',
    +(await one(`select count(*) c from pg_proc where proname='update_publish'`)).c === 1);

  await run(`insert into auth.users(id,email) values
    ('${MGR}','mgr@collection.co'),('${VIEW}','viewer@collection.co'),('${RIVAL}','rival@other.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}'),('${RORG}','Rival Co','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@collection.co','manager'),
    ('${ORG}','${VIEW}','viewer@collection.co','viewer'),
    ('${RORG}','${RIVAL}','rival@other.co','manager')`);
  await run(`insert into projects(id,org_id,name) values ('recordmade','${ORG}','RecordMade')`);
  const PAY = `'{"strip":{"health":"On track","next":{"text":"Gate V","target":""}},"asks":[{"text":"Approve v1.0","why":"","src":"appr:x"}],"moved":[],"open":[],"closed":[],"next":"","window":{"from":null,"to":"2026-07-13"}}'::jsonb`;

  console.log('- authorization on publish -');
  await asUser(VIEW);
  check('a viewer cannot publish an update',
    (await one(`select update_publish('recordmade', ${PAY}) r`)).r.ok === false);
  await asUser(RIVAL);
  check('a manager of another org cannot publish here',
    (await one(`select update_publish('recordmade', ${PAY}) r`)).r.ok === false);

  console.log('- the publish path -');
  await asUser(MGR);
  const p1 = (await one(`select update_publish('recordmade', ${PAY}, null, '  D. Reyes  ') r`)).r;
  check('a manager publishes: seq 1, server token, ok', p1.ok === true && p1.seq === 1 && String(p1.token).length >= 20, p1);
  const p2 = (await one(`select update_publish('recordmade', ${PAY}, '2026-07-13T00:00:00Z', 'D. Reyes') r`)).r;
  check('the next publish allocates seq 2 under the project lock', p2.ok === true && p2.seq === 2, p2);
  check('prepared_by lands trimmed', (await one(`select prepared_by p from updates where seq=1 and project_id='recordmade'`)).p === 'D. Reyes');
  check('a non-object payload is refused',
    (await one(`select update_publish('recordmade', '["not","an","object"]'::jsonb) r`)).r.error === 'bad_payload');
  check('an oversized payload is refused at the cap',
    (await one(`select update_publish('recordmade', jsonb_build_object('big', repeat('x', 300000))) r`)).r.error === 'too_large');
  check('publishing writes the activity trail',
    +(await one(`select count(*) c from activity where project_id='recordmade' and action='update.published'`)).c === 2);

  console.log('- who reads what -');
  check('a member reads the archive through row-level security',
    +(await one(`select count(*) c from (select * from updates where is_project_member(project_id)) s`)).c >= 2);
  await asUser(RIVAL);
  check('a rival org sees no rows through the policy',
    +(await one(`select count(*) c from (select * from updates where is_project_member(project_id)) s`)).c === 0);
  await asUser(MGR);

  console.log('- immutable at the grant -');
  await run('set role authenticated');
  check('published payloads cannot be rewritten, even by the manager, directly',
    await denied(`update updates set payload='{}'::jsonb where seq=1`));
  check('rows cannot be inserted around the RPC',
    await denied(`insert into updates(org_id,project_id,seq,token,payload) values ('${ORG}','recordmade',99,'tok-forged','{}'::jsonb)`));
  check('rows cannot be deleted - the archive is append-only',
    await denied(`delete from updates where seq=1`));
  await run('reset role');

  console.log('- the client\u2019s token page -');
  await asUser('');
  const ctx = (await one(`select update_context('${p1.token}') r`)).r;
  check('the token serves the frozen payload, the project name, and the byline',
    ctx && ctx.ok === true && ctx.revoked === false && ctx.project === 'RecordMade' &&
    ctx.preparedBy === 'D. Reyes' && ctx.payload.asks[0].text === 'Approve v1.0', ctx);
  check('an unknown token serves nothing', (await one(`select update_context('no-such-token-here-x') r`)).r == null);

  console.log('- withdrawal -');
  const uid1 = (await one(`select id from updates where seq=1 and project_id='recordmade'`)).id;
  await asUser(VIEW);
  check('a viewer cannot withdraw', (await one(`select update_revoke('${uid1}') r`)).r === false);
  await asUser(MGR);
  check('a manager withdraws, idempotently',
    (await one(`select update_revoke('${uid1}') r`)).r === true && (await one(`select update_revoke('${uid1}') r`)).r === true);
  const gone = (await one(`select update_context('${p1.token}') r`)).r;
  check('a withdrawn link says so and carries no payload',
    gone.ok === true && gone.revoked === true && gone.payload === undefined && gone.project === 'RecordMade', gone);
  check('withdrawal writes the activity trail',
    +(await one(`select count(*) c from activity where action='update.revoked'`)).c === 1);
} catch (e) {
  fail++; console.error('SUITE ERROR:', e.message || e);
} finally {
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
}
console.log(`\nupdates.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
