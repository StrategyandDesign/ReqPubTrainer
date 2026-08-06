/* ============================================================================
   Post-deploy live prober. Verifies that production serves this repo and that
   the backend exposes exactly what the committed schema promises.

   Run after a deploy:
     node tools/smoke.mjs                       origin from CNAME, keys from config.js
     node tools/smoke.mjs https://reqpub.com    explicit origin
     node tools/smoke.mjs --plan                print the probe plan, no network

   Probes:
     1. Served vs repo. index.html, app/index.html, and every app/js module
        fetched from the origin and sha256-compared byte for byte against the
        working tree. Drift right after a push usually means GitHub Pages has
        not finished deploying; re-run in a minute before investigating.
     2. RPC existence. Every callable function defined in supabase/schema.sql
        (trigger functions excluded; PostgREST never exposes them) is probed at
        /rest/v1/rpc/<name>. Missing means HTTP 404 / PGRST202: either the
        migration was never applied or the PostgREST schema cache is stale
        (run: notify pgrst, 'reload schema').
     3. Edge reachability. Every folder under supabase/functions/ answers at
        /functions/v1/<name> with anything but 404.
     4. Write locks. Direct writes to versions and sign_requests as anon must
        be refused at the privilege layer (401/403/42501). Probes cannot
        mutate: the anon key carries no session, updates filter on the nil
        uuid so zero rows can match, inserts reference foreign keys that
        cannot exist, and every request carries Prefer: tx=rollback.
   ============================================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { repoRoot, listAppJs, parseSchemaFunctions } from './audit-lib.mjs';

const root = repoRoot();
const read = (p) => readFileSync(join(root, p));
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? (argv.splice(i, 2)[1] ?? true) : null; };
const PLAN = argv.includes('--plan') ? (argv.splice(argv.indexOf('--plan'), 1), true) : false;
const NIL = '00000000-0000-0000-0000-000000000000';

const cfgText = read('config.js').toString();
const cfg = (k) => (cfgText.match(new RegExp(k + ":\\s*'([^']+)'")) || [])[1] || '';
const supabaseUrl = (flag('--supabase-url') || cfg('url')).replace(/\/$/, '');
const anon = flag('--anon') || cfg('anon');
const origin = (argv[0] || ('https://' + read('CNAME').toString().trim())).replace(/\/$/, '');

const coreFiles = ['index.html', 'app/index.html', ...listAppJs(root)];
const rpcFns = parseSchemaFunctions(read('supabase/schema.sql').toString()).filter((f) => f.callable);
const edgeFns = readdirSync(join(root, 'supabase', 'functions'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();
const writeProbes = [
  { table: 'versions', patch: { note: 'smoke write-lock probe' },
    insert: { project_id: '__smoke__', seq: 0, label: '0', snapshot: {} } },
  { table: 'sign_requests', patch: { decline_reason: '' },
    insert: { org_id: NIL, project_id: '__smoke__', version_id: NIL, token: '__smoke__' } },
];

let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL  ' + msg); };
const ok = (msg) => console.log('ok    ' + msg);

if (PLAN) {
  console.log('origin            ' + origin);
  console.log('supabase          ' + supabaseUrl);
  console.log('hash parity       ' + coreFiles.length + ' files: ' + coreFiles.join(', '));
  console.log('rpc existence     ' + rpcFns.length + ' callable functions: ' + rpcFns.map((f) => f.name).join(', '));
  console.log('edge reachability ' + edgeFns.length + ' functions: ' + edgeFns.join(', '));
  console.log('write locks       ' + writeProbes.map((w) => w.table).join(', ') + ' (patch nil uuid + insert impossible fks, tx=rollback)');
  process.exit(0);
}
if (!supabaseUrl || !anon) { console.error('config.js did not yield a Supabase url and anon key; pass --supabase-url and --anon.'); process.exit(2); }

const sbHeaders = { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' };
async function req(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, text, body };
  } catch (e) {
    return { status: 0, text: String(e && e.message || e), body: null };
  } finally { clearTimeout(t); }
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/* ---- 1) served vs repo ---------------------------------------------------- */
{
  let drift = 0;
  for (const p of coreFiles) {
    const local = read(p);
    const r = await fetch(origin + '/' + p + '?smoke=' + Date.now()).catch(() => null);
    if (!r || !r.ok) { fail('serve ' + p + ': HTTP ' + (r ? r.status : 'unreachable')); drift++; continue; }
    const served = Buffer.from(await r.arrayBuffer());
    if (sha(served) !== sha(local)) {
      fail('serve ' + p + ': drift (repo ' + local.length + 'B ' + sha(local).slice(0, 12) +
        ', served ' + served.length + 'B ' + sha(served).slice(0, 12) + ')');
      drift++;
    }
  }
  if (!drift) ok('served vs repo: ' + coreFiles.length + ' files match byte for byte');
  else console.log('      (drift immediately after a push usually means Pages is still deploying; re-run in a minute)');
}

