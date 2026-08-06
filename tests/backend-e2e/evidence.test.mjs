/* ReqPub v2 - the evidence pack backend (node tests/backend-e2e/evidence.test.mjs)
   Pins v2.52: migrations/0025_evidence.sql twice on the full prior stack; the one-throat
   leak grep on the gather output, seeded with a real token, a real address,
   and poisoned activity meta, none of which may leave the function; manager
   gating for member and rival alike; the practice refusal in the doctrine's
   words; snapshot and DER completeness so the pack builds offline; the
   chained evidence.exported line; read-only unconfigured parity. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-ev-' + process.pid), user: 'postgres', password: 'pw', port: 55503, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55503, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000e1';
const MEMBER = '11111111-0000-0000-0000-0000000000e2';
const OUTSIDER = '11111111-0000-0000-0000-0000000000e9';
const ORG = '22222222-0000-0000-0000-0000000000e4';
const RORG = '22222222-0000-0000-0000-0000000000e5';
const VID = 'aaaaaaaa-0000-0000-0000-0000000000e6';
const SREQ = 'bbbbbbbb-0000-0000-0000-0000000000e1';
const RCPT = 'cccccccc-0000-0000-0000-0000000000e1';

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
  await run(sql(rel('../../supabase/migrations/0025_evidence.sql')));
  check('migrations/0025_evidence.sql applies twice on the full prior stack', true);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co'),('${MEMBER}','viewer@cv.co'),('${OUTSIDER}','x@rival.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}'),('${RORG}','Rival','${OUTSIDER}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@cv.co','manager'),
    ('${ORG}','${MEMBER}','viewer@cv.co','viewer'),
    ('${RORG}','${OUTSIDER}','x@rival.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values ('pev','${ORG}','Evidence Proj','${MGR}')`);
  await run(`insert into versions(id,project_id,seq,label,status,author_name,note,snapshot) values
    ('${VID}','pev',1,'1.0','approved','Micah','first','{"answers":{"obj":"Ship"},"sections":{}}'::jsonb)`);
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,signer_name,signer_role,status,signed_name,signed_at,doc_fingerprint,sent_at) values
    ('${SREQ}','${ORG}','pev','${VID}','SIGNTOKSECRET1234567890abcd','kate@clientco.example','Kate Client','Sponsor','signed','Kate Q Client',now(),'ab'||repeat('cd',31),now())`);
  await run(`insert into acceptance_receipts(id,org_id,project_id,sign_request_id,receipt_json,canonical_hash,signature_base64,key_id,tsa_primary_der,tsa_status) values
    ('${RCPT}','${ORG}','pev','${SREQ}','{"receiptVersion":1,"signerName":"Kate Q Client"}','beefcafe','c2lnbmF0dXJl','ev-k1','QUJD','single')`);
  await run(`insert into receipt_keys(kid,public_key_spki_base64) values ('ev-k1','cHVibGljLWtleQ==') on conflict (kid) do nothing`);
  await run(`insert into attachments(org_id,project_id,uploader_kind,file_name,mime,size_bytes,storage_path,sha256_hex) values
    ('${ORG}','pev','team','sow.pdf','application/pdf',2048,'p/ev/sow.pdf',repeat('11',32))`);
  await run(`select log_activity('${ORG}','pev','comm.received','comm','c-x','A note arrived','{"secret":"METASECRET77"}'::jsonb)`);

  /* ---- the one throat: manager gather, leak grep on the full payload ---- */
  await run(`set role authenticated`); await asUser(MGR);
  const g = await one(`select evidence_gather('pev') j`);
  check('a manager gathers', g.j.ok === true, g.j.error);
  const blob = JSON.stringify(g.j);
  check('the seeded sign token never leaves the gather', !blob.includes('SIGNTOKSECRET'));
  check('no full email address leaves the gather; the domain does',
    !blob.includes('kate@clientco.example') && blob.includes('clientco.example'));
  check('activity meta is omitted and the omission is stated',
    !blob.includes('METASECRET77') && g.j.metaOmitted === true && String(g.j.metaNote).includes('D2'));
  check('the version carries its snapshot so the baseline bundle can exist',
    g.j.versions.length === 1 && g.j.versions[0].snapshot && g.j.versions[0].snapshot.answers.obj === 'Ship');
  check('the receipt carries its DER and the key rides along',
    g.j.receipts[0].tsaPrimaryDer === 'QUJD' && g.j.keys.some((k) => k.kid === 'ev-k1' && k.publicKeySpkiBase64 === 'cHVibGljLWtleQ=='));
  check('signature facts pair the sealed request with its receipt',
    g.j.signatures[0].receiptId === RCPT && g.j.signatures[0].signerName === 'Kate Q Client' && g.j.signatures[0].signerEmailDomain === 'clientco.example');
  check('the chain result rides in the gather', g.j.chain && g.j.chain.ok === true);

  /* ---- gating: member and rival alike ---- */
  await asUser(MEMBER);
  const gm = await one(`select evidence_gather('pev') j`);
  check('a viewer is refused', gm.j.ok === false && gm.j.error === 'forbidden', gm.j);
  await asUser(OUTSIDER);
  const go = await one(`select evidence_gather('pev') j`);
  check('a rival manager is refused', go.j.ok === false && go.j.error === 'forbidden', go.j);
  const gu = await one(`select evidence_gather('nope') j`);
  check('an unknown project answers not_found', gu.j.ok === false && gu.j.error === 'not_found', gu.j);
  await run(`reset role`);

  /* ---- practice refusal, in the doctrine's words. The practice column
     arrives with v2.55; adding it here in the embedded database proves the
     refusal branch that ships now and stays inert until then. ---- */
  await run(`alter table projects add column if not exists practice boolean not null default false`);
  // v2.55: practice is immutable after creation, so the rehearsal is made,
  // not flipped: a fresh project born practice.
  await run(`insert into projects(id,org_id,name,created_by,practice) values ('ppr','${ORG}','Rehearsal','${MGR}',true)`);
  await run(`set role authenticated`); await asUser(MGR);
  const gp = await one(`select evidence_gather('ppr') j`);
  check('a practice project is refused: practice records are non-evidence by construction',
    gp.j.ok === false && gp.j.error === 'practice_project' && String(gp.j.message).includes('non-evidence by construction'), gp.j);
  await run(`reset role`);

  /* ---- the export is itself on the record ---- */
  await run(`set role authenticated`); await asUser(MEMBER);
  const lm = await one(`select evidence_log_export('pev') j`);
  check('a viewer cannot log an export', lm.j.ok === false && lm.j.error === 'forbidden', lm.j);
  await asUser(MGR);
  const le = await one(`select evidence_log_export('pev') j`);
  check('a manager export writes the line', le.j.ok === true, le.j);
  await run(`reset role`);
  const row = await one(`select actor_name, summary from activity where project_id='pev' and action='evidence.exported'`);
  check('evidence.exported landed with its actor and summary', !!row && row.summary === 'Evidence pack exported', row);
  const chain = await one(`select verify_project_chain('pev') j`);
  check('the chain verifies with the export line on it', chain.j.ok === true, chain.j);

  /* ---- unconfigured parity: two read-side functions, nothing else ---- */
  const parity = await one(`select
    (to_regprocedure('public.evidence_gather(text)') is not null) a,
    (to_regprocedure('public.evidence_log_export(text)') is not null) b,
    (select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relname like 'evidence%') trg`);
  check('v2.52 adds exactly two functions, no tables, no triggers: inert until exported',
    parity.a === true && parity.b === true && parity.trg === 0, parity);
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + String((e && e.message) || e));
} finally {
  try { await db.end(); } catch {}
  try { await epg.stop(); } catch {}
}
console.log(`evidence backend: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
