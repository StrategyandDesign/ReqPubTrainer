/* ReqPub v2 - sealing backend (node tests/backend-e2e/sealing.test.mjs)
   Pins v2.48: receipt_store insert-once and idempotent, refusals on unsigned
   and revoked and non-member, tsa upgrade never downgrades, RLS isolation,
   and the token and email boundary on every reader. migrations/0021_sealing.sql applied
   twice on schema.sql plus migrations/0004_chain.sql. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-seal-' + process.pid), user: 'postgres', password: 'pw', port: 55492, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55492, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const tryQ = async (q, a) => { try { const r = await db.query(q, a); return { rows: r.rows }; } catch (e) { await db.query('rollback').catch(() => {}); return { error: e.message }; } };
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000d1';
const RIVAL = '11111111-0000-0000-0000-0000000000d3';
const ORG = '22222222-0000-0000-0000-0000000000d4';
const RORG = '22222222-0000-0000-0000-0000000000d5';
const VID = 'aaaaaaaa-0000-0000-0000-0000000000f1';
const SR = 'bbbbbbbb-0000-0000-0000-0000000000f2';
const SR2 = 'bbbbbbbb-0000-0000-0000-0000000000f3';

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  await run(sql(rel('../../supabase/migrations/0004_chain.sql')));
  await run(sql(rel('../../supabase/migrations/0021_sealing.sql')));
  await run(sql(rel('../../supabase/migrations/0021_sealing.sql')));
  check('migrations/0021_sealing.sql applies twice on top of schema.sql and migrations/0004_chain.sql', true);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${RIVAL}','rival@other.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}'),('${RORG}','Rival','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${ORG}','${MGR}','mgr@cv.co','manager'),('${RORG}','${RIVAL}','rival@other.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values ('p1','${ORG}','Acme PRD','${MGR}'),('rp1','${RORG}','Rival','${RIVAL}')`);
  await run(`insert into versions(id,project_id,seq,label,status,author_name,snapshot) values ('${VID}','p1',1,'1.0','approved','Mgr','{"answers":{},"sections":{}}'::jsonb)`);
  // A signed sign request, and a pending one.
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,signer_name,signer_role,status,doc_fingerprint,signed_name,signed_at)
             values ('${SR}','${ORG}','p1','${VID}','tok-signed','jane@acme.com','Jane Roe','CTO','signed','fp123','Jane Roe',now())`);
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,signer_name,status)
             values ('${SR2}','${ORG}','p1','${VID}','tok-pending','bob@acme.com','Bob','pending')`);

  await run(`set role authenticated`);
  await asUser(MGR);

  /* ---- seal_context leaks a domain, never an address ---- */
  const sc = await one(`select seal_context('${SR}') as c`);
  check('seal_context returns the signer email domain only', sc.c.signer.emailDomain === 'acme.com' && JSON.stringify(sc.c).indexOf('jane@acme.com') === -1);
  check('seal_context carries no token', JSON.stringify(sc.c).indexOf('tok-signed') === -1);

  /* ---- store: happy path, member authority ---- */
  const st = await one(`select receipt_store('${SR}', '', '{"format":"reqpub-receipt"}'::jsonb, 'HASHabc', 'SIGabc', 'acc-1') as r`);
  check('receipt_store seals a signed request for a member', st.r.existing === false && !!st.r.id);
  const act = await one(`select count(*)::int n from activity where action='seal.issued' and project_id='p1'`);
  check('sealing writes a seal.issued activity row (which the chain links)', act.n === 1);
  const chained = await one(`select count(*)::int n from chain_events c join activity a on a.id=c.activity_id where a.action='seal.issued'`);
  check('the seal.issued row is chained', chained.n === 1);

  /* ---- idempotence ---- */
  const st2 = await one(`select receipt_store('${SR}', '', '{"format":"x"}'::jsonb, 'OTHER', 'OTHER', 'acc-1') as r`);
  check('resealing returns the existing receipt, unchanged', st2.r.existing === true && st2.r.canonical_hash === 'HASHabc');

  /* ---- refusals ---- */
  const unsigned = await tryQ(`select receipt_store('${SR2}', '', '{}'::jsonb, 'h', 's', 'acc-1')`);
  check('sealing an unsigned request is refused', !!unsigned.error && unsigned.error.includes('not signed'));
  await run('reset role');
  await run(`update sign_requests set revoked=true, status='signed' where id='${SR2}'`);
  await run('set role authenticated'); await asUser(MGR);
  const revoked = await tryQ(`select receipt_store('${SR2}', '', '{}'::jsonb, 'h', 's', 'acc-1')`);
  check('sealing a revoked request is refused', !!revoked.error && revoked.error.includes('revoked'));

  /* ---- tsa upgrade never downgrades ---- */
  const t1 = await one(`select receipt_tsa_update('${st.r.id}', '', 'PRIMARYder', null) as r`);
  check('one timestamp yields single', t1.r.tsa_status === 'single');
  const t2 = await one(`select receipt_tsa_update('${st.r.id}', '', null, 'SECONDARYder') as r`);
  check('the second timestamp yields dual', t2.r.tsa_status === 'dual');
  const t3 = await one(`select receipt_tsa_update('${st.r.id}', '', null, null) as r`);
  check('a null-null update never downgrades from dual', t3.r.tsa_status === 'dual');

  /* ---- reader boundary ---- */
  const rf = await one(`select receipt_for('${SR}', '') as r`);
  check('receipt_for returns the sealed receipt to a member', rf.r && rf.r.key_id === 'acc-1');
  check('receipt_for carries no token and no email', JSON.stringify(rf.r).indexOf('tok-signed') === -1 && JSON.stringify(rf.r).indexOf('jane@acme.com') === -1);

  /* ---- token path works without a member session ---- */
  await asUser('');
  const rfTok = await one(`select receipt_for('${SR}', 'tok-signed') as r`);
  check('the signer token reads its own receipt with no session', rfTok.r && rfTok.r.key_id === 'acc-1');
  const rfNo = await one(`select receipt_for('${SR}', 'wrong-token') as r`);
  check('a wrong token reads nothing', rfNo.r === null);

  /* ---- RLS isolation ---- */
  await asUser(RIVAL);
  const peek = await one(`select count(*)::int n from acceptance_receipts where project_id='p1'`);
  check('a rival org reads zero receipts', peek.n === 0);
  const scFail = await one(`select seal_context('${SR}') as c`);
  check('seal_context returns nothing to a non-member', scFail.c === null);
  const storeFail = await tryQ(`select receipt_store('${SR}', '', '{}'::jsonb, 'h', 's', 'acc-1')`);
  check('a non-member cannot seal (no token, no membership)', !!storeFail.error && storeFail.error.includes('not allowed'));
  const ins = await tryQ(`insert into acceptance_receipts(org_id,project_id,sign_request_id,receipt_json,canonical_hash,signature_base64,key_id) values ('${ORG}','p1','${SR}','{}'::jsonb,'h','s','acc-1')`);
  check('direct insert into acceptance_receipts is refused', !!ins.error);

  /* ---- receipt_keys are public read, no direct write ---- */
  await asUser(MGR);
  await run('reset role');
  await run(`insert into receipt_keys(kid,public_key_spki_base64) values ('acc-1','PUBKEY') on conflict (kid) do nothing`);
  await run('set role authenticated'); await asUser('');
  const key = await one(`select public_key_spki_base64 from receipt_keys where kid='acc-1'`);
  check('receipt_keys are readable by anon for offline verification', key && key.public_key_spki_base64 === 'PUBKEY');
  const keyIns = await tryQ(`insert into receipt_keys(kid,public_key_spki_base64) values ('x','y')`);
  check('anon cannot write receipt_keys', !!keyIns.error);
} catch (e) {
  fail++; console.log('  \u2717 FATAL ' + e.message);
}
console.log(`\nsealing.test: ${pass} passed, ${fail} failed`);
await db.end().catch(() => {}); await epg.stop().catch(() => {});
process.exit(fail ? 1 : 0);
