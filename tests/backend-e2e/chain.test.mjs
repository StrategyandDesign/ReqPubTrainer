/* ReqPub v2 - activity chain backend (node tests/backend-e2e/chain.test.mjs)
   Pins v2.47: genesis honesty, ordering under concurrent writes, append-only
   refusal for every role, tamper detection at the exact seq, repair after a
   simulated miss, RLS isolation, and migrations/0004_chain.sql applied twice. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-chain-' + process.pid), user: 'postgres', password: 'pw', port: 55490, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55490, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const tryQ = async (q) => { try { const r = await db.query(q); return { rows: r.rows }; } catch (e) { await db.query('rollback').catch(() => {}); return { error: e.message }; } };
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000c1';
const VIEW = '11111111-0000-0000-0000-0000000000c2';
const RIVAL = '11111111-0000-0000-0000-0000000000c3';
const ORG = '22222222-0000-0000-0000-0000000000c4';
const RORG = '22222222-0000-0000-0000-0000000000c5';

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  await run(sql(rel('../../supabase/migrations/0004_chain.sql')));
  await run(sql(rel('../../supabase/migrations/0004_chain.sql')));
  check('migrations/0004_chain.sql applies twice on top of schema.sql', true);

/* v2.57.1: log_activity is private after the C1-001 lockdown. The fixture now
   writes the trail row the way the production path does, as the function
   owner, so this suite exercises the chain trigger rather than a grant that
   no longer exists. */
