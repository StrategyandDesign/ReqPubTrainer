/* ReqPub v2 - v2.48 RED TEAM (node tests/backend-e2e/sealing-redteam.test.mjs)
   Not an author's audit. An attacker's. Every check below is an attempt to
   forge, read, break, or bypass a seal, and PASS means the attack FAILED.
   migrations/0021_sealing.sql on schema.sql plus migrations/0004_chain.sql. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-red-' + process.pid), user: 'postgres', password: 'pw', port: 55494, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55494, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const tryQ = async (q, a) => { try { const r = await db.query(q, a); return { rows: r.rows }; } catch (e) { await db.query('rollback').catch(() => {}); return { error: e.message }; } };
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const attack = (n, blocked, x) => { if (blocked) { pass++; console.log('  \u2713 ATTACK BLOCKED: ' + n); } else { fail++; console.log('  \u2717 ATTACK SUCCEEDED (VULN): ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-00000000ed01';
const MEM = '11111111-0000-0000-0000-00000000ed02';
const ATT = '11111111-0000-0000-0000-00000000ed03'; // the attacker, a real user in a rival org
const ORG = '22222222-0000-0000-0000-00000000ed04';
const AORG = '22222222-0000-0000-0000-00000000ed05';
const VID = 'aaaaaaaa-0000-0000-0000-00000000ed11';
const SR = 'bbbbbbbb-0000-0000-0000-00000000ed12'; // victim signed request
const ASR = 'bbbbbbbb-0000-0000-0000-00000000ed13'; // attacker's own signed request

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  await run(sql(rel('../../supabase/migrations/0004_chain.sql')));
  await run(sql(rel('../../supabase/migrations/0021_sealing.sql')));

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@victim.co'),('${MEM}','mem@victim.co'),('${ATT}','attacker@evil.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Victim Co','${MGR}'),('${AORG}','Evil Co','${ATT}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@victim.co','manager'),('${ORG}','${MEM}','mem@victim.co','viewer'),
    ('${AORG}','${ATT}','attacker@evil.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values ('vp','${ORG}','Victim PRD','${MGR}'),('ap','${AORG}','Attacker PRD','${ATT}')`);
  await run(`insert into versions(id,project_id,seq,label,status,author_name,snapshot) values ('${VID}','vp',1,'1.0','approved','V','{"answers":{},"sections":{}}'::jsonb)`);
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,signer_name,signer_role,status,doc_fingerprint,signed_name,signed_at)
    values ('${SR}','${ORG}','vp','${VID}','victim-secret-token','ceo@victim.co','Victim CEO','CEO','signed','vfp','Victim CEO',now())`);
  // attacker's own signed request in their own org (a legitimate seal target for them)
  await run(`insert into versions(id,project_id,seq,label,status,author_name,snapshot) values ('cccccccc-0000-0000-0000-00000000ed21','ap',1,'1.0','approved','A','{"answers":{},"sections":{}}'::jsonb)`);
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,signer_name,status,doc_fingerprint,signed_name,signed_at)
    values ('${ASR}','${AORG}','ap','cccccccc-0000-0000-0000-00000000ed21','attacker-token','x@evil.co','Att','signed','afp','Att',now())`);
  // one legitimately sealed victim receipt to attack
  await run(`set role authenticated`); await asUser(MGR);
  const seal = await one(`select receipt_store('${SR}','', '{"format":"reqpub-receipt","secret":"victim"}'::jsonb, 'VICTIMHASH', 'VICTIMSIG', 'acc-1') as r`);
  const RID = seal.r.id;

  /* ============ THREAT 1: cross-tenant read (steal a competitor's receipt) ============ */
  await asUser(ATT);
  const t1a = await one(`select count(*)::int n from acceptance_receipts where project_id='vp'`);
  attack('attacker reads victim receipts via direct select', t1a.n === 0, t1a.n);
  const t1b = await one(`select receipt_for('${SR}','') as r`);
  attack('attacker reads victim receipt via receipt_for with no token', t1b.r === null);
  const t1c = await one(`select receipts_for_project('vp') as r`);
  attack('attacker lists victim receipts via receipts_for_project', Array.isArray(t1c.r) ? t1c.r.length === 0 : t1c.r === null || (t1c.r && t1c.r.length === 0), t1c.r);
  const t1d = await one(`select seal_context('${SR}') as c`);
  attack('attacker reads victim signer facts via seal_context', t1d.c === null);

  /* ============ THREAT 2: token theft blast radius ============ */
  // Even WITH the stolen victim token, the reader must yield only that
  // receipt and never a token or address back.
  await asUser('');
  const t2a = await one(`select receipt_for('${SR}','victim-secret-token') as r`);
  const leaked = JSON.stringify(t2a.r || {});
  attack('stolen token reader leaks the sign token back', leaked.indexOf('victim-secret-token') === -1);
  attack('stolen token reader leaks the signer email', leaked.indexOf('ceo@victim.co') === -1);
  // The stolen token must not read a DIFFERENT request's receipt.
  const t2b = await one(`select receipt_for('${ASR}','victim-secret-token') as r`);
  attack('victim token cross-reads the attacker request receipt', t2b.r === null);

  /* ============ THREAT 3: forge a seal on the victim (the core attack) ============ */
  await asUser(ATT);
  const t3a = await tryQ(`select receipt_store('${SR}','', '{"forged":true}'::jsonb, 'FORGED', 'FORGEDSIG', 'acc-1')`);
  attack('attacker seals a fresh forged receipt on the victim request (no token, no membership)', !!t3a.error);
  // With the stolen token, can a rival-org user still not overwrite?
  const t3b = await one(`select receipt_store('${SR}','victim-secret-token', '{"forged":true}'::jsonb, 'FORGED2', 'FORGEDSIG2', 'acc-1') as r`);
  attack('stolen token lets attacker overwrite the sealed receipt content', t3b.r.existing === true && t3b.r.canonical_hash === 'VICTIMHASH', t3b.r);

  /* ============ THREAT 4: tamper a stored receipt in place ============ */
  const t4a = await tryQ(`update acceptance_receipts set canonical_hash='SWAPPED', signature_base64='SWAP' where id='${RID}'`);
  attack('attacker mutates a stored receipt hash under authenticated', !!t4a.error);
  const t4b = await tryQ(`delete from acceptance_receipts where id='${RID}'`);
  attack('attacker deletes a victim receipt under authenticated', !!t4b.error);

  /* ============ THREAT 5: poison the key registry (publish attacker's key) ============ */
  const t5a = await tryQ(`insert into receipt_keys(kid,public_key_spki_base64) values ('acc-1','ATTACKER-KEY') on conflict (kid) do update set public_key_spki_base64='ATTACKER-KEY'`);
  attack('attacker rewrites the acc-1 public key in the registry', !!t5a.error);
  const t5b = await tryQ(`update receipt_keys set public_key_spki_base64='ATTACKER-KEY' where kid='acc-1'`);
  attack('attacker updates a published key', !!t5b.error);

  /* ============ THREAT 6: escalate timestamp status without a real TSA ============ */
  const t6a = await tryQ(`update acceptance_receipts set tsa_status='dual', tsa_primary_der='FAKE', tsa_secondary_der='FAKE' where id='${RID}'`);
  attack('attacker fakes dual timestamps by direct update', !!t6a.error);
  const t6b = await tryQ(`select receipt_tsa_update('${RID}','','FAKE','FAKE')`);
  attack('attacker escalates timestamps via receipt_tsa_update (rival org, no token)', !!t6b.error);
  // and the stored status is untouched by the failed attempt
  await asUser(MGR);
  const t6c = await one(`select tsa_status from acceptance_receipts where id='${RID}'`);
  attack('the failed escalation left the timestamp status changed', t6c.tsa_status === 'pending');
  await asUser(ATT);

  /* ============ THREAT 7: chain-cut, hide a seal from the trail ============ */
  await asUser(MGR);
  const _t7pre = await one(`select verify_project_chain('vp') as v`);
  await asUser(ATT);
  const t7a = await tryQ(`delete from chain_events where project_id='vp'`);
  attack('attacker deletes the victim chain to hide the seal', !!t7a.error);
  const t7b = await tryQ(`update chain_events set link_hash='0' where project_id='vp'`);
  attack('attacker rewrites a chain link', !!t7b.error);

  /* ============ THREAT 8: SQL injection through the text params ============ */
  await asUser(MGR);
  const evil = `x'; drop table acceptance_receipts; select '`;
  const _t8 = await tryQ(`select receipt_store($1,$2,$3::jsonb,$4,$5,$6)`, [ASR, '', '{}', evil, evil, evil]);
  const survived = await one(`select count(*)::int n from acceptance_receipts`);
  attack('injection through receipt params drops the table', survived && typeof survived.n === 'number');

  /* ============ THREAT 9: seal a request that was never signed, or replay a declined one ============ */
  await run('reset role');
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,status)
    values ('dddddddd-0000-0000-0000-00000000ed31','${ORG}','vp','${VID}','pending-tok','p@victim.co','pending')`);
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,status,decline_reason)
    values ('dddddddd-0000-0000-0000-00000000ed32','${ORG}','vp','${VID}','decl-tok','d@victim.co','declined','no')`);
  await run('set role authenticated'); await asUser(MGR);
  const t9a = await tryQ(`select receipt_store('dddddddd-0000-0000-0000-00000000ed31','', '{}'::jsonb,'h','s','acc-1')`);
  attack('seal a pending (never signed) request', !!t9a.error && t9a.error.includes('not signed'));
  const t9b = await tryQ(`select receipt_store('dddddddd-0000-0000-0000-00000000ed32','', '{}'::jsonb,'h','s','acc-1')`);
  attack('seal a declined request', !!t9b.error && t9b.error.includes('not signed'));

  /* ============ THREAT 10: privilege of the reader RPCs to a TRUE anon ============
     A real anonymous caller has role anon AND no identity. Clearing test.uid
     is essential: the shim auth.uid() reads it, and leaving a prior user's id
     set would make the functions see an authenticated member. This is the
     accountless-signer boundary, the highest-value one for a public link. */
  await asUser('');
  await run('reset role'); await run('set role anon');
  const t10a = await one(`select receipt_for('${SR}','') as r`);
  attack('anon reads a victim receipt with no token', t10a.r === null || t10a.r === undefined, t10a.r);
  const t10b = await tryQ(`select seal_context('${SR}') as r`);
  attack('anon reads victim signer facts via seal_context', !!t10b.error || t10b.rows[0].r === null, t10b);
  attack('anon is refused at the execute layer, not merely nulled', !!t10b.error && /permission denied/i.test(t10b.error), t10b.error || 'no error: returned ' + JSON.stringify(t10b.rows));
  const t10c = await tryQ(`select receipts_for_project('vp')`);
  attack('anon lists victim receipts (revoked at grant AND guarded in body)', !!t10c.error, t10c.rows);
  // The accountless signer path MUST still work with the correct token: this
  // is the whole point of the public link. Anon role, real token.
  const t10d = await one(`select receipt_for('${SR}','victim-secret-token') as r`);
  attack('POSITIVE: the accountless signer reads their own receipt with the real token', t10d.r !== null && t10d.r && t10d.r.key_id === 'acc-1', t10d.r);

} catch (e) {
  fail++; console.log('  \u2717 FATAL ' + e.message);
}
console.log(`\nsealing-redteam.test: ${pass} blocked, ${fail} vulnerabilities`);
await db.end().catch(() => {}); await epg.stop().catch(() => {});
process.exit(fail ? 1 : 0);
