/* Validates the demo walkthrough layer: the project-anchored team resolver the
   upload edge function calls, walkthrough_add's guards (membership, project
   match, image-only, infected, caption cap, duplicates), ordering (append,
   neighbor swap, clean edge no-op), caption edits, remove-detaches-only, RLS
   (member read, outsider blind), the write lock on the table, and the audit
   trail. Run: node tests/backend-e2e/walkthrough.test.mjs */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-wt-' + process.pid), user: 'postgres', password: 'pw', port: 55467, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55467, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const all = async (q, a) => (await db.query(q, a)).rows;
const run = (q) => db.query(q);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const MGR = '11111111-0000-0000-0000-0000000000e1';
const MEMBER = '22222222-0000-0000-0000-0000000000e2';
const OUTSIDER = '99999999-0000-0000-0000-0000000000e9';
const ORG = '33333333-0000-0000-0000-0000000000e3';
const addAtt = (proj, file, mime, scan) =>
  one(`select attachment_add($1,null,null,'team','Micah','${MGR}',$2,$3,1000,$4,$5,'') j`,
    [proj, file, mime, 'o/' + proj + '/' + file, scan]);
const wtAdd = (proj, att, cap) => one(`select walkthrough_add($1,$2,$3) j`, [proj, att, cap ?? '']);