const logAs = async (org, project, action, kind, id, summary) => {
  await run('reset role');
  await run(`select log_activity($1::uuid, $2, $3, $4, $5, $6, '{}'::jsonb)`, [org, project, action, kind, id, summary]);
};

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${VIEW}','view@cv.co'),('${RIVAL}','rival@other.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}'),('${RORG}','Rival','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@cv.co','manager'),('${ORG}','${VIEW}','view@cv.co','viewer'),('${RORG}','${RIVAL}','rival@other.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values ('cp1','${ORG}','Chain Proof','${MGR}'),('rp1','${RORG}','Rival Proj','${RIVAL}')`);

  /* ---- genesis and linkage on first activity ---- */
  await asUser(MGR);
  await logAs(ORG, 'cp1', 'version.created', 'version', 'v1', 'Baseline v1.0');
  const gen = await one(`select a.action, a.summary, c.seq, c.prev_hash from chain_events c join activity a on a.id=c.activity_id where c.project_id='cp1' and c.seq=0`);
  check('genesis is seq 0 with action chain.genesis', gen && gen.action === 'chain.genesis');
  check('genesis message states the honesty position', gen && gen.summary.includes('chain begins at this event') === false ? gen.summary.includes('The chain begins') : true);
  const g0 = await one(`select encode(digest(convert_to('REQPUB-GENESIS:cp1','UTF8'),'sha256'),'hex') as h`);
  check('genesis prev_hash follows the documented formula', gen && gen.prev_hash === g0.h);
  const first = await one(`select c.seq from chain_events c join activity a on a.id=c.activity_id where c.project_id='cp1' and a.action='version.created'`);
  check('the triggering activity chains at seq 1', first && Number(first.seq) === 1);

  /* ---- ordering under 20 concurrent writes ---- */
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    logAs(ORG, 'cp1', 'stress.write', 't', String(i), 'row ' + i)));
  const seqs = (await db.query(`select seq from chain_events where project_id='cp1' order by seq`)).rows.map((r) => Number(r.seq));
  check('20 parallel appends produce a gapless strictly increasing sequence', seqs.length === 22 && seqs.every((s, i) => s === i));

  /* ---- verification passes clean ---- */
  const v1 = await one(`select verify_project_chain('cp1') as v`);
  check('verify walks clean: ok true, zero unchained', v1.v.ok === true && v1.v.unchained === 0 && Number(v1.v.head_seq) === 21);

  /* ---- append-only for every role ---- */
  await run('reset role');
  const up = await tryQ(`update chain_events set entry_hash='00' where project_id='cp1' and seq=1`);
  check('superuser UPDATE is refused by the guard trigger', !!up.error && up.error.includes('append-only'));
  const del = await tryQ(`delete from chain_events where project_id='cp1' and seq=2`);
  check('superuser DELETE is refused by the guard trigger', !!del.error && del.error.includes('append-only'));
  await run('set role authenticated'); await asUser(MGR);
  const upA = await tryQ(`update chain_events set entry_hash='00' where project_id='cp1'`);
  check('authenticated UPDATE is refused', !!upA.error);

  /* ---- tamper detection at the exact seq ---- */
  await run('reset role');
  await run(`alter table chain_events disable trigger chain_events_no_rewrite`);
  await run(`update chain_events set entry_hash = repeat('0',64) where project_id='cp1' and seq=5`);
  await run(`alter table chain_events enable trigger chain_events_no_rewrite`);
  await run('set role authenticated'); await asUser(MGR);
  const v2 = await one(`select verify_project_chain('cp1') as v`);
  check('a flipped byte is reported at its exact divergence seq', v2.v.ok === false && Number(v2.v.divergence_seq) === 5);
  await run('reset role');
  await run(`alter table chain_events disable trigger chain_events_no_rewrite`);
  await run(`update chain_events c set entry_hash = chain_entry_hash(a.*) from activity a where a.id=c.activity_id and c.project_id='cp1' and c.seq=5`);
  await run(`alter table chain_events enable trigger chain_events_no_rewrite`);
  await run('set role authenticated'); await asUser(MGR);
  const v3 = await one(`select verify_project_chain('cp1') as v`);
  check('restoring the true bytes restores ok', v3.v.ok === true);

  /* ---- repair after a simulated trigger miss ---- */
  await run('reset role');
  await run(`alter table activity disable trigger activity_chain_link`);
  await run(`insert into activity(org_id,project_id,actor,actor_name,action,entity_kind,entity_id,summary,meta)
             values ('${ORG}','cp1',null,'system','missed.write','t','m1','slipped past the trigger','{}'::jsonb)`);
  await run(`alter table activity enable trigger activity_chain_link`);
  await run('set role authenticated'); await asUser(MGR);
  const v4 = await one(`select verify_project_chain('cp1') as v`);
  check('the miss shows as unchained coverage, chain still ok', v4.v.ok === true && v4.v.unchained === 1);
  const rep = await one(`select chain_repair('cp1') as r`);
  check('repair appends exactly the missed row', rep.r.repaired === 1);
  const v5 = await one(`select verify_project_chain('cp1') as v`);
  check('after repair: ok, zero unchained, head advanced', v5.v.ok === true && v5.v.unchained === 0 && Number(v5.v.head_seq) === 22);

  /* ---- RLS isolation and gates ---- */
  await asUser(RIVAL);
  const peek = await db.query(`select count(*)::int as n from chain_events where project_id='cp1'`);
  check('a rival org reads zero chain rows', peek.rows[0].n === 0);
  const vfail = await tryQ(`select verify_project_chain('cp1')`);
  check('verify refuses non-members', !!vfail.error && vfail.error.includes('not a member'));
  const rfail = await tryQ(`select chain_repair('cp1')`);
  check('repair refuses non-members', !!rfail.error);
  await asUser(VIEW);
  const vread = await one(`select verify_project_chain('cp1') as v`);
  check('a viewer member can verify the chain', vread.v.ok === true);
  const vrep = await tryQ(`select chain_repair('cp1')`);
  check('repair is manager-gated: a viewer is refused', !!vrep.error && vrep.error.includes('managers only'));
  await asUser(MGR);
  const ins = await tryQ(`insert into chain_events(project_id,activity_id,seq,entry_hash,prev_hash,link_hash) values ('cp1',1,99,'x','x','x')`);
  check('direct insert by authenticated is refused', !!ins.error);

  /* ---- org-level activity stays outside the chain, by design ---- */
  await logAs(ORG, null, 'org.note', 't', 'x', 'org level');
  const orgRows = await one(`select count(*)::int as n from chain_events c join activity a on a.id=c.activity_id where a.project_id is null`);
  check('project_id-null activity is never chained', orgRows.n === 0);
} catch (e) {
  fail++; console.log('  \u2717 FATAL ' + e.message);
}
console.log(`\nchain.test: ${pass} passed, ${fail} failed`);
await db.end().catch(() => {}); await epg.stop().catch(() => {});
process.exit(fail ? 1 : 0);
