/* End-to-end backend validation: real Postgres (embedded), Supabase shims,
   v1 schema + seeded v1 data → v2 schema → migration (twice) → functional
   RPC tests exercising every server path the app uses. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MANAGER = 'aaaaaaaa-0000-0000-0000-000000000001';
const PARTNER_USER = 'bbbbbbbb-0000-0000-0000-000000000002';
const ORG = 'cccccccc-0000-0000-0000-000000000003';
const VIEWER = '11111111-0000-0000-0000-000000000008';
const RIVAL = '22222222-0000-0000-0000-000000000009';

const epg = new EmbeddedPostgres({
  databaseDir: join(tmpdir(), 'reqpub-pg-' + process.pid), user: 'postgres', password: 'pw', port: 55433, persistent: false,
  createPostgresUser: !!(process.getuid && process.getuid() === 0)  // root containers only; no effect elsewhere
});
await epg.initialise();
await epg.start();
await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55433, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();

const sql = (f) => readFileSync(f, 'utf8');
const run = (q) => db.query(q);
const one = async (q) => (await db.query(q)).rows[0];
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

try {
  console.log('- setting up: shims, v1 schema, v1 data -');
  await run(sql(rel('shim.sql')));
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('seed-v1.sql')));

  console.log('- applying v2 schema (twice: fresh install, then as an upgrade) -');
  await run(sql(rel('../../supabase/schema.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  console.log('- running migration (then again, to prove idempotence) -');
  await asUser('');   // dashboard runs have no auth.uid(); historical names must survive
  await run(sql(rel('../../supabase/migrate.sql')));
  const snap1 = await one(`select
    (select count(*) from projects) p, (select count(*) from project_fields) f,
    (select count(*) from field_rows) r, (select count(*) from versions) v,
    (select count(*) from comms) c, (select count(*) from messages) m,
    (select count(*) from input_requests) q, (select count(*) from discovery_entries) d`);
  await run(sql(rel('../../supabase/migrate.sql')));
  const snap2 = await one(`select
    (select count(*) from projects) p, (select count(*) from project_fields) f,
    (select count(*) from field_rows) r, (select count(*) from versions) v,
    (select count(*) from comms) c, (select count(*) from messages) m,
    (select count(*) from input_requests) q, (select count(*) from discovery_entries) d`);

  console.log('\n- migration assertions -');
  check('projects migrated (both orgs)', snap1.p === '2', snap1);
  check('scalar fields migrated (5 scalars, __k_* counters dropped)', snap1.f === '5', snap1.f);
  check('rows migrated (2 goals + 2 FR + 1 approver; blank list item skipped)', snap1.r === '5', snap1.r);
  check('versions migrated', snap1.v === '2', snap1.v);
  check('comms migrated with dedupe (fb1, brief review, SME note, partner note, orphan submission)', snap1.c === '5', snap1.c);
  check('threads migrated (1 fb note + 1 sme reply + 2 partner replies + 1 request prompt)', snap1.m === '5', snap1.m);
  check('input requests migrated', snap1.q === '1', snap1.q);
  check('discovery migrated', snap1.d === '1', snap1.d);
  check('migration is idempotent (identical counts on re-run)', JSON.stringify(snap1) === JSON.stringify(snap2), { snap1, snap2 });

  const frks = (await db.query(`select k from field_rows where field_id='fr' order by k`)).rows.map((x) => +x.k);
  check('FR permanent ids preserved (k = 1 and 3, gap kept)', JSON.stringify(frks) === '[1,3]', frks);
  const disc = await one(`select disc_export from projects where id='p1'`);
  check('discovery-export flag carried over', disc.disc_export === true);
  const v2row = await one(`select status, build from versions where project_id='p1' and seq=2`);
  check('latest version inherits In Review status', v2row.status === 'in_review', v2row.status);
  check('build tag attached to version', v2row.build === '0.9.4', v2row.build);
  const v1row = await one(`select status from versions where project_id='p1' and seq=1`);
  check('older version stays draft', v1row.status === 'draft');
  const req = await one(`select token, status, legacy_id from input_requests where project_id='p1'`);
  check('legacy note link adopted (old token keeps working)', req.token === 'legacynote1', req.token);
  const pnote = await one(`select origin, partner_id from comms where legacy_id='ffffffff-0000-0000-0000-000000000006'`);
  check('partner note migrated once with partner linkage', pnote.origin === 'partner' && !!pnote.partner_id);
  const orphan = await one(`select origin, title from comms where legacy_id='99999999-0000-0000-0000-000000000007'`);
  check('unseen submission recovered into comms', !!orphan && orphan.origin === 'app', orphan);

  console.log('\n- field save: optimistic concurrency -');
  await asUser(MANAGER);
  let r = await one(`select save_field('p1','context','"Used in clinics"'::jsonb, 0) j`);
  check('insert path returns rev 1', r.j.ok === true && r.j.rev === 1, r.j);
  r = await one(`select save_field('p1','context','"Used in clinics and homes"'::jsonb, 1) j`);
  check('rev-checked update returns rev 2', r.j.ok === true && r.j.rev === 2, r.j);
  r = await one(`select save_field('p1','context','"Stale write"'::jsonb, 1) j`);
  check('stale write rejected with current value (no silent clobber)',
    r.j.ok === false && r.j.conflict === true && r.j.rev === 2 && r.j.value === 'Used in clinics and homes', r.j);
  await asUser(PARTNER_USER);
  r = await one(`select save_field('p1','context','"Partner cannot write"'::jsonb, 2) j`);
  check('non-manager save is forbidden', r.j.ok === false && r.j.error === 'forbidden', r.j);

  console.log('\n- rows: permanent ids under insert -');
  await asUser(MANAGER);
  r = await one(`select upsert_row('p1','fr',null,'{"stmt":"New concurrent requirement"}'::jsonb) j`);
  check('new FR continues the sequence (k=4 after migrated 1,3)', r.j.ok === true && r.j.k === 4, r.j);
  const rowId = r.j.id;
  r = await one(`select upsert_row('p1','fr','${rowId}'::uuid,'{"stmt":"Edited"}'::jsonb,null,1) j`);
  check('row update with correct rev succeeds', r.j.ok === true && r.j.rev === 2, r.j);
  r = await one(`select upsert_row('p1','fr','${rowId}'::uuid,'{"stmt":"Stale"}'::jsonb,null,1) j`);
  check('row update with stale rev returns conflict + winner', r.j.ok === false && r.j.conflict === true && r.j.data.stmt === 'Edited', r.j);
  r = await one(`select delete_row('p1','${rowId}'::uuid) j`);
  check('soft delete works', r.j === true);

  console.log('\n- versions: allocation + approval gate -');
  r = await one(`select create_version('p1', false, 'Test cut', '{"answers":{},"sections":{}}'::jsonb) j`);
  check('server allocates seq 3, label 1.2', r.j.ok === true && r.j.seq === 3 && r.j.label === '1.2', r.j);
  const vid = r.j.id;
  r = await one(`select version_set_status('${vid}'::uuid, 'approved') j`);
  check('draft → approved is an illegal transition', r.j.ok === false && r.j.error === 'bad_transition', r.j);
  await run(`select version_set_status('${vid}'::uuid, 'in_review')`);
  await run(`insert into version_approvals(version_id, approver_role, approver_name) values ('${vid}','Engineering','Lee')`);
  r = await one(`select version_set_status('${vid}'::uuid, 'approved') j`);
  check('approval gate blocks approve while an approver is pending', r.j.ok === false && r.j.error === 'approvals_pending', r.j);
  const apid = (await one(`select id from version_approvals where version_id='${vid}'`)).id;
  // v2.28.1: the last decision approves the version by itself.
  r = await one(`select approval_decide('${apid}'::uuid, 'approved', 'LGTM') j`);
  check('the last approval approves the version by itself', r.j.ok === true && r.j.version_status === 'approved'
    && (await one(`select status from versions where id='${vid}'`)).status === 'approved', r.j);

  console.log('\n- SME accountless flow -');
  const token = (await one(`select share_put('p1','brief',3,'{"product":"RecordMade","label":"1.2","answers":{}}'::jsonb) t`)).t;
  check('share_put returns a token', typeof token === 'string' && token.length > 10, token);
  await asUser('');   // anon
  r = await one(`select submit_share_v2('${token}', '{"name":"Dr X","title":"Review","body":"Looks complete to me","verdict":"Looks complete"}'::jsonb) j`);
  check('anon SME submission accepted with reply token', r.j.ok === true && !!r.j.reply_token, r.j);
  const reply = r.j.reply_token;
  r = await one(`select submit_share_v2('nosuchtoken', '{"body":"x"}'::jsonb) j`);
  check('invalid token rejected', r.j.ok === false, r.j);
  await asUser(MANAGER);
  const commId = (await one(`select id from comms where reply_token='${reply}'`)).id;
  await run(`insert into messages(org_id,parent_kind,parent_id,author_kind,author_name,author_user,body)
             values ('${ORG}','comm','${commId}','team','Micah','${MANAGER}','Thanks, shipping v1.2 next week')`);
  await asUser('');
  r = await one(`select sme_thread('${reply}') j`);
  check('SME sees the team reply at their tokened thread', r.j.ok === true && r.j.messages.length === 1 && r.j.messages[0].from === 'team', r.j.messages);
  r = await one(`select sme_reply('${reply}', 'Great, thank you') j`);
  check('SME can reply without an account', r.j === true);
  r = await one(`select sme_thread('${reply}') j`);
  check('thread now has both sides', r.j.messages.length === 2, r.j.messages.length);

  console.log('\n- input request flow (legacy link) -');
  r = await one(`select request_view('legacynote1') j`);
  check('legacy request link resolves with team thread', r.j.ok === true && r.j.title === 'Kickoff input' && r.j.thread.length === 1, r.j);
  r = await one(`select request_submit('legacynote1', 'Dr Y', 'Must-have: full offline mode') j`);
  check('request submission accepted', r.j.ok === true && !!r.j.reply_token, r.j);
  const linked = await one(`select c.request_id, ir.legacy_id from comms c join input_requests ir on ir.id = c.request_id where c.author_name='Dr Y'`);
  check('response lands linked to the request', linked.legacy_id === 'r1');

  console.log('\n- partner portal -');
  await asUser(PARTNER_USER);
  r = await one(`select partner_projects_v2() j`);
  check('partner sees assigned project with latest published brief', r.j.length === 1 && r.j[0].project_id === 'p1' && r.j[0].payload.label === '1.2', r.j);
  r = await one(`select partner_post('p1', 'SMEs need a Spanish version') j`);
  check('partner can post a note', r.j === true);
  r = await one(`select partner_thread_v2('p1') j`);
  const migrated = r.j.find((x) => x.body === 'Clients ask about pricing');
  check('partner thread includes the migrated v1 note with its replies', !!migrated && migrated.messages.length === 2, migrated && migrated.messages);
  r = await one(`select partner_reply('${migrated.id}'::uuid, 'Following up on this') j`);
  check('partner can reply in an existing thread', r.j === true);
  r = await one(`select save_field('p1','ov_vision','"hijack"'::jsonb, 0) j`);
  check('partner still cannot touch the document', r.j.ok === false, r.j);

  console.log('\n- partner profile -');
  r = await one(`select partner_update_profile('Pat Q. Partner', 'Director of Research', 'Canfield Group') j`);
  check('partner saves own profile', r.j === true);
  const prof = await one(`select name, title, company from partners where user_id = '${PARTNER_USER}'`);
  check('profile fields persisted', prof.name === 'Pat Q. Partner' && prof.title === 'Director of Research' && prof.company === 'Canfield Group', prof);
  await run(`select partner_post('p1', 'Note under my updated name')`);
  const pn2 = await one(`select author_name from comms where body = 'Note under my updated name'`);
  check('new notes carry the updated profile name', pn2.author_name === 'Pat Q. Partner', pn2.author_name);
  r = await one(`select v2_context() j`);
  check('context exposes profile to the portal', r.j.partner.company === 'Canfield Group' && r.j.partner.email === 'partner@client.com', r.j.partner);
  await asUser(MANAGER);
  r = await one(`select partner_update_profile('Mallory', '', '') j`);
  check('non-partners cannot touch partner profiles', r.j === false);
  const prof2 = await one(`select name from partners where user_id = '${PARTNER_USER}'`);
  check('profile unchanged after that attempt', prof2.name === 'Pat Q. Partner');
  await asUser(PARTNER_USER);

  console.log('\n- read-only presentation link (v2.7) -');
  // ensure a public brief exists for p1 (share_put as manager)
  await asUser(MANAGER);
  await one(`select share_put('p1','brief',2,'{"product":"RecordMade","label":"1.1","answers":{"ov_vision":"V"}}'::jsonb) t`);
  await asUser(PARTNER_USER);
  let r2 = await one(`select partner_present_token('p1') j`);
  check('assigned partner gets the public present token (latest brief)', r2.j.ok === true && typeof r2.j.token === 'string' && Number.isInteger(r2.j.seq), r2.j);
  // rival partner (none) - a partner not assigned to p1 gets nothing
  await asUser(RIVAL);
  r2 = await one(`select partner_present_token('p1') j`);
  check('non-assigned user gets no present token', !r2.j || r2.j.ok === false, r2.j);
  // the present token is just the brief token → anon can read it via get_share
  await asUser(PARTNER_USER);
  const ptok = (await one(`select partner_present_token('p1') j`)).j.token;
  await asUser('');
  const pv = await one(`select get_share('${ptok}') p`);
  check('anon can open the presentation payload read-only', pv.p && pv.p.product === 'RecordMade', pv.p && pv.p.product);

  console.log('\n- PRD brand logo (v2.6) -');
  await asUser(MANAGER);
  await run(`update projects set brand_logo = 'data:image/png;base64,iVBORw0KAAAA', brand_label = 'Northwind Field Services' where id = 'p1'`);
  const brand = await one(`select brand_logo, brand_label from projects where id='p1'`);
  check('manager can assign a brand logo + label to a PRD', brand.brand_logo.startsWith('data:image/png') && brand.brand_label === 'Northwind Field Services', brand.brand_label);
  // publish a brief carrying the logo, then read it back as an anonymous SME
  const btok = (await one(`select share_put('p1','brief',2,'{"product":"RecordMade","label":"1.1","logo":"data:image/png;base64,iVBORw0KAAAA","brandLabel":"Northwind Field Services","answers":{"ov_vision":"V"}}'::jsonb) t`)).t;
  await asUser('');
  const seen = await one(`select get_share('${btok}') p`);
  check('anonymous SME receives the brand logo in the published brief', seen.p.logo && seen.p.logo.startsWith('data:image/png') && seen.p.brandLabel === 'Northwind Field Services', seen.p.brandLabel);
  await asUser(MANAGER);
  let brandCapDenied = false;
  try { await run(`update projects set brand_logo = repeat('x', 700000) where id='p1'`); }
  catch { brandCapDenied = true; }
  check('oversized brand logo is rejected by the size cap', brandCapDenied);

  console.log('\n- v2.5 hardening -');
  // partner_reply now requires current project access (H2)
  await asUser(PARTNER_USER);
  const pcomm = await one(`select id from comms where legacy_id = 'ffffffff-0000-0000-0000-000000000006'`);
  r = await one(`select partner_reply('${pcomm.id}'::uuid, 'reply with access') j`);
  check('partner can reply while assigned', r.j === true);
  await asUser(MANAGER);
  await run(`delete from partner_access where partner_id = 'dddddddd-0000-0000-0000-000000000004' and project_id = 'p1'`);
  await asUser(PARTNER_USER);
  r = await one(`select partner_reply('${pcomm.id}'::uuid, 'reply after de-assignment') j`);
  check('de-assigned partner cannot reply (project-access enforced)', r.j === false, r.j);
  await asUser(MANAGER);
  await run(`insert into partner_access(partner_id, project_id) values ('dddddddd-0000-0000-0000-000000000004','p1')`);

  // approval provenance trigger (M3): direct insert forced pending; decided_by stamped
  const vv = await one(`select id from versions where project_id='p1' order by seq desc limit 1`);
  await run(`insert into version_approvals(version_id, approver_role, approver_name, status, decided_by)
             values ('${vv.id}','Sponsor','Sam','approved','${PARTNER_USER}')`);
  const forged = await one(`select status, decided_by from version_approvals where approver_name='Sam'`);
  check('direct approver insert is forced to pending (no pre-approval)', forged.status === 'pending' && forged.decided_by === null, forged);
  const said = await one(`select id from version_approvals where approver_name='Sam'`);
  await run(`select approval_decide('${said.id}'::uuid, 'approved', 'ok')`);
  const decided = await one(`select decided_by from version_approvals where id='${said.id}'`);
  check('approval decision stamps decided_by from the caller', decided.decided_by === MANAGER, decided.decided_by);

  // read-only tables reject direct writes under the authenticated role (blanket-grant defense)
  await asUser(MANAGER); await run('set role authenticated');
  let roDenied = false;
  try { await run(`insert into activity(org_id, action) values ('${ORG}','hack')`); }
  catch { roDenied = true; }
  check('authenticated cannot write the audit trail directly', roDenied);
  let fieldDenied = false;
  try { await run(`update project_fields set value='"x"'::jsonb where project_id='p1'`); }
  catch { fieldDenied = true; }
  check('authenticated cannot write project_fields directly (revoked, not just no-policy)', fieldDenied);
  await run('reset role');

  // version label format guard (M4)
  let labelDenied = false;
  try { await run(`update versions set label='final' where id='${vv.id}'`); }
  catch { labelDenied = true; }
  check('non-numeric version label is rejected', labelDenied);

  // migration used the share's project, not the payload's (H4)
  const orphanProj = await one(`select project_id from comms where legacy_id='99999999-0000-0000-0000-000000000007'`);
  check('recovered submission attributed to the share project', orphanProj.project_id === 'p1', orphanProj.project_id);

  // realtime send is manager-only on project channels (H1)
  const sendPol = await one(`select pg_get_expr(polwithcheck, polrelid) w from pg_policy where polname='rt_send'`);
  check('rt_send requires manager on project channels', /is_project_manager/.test(sendPol.w), sendPol.w);

  console.log('\n- side effects -');
  const bcast = await one(`select count(*) n from realtime.messages where topic = 'proj:p1'`);
  check('broadcast triggers emitted project events', +bcast.n > 0, bcast.n);
  const act = await one(`select count(*) n from activity where org_id='${ORG}'`);
  check('append-only activity recorded RPC actions', +act.n >= 4, act.n);
  const acts = (await db.query(`select distinct action from activity order by action`)).rows.map((x) => x.action);
  check('activity covers versions, approvals, status, and inbound comms',
    ['approval.approved', 'comm.received', 'version.created', 'version.status'].every((a) => acts.includes(a)), acts);

  console.log('\n- cross-org fencing -');
  await asUser(RIVAL);
  r = await one(`select share_put('p2','brief',1,'{"product":"RivalProduct"}'::jsonb, 'legacybrief2') t`);
  check('cross-org share token takeover refused', r.t === null, r.t);
  const victim = await one(`select payload->>'product' p, org_id from shares where token='legacybrief2'`);
  check('victim share payload untouched', victim.p === 'RecordMade' && victim.org_id === ORG, victim);
  r = await one(`select save_field('p1','ov_vision','"hijack"'::jsonb, 0) j`);
  check('rival manager cannot write another org project', r.j.ok === false && r.j.error === 'forbidden', r.j);

  console.log('\n- anonymous rate limiting -');
  await asUser('');
  let tripped = -1;
  for (let i = 0; i < 31; i++) {
    const rr = await one(`select request_submit('legacynote1', 'Flood Bot', 'attempt') j`);
    if (rr.j.ok === false && rr.j.error === 'rate_limited') { tripped = i; break; }
  }
  check('request intake rate limit trips within the hour window', tripped >= 0 && tripped <= 30, tripped);

  console.log('\n- server-stamped team identity -');
  await asUser(MANAGER);
  await run(`insert into messages(org_id,parent_kind,parent_id,author_kind,author_name,author_user,body)
             values ('${ORG}','comm','${commId}','team','Totally Fake Name','${MANAGER}','identity check')`);
  const stamped = await one(`select author_name from messages where body='identity check'`);
  check('client-supplied team name is overwritten by the profile', stamped.author_name !== 'Totally Fake Name', stamped.author_name);

  console.log('\n- size ceilings -');
  r = await one(`select save_field('p1','huge_field', to_jsonb(repeat('x', 300000)), 0) j`);
  check('oversize worksheet answer rejected', r.j.ok === false && r.j.error === 'too_large', r.j.error);
  r = await one(`select upsert_row('p1','fr', null, jsonb_build_object('stmt', repeat('x', 200000))) j`);
  check('oversize row rejected', r.j.ok === false && r.j.error === 'too_large', r.j.error);

  console.log('\n- viewer RLS under the authenticated role -');
  await asUser(VIEWER);
  await run('set role authenticated');
  const vread = await one(`select count(*) n from project_fields where project_id='p1'`);
  check('viewer reads the worksheet', +vread.n > 0, vread.n);
  let denied = false;
  try { await run(`update project_fields set value = '"x"'::jsonb where project_id = 'p1'`); }
  catch { denied = true; }
  check('viewer cannot write fields directly (no grant, no policy)', denied);
  const vmsg = await one(`insert into messages(org_id,parent_kind,parent_id,author_kind,author_name,author_user,body)
    values ('${ORG}','comm','${commId}','team','Whoever','${VIEWER}','viewer reply') returning author_name`);
  check('viewer may reply in threads, name stamped from account', vmsg.author_name === 'viewer@fathers.com', vmsg.author_name);
  let crossDenied = false;
  try { await one(`select count(*) n from comms where org_id = '33333333-0000-0000-0000-00000000000a'`).then((x) => { crossDenied = +x.n === 0; }); }
  catch { crossDenied = true; }
  check('viewer sees nothing from the rival org', crossDenied);
  await run('reset role');

  console.log('\n- verify.sql runs clean -');
  await asUser(MANAGER);
  await run(sql(rel('../../supabase/verify.sql')));
  check('verify.sql executes without error', true);
} catch (e) {
  fail++;
  console.error('\n✗ HARNESS ERROR:', e.message);
  if (e.position) console.error('  at SQL position', e.position);
} finally {
  await db.end().catch(() => {});
  await epg.stop().catch(() => {});
}
console.log(`\nbackend e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
