/* ReqPub C1.1 - the authorization matrix
   (node tests/backend-e2e/authz-matrix.test.mjs)

   This suite is the permanent answer to the question an auditor asks first:
   what can an unauthenticated caller reach, and what can a caller reach who
   holds a session but no membership in the organization they are naming.

   It does three things. It enumerates every function in the public schema and
   asserts the anon-reachable and authenticated-reachable sets equal a
   committed allowlist, so a function added later is private until someone
   deliberately grants it and reviews the diff. It re-runs the C1-001 exploit
   and asserts it is refused. And it regenerates docs/security/AUTHZ_MATRIX.md so drift is
   visible in review rather than in production.

   C1-001, CRITICAL: before the lockdown, a caller holding only the public
   anon key could call log_activity directly and insert a forged, chained row
   into any organization's trail. Proven, fixed, and pinned below. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-authz-' + process.pid), user: 'postgres', password: 'pw', port: 55506, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55506, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

/* The committed allowlist. Anything reachable and not named here fails the
   suite; anything named here and unreachable fails it too. */
const TYPE_ALIASES = [[/\bint\b/g, 'integer'], [/\btimestamptz\b/g, 'timestamp with time zone'],
  [/\bfloat8\b/g, 'double precision'], [/\bbool\b/g, 'boolean']];
const normSig = (s) => TYPE_ALIASES.reduce((acc, [re, to]) => acc.replace(re, to), s);
const ANON_ALLOW = [
  'get_share(text)',
  'receipt_for(uuid, text)',
  'receipt_store(uuid, text, jsonb, text, text, text)',
  'receipt_tsa_update(uuid, text, text, text)',
  'request_submit(text, text, text)',
  'request_view(text)',
  'sign_request_context(text)',
  'sign_request_decline(text, text)',
  'sign_request_sign(text, text, text)',
  'sme_reply(text, text)',
  'sme_thread(text)',
  'submit_share_v2(text, jsonb)',
  'update_comment(text, text)',
  'update_context(text)',
  'update_note_save(text, text, integer)',
  'update_thread_create(text, text, text, text)',
  'update_thread_reply(text, uuid, text)',
];
const AUTH_ONLY_ALLOW = [
  // Required by RLS: policies are evaluated as the querying role, and each
  // predicate answers only whether the caller themselves is a member.
  'is_org_member(uuid)', 'is_org_manager(uuid)', 'is_project_member(text)',
  'is_project_manager(text)', 'is_project_partner(text)',
  'approval_decide(uuid, text, text)',
  'book_export()',
  'chain_repair(text)',
  'claim_invites()',
  'comm_seen(uuid)',
  'create_org(text)',
  'create_version(text, boolean, text, jsonb, text)',
  'delete_row(text, uuid)',
  'deliveries_due(text, int)',
  'deliveries_list(text, int)',
  'delivery_redeliver(uuid)',
  'endpoint_create(text, text, text)',
  'endpoint_set_active(uuid, boolean)',
  'evidence_gather(text)',
  'evidence_log_export(text)',
  'help_stats(uuid)',
  'mcp_key_issue(uuid, text, boolean, text[])',
  'mcp_key_revoke(uuid)',
  'mcp_keys_list(uuid)',
  'my_context()',
  'my_open_approvals()',
  'org_members_named(uuid)',
  'partner_post(text, text)',
  'partner_present_token(text)',
  'partner_projects_v2()',
  'partner_reply(uuid, text)',
  'partner_thread_v2(text)',
  'partner_update_profile(text, text, text)',
  'project_acceptance_facts()',
  'project_set_lineage(text, text, integer, text)',
  'receipts_for_project(text)',
  'record_template_delete(uuid)',
  'record_template_get(uuid)',
  'record_template_put(uuid, text, jsonb)',
  'record_template_touch(uuid)',
  'record_templates_list(uuid)',
  'save_field(text, text, jsonb, integer)',
  'seal_context(uuid)',
  'share_put(text, text, integer, jsonb, text)',
  'share_revoke(text)',
  'sign_request_create(uuid, text, text, text, text)',
  'sign_request_revoke(uuid)',
  'sme_seat(text, text, text)',
  'sme_seats(text)',
  'update_publish(text, jsonb, timestamptz, text, text, text, text)',
  'update_revoke(uuid)',
  'updates_next_id(text, text)',
  'upsert_row(text, text, uuid, jsonb, double precision, integer)',
  'v2_context()',
  'verify_project_chain(text)',
  'version_set_build(uuid, text)',
  'version_set_status(uuid, text)',
  'walkthrough_add(text, uuid, text)',
  'walkthrough_caption(uuid, text)',
  'walkthrough_move(uuid, int)',
  'walkthrough_remove(uuid)',
  'webhook_host(text)',
];

