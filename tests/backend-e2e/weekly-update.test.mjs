/* The weekly update dashboard, notes, and threads (v2.35.0).

   The update link is an anonymous credential a stranger's browser presents,
   so everything it grants is proven here as boundaries, not intentions:

     1. Row IDs are allocated server-side by a manager-only RPC, per
        (project, field, phase letter), under a lock, and never reused.
     2. The recipient's note is scoped to ITS link: no other token reads it,
        no org member reads it through the table, and a rev conflict returns
        the current state instead of silently clobbering.
     3. A thread is a real comms row: attributed to the token's named
        recipient, stamped to the update's baseline, raising the same inbox
        signal as every other outside voice, and append-only in the activity
        trail. One token cannot post into another link's thread.
     4. Revocation kills the whole grant: the page, the note, the threads,
        and the reply tokens the page handed out.
     5. Direct DML on every new surface is refused for the client role.

   Run: node tests/backend-e2e/weekly-update.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-wupd-' + process.pid), user: 'postgres', password: 'pw', port: 55485, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55485, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const all = async (q, a) => (await db.query(q, a)).rows;
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000d1';
const VIEW = '11111111-0000-0000-0000-0000000000d2';
const RIVAL = '11111111-0000-0000-0000-0000000000d3';
const ORG = '22222222-0000-0000-0000-0000000000d4';
const RORG = '22222222-0000-0000-0000-0000000000d5';
const SNAP = `'{"answers":{"pname":"Apollo","ctrl_phase":"Design"},"sections":{}}'::jsonb`;
const BOARD = `{"phase":"Design","phases":["Discovery","Design","Development","Test","Implement","Manage"],"okrs":[{"objective":"Close faster","kr":"Five day close","done":"Open"}],"items":[{"id":"D01","type":"Risk","title":"Scope creep","desc":"d","action":"a","owner":"o","delivery":"","notes":"n"}]}`;
const payloadOf = (extra) => `'{"strip":null,"asks":[],"moved":[],"open":[],"closed":[],"window":{"from":null,"to":"2026-07-27"},"board":${BOARD}${extra || ''}}'::jsonb`;

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  // The live-DB path: the two prior patches, then this release's patch TWICE.
  await run(sql(rel('../../supabase/migrations/0017_update_panel.sql')));
  await run(sql(rel('../../supabase/migrations/0018_updates.sql')));
  await run(sql(rel('../../supabase/migrations/0020_weekly_update.sql')));
  await run(sql(rel('../../supabase/migrations/0020_weekly_update.sql')));
  check('the patch applies twice on top of schema.sql without error, and one of each function remains',
    +(await one(`select count(*) c from pg_proc where proname in
      ('update_publish','updates_next_id','update_note_save','update_thread_create','update_thread_reply','update_context')`)).c === 6);

  await run(`insert into auth.users(id,email) values
    ('${MGR}','mgr@collection.co'), ('${VIEW}','viewer@collection.co'), ('${RIVAL}','rival@other.co')`);
  await run(`insert into orgs(id,name,created_by) values
    ('${ORG}','Collection Ventures','${MGR}'), ('${RORG}','Rival Co','${RIVAL}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@collection.co','manager'),
    ('${ORG}','${VIEW}','viewer@collection.co','viewer'),
    ('${RORG}','${RIVAL}','rival@other.co','manager')`);
  await run(`insert into projects(id,org_id,name) values ('apollo','${ORG}','Apollo'), ('zeus','${RORG}','Zeus')`);
  await asUser(MGR);
  const v1 = (await one(`select create_version('apollo', true, 'first', ${SNAP}) r`)).r;
  check('setup: a baseline exists', v1.ok === true, v1);

  /* ================= 1. the allocator ================= */

  const a1 = (await one(`select updates_next_id('apollo','D') r`)).r;
  const a2 = (await one(`select updates_next_id('apollo','D') r`)).r;
  const a3 = (await one(`select updates_next_id('apollo','V') r`)).r;
  check('ids allocate per phase letter: D01, D02, then V01 in its own bucket',
    a1.id === 'D01' && a2.id === 'D02' && a3.id === 'V01', [a1, a2, a3]);

  // Deleting a row is a client-side act; the counter never rewinds, so the
  // next allocation cannot reuse a dead id.
  const a4 = (await one(`select updates_next_id('apollo','D') r`)).r;
  check('after any deletion the next id is still the next number, never a reused one', a4.id === 'D03', a4);

  const bad = (await one(`select updates_next_id('apollo','X') r`)).r;
  check('a letter outside the phase vocabulary is refused', bad.ok === false && bad.error === 'bad_letter', bad);

  // Two sessions racing the same bucket must serialize on the advisory lock.
  const db2 = new pg.Client({ host: 'localhost', port: 55485, user: 'postgres', password: 'pw', database: 'reqpub' });
  await db2.connect();
  await db2.query(`select set_config('test.uid', '${MGR}', false)`);
  const [r1, r2] = await Promise.all([
    db.query(`select updates_next_id('apollo','T') r`),
    db2.query(`select updates_next_id('apollo','T') r`),
  ]);
  const pairT = [r1.rows[0].r.id, r2.rows[0].r.id].sort();
  check('two concurrent allocations in one bucket yield distinct sequential ids', pairT.join(',') === 'T01,T02', pairT);
  await db2.end();

  await asUser(VIEW);
  const vAlloc = (await one(`select updates_next_id('apollo','D') r`)).r;
  check('a non-manager member cannot allocate', vAlloc.ok === false && vAlloc.error === 'forbidden', vAlloc);
  await asUser(RIVAL);
  const rAlloc = (await one(`select updates_next_id('apollo','D') r`)).r;
  check('a rival-org manager cannot allocate against our project', rAlloc.ok === false && rAlloc.error === 'forbidden', rAlloc);
  await asUser('');
  const anonAlloc = (await one(`select updates_next_id('apollo','D') r`)).r;
  check('anonymous cannot allocate', anonAlloc.ok === false && anonAlloc.error === 'forbidden', anonAlloc);

  /* ================= 2. publish with a role ================= */

  await asUser(MGR);
  const pub = (await one(`select update_publish('apollo', ${payloadOf()}, null, 'Micah', 'Dana Fox', 'dana@client.com', 'Client') r`)).r;
  check('publish accepts the role and returns a token', pub.ok === true && !!pub.token, pub);
  const row = await one(`select recipient_role, payload->'board'->'items'->0->>'id' as rid from updates where token=$1`, [pub.token]);
  check('the role and the frozen board land on the row', row.recipient_role === 'Client' && row.rid === 'D01', row);
  const badRole = (await one(`select update_publish('apollo', ${payloadOf()}, null, '', 'X', 'x@y.z', 'Overlord') r`)).r;
  check('a role outside Client/Partner is refused', badRole.ok === false && badRole.error === 'bad_role', badRole);
  await asUser(VIEW);
  const vPub = (await one(`select update_publish('apollo', ${payloadOf()}, null, '', '', '', '') r`)).r;
  check('a non-manager cannot publish', vPub.ok === false && vPub.error === 'forbidden', vPub);
  await asUser(MGR);

  // A second link on the same project, issued to a different named recipient:
  // the cross-token subject for everything below.
  const pub2 = (await one(`select update_publish('apollo', ${payloadOf()}, null, 'Micah', 'Sam Reed', 'sam@partner.co', 'Partner') r`)).r;
  check('setup: a second link exists for a Partner recipient', pub2.ok === true, pub2);
  // And a link issued to nobody.
  const pubNone = (await one(`select update_publish('apollo', ${payloadOf()}, null, 'Micah', '', '', '') r`)).r;
  check('setup: a link issued to nobody exists', pubNone.ok === true, pubNone);

  /* ================= 3. the context, wrong tokens, and the role ========== */

  await asUser('');
  let ctx = (await one(`select update_context($1) c`, [pub.token])).c;
  check('the context carries the recipient role', ctx.recipient.role === 'Client', ctx.recipient);
  check('the context carries the frozen board untouched', ctx.payload.board.items[0].id === 'D01', ctx.payload.board);
  const wrong = (await one(`select update_context('no-such-token-000000') c`)).c;
  check('a wrong token returns null: same shape as nothing, no existence leak', wrong === null, wrong);

  /* ================= 4. notes: scoped, rev-checked, capped ================= */

  const n1 = (await one(`select update_note_save($1, 'first draft', 0) r`, [pub.token])).r;
  check('the first save creates the note at rev 1', n1.ok === true && n1.rev === 1, n1);
  const nSame = (await one(`select update_note_save($1, 'first draft', 99) r`, [pub.token])).r;
  check('identical content is ok at any base rev: replays cannot corrupt', nSame.ok === true && nSame.rev === 1, nSame);
  const n2 = (await one(`select update_note_save($1, 'second draft', 1) r`, [pub.token])).r;
  check('a save against the current rev advances it', n2.ok === true && n2.rev === 2, n2);
  const stale = (await one(`select update_note_save($1, 'from a stale tab', 1) r`, [pub.token])).r;
  check('a stale-rev save conflicts and returns the current body and rev to resolve',
    stale.ok === false && stale.error === 'conflict' && stale.body === 'second draft' && stale.rev === 2, stale);
  const big = (await one(`select update_note_save($1, repeat('x', 20001), 2) r`, [pub.token])).r;
  check('an oversize note is refused server-side', big.ok === false && big.error === 'too_long', big);

  ctx = (await one(`select update_context($1) c`, [pub.token])).c;
  check('the owner link reads its note back', ctx.note && ctx.note.body === 'second draft' && ctx.note.rev === 2, ctx.note);
  const ctx2 = (await one(`select update_context($1) c`, [pub2.token])).c;
  check('another link on the same project reads NO note: token scope is the boundary', ctx2.note === null, ctx2.note);
  const n2b = (await one(`select update_note_save($1, 'sam private', 0) r`, [pub2.token])).r;
  const ctxA = (await one(`select update_context($1) c`, [pub.token])).c;
  check('each link keeps its own note; a save on one never touches the other',
    n2b.ok === true && ctxA.note.body === 'second draft', [n2b, ctxA.note]);
  const nNone = (await one(`select update_note_save($1, 'ghost', 0) r`, [pubNone.token])).r;
  check('a link issued to nobody keeps no notes', nNone.ok === false && nNone.error === 'no_recipient', nNone);
  const nWrong = (await one(`select update_note_save('no-such-token-000000', 'x', 0) r`)).r;
  check('a wrong token saves nothing', nWrong.ok === false && nWrong.error === 'invalid_link', nWrong);

  /* ================= 5. threads: real comms rows, attributed ================= */

  const _extBefore = (await one(`select last_ext_at from comms where project_id='apollo' limit 1`).catch(() => ({})));
  const t1 = (await one(`select update_thread_create($1, 'Question', 'Delivery date', 'When does D01 land?') r`, [pub.token])).r;
  check('a thread opens with a UQ reference and a reply token', t1.ok === true && /^UQ-\d+$/.test(t1.ref) && !!t1.reply_token, t1);
  const comm = await one(`select origin, update_id, partner_id, version_seq, author_name, author_email, fb_type, last_ext_at, ref from comms where id=$1`, [t1.id]);
  check('the thread is a comms row: origin update, stamped to the baseline, attributed to the token recipient',
    comm.origin === 'update' && comm.version_seq === v1.seq && comm.author_name === 'Dana Fox' && comm.author_email === 'dana@client.com', comm);
  check('the new thread raises the inbox signal on creation', comm.last_ext_at !== null, comm.last_ext_at);
  const partner = await one(`select id, name, lower(email) e from partners where org_id='${ORG}' and lower(email)='dana@client.com'`);
  check('the recipient resolved to a client contact row, keyed on email', !!partner && comm.partner_id === partner.id, partner);

  const dup = (await one(`select update_thread_create($1, 'Question', 'Delivery date', 'When does D01 land?') r`, [pub.token])).r;
  check('an identical resubmission within the window returns the SAME thread, deduped',
    dup.ok === true && dup.id === t1.id && dup.deduped === true, dup);
  await run(`update comms set created_at = created_at - interval '3 minutes' where id=$1`, [t1.id]);
  const aged = (await one(`select update_thread_create($1, 'Question', 'Delivery date', 'When does D01 land?') r`, [pub.token])).r;
  check('outside the window the same words are a new thread, not a dedupe', aged.ok === true && aged.id !== t1.id, aged);

  const tNone = (await one(`select update_thread_create($1, 'Question', 't', 'b') r`, [pubNone.token])).r;
  check('a link issued to nobody opens no threads: never anonymous', tNone.ok === false && tNone.error === 'no_recipient', tNone);
  const tEmpty = (await one(`select update_thread_create($1, 'Question', 't', '   ') r`, [pub.token])).r;
  check('an empty body is refused', tEmpty.ok === false && tEmpty.error === 'bad_body', tEmpty);
  const tBig = (await one(`select update_thread_create($1, 'Question', 't', repeat('x', 20001)) r`, [pub.token])).r;
  check('an oversize thread body is refused server-side', tBig.ok === false && tBig.error === 'bad_body', tBig);

  /* ================= 6. replies, scope, and the inbox loop ================= */

  const rep = (await one(`select update_thread_reply($1, $2, 'Adding context.') r`, [pub.token, t1.id])).r;
  check('the recipient replies onto their own thread', rep.ok === true, rep);
  const msg = await one(`select author_kind, author_name from messages where id=$1`, [rep.id]);
  check('the reply lands as author_kind client under the recipient name',
    msg.author_kind === 'client' && msg.author_name === 'Dana Fox', msg);
  const flagged = await one(`select last_ext_at, team_seen_at from comms where id=$1`, [t1.id]);
  check('a client reply bumps last_ext_at: the existing inbox signal, no parallel system',
    flagged.last_ext_at !== null && (flagged.team_seen_at === null || flagged.team_seen_at < flagged.last_ext_at), flagged);

  const repDup = (await one(`select update_thread_reply($1, $2, 'Adding context.') r`, [pub.token, t1.id])).r;
  check('an identical reply within the window dedupes to the same message', repDup.ok === true && repDup.id === rep.id && repDup.deduped === true, repDup);

  // Scope: token 2 cannot post into token 1's thread.
  const cross = (await one(`select update_thread_reply($1, $2, 'I am not on this link.') r`, [pub2.token, t1.id])).r;
  check('one token cannot reply into another link\u2019s thread: scope is server-side', cross.ok === false && cross.error === 'invalid_thread', cross);
  // Scope: nor into an arbitrary comm that is not an update thread.
  await asUser(MGR);
  const teamNote = await one(`insert into comms(org_id,project_id,origin,author_user,author_name,title,body)
    values ('${ORG}','apollo','team','${MGR}','Micah','Internal','team words') returning id`);
  await asUser('');
  const intoTeam = (await one(`select update_thread_reply($1, $2, 'reaching') r`, [pub.token, teamNote.id])).r;
  check('an update token cannot post into any non-update conversation', intoTeam.ok === false && intoTeam.error === 'invalid_thread', intoTeam);

  // The team's side of the loop.
  await asUser(MGR);
  check('a manager marks the thread seen through the existing comm_seen', (await one(`select comm_seen($1) ok`, [t1.id])).ok === true);
  await run(`insert into messages(org_id, parent_kind, parent_id, author_kind, author_user, author_name, body)
             values ('${ORG}','comm',$1,'team','${MGR}','Micah','On it. New date Friday.')`, [t1.id]);
  const afterTeam = await one(`select last_ext_at, team_seen_at from comms where id=$1`, [t1.id]);
  check('a team reply does not re-flag the thread as new-external', afterTeam.team_seen_at >= afterTeam.last_ext_at, afterTeam);
  await asUser('');
  ctx = (await one(`select update_context($1) c`, [pub.token])).c;
  const thread = (ctx.threads || []).find((t) => t.id === t1.id);
  check('the team reply appears on the recipient\u2019s link: the loop closes',
    !!thread && thread.messages.some((m) => m.from === 'team' && m.body.includes('Friday')), thread && thread.messages);
  const ctxOther = (await one(`select update_context($1) c`, [pub2.token])).c;
  check('the other link sees none of these threads', (ctxOther.threads || []).length === 0, ctxOther.threads);

  /* ================= 7. the reply token path, and revocation ================= */

  const viaReply = (await one(`select sme_thread($1) j`, [t1.reply_token])).j;
  check('the thread is reachable at its reply token like any external thread', viaReply.ok === true && viaReply.name === 'Dana Fox', viaReply);
  check('no brief payload rides an update thread: that disclosure was never made', viaReply.brief === null || viaReply.brief === undefined, viaReply.brief);
  check('a reply through that token posts as client, not sme',
    (await one(`select sme_reply($1, 'Following up here.') ok`, [t1.reply_token])).ok === true &&
    (await one(`select author_kind from messages where parent_id=$1 order by created_at desc limit 1`, [t1.id])).author_kind === 'client');

  /* ================= 8. rate limits ================= */

  await run(`insert into comms(org_id,project_id,origin,update_id,author_name,fb_type,title,body,created_at)
    select '${ORG}','apollo','update',(select id from updates where token=$1),'Dana Fox','Question','filler '||g,'filler '||g, now()
    from generate_series(1,30) g`, [pub2.token]);
  const rate = (await one(`select update_thread_create($1, 'Question', 'one more', 'one more') r`, [pub2.token])).r;
  check('the 31st thread in an hour on one link is rate-limited', rate.ok === false && rate.error === 'rate_limited', rate);

  /* ================= 9. the activity trail is append-only evidence ========= */

  const acts = await all(`select action, summary from activity where project_id='apollo' and action in ('comm.received','comm.replied') order by id`);
  check('thread creation and the client reply each left an activity row with the actor named',
    acts.some((a) => a.action === 'comm.received' && a.summary.includes('Dana Fox') && a.summary.includes('(Client)')) &&
    acts.some((a) => a.action === 'comm.replied' && a.summary.includes('Dana Fox')), acts);
  await asUser(MGR); await run('set role authenticated');
  let actWrite = 'allowed';
  try { await run(`update activity set summary='rewritten' where project_id='apollo'`); actWrite = 'updated'; }
  catch (e) { actWrite = e.code; }
  await run('reset role');
  check('the trail cannot be rewritten even by a manager', actWrite === '42501', actWrite);

  /* ================= 10. direct DML is refused for the client role ========= */

  const dml = async (q) => { let out = 'allowed'; try { await run(q); out = 'wrote'; } catch (e) { out = e.code; } return out; };
  await asUser(MGR); await run('set role authenticated');
  const dUpd = await dml(`insert into updates(org_id,project_id,seq,token,payload) values ('${ORG}','apollo',99,'forged','{}'::jsonb)`);
  const dNotes = await dml(`insert into update_notes(update_id,org_id,project_id,body) values ((select id from updates limit 1),'${ORG}','apollo','forged')`);
  const dNotesR = await dml(`select count(*) from update_notes`);
  const dSeq = await dml(`update row_id_seq set n = 0`);
  await run('reset role');
  check('direct insert into updates is refused', dUpd === '42501', dUpd);
  check('direct insert into update_notes is refused', dNotes === '42501', dNotes);
  check('even a manager cannot READ update_notes through the table: the page\u2019s promise is schema-enforced', dNotesR === '42501', dNotesR);
  check('the id counter cannot be rewound from the client role', dSeq === '42501', dSeq);

  /* ================= 11. the rival sees zero ================= */

  await asUser(RIVAL); await run('set role authenticated');
  const rivalSees = await one(`select
    (select count(*)::int from updates where project_id='apollo') u,
    (select count(*)::int from comms where project_id='apollo') c,
    (select count(*)::int from activity where project_id='apollo') a`);
  await run('reset role');
  check('a rival org reads zero updates, threads, and activity across the tenant wall',
    rivalSees.u === 0 && rivalSees.c === 0 && rivalSees.a === 0, rivalSees);

  /* ================= 12. revocation kills the whole grant ================= */

  await asUser(MGR);
  await run(`select update_revoke((select id from updates where token=$1))`, [pub.token]);
  await asUser('');
  const dead = (await one(`select update_context($1) c`, [pub.token])).c;
  check('a revoked link returns the withdrawn marker and nothing else',
    dead.revoked === true && dead.note === undefined && dead.threads === undefined && dead.payload === undefined, dead);
  const deadNote = (await one(`select update_note_save($1, 'still here?', 2) r`, [pub.token])).r;
  const deadThread = (await one(`select update_thread_create($1, 'Question', 't', 'b') r`, [pub.token])).r;
  const deadReply = (await one(`select update_thread_reply($1, $2, 'b') r`, [pub.token, t1.id])).r;
  check('notes, new threads, and replies are all dead on the revoked token',
    deadNote.error === 'invalid_link' && deadThread.error === 'invalid_link' && deadReply.error === 'invalid_link', [deadNote, deadThread, deadReply]);
  const deadVia = (await one(`select sme_thread($1) j`, [t1.reply_token])).j;
  check('the reply token the page handed out dies with the update', deadVia.ok === false, deadVia);
  check('and posts nothing', (await one(`select sme_reply($1, 'ghost') ok`, [t1.reply_token])).ok === false);
} catch (e) {
  fail++; console.error('\n✗ HARNESS ERROR:', e.message);
} finally { await db.end().catch(() => {}); await epg.stop().catch(() => {}); }
console.log(`\nweekly-update.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