/* ---- 2) rpc existence, generated from schema.sql -------------------------- */
{
  let missing = 0;
  for (const f of rpcFns) {
    const args = Object.fromEntries(f.args.map((a) => [a.name, null]));
    const r = await req(supabaseUrl + '/rest/v1/rpc/' + f.name, {
      method: 'POST', headers: { ...sbHeaders, prefer: 'tx=rollback' }, body: JSON.stringify(args),
    });
    const gone = r.status === 404 || (r.body && r.body.code === 'PGRST202');
    if (gone) { fail('rpc ' + f.name + ': not present live (' + (r.body && r.body.code || r.status) + ')'); missing++; }
  }
  if (!missing) ok('rpc existence: all ' + rpcFns.length + ' schema functions answer live');
  else console.log('      (PGRST202 with the function applied means a stale PostgREST cache: notify pgrst, \'reload schema\')');
}

/* ---- 3) edge function reachability ---------------------------------------- */
{
  let missing = 0;
  for (const name of edgeFns) {
    let r = await req(supabaseUrl + '/functions/v1/' + name, { method: 'OPTIONS', headers: sbHeaders });
    if (r.status === 0) r = await req(supabaseUrl + '/functions/v1/' + name, { method: 'GET', headers: sbHeaders });
    if (r.status === 404 || r.status === 0) { fail('edge ' + name + ': not reachable (' + (r.status || r.text) + ')'); missing++; }
  }
  if (!missing) ok('edge reachability: all ' + edgeFns.length + ' functions answer');
}

/* ---- 4) write locks on versions and sign_requests ------------------------- */
{
  const locked = (r) => r.status === 401 || r.status === 403 || (r.body && r.body.code === '42501');
  let open = 0;
  for (const w of writeProbes) {
    const patch = await req(supabaseUrl + '/rest/v1/' + w.table + '?id=eq.' + NIL, {
      method: 'PATCH', headers: { ...sbHeaders, prefer: 'tx=rollback,return=minimal' }, body: JSON.stringify(w.patch),
    });
    if (!locked(patch)) {
      fail('write lock ' + w.table + ': anon PATCH was not refused at the privilege layer (HTTP ' + patch.status + ')'); open++;
    }
    const ins = await req(supabaseUrl + '/rest/v1/' + w.table, {
      method: 'POST', headers: { ...sbHeaders, prefer: 'tx=rollback,return=minimal' }, body: JSON.stringify(w.insert),
    });
    if (!locked(ins)) {
      fail('write lock ' + w.table + ': anon INSERT was not refused at the privilege layer (HTTP ' + ins.status + ')'); open++;
    }
  }
  if (!open) ok('write locks: versions and sign_requests refuse direct anon writes');
}

/* ---- verdict -------------------------------------------------------------- */
if (failures) {
  console.log('\nsmoke: ' + failures + ' failure' + (failures === 1 ? '' : 's') + '. Production does not match the repo.');
  process.exit(1);
}
console.log('\nsmoke: production matches the repo.');
