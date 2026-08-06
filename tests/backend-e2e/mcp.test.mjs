/* ReqPub v2 - the MCP server backend (node tests/backend-e2e/mcp.test.mjs)
   Pins v2.51: migrations/0024_mcp.sql twice on the full prior stack; the origin
   constraint gains agent while the member insert policy still refuses it;
   key issue, format, hash at rest, label and scope validation, revoke,
   list without hashes; org-level issuance logging, the recorded adaptation;
   mcp_auth; the atomic gate at 60 per key per minute; the append-only audit
   guard; scope isolation across orgs and inside a scoped key on every tool;
   list, baseline, signature status, receipt, chain; the doubly gated
   propose landing as an inbox comm with a chained activity line; the
   no-token no-email assertion on every tool output; unconfigured parity. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-mcp-' + process.pid), user: 'postgres', password: 'pw', port: 55502, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55502, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const _all = async (q, a) => (await db.query(q, a)).rows;
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000a1';
const MEMBER = '11111111-0000-0000-0000-0000000000a2';
const OUTSIDER = '11111111-0000-0000-0000-0000000000a9';
const ORG = '22222222-0000-0000-0000-0000000000a4';
const RORG = '22222222-0000-0000-0000-0000000000a5';
const VID = 'aaaaaaaa-0000-0000-0000-0000000000a6';
const VID2 = 'aaaaaaaa-0000-0000-0000-0000000000a7';
const RVID = 'aaaaaaaa-0000-0000-0000-0000000000a8';
const SREQ = 'bbbbbbbb-0000-0000-0000-0000000000a1';
const RCPT = 'cccccccc-0000-0000-0000-0000000000a1';

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
  await run(sql(rel('../../supabase/migrations/0024_mcp.sql')));
  await run(sql(rel('../../supabase/migrations/0024_mcp.sql')));
  check('migrations/0024_mcp.sql applies twice on the full prior stack', true);

  const conDef = await one(`select pg_get_constraintdef(oid) d from pg_constraint
    where conrelid='comms'::regclass and conname='comms_origin_check'`);
  check('U1: the final origin constraint carries the canonical 8 including update and agent (v2.51 deploy finding: production held update-thread rows and schema.sql re-added the constraint later without agent)', /'update'/.test(conDef.d) && /'agent'/.test(conDef.d), conDef.d);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${MEMBER}','viewer@cv.co'),('${OUTSIDER}','x@rival.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}'),('${RORG}','Rival','${OUTSIDER}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@cv.co','manager'),
    ('${ORG}','${MEMBER}','viewer@cv.co','viewer'),
    ('${RORG}','${OUTSIDER}','x@rival.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values
    ('p1','${ORG}','Fathering Excellence','${MGR}'),
    ('p2','${ORG}','Second','${MGR}'),
    ('parch','${ORG}','Old','${MGR}'),
    ('pr','${RORG}','Rival Proj','${OUTSIDER}')`);
  await run(`update projects set archived=true where id='parch'`);
  await run(`insert into versions(id,project_id,seq,label,status,author_name,snapshot) values
    ('${VID}','p1',1,'1.0','approved','Micah','{"answers":{},"sections":{}}'::jsonb),
    ('${VID2}','p1',2,'1.1','draft','Micah','{"answers":{"k":"v"},"sections":{}}'::jsonb),
    ('${RVID}','pr',1,'1.0','approved','Rival','{"answers":{},"sections":{}}'::jsonb)`);
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,signer_name,signer_role,status,signed_name,signed_at,doc_fingerprint,sent_at) values
    ('${SREQ}','${ORG}','p1','${VID2}','tok_secret_abcdef0123456789','client@example.com','Ada Client','Sponsor','signed','Ada Q Client',now(),'ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000',now())`);
  await run(`insert into acceptance_receipts(id,org_id,project_id,sign_request_id,receipt_json,canonical_hash,signature_base64,key_id,tsa_status) values
    ('${RCPT}','${ORG}','p1','${SREQ}','{"receiptVersion":1,"signerName":"Ada Q Client"}','beef','c2ln','acc-1','pending')`);

  /* ---- member direct insert with origin agent stays blocked ---- */
  await run(`set role authenticated`); await asUser(MEMBER);
  let blocked = false;
  try { await run(`insert into comms(org_id,project_id,origin,author_user,title,body) values ('${ORG}','p1','agent','${MEMBER}','x','y')`); }
  catch { blocked = true; }
  check('a member cannot insert origin agent directly (policy holds)', blocked);
  await run(`reset role`);

  /* ---- key issue: gate, format, hash at rest, validation ---- */
  await run(`set role authenticated`); await asUser(MEMBER);
  const kV = await one(`select mcp_key_issue('${ORG}','viewer key') j`);
  check('a viewer cannot issue a key', kV.j.ok === false && kV.j.error === 'forbidden', kV.j);
  await asUser(MGR);
  const kNoLabel = await one(`select mcp_key_issue('${ORG}','  ') j`);
  check('a key needs a label', kNoLabel.j.ok === false && kNoLabel.j.error === 'label_required', kNoLabel.j);
  const kBadScope = await one(`select mcp_key_issue('${ORG}','x',false,array['pr']) j`);
  check('a foreign project in scope is refused at issue', kBadScope.j.ok === false && kBadScope.j.error === 'unknown_project_in_scope', kBadScope.j);
  const k1 = await one(`select mcp_key_issue('${ORG}','Planning agent',false) j`);
  check('a manager issues a key', k1.j.ok === true && !!k1.j.key, k1.j);
  check('the key format is rqp_live_ plus 32 base62', /^rqp_live_[0-9A-Za-z]{32}$/.test(k1.j.key), k1.j.key);
  await run(`reset role`);
  const hash1 = createHash('sha256').update(k1.j.key).digest('hex');
  const stored = await one(`select key_hash from mcp_api_keys where id='${k1.j.id}'`);
  check('only the sha256 of the key is stored', stored.key_hash === hash1 && stored.key_hash !== k1.j.key);
  const issLog = await one(`select count(*)::int c from activity where org_id='${ORG}' and project_id is null and action='mcp.key_issued'`);
  check('issuance is logged at org level, the recorded adaptation', issLog.c >= 1, issLog);
  const issChain = await one(`select count(*)::int c from chain_events ce join activity a on a.id=ce.activity_id where a.action='mcp.key_issued'`);
  check('org-level issuance stays outside the per-project chain by design', issChain.c === 0, issChain);
  const leakLog = await one(`select count(*)::int c from activity where summary like '%rqp_live_%' or meta::text like '%rqp_live_%'`);
  check('the key never appears in any activity row', leakLog.c === 0, leakLog);

  /* second keys: a propose key and a scoped key */
  await run(`set role authenticated`); await asUser(MGR);
  const k2 = await one(`select mcp_key_issue('${ORG}','Propose agent',true) j`);
  const _k3 = await one(`select mcp_key_issue('${ORG}','Scoped agent',false,array['p2']) j`);
  const list = await one(`select mcp_keys_list('${ORG}') j`);
  check('keys_list returns the rows without any hash', list.j.ok === true
    && list.j.rows.length === 3 && !JSON.stringify(list.j).includes(hash1), list.j.rows && list.j.rows.length);
  await asUser(MEMBER);
  const listV = await one(`select mcp_keys_list('${ORG}') j`);
  check('keys_list is manager only', listV.j.ok === false && listV.j.error === 'forbidden', listV.j);
  await run(`reset role`);

  /* ---- mcp_auth ---- */
  const authBad = await one(`select mcp_auth('deadbeef') j`);
  check('an unknown hash fails auth', authBad.j.ok === false && authBad.j.error === 'invalid_key', authBad.j);
  const auth1 = await one(`select mcp_auth('${hash1}') j`);
  check('a valid hash authenticates with org, scope, and propose facts',
    auth1.j.ok === true && auth1.j.orgId === ORG && auth1.j.proposeEnabled === false && auth1.j.projectIds === null, auth1.j);
  const touched = await one(`select last_used_at is not null u from mcp_api_keys where id='${k1.j.id}'`);
  check('auth touches last_used_at', touched.u === true);

  /* ---- revoke: idempotent, immediate ---- */
  await run(`set role authenticated`); await asUser(MGR);
  const kDead = await one(`select mcp_key_issue('${ORG}','Short lived') j`);
  const rv1 = await one(`select mcp_key_revoke('${kDead.j.id}') j`);
  const rv2 = await one(`select mcp_key_revoke('${kDead.j.id}') j`);
  check('revoke works and repeats harmlessly', rv1.j.ok === true && rv2.j.ok === true && rv2.j.already === true, rv2.j);
  await run(`reset role`);
  const hashDead = createHash('sha256').update(kDead.j.key).digest('hex');
  const authDead = await one(`select mcp_auth('${hashDead}') j`);
  check('a revoked key fails auth immediately', authDead.j.ok === false && authDead.j.error === 'revoked', authDead.j);

  /* ---- the gate: 60 per key per minute, every row counted ---- */
  const g1 = await one(`select mcp_gate('${k1.j.id}','reqpub_list_projects','h1') j`);
  check('the gate admits a fresh call and appends ok', g1.j.ok === true);
  await run(`insert into mcp_audit_log(key_id,tool,params_hash,status)
    select '${k1.j.id}','reqpub_list_projects','h', 'ok' from generate_series(1,59)`);
  const g2 = await one(`select mcp_gate('${k1.j.id}','reqpub_list_projects','h2') j`);
  check('the 61st call in the window is refused', g2.j.ok === false && g2.j.error === 'rate_limited', g2.j);
  const audCounts = await one(`select
    count(*) filter (where status='rate_limited')::int rl,
    count(*)::int total from mcp_audit_log where key_id='${k1.j.id}'`);
  check('the refusal itself is on the audit log', audCounts.rl === 1 && audCounts.total === 61, audCounts);
  let guard = 0;
  try { await run(`update mcp_audit_log set status='x' where key_id='${k1.j.id}'`); } catch { guard++; }
  try { await run(`delete from mcp_audit_log where key_id='${k1.j.id}'`); } catch { guard++; }
  check('the audit log is append-only under the guard trigger', guard === 2, guard);
  await run(`select mcp_audit_append('${k1.j.id}','reqpub_get_baseline','h3','denied')`);
  const apd = await one(`select status from mcp_audit_log where key_id='${k1.j.id}' order by id desc limit 1`);
  check('mcp_audit_append records the outcome row', apd.status === 'denied');

  /* ---- scope isolation on every tool ---- */
  const lp = await one(`select mcp_list_projects('${ORG}', null) j`);
  const ids = (lp.j.projects || []).map((p) => p.id).sort().join(',');
  check('list_projects: in-org, unarchived, with latest baseline facts',
    ids === 'p1,p2' && lp.j.projects.find((p) => p.id === 'p1').latestBaselineLabel === '1.1'
    && lp.j.projects.find((p) => p.id === 'p1').practice === false, lp.j.projects);
  const lpScoped = await one(`select mcp_list_projects('${ORG}', array['p2']) j`);
  check('a scoped key lists only its projects', (lpScoped.j.projects || []).length === 1 && lpScoped.j.projects[0].id === 'p2', lpScoped.j);
  const lpRival = await one(`select mcp_list_projects('${RORG}', null) j`);
  check('a rival org key never sees this org', (lpRival.j.projects || []).map((p) => p.id).join(',') === 'pr', lpRival.j);

  const bl = await one(`select mcp_get_baseline('${ORG}', null, 'p1', null) j`);
  check('get_baseline returns the latest stored row with the snapshot',
    bl.j.ok === true && bl.j.seq === 2 && bl.j.label === '1.1' && bl.j.snapshot.answers.k === 'v' && bl.j.practice === false, bl.j);
  const blSeq = await one(`select mcp_get_baseline('${ORG}', null, 'p1', 1) j`);
  check('get_baseline honors an explicit seq', blSeq.j.ok === true && blSeq.j.seq === 1 && blSeq.j.label === '1.0', blSeq.j);
  const blNone = await one(`select mcp_get_baseline('${ORG}', null, 'p2', null) j`);
  check('a project without versions says no_baseline', blNone.j.ok === false && blNone.j.error === 'no_baseline', blNone.j);
  const blCross = await one(`select mcp_get_baseline('${ORG}', null, 'pr', null) j`);
  check('get_baseline refuses a foreign project', blCross.j.ok === false && blCross.j.error === 'not_in_scope', blCross.j);
  const blScoped = await one(`select mcp_get_baseline('${ORG}', array['p2'], 'p1', null) j`);
  check('a scoped key cannot read a sibling project baseline', blScoped.j.ok === false && blScoped.j.error === 'not_in_scope', blScoped.j);

  const ss = await one(`select mcp_signature_status('${ORG}', null, 'p1', 2) j`);
  const req0 = ss.j.requests && ss.j.requests[0];
  check('signature_status states the signer facts and the receipt id',
    ss.j.ok === true && req0 && req0.signerName === 'Ada Q Client' && req0.signerRole === 'Sponsor'
    && req0.status === 'signed' && req0.receiptId === RCPT, ss.j);
  check('signature_status leaks no token and no address',
    !JSON.stringify(ss.j).includes('tok_secret') && !JSON.stringify(ss.j).includes('@'), JSON.stringify(ss.j).slice(0, 120));
  const ssCross = await one(`select mcp_signature_status('${RORG}', null, 'p1', null) j`);
  check('signature_status refuses across orgs', ssCross.j.ok === false && ssCross.j.error === 'not_in_scope', ssCross.j);

  const rc = await one(`select mcp_get_receipt('${ORG}', null, '${RCPT}') j`);
  check('get_receipt returns the stored seal facts',
    rc.j.ok === true && rc.j.keyId === 'acc-1' && rc.j.tsaStatus === 'pending'
    && rc.j.signatureBase64 === 'c2ln' && rc.j.receiptJson.receiptVersion === 1, rc.j);
  const rcCross = await one(`select mcp_get_receipt('${RORG}', null, '${RCPT}') j`);
  check('get_receipt refuses a foreign receipt id', rcCross.j.ok === false && rcCross.j.error === 'not_in_scope', rcCross.j);

  const vc = await one(`select mcp_verify_chain('${ORG}', null, 'p1') j`);
  check('verify_chain passes the project verification through', typeof vc.j.ok === 'boolean' && 'checked' in vc.j || vc.j.ok === true, vc.j);
  const vcCross = await one(`select mcp_verify_chain('${ORG}', null, 'pr') j`);
  check('verify_chain refuses out of scope', vcCross.j.ok === false && vcCross.j.error === 'not_in_scope', vcCross.j);

  /* ---- propose: doubly gated, lands as an inbox comm, chained ---- */
  const pv0 = await one(`select mcp_propose_visible('${ORG}', null) j`);
  check('propose is invisible while no project has the control on', pv0.j.visible === false, pv0.j);
  const pNoKeyGate = await one(`select mcp_propose('${k1.j.id}','p1','Tighten FR-003','The threshold reads ambiguous.','FR-003') j`);
  check('a key without propose is refused', pNoKeyGate.j.ok === false && pNoKeyGate.j.error === 'propose_disabled', pNoKeyGate.j);
  const pNoCtrl = await one(`select mcp_propose('${k2.j.id}','p1','Tighten FR-003','The threshold reads ambiguous.','FR-003') j`);
  check('a propose key is refused while the project control is off', pNoCtrl.j.ok === false && pNoCtrl.j.error === 'propose_disabled', pNoCtrl.j);
  await run(`set role authenticated`); await asUser(MGR);
  const sf = await one(`select save_field('p1','ctrl_mcp_propose','"on"'::jsonb,0) j`);
  check('the manager turns the project control on through save_field', sf.j.ok === true, sf.j);
  await run(`reset role`);
  const pv1 = await one(`select mcp_propose_visible('${ORG}', null) j`);
  check('propose becomes visible once one in-scope project allows it', pv1.j.visible === true, pv1.j);
  const pCross = await one(`select mcp_propose('${k2.j.id}','pr','x','y','') j`);
  check('propose refuses a foreign project even with both gates on', pCross.j.ok === false && pCross.j.error === 'not_in_scope', pCross.j);
  const pEmpty = await one(`select mcp_propose('${k2.j.id}','p1','  ','','') j`);
  check('propose needs a subject and a body', pEmpty.j.ok === false && pEmpty.j.error === 'subject_and_body_required', pEmpty.j);
  const pOk = await one(`select mcp_propose('${k2.j.id}','p1','Tighten FR-003','The threshold reads ambiguous at the boundary.','FR-003') j`);
  check('with both gates on, the proposal is recorded with the doctrine sentence',
    pOk.j.ok === true && pOk.j.message === 'Proposal recorded for human review. Agents propose; humans accept.', pOk.j);
  const comm = await one(`select origin, author_name, title, body, fb_type, status from comms where id='${pOk.j.commId}'`);
  check('the proposal is an ordinary inbox comm attributed to the key label',
    comm.origin === 'agent' && comm.author_name === 'Propose agent' && comm.status === 'new'
    && comm.fb_type === 'Proposal' && comm.body.startsWith('Target: FR-003'), comm);
  const chained = await one(`select count(*)::int c from chain_events ce join activity a on a.id=ce.activity_id
    where a.project_id='p1' and a.action='comm.agent'`);
  check('the proposal activity is on the project chain', chained.c === 1, chained);
  const vcAfter = await one(`select verify_project_chain('p1') j`);
  check('the chain still verifies after the agent write', vcAfter.j.ok === true, vcAfter.j);
  await run(`set role authenticated`); await asUser(MGR);
  const inbox = await one(`select count(*)::int c from comms where project_id='p1' and origin='agent' and status='new'`);
  check('the manager sees the proposal in the inbox query, promotable like any comm', inbox.c === 1, inbox);
  await run(`reset role`);

  /* ---- the leak grep across every tool output ---- */
  const blob = JSON.stringify([lp.j, bl.j, blSeq.j, ss.j, rc.j, vc.j, pOk.j]);
  check('no tool output carries a token substring or an email address',
    !blob.includes('tok_secret') && !blob.includes('@') && !blob.includes('rqp_live_'), blob.length);

  /* ---- unconfigured parity: a fresh org with zero keys ---- */
  const fresh = await one(`select count(*)::int c from mcp_api_keys k where k.org_id='${RORG}'`);
  check('the rival org has zero keys and its record is untouched by v2.51',
    fresh.c === 0);
  const agentComms = await one(`select count(*)::int c from comms where org_id='${RORG}'`);
  const rAudit = await one(`select count(*)::int c from mcp_audit_log a join mcp_api_keys k on k.id=a.key_id where k.org_id='${RORG}'`);
  check('with nothing configured, no agent comm and no audit row exists for it', agentComms.c === 0 && rAudit.c === 0);
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + (e && e.message));
} finally {
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
}
console.log(`mcp backend: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
