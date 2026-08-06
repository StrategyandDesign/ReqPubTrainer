/* Notes at a baseline, and the update panel (v2.34.0).

   Two properties this suite exists to hold:

     1. version_seq is metadata ABOUT a note, never content IN a baseline.
        discovery_entries gains the column comms already had; the snapshot
        keeps holding answers and sections and nothing else; and promotion
        stays the only path by which a note becomes part of the agreement.

     2. The update panel is a VIEW onto the record. Everything it shows is a
        read of state that already exists, and the single thing it writes is a
        message - attributed to the named recipient, never anonymous, and
        never an approval.

   Run: node tests/backend-e2e/update-panel.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-updp-' + process.pid), user: 'postgres', password: 'pw', port: 55483, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55483, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const all = async (q, a) => (await db.query(q, a)).rows;
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000c1';
const ORG = '22222222-0000-0000-0000-0000000000c2';
const SNAP = `'{"answers":{"product":"RecordMade","risks":[{"risk":"Access","impact":"Slips a week","owner":"Ada","status":"Open"}]},"sections":{"control":"# Control"}}'::jsonb`;
const PAY = `'{"strip":{"health":"On track","next":{"text":"Gate V","target":""}},"asks":[],"moved":[],"open":[],"closed":[],"window":{"from":null,"to":"2026-07-20"},"baseline":{"label":"1.0","fp":"deadbeefcafe0000111122223333444455556666777788889999aaaabbbbcccc"}}'::jsonb`;

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  // The standalone live-DB patches must apply twice on top of the schema.
  await run(sql(rel('../../supabase/migrations/0017_update_panel.sql')));
  await run(sql(rel('../../supabase/migrations/0017_update_panel.sql')));
  await run(sql(rel('../../supabase/migrations/0018_updates.sql')));
  check('the live-DB patches leave exactly one update_publish and one update_comment',
    +(await one(`select count(*) c from pg_proc where proname in ('update_publish','update_comment')`)).c === 2);

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@collection.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${ORG}','${MGR}','mgr@collection.co','manager')`);
  await run(`insert into projects(id,org_id,name) values ('recordmade','${ORG}','RecordMade')`);
  await asUser(MGR);

  const v1 = (await one(`select create_version('recordmade', true, 'first', ${SNAP}) r`)).r;
  check('setup: a baseline exists', v1.ok === true && v1.label === '1.0', v1);

  /* ---- 1. version_seq parity, and the wall around the snapshot ---------- */
  const cols = await all(`select column_name from information_schema.columns
    where table_name='discovery_entries' and column_name='version_seq'`);
  check('discovery_entries carries version_seq, like comms', cols.length === 1, cols);

  await run(`insert into discovery_entries(org_id,project_id,takeaway,version_seq,author_name)
             values ('${ORG}','recordmade','Client wants the offline window',$1,'Micah')`, [v1.seq]);
  await run(`insert into comms(org_id,project_id,origin,author_user,author_name,title,body,version_seq)
             values ('${ORG}','recordmade','team','${MGR}','Micah','Note','Filed while v1.0 was current.',$1)`, [v1.seq]);
  const atV1 = (await one(`select
      (select count(*)::int from comms where project_id='recordmade' and version_seq=$1) c,
      (select count(*)::int from discovery_entries where project_id='recordmade' and version_seq=$1) d`, [v1.seq]));
  check('both a note and a discovery entry can be filtered to one baseline', atV1.c === 1 && atV1.d === 1, atV1);

  // The wall: a note filed at a baseline is NOT in the baseline.
  const snap = (await one(`select snapshot from versions where project_id='recordmade' and seq=$1`, [v1.seq])).snapshot;
  check('the snapshot still holds answers and sections only',
    Object.keys(snap).sort().join(',') === 'answers,sections', Object.keys(snap));
  check('no note text leaked into the immutable snapshot',
    !JSON.stringify(snap).includes('offline window') && !JSON.stringify(snap).includes('Filed while'), snap);

  // A later baseline does not retroactively re-stamp older notes.
  const v2 = (await one(`select create_version('recordmade', false, 'second', ${SNAP}) r`)).r;
  const stillV1 = (await one(`select count(*)::int n from comms where project_id='recordmade' and version_seq=$1`, [v1.seq])).n;
  check('a new baseline does not move notes already filed against the old one', stillV1 === 1, stillV1);

  // Risks travel in the baseline because they are answers, not notes.
  check('authored risk rows DO travel in the snapshot, because they are record content',
    JSON.stringify(snap.answers.risks || []).includes('Access'), snap.answers.risks);

  /* ---- 2. The panel: publish stamps the baseline and the recipient ------ */
  const pub = (await one(`select update_publish('recordmade', ${PAY}, null, 'Micah Canfield', 'Ada Lovelace', 'ada@client.com') r`)).r;
  check('update_publish accepts a recipient and returns a token', pub.ok === true && !!pub.token, pub);
  const row = await one(`select version_id, recipient_name, recipient_email from updates where token=$1`, [pub.token]);
  check('the update is stamped with the newest baseline server-side',
    row.version_id === (await one(`select id from versions where project_id='recordmade' and seq=$1`, [v2.seq])).id, row.version_id);
  check('the recipient is stored on the row', row.recipient_name === 'Ada Lovelace' && row.recipient_email === 'ada@client.com', row);

  /* ---- signatures, baselines, recipient come back on the token --------- */
  const sr = (await one(`select sign_request_create($1,'ada@client.com','Ada Lovelace','Sponsor','abc123') r`,
    [(await one(`select id from versions where project_id='recordmade' and seq=$1`, [v2.seq])).id])).r;
  check('setup: a signature request exists on the update\u2019s baseline', sr.ok === true, sr);
  // A present-mode link the team already published for the first baseline.
  await run(`insert into shares(token,org_id,project_id,version_seq,kind,payload)
             values ('tok-present-1','${ORG}','recordmade',$1,'present','{"product":"RecordMade"}'::jsonb)`, [v1.seq]);

  await asUser('');   // the client is anonymous at the token link
  let ctx = (await one(`select update_context($1) c`, [pub.token])).c;
  check('the panel returns the pending signature', ctx.signatures.length === 1 && ctx.signatures[0].status === 'pending', ctx.signatures);
  check('the recipient gets a token for THEIR OWN signature request',
    ctx.signatures[0].token !== null && !!ctx.signatures[0].token, ctx.signatures[0]);

  /* ---- SECURITY: a sign token is a signing credential --------------------
     sign_request_sign(token, typed_name) is granted to anon and asks for
     nothing else, so handing out another signer's token from a forwardable
     weekly update would be the power to forge their signature. Prove the
     panel releases tokens only to the person it was addressed to. */
  await asUser(MGR);
  const v2id = (await one(`select id from versions where project_id='recordmade' and seq=$1`, [v2.seq])).id;
  await run(`select sign_request_create($1,'sponsor@client.com','M. Reyes','Client sponsor','abc123')`, [v2id]);
  await run(`select sign_request_create($1,'eng@vendor.co','L. Two Bulls','Engineering','abc123')`, [v2id]);
  await asUser('');
  ctx = (await one(`select update_context($1) c`, [pub.token])).c;
  const forOthers = ctx.signatures.filter((s) => s.name !== 'Ada Lovelace');
  check('every OTHER signer comes back with a null token, never a live one',
    forOthers.length === 2 && forOthers.every((s) => s.token === null), forOthers);
  check('other signers still show name, role, and status, so the panel stays useful',
    forOthers.every((s) => s.name && s.role && s.status), forOthers);
  check('no signer email is exposed to whoever holds the update link',
    ctx.signatures.every((s) => s.email === undefined), ctx.signatures);

  // The whole point, stated as the attack: holding this update link must not
  // let anyone sign as the client sponsor.
  const stolen = ctx.signatures.find((s) => s.role === 'Client sponsor').token;
  check('the sponsor\u2019s signing credential is simply not in the payload', stolen === null, stolen);
  const forged = stolen ? (await one(`select sign_request_sign($1,'Not M. Reyes') r`, [stolen])).r : null;
  check('so no signature can be forged from an update link', forged === null, forged);

  // A link issued to nobody releases no tokens at all.
  await asUser(MGR);
  const noRecip = (await one(`select update_publish('recordmade', ${PAY}, null, 'Micah') r`)).r;
  await asUser('');
  const nrCtx = (await one(`select update_context($1) c`, [noRecip.token])).c;
  check('an unaddressed update link releases no sign tokens whatsoever',
    nrCtx.signatures.every((s) => s.token === null), nrCtx.signatures);
  check('the signature carries the signer name and role for the panel row',
    ctx.signatures[0].name === 'Ada Lovelace' && ctx.signatures[0].role === 'Sponsor', ctx.signatures[0]);
  check('the panel returns every baseline, newest first',
    ctx.baselines.length === 2 && ctx.baselines[0].seq === v2.seq, ctx.baselines.map((b) => b.seq));
  check('a baseline with a live present link exposes it read-only',
    ctx.baselines.find((b) => b.seq === v1.seq).presentToken === 'tok-present-1', ctx.baselines);
  check('the project id is returned so the panel can build present links',
    ctx.projectId === 'recordmade', ctx.projectId);
  check('the fingerprint recorded at signature send is surfaced',
    ctx.baselines.find((b) => b.seq === v2.seq).fingerprint === 'abc123', ctx.baselines);
  check('a baseline with no recorded fingerprint returns empty, never an invented one',
    ctx.baselines.find((b) => b.seq === v1.seq).fingerprint === '', ctx.baselines);
  check('the recipient comes back for attribution', ctx.recipient.name === 'Ada Lovelace', ctx.recipient);

  // The panel mints nothing. Reading it must not create a share or a token.
  const sharesAfter = (await one(`select count(*)::int n from shares where project_id='recordmade'`)).n;
  check('reading the panel creates no share tokens of its own', sharesAfter === 1, sharesAfter);

  /* ---- the one write: a comment, attributed, never an approval --------- */
  const c1 = (await one(`select update_comment($1,'The Q3 threshold looks wrong to me.') r`, [pub.token])).r;
  check('a comment from the link succeeds', c1.ok === true && c1.ref === 'UC-1', c1);
  const comm = await one(`select origin, author_name, author_email, version_seq, title, body, last_ext_at
                          from comms where ref='UC-1'`);
  check('it lands in comms with the external update origin', comm.origin === 'update', comm.origin);
  check('it is attributed to the recipient the token was issued to, never anonymous',
    comm.author_name === 'Ada Lovelace' && comm.author_email === 'ada@client.com', comm);
  check('it is filed against the same baseline the update reported on', comm.version_seq === v2.seq, comm.version_seq);
  check('it gets a self-describing headline from its first line',
    comm.title.startsWith('The Q3 threshold looks wrong'), comm.title);
  check('the external-origin trigger flags it, so the team sees a new reply',
    comm.last_ext_at !== null, comm.last_ext_at);

  // It is a message, not a decision: nothing about the agreement moved.
  const verStatus = (await one(`select status from versions where project_id='recordmade' and seq=$1`, [v2.seq])).status;
  const apprs = (await one(`select count(*)::int n from version_approvals`)).n;
  const signStatus = (await one(`select status from sign_requests limit 1`)).status;
  check('the comment approves nothing: version status, approvals, and signature all unmoved',
    verStatus === 'draft' && apprs === 0 && signStatus === 'pending', { verStatus, apprs, signStatus });
  check('the comment is not promoted by default',
    (await one(`select promoted_to from comms where ref='UC-1'`)).promoted_to === '', 'promoted');

  const c2 = (await one(`select update_comment($1,'One more thought.') r`, [pub.token])).r;
  check('references are sequential and never reused', c2.ref === 'UC-2', c2);
  const blank = (await one(`select update_comment($1,'   ') r`, [pub.token])).r;
  check('an empty comment is refused', blank.ok === false && blank.error === 'bad_body', blank);
  const bad = (await one(`select update_comment('not-a-real-token','hello') r`)).r;
  check('an invalid token is refused', bad.ok === false && bad.error === 'invalid_link', bad);

  /* ---- never anonymous: a link with no recipient takes no comments ----- */
  await asUser(MGR);
  const anon = (await one(`select update_publish('recordmade', ${PAY}, null, 'Micah Canfield') r`)).r;
  await asUser('');
  const refused = (await one(`select update_comment($1,'Who am I?') r`, [anon.token])).r;
  check('a link issued to nobody refuses comments rather than filing them anonymously',
    refused.ok === false && refused.error === 'no_recipient', refused);
  const anonCtx = (await one(`select update_context($1) c`, [anon.token])).c;
  check('and that link reports an empty recipient, so the box never renders',
    anonCtx.recipient.name === '', anonCtx.recipient);

  /* ---- a withdrawn update stays withdrawn ------------------------------ */
  await asUser(MGR);
  await run(`select update_revoke((select id from updates where token=$1))`, [pub.token]);
  await asUser('');
  const revoked = (await one(`select update_context($1) c`, [pub.token])).c;
  check('a withdrawn update returns the marker and no panel data',
    revoked.revoked === true && revoked.signatures === undefined, revoked);
  const afterRevoke = (await one(`select update_comment($1,'still here?') r`, [pub.token])).r;
  check('a withdrawn link accepts no comments', afterRevoke.ok === false && afterRevoke.error === 'invalid_link', afterRevoke);

  /* ---- the origin vocabulary is additive ------------------------------- */
  let badOrigin = 'accepted';
  try {
    await run(`insert into comms(org_id,project_id,origin,author_name,body)
               values ('${ORG}','recordmade','tracker','x','y')`);
  } catch (e) { badOrigin = e.code; }
  check('the origin check still rejects values outside the vocabulary', badOrigin === '23514', badOrigin);
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\nupdate-panel.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
