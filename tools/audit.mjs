/* ============================================================================
   Static symmetry audit. Exits nonzero on any mismatch, so orphans and drift
   fail the build. Run: node tools/audit.mjs   (CI runs it before the suites)

   Checks:
     1. data-action symmetry. Every action name in rendered markup, in
        querySelector lookups, and in palette `action:` fields has a handler
        (a handleAction case or a change-delegation branch), and every handler
        is referenced somewhere. Dynamic data-action concatenations must
        resolve to string literals or the audit fails.
     2. rpc callsites. Every rpc('x') and sb.rpc('x') in served JS resolves to
        a function defined in supabase/schema.sql.
     3. Edge functions. Every functions.invoke('x') and functions/v1/x
        callsite has a matching folder under supabase/functions/.
     4. Syntax. node --check passes on every module under app/js/.
     5. Banned language. app/js and every served HTML page carry no em dash
        and none of the AI-tell vocabulary (list in tools/audit-lib.mjs).
   ============================================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  repoRoot, listAppJs, listServedHtml, parseSchemaFunctions,
  extractRpcNames, extractInvokeNames, collectActions, bannedHits,
} from './audit-lib.mjs';

const root = repoRoot();
const read = (p) => readFileSync(join(root, p), 'utf8');
let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL  ' + msg); };
const ok = (msg) => console.log('ok    ' + msg);

/* ---- 1) data-action symmetry --------------------------------------------- */
{
  const files = [...listAppJs(root), ...listServedHtml(root)]
    .map((p) => ({ path: p, text: read(p) }));
  const { markup, handlers, references, indirect, failures: dyn } = collectActions(files);
  dyn.forEach((d) => fail('data-action: ' + d));

  for (const [name, where] of [...markup, ...references, ...indirect]) {
    if (!handlers.has(name)) fail('data-action "' + name + '" has no handler (' + where[0] + ')');
  }
  for (const [name] of references) {
    if (!markup.has(name)) fail('querySelector targets data-action "' + name + '" which no markup renders');
  }
  const referenced = new Set([...markup.keys(), ...references.keys(), ...indirect.keys()]);
  for (const [name, where] of handlers) {
    if (!referenced.has(name)) fail('handler "' + name + '" is dead: no markup, lookup, or palette item uses it (' + where[0] + ')');
  }
  if (!failures) ok('data-action symmetry: ' + markup.size + ' markup actions, ' + handlers.size + ' handlers, ' + indirect.size + ' palette actions, no orphans');
}

/* ---- 1b) the build stamp is the package version --------------------------- */
{
  const pkg = JSON.parse(read('package.json')).version;
  const m = read('app/js/core.js').match(/APP_VERSION = '([^']+)'/);
  if (!m) fail('core.js does not export APP_VERSION');
  else if (m[1] !== pkg) fail('APP_VERSION ' + m[1] + ' != package.json ' + pkg);
  else ok('build stamp: APP_VERSION matches package.json (' + pkg + ')');
}

/* ---- 1c) help anchors: every registry key renders somewhere ---------------- */
{
  const reg = [...read('app/js/help.js').matchAll(/key: '([a-z.]+)'/g)].map((m) => m[1]);
  const views = ['app/js/views-app.js', 'app/js/views-collab.js', 'app/js/help.js', 'app/js/help.js'].map(read).join('\n');
  const missing = reg.filter((k) => !views.includes('data-help-anchor="' + k + '"'));
  if (missing.length) fail('help anchors missing from views: ' + missing.join(', '));
  else ok('help anchors: ' + reg.length + ' registry keys all render as data-help-anchor targets');
}

/* ---- 2) rpc callsites resolve in schema.sql ------------------------------- */
const rpcFailBase = failures;
{
  const js = [...listAppJs(root), 'login/login.js', 'signup/signup.js', 'site.js']
    .map((p) => ({ p, t: read(p) }));
  const called = new Map();
  for (const { p, t } of js) for (const n of extractRpcNames(t)) if (!called.has(n)) called.set(n, p);
  const defined = new Set(parseSchemaFunctions(read('supabase/schema.sql')).map((f) => f.name));
  for (const [n, p] of [...called].sort()) {
    if (!defined.has(n)) fail('rpc "' + n + '" (' + p + ') is not defined in supabase/schema.sql');
  }
  if (failures === rpcFailBase) ok('rpc symmetry: ' + called.size + ' callsites, all defined in schema.sql');
}

/* ---- 3) edge function callsites have folders ------------------------------ */
const edgeFailBase = failures;
{
  const js = listAppJs(root).map((p) => read(p)).join('\n');
  const called = extractInvokeNames(js);
  const folders = new Set(readdirSync(join(root, 'supabase', 'functions'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name));
  for (const n of [...called].sort()) {
    if (!folders.has(n)) fail('edge function "' + n + '" is invoked but supabase/functions/' + n + '/ does not exist');
  }
  if (failures === edgeFailBase) ok('edge symmetry: ' + called.size + ' invoked, all present under supabase/functions/ (' + folders.size + ' folders)');
}

/* ---- 4) node --check on the app/js module graph --------------------------- */
const synFailBase = failures;
{
  for (const p of listAppJs(root)) {
    const r = spawnSync(process.execPath, ['--check', join(root, p)], { encoding: 'utf8' });
    if (r.status !== 0) fail('node --check ' + p + ': ' + (r.stderr || '').split('\n')[0]);
  }
  if (failures === synFailBase) ok('syntax: node --check clean on ' + listAppJs(root).length + ' app/js modules');
}

/* ---- 5) banned language --------------------------------------------------- */
const banFailBase = failures;
{
  const targets = [...listAppJs(root), ...listServedHtml(root)];
  for (const p of targets) {
    for (const h of bannedHits(p, read(p))) fail('banned language [' + h.term + '] ' + h.where + '  ' + h.text);
  }
  if (failures === banFailBase) ok('banned language: ' + targets.length + ' files clean (em dash + vocabulary list)');
}

/* ---- verdict -------------------------------------------------------------- */
if (failures) {
  console.log('\naudit: ' + failures + ' failure' + (failures === 1 ? '' : 's') + '. The build is blocked until the symmetry is restored.');
  process.exit(1);
}
console.log('\naudit: clean.');