try {
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@collection.co'),('${MEMBER}','v@collection.co'),('${OUTSIDER}','x@nope.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','Collection Ventures','${MGR}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values
    ('${ORG}','${MGR}','mgr@collection.co','manager'),('${ORG}','${MEMBER}','v@collection.co','viewer')`);
  await run(`insert into projects(id,org_id,name) values ('reqpub','${ORG}','ReqPub Platform'),('other','${ORG}','Other PRD')`);

  /* --- the resolver the upload edge function calls for no-thread team uploads --- */
  const tgtOk = await one(`select attachment_team_target('reqpub','${MEMBER}') j`);
  check('a teammate resolves against the project (org + name returned)', tgtOk.j.ok === true && tgtOk.j.org_id === ORG, tgtOk.j);
  const tgtNo = await one(`select attachment_team_target('reqpub','${OUTSIDER}') j`);
  check('an outsider is refused by the resolver', tgtNo.j.ok === false && tgtNo.j.error === 'forbidden', tgtNo.j);
  const tgtBad = await one(`select attachment_team_target('nope','${MEMBER}') j`);
  check('an unknown project is named as the reason', tgtBad.j.ok === false && tgtBad.j.error === 'unknown_project', tgtBad.j);

  /* --- seed attachments through the validated path, threadless (comm null) --- */
  const img1 = (await addAtt('reqpub', 'login.png', 'image/png', 'clean')).j;
  const img2 = (await addAtt('reqpub', 'dashboard.png', 'image/png', 'clean')).j;
  const img3 = (await addAtt('reqpub', 'settings.png', 'image/png', 'clean')).j;
  const pdf = (await addAtt('reqpub', 'notes.pdf', 'application/pdf', 'clean')).j;
  const bad = (await addAtt('reqpub', 'sketchy.png', 'image/png', 'clean')).j;
  await run(`update attachments set scan_status='error' where id='${bad.id}'`);
  const elsewhere = (await addAtt('other', 'other.png', 'image/png', 'clean')).j;
  check('threadless team attachments land (comm stays null)', img1.ok && img2.ok && img3.ok && pdf.ok && elsewhere.ok,
    { img1, pdf });

  /* --- walkthrough_add guards --- */
  await asUser(MEMBER);
  const a1 = (await wtAdd('reqpub', img1.id, 'Sign in with the org account')).j;
  const a2 = (await wtAdd('reqpub', img2.id, 'Open the dashboard')).j;
  check('shots append in order (positions 1 then 2), by any teammate', a1.ok && a1.position === 1 && a2.ok && a2.position === 2, { a1, a2 });
  const nonImg = (await wtAdd('reqpub', pdf.id, 'x')).j;
  check('a non-image attachment is refused', nonImg.ok === false && nonImg.error === 'not_an_image', nonImg);
  const cross = (await wtAdd('reqpub', elsewhere.id, 'x')).j;
  check('an attachment from another project is refused', cross.ok === false && cross.error === 'bad_attachment', cross);
  const dup = (await wtAdd('reqpub', img1.id, 'again')).j;
  check('the same screenshot cannot join twice', dup.ok === false && dup.error === 'duplicate', dup);
  const longCap = (await wtAdd('reqpub', img3.id, 'x'.repeat(501))).j;
  check('a caption over 500 characters is refused on add', longCap.ok === false && longCap.error === 'caption_too_long', longCap);
  await asUser(OUTSIDER);
  const noAdd = (await wtAdd('reqpub', img3.id, '')).j;
  check('an outsider cannot add a shot', noAdd.ok === false && noAdd.error === 'forbidden', noAdd);
  await asUser(MEMBER);
  await run(`update attachments set scan_status='infected' where id='${bad.id}'`);
  const inf = (await wtAdd('reqpub', bad.id, '')).j;
  check('an infected file never joins the walkthrough', inf.ok === false && inf.error === 'infected', inf);

  /* --- captions --- */
  const capOk = (await one(`select walkthrough_caption('${a1.id}','Sign in, then pick the workspace') j`)).j;
  const capRow = await one(`select caption from walkthrough_shots where id='${a1.id}'`);
  check('a caption edit lands', capOk.ok === true && capRow.caption === 'Sign in, then pick the workspace', capRow);
  const capLong = (await one(`select walkthrough_caption('${a1.id}','${'y'.repeat(501)}') j`)).j;
  check('a caption over 500 characters is refused on edit', capLong.ok === false && capLong.error === 'caption_too_long', capLong);
  await asUser(OUTSIDER);
  const capNo = (await one(`select walkthrough_caption('${a1.id}','hijack') j`)).j;
  check('an outsider cannot edit a caption', capNo.ok === false && capNo.error === 'forbidden', capNo);
  await asUser(MEMBER);

  /* --- ordering --- */
  const mv = (await one(`select walkthrough_move('${a1.id}',1) j`)).j;
  const order1 = await all(`select id, position from walkthrough_shots where project_id='reqpub' order by position`);
  check('a neighbor swap reorders (shot 1 moves to 2)', mv.ok === true && mv.moved === true
    && order1[0].id === a2.id && order1[0].position === 1 && order1[1].id === a1.id && order1[1].position === 2, order1);
  const edge = (await one(`select walkthrough_move('${a2.id}',-1) j`)).j;
  check('moving past the top is a clean no-op (moved:false)', edge.ok === true && edge.moved === false, edge);

  /* --- remove detaches, never deletes the file --- */
  const rm = (await one(`select walkthrough_remove('${a2.id}') j`)).j;
  const gone = await one(`select count(*)::int c from walkthrough_shots where id='${a2.id}'`);
  const fileStays = await one(`select count(*)::int c from attachments where id='${img2.id}'`);
  check('remove detaches the shot and leaves the attachment', rm.ok === true && gone.c === 0 && fileStays.c === 1, { rm, gone, fileStays });

  /* --- RLS + the write lock --- */
  await run('set role authenticated');
  await asUser(MEMBER);
  const seen = await one(`select count(*)::int c from walkthrough_shots where project_id='reqpub'`);
  check('a teammate reads the walkthrough through RLS', seen.c === 1, seen);
  await asUser(OUTSIDER);
  const blind = await one(`select count(*)::int c from walkthrough_shots`);
  check('an outsider reads nothing through RLS', blind.c === 0, blind);
  let denied = false;
  try {
    await run(`insert into walkthrough_shots(org_id,project_id,attachment_id,position) values ('${ORG}','reqpub','${img3.id}',9)`);
  } catch (e) { denied = e.code === '42501'; }
  check('direct inserts are refused at the privilege layer (42501)', denied);
  await run('reset role');

  /* --- the share-reader image gate (walkthrough_image_access) --- */
  await run(`insert into versions(project_id, seq, label, note, author_name, snapshot)
    values ('reqpub', 1, '1.0', '', 'Micah',
      jsonb_build_object('answers', '{}'::jsonb, 'walkthrough',
        jsonb_build_array(jsonb_build_object('n', 1, 'caption', 'Sign in', 'file_name', 'login.png', 'attachment_id', '${img1.id}'))))`);
  await run(`insert into shares(token, org_id, project_id, version_seq, kind, payload)
    values ('tok-brief', '${ORG}', 'reqpub', 1, 'brief', '{}'::jsonb),
           ('tok-pilot', '${ORG}', 'reqpub', 1, 'pilot', '{}'::jsonb),
           ('tok-dead', '${ORG}', 'reqpub', 1, 'brief', '{}'::jsonb)`);
  await run(`update shares set revoked = true where token = 'tok-dead'`);
  const gOk = (await one(`select walkthrough_image_access('tok-brief','${img1.id}') j`)).j;
  check('a live brief token reaches a frozen shot (path returned)', gOk.ok === true && gOk.path === 'o/reqpub/login.png', gOk);
  const gOut = (await one(`select walkthrough_image_access('tok-brief','${img3.id}') j`)).j;
  check('a file outside the frozen set is refused', gOut.ok === false && gOut.error === 'not_in_walkthrough', gOut);
  const gDead = (await one(`select walkthrough_image_access('tok-dead','${img1.id}') j`)).j;
  check('a revoked share closes the image path', gDead.ok === false && gDead.error === 'invalid_link', gDead);
  const gPilot = (await one(`select walkthrough_image_access('tok-pilot','${img1.id}') j`)).j;
  check('a pilot token is not an image credential', gPilot.ok === false && gPilot.error === 'invalid_link', gPilot);
  await run(`update attachments set scan_status='infected' where id='${img1.id}'`);
  const gInf = (await one(`select walkthrough_image_access('tok-brief','${img1.id}') j`)).j;
  check('a file flagged infected after freezing stops serving', gInf.ok === false && gInf.error === 'file_gone', gInf);
  await run(`update attachments set scan_status='clean' where id='${img1.id}'`);

  /* --- the audit trail --- */
  const acts = await all(`select action from activity where project_id='reqpub' and action like 'walkthrough.%' order by created_at`);
  check('add and remove land on the activity trail; caption and move stay quiet',
    acts.some((r) => r.action === 'walkthrough.added') && acts.some((r) => r.action === 'walkthrough.removed')
    && acts.every((r) => r.action === 'walkthrough.added' || r.action === 'walkthrough.removed'), acts);
} finally {
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
}
console.log(`walkthrough.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
