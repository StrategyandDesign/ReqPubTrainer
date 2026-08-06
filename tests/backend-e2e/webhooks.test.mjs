/* ReqPub v2 - signed webhooks backend (node tests/backend-e2e/webhooks.test.mjs)
   Pins v2.50: the enqueue triggers on sign.signed, sign.declined, seal.issued,
   and seal.timestamped; one delivery per active endpoint and zero when none
   exist (inert until configured); the payload contract, with no token, no
   email address, and no snapshot content, ever; the manager gates on every
   config RPC and the chained webhook.endpoint_changed audit line recording
   host only; the retry ladder 1m 5m 30m 2h 12h then dead; redeliver; the
   due list; the service-role take and result pair; direct DML revoked.
   migrations/0023_webhooks.sql applied twice on the full prior stack. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-wh-' + process.pid), user: 'postgres', password: 'pw', port: 55498, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55498, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const all = async (q, a) => (await db.query(q, a)).rows;
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000f1';
const MEMBER = '11111111-0000-0000-0000-0000000000f2';
const OUTSIDER = '11111111-0000-0000-0000-0000000000f9';
const ORG = '22222222-0000-0000-0000-0000000000f4';
const RORG = '22222222-0000-0000-0000-0000000000f5';
const VID = 'aaaaaaaa-0000-0000-0000-0000000000f6';
const VID2 = 'aaaaaaaa-0000-0000-0000-0000000000f7';

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  await run(sql(rel('../../supabase/migrations/0004_chain.sql')));
  await run(sql(rel('../../supabase/migrations/0021_sealing.sql')));
  await run(sql(rel('../../supabase/migrations/0022_attachment_hash.sql')));
  await run(sql(rel('../../supabase/migrations/0023_webhooks.sql')));
  await run(sql(rel('../../supabase/migrations/0023_webhooks.sql')));
  check('migrations/0023_webhooks.sql applies twice on the full prior stack', true);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${MEMBER}','viewer@cv.co'),('${OUTSIDER}','x@rival.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}'),('${RORG}','Rival','${OUTSIDER}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@cv.co','manager'),
    ('${ORG}','${MEMBER}','viewer@cv.co','viewer'),
    ('${RORG}','${OUTSIDER}','x@rival.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values ('p1','${ORG}','Fathering Excellence','${MGR}'),('p2','${ORG}','Silent','${MGR}'),('pr','${RORG}','Rival Proj','${OUTSIDER}')`);
  await run(`insert into versions(id,project_id,seq,label,status,author_name,snapshot) values
    ('${VID}','p1',1,'1.0','approved','Micah','{"answers":{},"sections":{}}'::jsonb),
    ('${VID2}','p2',1,'1.0','approved','Micah','{"answers":{"secret":"SNAPCONTENT"},"sections":{}}'::jsonb)`);

  /* ---- endpoint_create: manager gate, https gate, chained audit ---- */
  await run(`set role authenticated`); await asUser(MGR);
  const e1 = await one(`select endpoint_create('p1','https://hooks.example.com/reqpub?key=SECRETQ','primary receiver') j`);
  check('a manager adds an https endpoint', e1.j.ok === true && !!e1.j.id, e1.j);
  const eHttp = await one(`select endpoint_create('p1','http://hooks.example.com/x','') j`);
  check('an http endpoint is refused', eHttp.j.ok === false && eHttp.j.error === 'https_required', eHttp.j);
  await asUser(MEMBER);
  const eV = await one(`select endpoint_create('p1','https://hooks.example.com/x','') j`);
  check('a viewer cannot add an endpoint', eV.j.ok === false && eV.j.error === 'forbidden', eV.j);
  await asUser(OUTSIDER);
  const eX = await one(`select endpoint_create('p1','https://evil.example.com/x','') j`);
  check('a rival-org manager cannot add an endpoint to this project', eX.j.ok === false && eX.j.error === 'forbidden', eX.j);
  await run('reset role');
  const act = await one(`select summary, meta from activity where action='webhook.endpoint_changed' and project_id='p1' order by id desc limit 1`);
  check('the config change is logged with the host, never the full URL',
    act.summary.includes('hooks.example.com') && !act.summary.includes('SECRETQ') && !JSON.stringify(act.meta).includes('SECRETQ'), act);
  const chained = await one(`select count(*)::int n from chain_events c join activity a on a.id = c.activity_id where a.action='webhook.endpoint_changed'`);
  check('the endpoint change is on the chain', chained.n === 1, chained);

  /* ---- sign.signed enqueues once per active endpoint, with the contract ---- */
  await run(`set role authenticated`); await asUser(MGR);
  const sr = await one(`select sign_request_create('${VID}','jane@acme.com','Jane Roe','CTO','fp-abc') j`);
  check('a sign request goes out', sr.j.ok === true, sr.j);
  await run('reset role');
  const signed = await one(`select sign_request_sign('${sr.j.token}','Jane Roe','UA/9') j`);
  check('signing succeeds and returns the pending delivery ids', signed.j.ok === true && Array.isArray(signed.j.pendingDeliveries) && signed.j.pendingDeliveries.length === 1, signed.j);
  const d1 = await one(`select * from webhook_deliveries where id='${signed.j.pendingDeliveries[0]}'`);
  check('exactly one pending delivery exists for the one active endpoint', d1 && d1.state === 'pending' && d1.attempt === 0 && d1.event_type === 'sign.signed',
    d1 && { state: d1.state, attempt: d1.attempt, event: d1.event_type });
  const p = d1.payload;
  check('the payload carries the contract fields',
    p.event === 'sign.signed' && p.deliveryId === d1.id && p.projectId === 'p1' && p.versionLabel === '1.0' && p.seq === 1 &&
    p.signRequestId === sr.j.id && p.docFingerprint === 'fp-abc' && p.signerName === 'Jane Roe' && p.signerRole === 'CTO' &&
    typeof p.occurredAt === 'string' && p.chainHead && typeof p.chainHead.seq === 'number' && /^[0-9a-f]{64}$/.test(p.chainHead.linkHash), p);
  const ptext = JSON.stringify(p);
  check('the payload never carries a token, an email, or snapshot content',
    !ptext.includes(sr.j.token) && !ptext.includes('@') && !ptext.includes('SNAPCONTENT'), ptext.slice(0, 140));

  /* ---- decline path ---- */
  await run(`set role authenticated`); await asUser(MGR);
  const sr2 = await one(`select sign_request_create('${VID}','bob@acme.com','Bob','','fp-2') j`);
  await run('reset role');
  const dec = await one(`select sign_request_decline('${sr2.j.token}','not ready') j`);
  const d2 = await one(`select event_type, state from webhook_deliveries where payload->>'signRequestId'='${sr2.j.id}'`);
  check('a decline enqueues sign.declined and returns its id', dec.j.ok === true && dec.j.pendingDeliveries.length === 1 && d2.event_type === 'sign.declined' && d2.state === 'pending', { dec: dec.j, d2 });

  /* ---- seal.issued and seal.timestamped ---- */
  await run(`set role authenticated`); await asUser(MGR);
  const stored = await one(`select receipt_store('${sr.j.id}','','{"format":"reqpub-receipt"}'::jsonb,'${'ab'.repeat(32)}','sigsig','acc-1') j`);
  check('the receipt seals', !!stored.j.id, stored.j);
  const d3 = await one(`select id, payload from webhook_deliveries where event_type='seal.issued' and payload->>'signRequestId'='${sr.j.id}'`);
  check('sealing enqueues seal.issued carrying the receiptId', !!d3 && d3.payload.receiptId === stored.j.id, d3 && d3.payload);
  await one(`select receipt_tsa_update('${stored.j.id}','','${'cd'.repeat(20)}',null) j`);
  const d4 = await one(`select count(*)::int n from webhook_deliveries where event_type='seal.timestamped' and payload->>'receiptId'='${stored.j.id}'`);
  check('the first timestamp upgrade enqueues seal.timestamped once', d4.n === 1, d4);
  await one(`select receipt_tsa_update('${stored.j.id}','',null,'${'ef'.repeat(20)}') j`);
  const d5 = await one(`select count(*)::int n from webhook_deliveries where event_type='seal.timestamped' and payload->>'receiptId'='${stored.j.id}'`);
  check('single to dual does not enqueue a second timestamp event', d5.n === 1, d5);
  await run('reset role');

  /* ---- inert until configured, and paused endpoints stay silent ---- */
  await run(`set role authenticated`); await asUser(MGR);
  const srS = await one(`select sign_request_create('${VID2}','kim@acme.com','Kim','','') j`);
  await run('reset role');
  const sS = await one(`select sign_request_sign('${srS.j.token}','Kim','UA') j`);
  const nS = await one(`select count(*)::int n from webhook_deliveries d join webhook_endpoints e on e.id=d.endpoint_id where e.project_id='p2'`);
  check('a project with no endpoint enqueues nothing and returns an empty list', sS.j.ok === true && sS.j.pendingDeliveries.length === 0 && nS.n === 0, { r: sS.j, n: nS.n });
  await run(`set role authenticated`); await asUser(MGR);
  await one(`select endpoint_set_active('${e1.j.id}', false) j`);
  const srP = await one(`select sign_request_create('${VID}','pat@acme.com','Pat','','fp-3') j`);
  await run('reset role');
  const sP = await one(`select sign_request_sign('${srP.j.token}','Pat','UA') j`);
  const nP = await one(`select count(*)::int n from webhook_deliveries where payload->>'signRequestId'='${srP.j.id}'`);
  check('a paused endpoint receives nothing', sP.j.pendingDeliveries.length === 0 && nP.n === 0, { r: sP.j.pendingDeliveries, n: nP.n });
  await run(`set role authenticated`); await asUser(MGR);
  await one(`select endpoint_set_active('${e1.j.id}', true) j`);
  const tog = await all(`select meta->>'change' c from activity where action='webhook.endpoint_changed' and entity_id='${e1.j.id}' order by id`);
  check('activation changes are each logged', tog.map((r) => r.c).join(',') === 'added,deactivated,activated', tog);
  await run('reset role');

  /* ---- take, result, and the ladder ---- */
  const take1 = await one(`select webhook_delivery_take('${d1.id}') j`);
  check('take returns the url and payload for a due delivery', take1.j.ok === true && take1.j.url.startsWith('https://hooks.example.com') && take1.j.payload.deliveryId === d1.id, take1.j);
  const fail1 = await one(`select webhook_delivery_result('${d1.id}', false, 503, 'service unavailable') j`);
  const row1 = await one(`select state, attempt, next_retry_at, extract(epoch from (next_retry_at - now()))::int gap from webhook_deliveries where id='${d1.id}'`);
  check('a failure walks to failed with a one-minute retry', fail1.j.state === 'failed' && row1.attempt === 1 && row1.gap >= 55 && row1.gap <= 65, row1);
  const takeEarly = await one(`select webhook_delivery_take('${d1.id}') j`);
  check('a failed delivery is not due before its retry time', takeEarly.j.ok === false && takeEarly.j.error === 'not_due', takeEarly.j);
  const gaps = [];
  for (let i = 2; i <= 5; i++) {
    await run(`update webhook_deliveries set next_retry_at = now() - interval '1 second' where id='${d1.id}'`);
    await one(`select webhook_delivery_result('${d1.id}', false, 500, 'boom') j`);
    const r = await one(`select attempt, state, extract(epoch from (next_retry_at - now()))::int gap from webhook_deliveries where id='${d1.id}'`);
    gaps.push(r.gap);
  }
  const ok234 = gaps[0] >= 295 && gaps[0] <= 305 && gaps[1] >= 1795 && gaps[1] <= 1805 && gaps[2] >= 7195 && gaps[2] <= 7205 && gaps[3] >= 43195 && gaps[3] <= 43205;
  check('the ladder runs 5m, 30m, 2h, 12h on attempts two through five', ok234, gaps);
  await run(`update webhook_deliveries set next_retry_at = now() - interval '1 second' where id='${d1.id}'`);
  const dead = await one(`select webhook_delivery_result('${d1.id}', false, 500, 'boom') j`);
  const rowDead = await one(`select state, attempt, next_retry_at from webhook_deliveries where id='${d1.id}'`);
  check('the sixth failure is dead, with no retry scheduled', dead.j.state === 'dead' && rowDead.attempt === 6 && rowDead.next_retry_at === null, rowDead);
  const takeDead = await one(`select webhook_delivery_take('${d1.id}') j`);
  check('a dead delivery cannot be taken', takeDead.j.ok === false, takeDead.j);
  const resDead = await one(`select webhook_delivery_result('${d1.id}', true, 200, 'late') j`);
  check('a result on a dead delivery changes nothing', resDead.j.unchanged === true, resDead.j);

  /* ---- redeliver: manager only, failed or dead only ---- */
  await run(`set role authenticated`); await asUser(MEMBER);
  const rdV = await one(`select delivery_redeliver('${d1.id}') j`);
  check('a viewer cannot redeliver', rdV.j.ok === false && rdV.j.error === 'forbidden', rdV.j);
  await asUser(MGR);
  const rd = await one(`select delivery_redeliver('${d1.id}') j`);
  check('a manager revives a dead delivery to pending, due now', rd.j.ok === true, rd.j);
  await run('reset role');
  const revived = await one(`select state, next_retry_at <= now() as due from webhook_deliveries where id='${d1.id}'`);
  check('the revived delivery is pending and immediately due', revived.state === 'pending' && revived.due === true, revived);
  const good = await one(`select webhook_delivery_result('${d1.id}', true, 200, 'ok thanks') j`);
  const rowOk = await one(`select state, status_code, response_snippet from webhook_deliveries where id='${d1.id}'`);
  check('a 2xx marks delivered and records the response', good.j.state === 'delivered' && rowOk.status_code === 200 && rowOk.response_snippet === 'ok thanks', rowOk);
  await run(`set role authenticated`); await asUser(MGR);
  const rdD = await one(`select delivery_redeliver('${d1.id}') j`);
  check('a delivered delivery is not redeliverable', rdD.j.ok === false && rdD.j.error === 'not_redeliverable', rdD.j);

  /* ---- lists, due, and the org boundary ---- */
  const list = await one(`select deliveries_list('p1', 50) j`);
  check('the manager list carries state, attempts, and the endpoint url', list.j.ok === true && list.j.rows.length >= 3 && list.j.rows.every((r) => typeof r.url === 'string'), list.j.rows && list.j.rows.length);
  const due = await one(`select deliveries_due('p1', 20) j`);
  check('the due list holds only pending or retry-due rows', due.j.ok === true && Array.isArray(due.j.ids), due.j);
  await asUser(MEMBER);
  const listV = await one(`select deliveries_list('p1', 50) j`);
  check('a viewer cannot list deliveries', listV.j.ok === false && listV.j.error === 'forbidden', listV.j);
  await asUser(OUTSIDER);
  const listX = await one(`select deliveries_list('p1', 50) j`);
  check('a rival-org manager cannot list deliveries', listX.j.ok === false && listX.j.error === 'forbidden', listX.j);
  const selX = await all(`select id from webhook_endpoints`);
  check('RLS hides the endpoints from the rival org entirely', selX.length === 0, selX.length);
  let dmlBlocked = false;
  try { await run(`insert into webhook_endpoints(org_id, project_id, url) values ('${RORG}','pr','https://x.example.com')`); }
  catch { dmlBlocked = true; }
  check('direct DML on webhook_endpoints is revoked', dmlBlocked === true);
  await run('reset role');
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + (e && e.message));
} finally {
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
}
console.log(`webhooks backend: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
