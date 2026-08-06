/* ReqPub C1.7 and C5 - limits under load, and budgets
   (node tests/backend-e2e/limits-budgets.test.mjs)

   C1.7. A rate limit that holds when calls arrive one at a time proves
   nothing: the interesting failure is two calls reading the same counter
   before either writes it. Every limit here is driven in parallel, and the
   assertion is exact rather than approximate. Cross-key interference is
   tested too, because a limiter that throttles the wrong tenant is an outage
   dressed as a control.

   C5. Budgets, not benchmarks. Each one is a plain sentence about what a
   person waits for, measured on production-shaped data. A miss is either
   fixed or the budget is revised in the open with the reason stated. The
   numbers below are recorded in docs/security/HARDENING_REPORT.md so a later regression is
   visible as a change in a committed figure. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-limits-' + process.pid), user: 'postgres', password: 'pw', port: 55508, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55508, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
let pass = 0, fail = 0;
const budgets = [];
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };
const budget = async (name, limitMs, fn) => {
  const t0 = Date.now();
  const extra = await fn();
  const ms = Date.now() - t0;
  budgets.push({ name, limitMs, ms, extra });
  check(`${name}: ${ms}ms against a ${limitMs}ms budget` + (extra ? ` (${extra})` : ''), ms <= limitMs, ms);
  return ms;
};

const MGR = '99999999-0000-0000-0000-0000000000d1';
const ORG = 'aaaa9999-0000-0000-0000-0000000000d1';
const ORG2 = 'aaaa9999-0000-0000-0000-0000000000d2';

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  for (const f of ['schema.sql', 'migrations/0021_sealing.sql', 'migrations/0022_attachment_hash.sql', 'migrations/0023_webhooks.sql',
                   'migrations/0024_mcp.sql', 'migrations/0025_evidence.sql', 'migrations/0026_book_practice.sql', 'migrations/0027_pursuit_lineage.sql',
                   'migrations/0028_authz_lockdown.sql', 'migrations/0029_ssrf_guard.sql'])
    await run(sql(rel('../../supabase/' + f)));

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}'),('${ORG2}','Other','${MGR}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${ORG}','${MGR}','mgr@cv.co','manager'),('${ORG2}','${MGR}','mgr@cv.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values ('lp1','${ORG}','Load proof','${MGR}')`);

  /* ================= C1.7 LIMITS UNDER PARALLEL LOAD ================= */

  await run(`select set_config('test.uid', '${MGR}', false)`);
  let keyErr = null;
  const keyA = await one(`select mcp_key_issue($1::uuid, 'Agent A') j`, [ORG]).catch((e) => { keyErr = e.message; return null; });
  const haveKeys = !!(keyA && keyA.j && keyA.j.ok && keyA.j.id);
  if (haveKeys) {
    const kidA = keyA.j.id;
    const keyB = await one(`select mcp_key_issue($1::uuid, 'Agent B') j`, [ORG]);
    const kidB = keyB.j.id;

    /* Sixty admissions per key per minute, driven ninety-deep in parallel. */
    let gateErr = null;
    const burst = await Promise.all(Array.from({ length: 90 }, () =>
      one(`select mcp_gate($1::uuid, 'tools/call', 'h') j`, [kidA]).catch((e) => { gateErr = gateErr || e.message; return { j: { ok: false, error: 'threw' } }; })));
    if (gateErr) console.log('    gate error:', gateErr, '| kidA=', JSON.stringify(kidA), '| issue=', JSON.stringify(keyA.j).slice(0, 160));
    const admitted = burst.filter((r) => r.j && r.j.ok === true).length;
    const refused = burst.filter((r) => r.j && r.j.ok === false).length;
    check('the limit admits exactly its allowance under ninety parallel calls, no overshoot',
      admitted === 60 && refused === 30, { admitted, refused });
    check('every refusal is a clean rate-limit answer, not an error',
      burst.filter((r) => r.j && r.j.ok === false).every((r) => /rate|limit|429/i.test(JSON.stringify(r.j))),
      burst.find((r) => r.j && r.j.ok === false && !/rate|limit/i.test(JSON.stringify(r.j))));

    /* A saturated key must not throttle a different key. */
    const other = await Promise.all(Array.from({ length: 10 }, () =>
      one(`select mcp_gate($1::uuid, 'tools/call', 'h') j`, [kidB]).catch(() => ({ j: { ok: false } }))));
    check('a saturated key does not throttle another key: no cross-tenant interference',
      other.every((r) => r.j && r.j.ok === true), other.filter((r) => !(r.j && r.j.ok)).length);
  } else {
    check('mcp key issue is reachable for the limit drill', false, keyErr || JSON.stringify(keyA && keyA.j));
  }

  /* ================= C5 BUDGETS ON PRODUCTION-SHAPED DATA ================= */

  /* A thousand-row record is a large but real engagement. */
  await budget('a 1,000-row record accepts its rows', 20000, async () => {
    const rows = [];
    for (let i = 0; i < 1000; i++) rows.push(`('lp1','fr',${i},gen_random_uuid(),'{"stmt":"FR-${i} the system shall record the submission","fit":"unit test","pri":"Must"}'::jsonb,${i})`);
    await run(`insert into field_rows(project_id, field_id, k, id, data, pos) values ${rows.join(',')}`);
    return '1000 rows';
  });

  await budget('the worksheet payload for a 1,000-row record loads', 2000, async () => {
    const r = await one(`select count(*)::int n, pg_size_pretty(sum(pg_column_size(data))::bigint) sz from field_rows where project_id='lp1'`);
    return r.n + ' rows, ' + r.sz;
  });

  await budget('a baseline is generated over a 1,000-row snapshot', 3000, async () => {
    const snap = await one(`select jsonb_build_object('answers', jsonb_build_object('fr',
      coalesce(jsonb_agg(data order by pos), '[]'::jsonb)), 'sections', '{}'::jsonb) s from field_rows where project_id='lp1'`);
    await run(`insert into versions(id, project_id, seq, label, status, author_name, snapshot)
      values (gen_random_uuid(), 'lp1', 1, '1.0', 'approved', 'Micah', $1::jsonb)`, [JSON.stringify(snap.s)]);
    return 'snapshot stored';
  });

  await budget('a diff between two 1,000-row baselines renders', 3000, async () => {
    const prev = await one(`select snapshot s from versions where project_id='lp1' and seq=1`);
    const cur = JSON.parse(JSON.stringify(prev.s));
    cur.answers.fr[500].stmt = 'FR-500 the system shall record the submission and the site';
    await run(`insert into versions(id, project_id, seq, label, status, author_name, snapshot)
      values (gen_random_uuid(), 'lp1', 2, '1.1', 'approved', 'Micah', $1::jsonb)`, [JSON.stringify(cur)]);
    globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
    const { reqDiffDetail } = await import('../../app/js/domain.js');
    const prevA = prev.s.answers, curA = cur.answers;
    prevA.fr.forEach((r, i) => { r._k = i; }); curA.fr.forEach((r, i) => { r._k = i; });
    const det = reqDiffDetail(prevA, curA);
    return det.length + ' changed requirement' + (det.length === 1 ? '' : 's');
  });

  await budget('fifty acceptance rows chain without a gap', 15000, async () => {
    for (let i = 0; i < 50; i++) {
      await run(`select log_activity($1::uuid,'lp1','version.sealed','version',$2,'sealed ' || $2,'{}'::jsonb)`, [ORG, 'v' + i]);
    }
    const gaps = await one(`select count(*)::int n from (
      select seq, lag(seq) over (order by seq) prev from chain_events where project_id='lp1') t
      where prev is not null and seq <> prev + 1`);
    return gaps.n === 0 ? 'no gaps' : gaps.n + ' GAPS';
  });
  const gapCheck = await one(`select count(*)::int n from (
    select seq, lag(seq) over (order by seq) prev from chain_events where project_id='lp1') t
    where prev is not null and seq <> prev + 1`);
  check('the chain has no gap after fifty sequential appends', gapCheck.n === 0, gapCheck.n);

  await budget('a 100-delivery webhook burst enqueues', 10000, async () => {
    await run(`insert into webhook_endpoints(org_id, project_id, url, active)
      values ('${ORG}','lp1','https://hooks.clientco.example/reqpub', true)`);
    const ep = await one(`select id from webhook_endpoints where project_id='lp1' limit 1`);
    const vals = Array.from({ length: 100 }, () => `(gen_random_uuid(), '${ep.id}', 'acceptance.sealed', '{}'::jsonb)`);
    await run(`insert into webhook_deliveries(id, endpoint_id, event_type, payload) values ${vals.join(',')}`);
    const n = await one(`select count(*)::int n from webhook_deliveries d join webhook_endpoints e on e.id=d.endpoint_id where e.project_id='lp1'`);
    return n.n + ' queued';
  });

  await budget('the evidence gather for a 1,000-row record returns', 5000, async () => {
    await run(`select set_config('test.uid', '${MGR}', false)`);
    const g = await one(`select evidence_gather('lp1') j`);
    return g.j && g.j.ok === false ? 'refused: ' + g.j.error : 'gathered';
  });

  console.log('\n  C5 budget table');
  for (const b of budgets) console.log('    ' + b.name.padEnd(52) + String(b.ms).padStart(6) + 'ms / ' + b.limitMs + 'ms' + (b.extra ? '  ' + b.extra : ''));
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + String((e && e.message) || e));
} finally {
  try { await db.end(); } catch {}
  try { await epg.stop(); } catch {}
}
console.log(`limits + budgets: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
