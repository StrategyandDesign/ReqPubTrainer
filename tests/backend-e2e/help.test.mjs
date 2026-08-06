/* ReqPub v2 - help system backend (node tests/backend-e2e/help.test.mjs)
   The security gate for in-app help: RLS on all five tables plus the stats
   RPC, exercised as manager, member, rival, and forged identities, with
   migrations/0008_help.sql applied twice on top of schema.sql. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-help-' + process.pid), user: 'postgres', password: 'pw', port: 55488, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55488, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const tryQ = async (q) => { try { const r = await db.query(q); return { rows: r.rows }; } catch (e) { await db.query('rollback').catch(() => {}); return { error: e.message }; } };
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000e1';
const MEM = '11111111-0000-0000-0000-0000000000e2';
const RIVAL = '11111111-0000-0000-0000-0000000000e3';
const ORG = '22222222-0000-0000-0000-0000000000e4';
const RORG = '22222222-0000-0000-0000-0000000000e5';

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  await run(sql(rel('../../supabase/migrations/0008_help.sql')));
  await run(sql(rel('../../supabase/migrations/0008_help.sql')));
  check('migrations/0008_help.sql applies twice on top of schema.sql', true);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${MEM}','mem@cv.co'),('${RIVAL}','rival@other.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}'),('${RORG}','Rival','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@cv.co','manager'),('${ORG}','${MEM}','mem@cv.co','viewer'),('${RORG}','${RIVAL}','rival@other.co','manager')`);
  await run(`set role authenticated`);

  /* ---- authoring is manager-only ---- */
  await asUser(MGR);
  const t1 = (await one(`insert into help_topics(org_id,title,body_md,routes,audience) values ('${ORG}','Publish an update','# How','{workspace}','all') returning id`)).id;
  check('manager creates a draft topic', !!t1);
  await asUser(MEM);
  const memIns = await tryQ(`insert into help_topics(org_id,title) values ('${ORG}','nope') returning id`);
  check('member cannot author topics', !!memIns.error, memIns.error);
  await asUser(RIVAL);
  const rivIns = await tryQ(`insert into help_topics(org_id,title) values ('${ORG}','nope') returning id`);
  check('outsider cannot author topics', !!rivIns.error, rivIns.error);

  /* ---- drafts hidden from members; publish opens them; edits stay manager-only ---- */
  await asUser(MEM);
  check('member sees zero drafts', +(await one(`select count(*) n from help_topics`)).n === 0);
  await asUser(MGR);
  check('manager sees the draft', +(await one(`select count(*) n from help_topics`)).n === 1);
  await run(`update help_topics set is_published = true where id = '${t1}'`);
  await asUser(MEM);
  check('member sees it once published', (await one(`select title from help_topics`)).title === 'Publish an update');
  const memUpd = await tryQ(`update help_topics set title='defaced' where id='${t1}' returning id`);
  check('member cannot edit a topic', !memUpd.error && memUpd.rows.length === 0, memUpd);
  await asUser(RIVAL);
  check('outsider sees nothing, published or not', +(await one(`select count(*) n from help_topics`)).n === 0);

  /* ---- steps follow the topic ---- */
  await asUser(MGR);
  await run(`insert into help_steps(topic_id,step_order,anchor_key,title,body_md) values
    ('${t1}',1,'ws.generate','Generate','Click.'),('${t1}',2,'doc.updates','Compose','Here.')`);
  await asUser(MEM);
  check('member reads steps of a published topic', +(await one(`select count(*) n from help_steps`)).n === 2);
  const memStep = await tryQ(`insert into help_steps(topic_id,title) values ('${t1}','x') returning id`);
  check('member cannot write steps', !!memStep.error, memStep.error);
  await asUser(RIVAL);
  check('outsider reads zero steps', +(await one(`select count(*) n from help_steps`)).n === 0);

  /* ---- per-user state and prefs are self-only ---- */
  await asUser(MEM);
  await run(`insert into help_state(user_id,topic_id,seen,dismissed) values ('${MEM}','${t1}',true,true)`);
  check('member writes own state', (await one(`select dismissed from help_state`)).dismissed === true);
  await asUser(MGR);
  check('nobody reads another user\u2019s state, managers included', +(await one(`select count(*) n from help_state`)).n === 0);
  await asUser(RIVAL);
  const forge = await tryQ(`insert into help_state(user_id,topic_id) values ('${MEM}','${t1}')`);
  check('state cannot be written as someone else', !!forge.error, forge.error);
  await asUser(MEM);
  await run(`insert into help_prefs(user_id,beacon_hidden) values ('${MEM}',true)`);
  await asUser(MGR);
  check('prefs are self-scoped', +(await one(`select count(*) n from help_prefs`)).n === 0);

  /* ---- events: own only, org members only; raw reads manager-only ---- */
  await asUser(MEM);
  await run(`insert into help_events(topic_id,user_id,event_type) values ('${t1}','${MEM}','view')`);
  await run(`insert into help_events(topic_id,user_id,event_type) values ('${t1}','${MEM}','complete')`);
  const spoof = await tryQ(`insert into help_events(topic_id,user_id,event_type) values ('${t1}','${MGR}','view')`);
  check('events cannot be recorded as someone else', !!spoof.error, spoof.error);
  check('member cannot read raw events', +(await one(`select count(*) n from help_events`)).n === 0);
  await asUser(RIVAL);
  const rivEv = await tryQ(`insert into help_events(topic_id,user_id,event_type) values ('${t1}','${RIVAL}','view')`);
  check('an outsider cannot record events on the org\u2019s topics', !!rivEv.error, rivEv.error);

  /* ---- stats RPC ---- */
  await asUser(MGR);
  const stats = (await one(`select help_stats('${ORG}') s`)).s;
  check('help_stats gives the manager per-topic view and completion counts',
    stats.ok === true && +stats.topics[0].views === 1 && +stats.topics[0].completes === 1, stats);
  await asUser(MEM);
  const memStats = (await one(`select help_stats('${ORG}') s`)).s;
  check('help_stats refuses non-managers', memStats.ok === false && memStats.error === 'forbidden', memStats);

  /* ---- delete cascades everything ---- */
  await asUser(MGR);
  await run(`delete from help_topics where id = '${t1}'`);
  await run(`reset role`);
  const left = await one(`select (select count(*) from help_steps) s, (select count(*) from help_events) e, (select count(*) from help_state) t`);
  check('deleting a topic cascades steps, events, and state', +left.s === 0 && +left.e === 0 && +left.t === 0, left);
} catch (e) {
  fail++;
  console.log('  FATAL: ' + String(e.message || e).split('\n')[0]);
} finally {
  console.log('\nhelp.test: ' + pass + ' passed, ' + fail + ' failed');
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
  process.exit(fail ? 1 : 0);
}