const VICTIM = '33333333-0000-0000-0000-0000000000b1';
const OUTSIDER = '33333333-0000-0000-0000-0000000000b9';
const VORG = '44444444-0000-0000-0000-0000000000b1';

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  for (const f of ['schema.sql', 'migrations/0021_sealing.sql', 'migrations/0022_attachment_hash.sql', 'migrations/0023_webhooks.sql',
                   'migrations/0024_mcp.sql', 'migrations/0025_evidence.sql', 'migrations/0026_book_practice.sql', 'migrations/0027_pursuit_lineage.sql'])
    await run(sql(rel('../../supabase/' + f)));

  /* ---- the vulnerable state, so the suite proves the fix rather than
          asserting it. This is C1-001 exactly as it was reported. ---- */
  await run(`insert into auth.users(id,email) values ('${VICTIM}','victim@client.co'),('${OUTSIDER}','x@rival.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${VORG}','Victim Firm','${VICTIM}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${VORG}','${VICTIM}','victim@client.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values ('victim-proj','${VORG}','Confidential engagement','${VICTIM}')`);

  // schema.sql now carries the lockdown itself, so the vulnerable state no
  // longer exists to be loaded. It is therefore constructed here, explicitly
  // and visibly: restore exactly the PostgreSQL default this finding is about,
  // EXECUTE to PUBLIC on an ungated internal helper. The exploit below is then
  // a real attack against a real configuration, not a story about one.
  await run(`grant execute on function log_activity(uuid, text, text, text, text, text, jsonb) to public`);
  await run(`grant execute on function chain_ensure_genesis(text) to public`);
  await run(`set role anon`);
  let preExploit = 'refused';
  try {
    await run(`select log_activity('${VORG}'::uuid, 'victim-proj', 'version.approved', 'version', 'v-forged', 'Baseline 9.9 approved by the client', '{}'::jsonb)`);
    preExploit = 'landed';
  } catch { preExploit = 'refused'; }
  await run(`reset role`);
  const forgedBefore = await one(`select count(*)::int n from activity where project_id='victim-proj' and entity_id='v-forged'`);
  check('C1-001 reproduces on the unpatched stack: an anon caller forges a chained trail row',
    preExploit === 'landed' && forgedBefore.n === 1, [preExploit, forgedBefore.n]);
  // The forged row cannot be deleted: activity and chain_events are
  // append-only by policy and trigger, which is the invariant that makes the
  // forgery serious in the first place. Every assertion below is therefore a
  // delta against this mark, not an absolute count.
  const mark = (await one(`select count(*)::int n from activity where project_id='victim-proj'`)).n;

  /* ---- apply the lockdown, twice ---- */
  await run(sql(rel('../../supabase/migrations/0028_authz_lockdown.sql')));
  await run(sql(rel('../../supabase/migrations/0028_authz_lockdown.sql')));
  check('migrations/0028_authz_lockdown.sql applies twice on the full stack', true);

  /* ---- the exploit is refused ---- */
  await run(`set role anon`);
  let post = 'landed', msg = '';
  try {
    await run(`select log_activity('${VORG}'::uuid, 'victim-proj', 'version.approved', 'version', 'v-forged', 'Baseline 9.9 approved by the client', '{}'::jsonb)`);
  } catch (e) { post = 'refused'; msg = e.message; }
  let genesis = 'landed';
  try { await run(`select chain_ensure_genesis('victim-proj')`); } catch { genesis = 'refused'; }
  let chainAppend = 'landed';
  try { await run(`select chain_repair('victim-proj')`); } catch { chainAppend = 'refused'; }
  await run(`reset role`);
  const forgedAfter = await one(`select count(*)::int n from activity where project_id='victim-proj'`);
  check('C1-001 is closed: anon cannot call log_activity', post === 'refused' && /permission denied/i.test(msg), msg.slice(0, 60));
  check('the chain helpers are closed to anon as well', genesis === 'refused' && chainAppend === 'refused', [genesis, chainAppend]);
  check('no further row reached the victim trail', forgedAfter.n === mark, [forgedAfter.n, mark]);

  /* ---- an authenticated non-member cannot forge either ---- */
  await run(`set role authenticated`); await asUser(OUTSIDER);
  let authForge = 'landed';
  try {
    await run(`select log_activity('${VORG}'::uuid, 'victim-proj', 'version.approved', 'version', 'v2', 'Forged by a stranger', '{}'::jsonb)`);
  } catch { authForge = 'refused'; }
  await run(`reset role`);
  const afterAuth = await one(`select count(*)::int n from activity where project_id='victim-proj'`);
  check('a session without membership cannot forge a trail row either',
    authForge === 'refused' && afterAuth.n === mark, [authForge, afterAuth.n, mark]);

  /* ---- defense in depth: the helper refuses impossible arguments even when
          reached legitimately from inside another definer function ---- */
  await run(`select log_activity('${VORG}'::uuid, 'no-such-project', 'test', 'x', 'x', 'x', '{}'::jsonb)`);
  const cross = await one(`select count(*)::int n from activity where project_id='no-such-project'`);
  check('log_activity refuses a project that does not belong to the org named', cross.n === 0, cross.n);
  const ghostOrg = '44444444-0000-0000-0000-00000000ffff';
  await run(`select log_activity('${ghostOrg}'::uuid, null, 'test', 'x', 'x', 'x', '{}'::jsonb)`);
  const ghost = await one(`select count(*)::int n from activity where org_id='${ghostOrg}'`);
  check('log_activity refuses an organization that does not exist', ghost.n === 0, ghost.n);

  /* ---- the reachability matrix ---- */
  const rows = (await db.query(`select p.proname,
      coalesce((select string_agg(format_type(t, null), ', ' order by ord)
                from unnest(p.proargtypes) with ordinality u(t, ord)), '') args,
      p.prosecdef definer,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' order by p.proname, args`)).rows;
  const sig = (r) => r.proname + '(' + (r.args || '') + ')';
  const anonReach = rows.filter((r) => r.anon).map(sig).sort();
  const authReach = rows.filter((r) => r.auth).map(sig).sort();
  const wantAnon = ANON_ALLOW.map(normSig).sort();
  const wantAuth = [...ANON_ALLOW, ...AUTH_ONLY_ALLOW].map(normSig).sort();

  const anonExtra = anonReach.filter((x) => !wantAnon.includes(x));
  const anonMissing = wantAnon.filter((x) => !anonReach.includes(x));
  check('the anon-reachable surface equals the committed allowlist, exactly',
    anonExtra.length === 0 && anonMissing.length === 0, { unexpected: anonExtra, missing: anonMissing });
  const authExtra = authReach.filter((x) => !wantAuth.includes(x));
  const authMissing = wantAuth.filter((x) => !authReach.includes(x));
  check('the authenticated-reachable surface equals the committed allowlist, exactly',
    authExtra.length === 0 && authMissing.length === 0, { unexpected: authExtra, missing: authMissing });
  // The internal helpers, named. The membership predicates are deliberately
  // reachable because RLS requires it and each answers only about the caller;
  // everything below writes, mutates the chain, or resolves another
  // organization's data, and none of it is callable from either role.
  const INTERNAL = ['log_activity', 'chain_append_row', 'chain_ensure_genesis', 'chain_link_activity',
    'project_org', 'webhook_enqueue', 'webhook_on_sign', 'webhook_on_seal', 'current_display_name',
    'attachment_uploader', 'attachment_sme_target', 'sync_project_name', 'messages_flag_external',
    'enforce_team_author', 'enforce_approval_provenance'];
  const leaked = INTERNAL.filter((n) => anonReach.some((s) => s.startsWith(n + '('))
    || authReach.some((s) => s.startsWith(n + '(')));
  check('every internal helper is unreachable from both roles', leaked.length === 0, leaked);

  /* ---- a function added later is caught by this suite, which is the
          control that actually holds. The default-privileges lever was tried
          and measured: it stores no ACL row on this PostgreSQL and does not
          make new functions private, so the allowlist comparison above is
          what stands between a new function and an unreviewed public API. ---- */
  await run(`create or replace function public.zz_probe_new_function() returns int language sql as $$ select 1 $$`);
  const probe = await one(`select has_function_privilege('anon', 'public.zz_probe_new_function()', 'EXECUTE') a`);
  const reachNow = (await db.query(`select p.proname,
      coalesce((select string_agg(format_type(t, null), ', ' order by ord)
                from unnest(p.proargtypes) with ordinality u(t, ord)), '') args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')`)).rows
    .map((r) => r.proname + '(' + r.args + ')');
  const caught = reachNow.filter((x) => !wantAnon.includes(x));
  check('a function added later is caught by the allowlist comparison, with its name reported',
    caught.length === 1 && caught[0] === 'zz_probe_new_function()', caught);
  check('the measured default-privileges behaviour is recorded, not assumed', probe.a === true);
  await run(`drop function public.zz_probe_new_function()`);

  /* ---- the artifact ---- */
  const lines = ['# Authorization matrix', '',
    'Generated by tests/backend-e2e/authz-matrix.test.mjs. Every function in the',
    'public schema with the roles that may execute it. A function is private',
    'unless it appears with a role below, and the suite fails on any drift.', '',
    '| Function | Definer | anon | authenticated |', '| --- | --- | --- | --- |'];
  for (const r of rows) lines.push('| `' + sig(r) + '` | ' + (r.definer ? 'yes' : 'no') + ' | ' +
    (r.anon ? 'yes' : '') + ' | ' + (r.auth ? 'yes' : '') + ' |');
  lines.push('', 'Totals: ' + rows.length + ' functions, ' + anonReach.length + ' reachable by anon, ' +
    authReach.length + ' reachable by authenticated.', '');
  /* Line one says a machine wrote this, so a reader cannot mistake the
     artifact for a source. The docs gate requires the banner. */
  writeFileSync(rel('../../docs/security/AUTHZ_MATRIX.md'),
    '<!-- Generated by tests/backend-e2e/authz-matrix.test.mjs. Do not edit by hand. -->\n' + lines.join('\n'));
  check('the matrix artifact regenerates for review', lines.length > 40);
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + String((e && e.message) || e));
} finally {
  try { await db.end(); } catch {}
  try { await epg.stop(); } catch {}
}
console.log(`authz matrix: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
