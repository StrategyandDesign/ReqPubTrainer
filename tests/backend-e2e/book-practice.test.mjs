/* ReqPub v2 - book and practice backend (node tests/backend-e2e/book-practice.test.mjs)
   Pins v2.55: migrations/0026_book_practice.sql twice on the full prior stack; practice
   immutable in both directions under the authenticated role; the batched
   acceptance facts, member-scoped; the Book export excluding practice and
   rivals, carrying engagement_value as written; webhook silence proven by
   zero delivery rows on a practice project while an evidence project still
   enqueues; the external contexts and seal_context carrying practice; the
   parity pin that nothing else changed. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-bp-' + process.pid), user: 'postgres', password: 'pw', port: 55504, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55504, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
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
const PVID = 'aaaaaaaa-0000-0000-0000-0000000000f7';
const SREQ = 'bbbbbbbb-0000-0000-0000-0000000000f1';
const PSREQ = 'bbbbbbbb-0000-0000-0000-0000000000f2';
const RCPT = 'cccccccc-0000-0000-0000-0000000000f1';

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  await run(sql(rel('../../supabase/migrations/0021_sealing.sql')));
  await run(sql(rel('../../supabase/migrations/0022_attachment_hash.sql')));
  await run(sql(rel('../../supabase/migrations/0023_webhooks.sql')));
  await run(sql(rel('../../supabase/migrations/0024_mcp.sql')));
  await run(sql(rel('../../supabase/migrations/0025_evidence.sql')));
  await run(sql(rel('../../supabase/migrations/0026_book_practice.sql')));
  await run(sql(rel('../../supabase/migrations/0028_authz_lockdown.sql')));
  await run(sql(rel('../../supabase/migrations/0026_book_practice.sql')));
  check('migrations/0026_book_practice.sql applies twice on the full prior stack', true);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${MEMBER}','viewer@cv.co'),('${OUTSIDER}','x@rival.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}'),('${RORG}','Rival','${OUTSIDER}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@cv.co','manager'),('${ORG}','${MEMBER}','viewer@cv.co','viewer'),
    ('${RORG}','${OUTSIDER}','x@rival.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by,practice) values
    ('pev','${ORG}','Evidence Proj','${MGR}',false),
    ('prx','${ORG}','Rehearsal','${MGR}',true),
    ('prr','${RORG}','Rival Proj','${OUTSIDER}',false)`);
  await run(`insert into versions(id,project_id,seq,label,status,author_name,snapshot) values
    ('${VID}','pev',1,'1.0','approved','Micah','{"answers":{},"sections":{}}'::jsonb),
    ('${PVID}','prx',1,'1.0','approved','Micah','{"answers":{},"sections":{}}'::jsonb)`);
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,signer_name,signer_role,status,signed_name,signed_at,doc_fingerprint,sent_at) values
    ('${SREQ}','${ORG}','pev','${VID}','TOK_ev_0123456789abcdef0123','kate@clientco.example','Kate','Sponsor','signed','Kate Q',now(),repeat('ab',32),now()),
    ('${PSREQ}','${ORG}','prx','${PVID}','TOK_pr_0123456789abcdef0123','sam@clientco.example','Sam','PM','pending','',null,repeat('cd',32),now())`);
  await run(`insert into acceptance_receipts(id,org_id,project_id,sign_request_id,receipt_json,canonical_hash,signature_base64,key_id,tsa_status) values
    ('${RCPT}','${ORG}','pev','${SREQ}','{"receiptVersion":1,"chain":{"headSeq":5,"headHash":"${'ef'.repeat(32)}"}}','beadfeed','c2ln','bk-1','dual')`);
  await run(`insert into project_fields(project_id,field_id,value,rev) values ('pev','ctrl_engagement_value','"USD 250,000 fixed fee"'::jsonb,1)`);

  /* ---- immutability, both directions, under the authenticated role ---- */
  await run(`set role authenticated`); await asUser(MGR);
  let up = null;
  try { await run(`update projects set practice = true where id = 'pev'`); } catch (e) { up = e.message; }
  check('evidence can never become a rehearsal', up && up.includes('practice is immutable'), up);
  let down = null;
  try { await run(`update projects set practice = false where id = 'prx'`); } catch (e) { down = e.message; }
  check('a rehearsal can never become evidence', down && down.includes('practice is immutable'), down);
  const rn = await run(`update projects set name = 'Rehearsal Renamed' where id = 'prx'`);
  check('an update that leaves practice alone still lands', rn.rowCount === 1);
  await run(`reset role`);

  /* ---- the batched facts, member-scoped ---- */
  await run(`set role authenticated`); await asUser(MEMBER);
  const f = await one(`select project_acceptance_facts() j`);
  check('a member reads the facts in one call',
    f.j.pev && f.j.pev.pending === 0 && f.j.pev.signed === 1 && f.j.pev.sealed === true, f.j.pev);
  check('the pending rehearsal counts too, unsealed',
    f.j.prx && f.j.prx.pending === 1 && f.j.prx.sealed === false, f.j.prx);
  check('a rival project never appears in the facts', !('prr' in f.j));
  await run(`reset role`);

  /* ---- the Book export ---- */
  await run(`set role authenticated`); await asUser(MGR);
  const b = await one(`select book_export() j`);
  check('one row per signature on evidence projects only',
    Array.isArray(b.j) && b.j.length === 1 && b.j[0].project_id === 'pev', b.j.length);
  check('the row carries the frozen facts and the authored engagement value',
    b.j[0].signer_name === 'Kate Q' && b.j[0].signer_email_domain === 'clientco.example'
    && b.j[0].canonical_hash === 'beadfeed' && b.j[0].engagement_value === 'USD 250,000 fixed fee');
  check('the chain columns carry the at-seal snapshot from the receipt',
    b.j[0].chain_head_seq === '5' && b.j[0].chain_head_hash === 'ef'.repeat(32));
  check('no token leaves the book', !JSON.stringify(b.j).includes('TOK_'));
  await asUser(MEMBER);
  const bv = await one(`select book_export() j`);
  check('a viewer gets an empty book, not an error', Array.isArray(bv.j) && bv.j.length === 0);
  await asUser(OUTSIDER);
  const br = await one(`select book_export() j`);
  check('a rival manager sees only their own book', br.j.length === 0);
  await run(`reset role`);

  /* ---- webhook silence: zero delivery rows ever ---- */
  await run(`insert into webhook_endpoints(org_id,project_id,url,active) values
    ('${ORG}','pev','https://example.com/hook',true),
    ('${ORG}','prx','https://example.com/hook',true)`);
  await run(`select webhook_enqueue('acceptance.sealed', (select s from sign_requests s where id='${SREQ}'), '${RCPT}')`);
  await run(`select webhook_enqueue('acceptance.sealed', (select s from sign_requests s where id='${PSREQ}'), null)`);
  const ev = await one(`select count(*)::int n from webhook_deliveries d join webhook_endpoints e on e.id=d.endpoint_id where e.project_id='pev'`);
  const pr = await one(`select count(*)::int n from webhook_deliveries d join webhook_endpoints e on e.id=d.endpoint_id where e.project_id='prx'`);
  check('an evidence project still enqueues', ev.n === 1, ev.n);
  check('a practice project produces zero delivery rows ever', pr.n === 0, pr.n);

  /* ---- the contexts announce practice ---- */
  const sc = await one(`select sign_request_context('TOK_pr_0123456789abcdef0123') j`);
  check('the sign context carries practice true on the rehearsal', sc.j.practice === true, sc.j.practice);
  const sc2 = await one(`select sign_request_context('TOK_ev_0123456789abcdef0123') j`);
  check('and false on evidence', sc2.j.practice === false);
  await run(`insert into shares(token,org_id,project_id,kind,version_seq,payload) values
    ('SHTOK_pr_abcdef','${ORG}','prx','brief',1,'{"answers":{},"sections":{}}'::jsonb)`);
  const gs = await one(`select get_share('SHTOK_pr_abcdef') j`);
  check('the share payload carries practice', gs.j.practice === true, gs.j);
  await run(`set role authenticated`); await asUser(MGR);
  const sctx = await one(`select seal_context('${PSREQ}') j`);
  check('seal_context carries practice so the receipt can state it', sctx.j.practice === true, sctx.j.practice);
  await run(`reset role`);

  /* ---- parity: the column, the trigger, three new functions, nothing else ---- */
  const parity = await one(`select
    (select count(*)::int from information_schema.columns where table_name='projects' and column_name='practice') col,
    (select count(*)::int from pg_trigger where tgname='projects_practice_immutable') trg,
    (to_regprocedure('public.project_acceptance_facts()') is not null) a,
    (to_regprocedure('public.book_export()') is not null) b`);
  check('v2.55 adds one column, one trigger, two read functions; every prior surface replaced in place',
    parity.col === 1 && parity.trg === 1 && parity.a === true && parity.b === true, parity);
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + String((e && e.message) || e));
} finally {
  try { await db.end(); } catch {}
  try { await epg.stop(); } catch {}
}
console.log(`book+practice backend: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
