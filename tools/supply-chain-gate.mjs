#!/usr/bin/env node
/* ReqPub - the supply chain gate.
 *
 * Finding recorded in app/vendor/VENDOR.md: the three pages that hold a
 * session loaded the Supabase client from a public CDN at the floating tag
 * `@2`, with no integrity attribute, and their content security policy named
 * that origin explicitly. That script holds the session token and mediates
 * every read and every write, so a single malicious publish to the 2.x line
 * would have executed with full session authority against every customer at
 * once. The PDF worker had been vendored properly long before, which means
 * the harder case was solved and the easier one was missed.
 *
 * This gate makes that unrepeatable. It fails the build when:
 *
 *   ORIGIN    any served page loads a script from an origin other than ours
 *   POLICY    any served page has no content security policy
 *   SCRIPTSRC any policy names a script source other than 'self'
 *   HASH      a file in app/vendor does not match the hash recorded in
 *             VENDOR.md, or is absent from the inventory entirely
 *   NONET     verify.html or receipt-verify.html loses connect-src 'none',
 *             which is the property that lets a reviewer verify a record with
 *             the network switched off
 *
 * --selftest runs a violating fixture through the same checks and asserts
 * every class fires, so the gate cannot rot into a formality.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* Every page a browser can load. */
function servedPages() {
  const out = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  for (const dir of ['app', 'login', 'signup']) {
    const p = join(ROOT, dir, 'index.html');
    if (existsSync(p)) out.push(dir + '/index.html');
  }
  return out;
}

/* Pages whose whole value is that they cannot phone home. */
const NO_NETWORK = ['verify.html', 'receipt-verify.html'];

export function checkPage(file, html) {
  const v = [];
  const scripts = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]);
  for (const src of scripts) {
    if (/^https?:\/\//i.test(src) || src.startsWith('//')) {
      v.push(`ORIGIN    ${file} loads a script from another origin: ${src}`);
    }
  }
  /* A policy is full of single quotes ('self', 'none'), so the content
     attribute must be matched as a double-quoted value. Matching either quote
     character truncated every policy at "default-src " and made the gate
     report that no page sets a script source. */
  const csp = /<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i.exec(html);
  if (!csp) {
    v.push(`POLICY    ${file} has no content security policy`);
  } else {
    const policy = csp[1];
    const m = /script-src\s+([^;]+)/i.exec(policy);
    if (!m) {
      v.push(`SCRIPTSRC ${file} sets no script-src`);
    } else {
      const sources = m[1].trim().split(/\s+/).filter(Boolean);
      const extra = sources.filter((x) => x !== "'self'" && x !== "'none'");
      if (extra.length) v.push(`SCRIPTSRC ${file} permits a script source other than 'self': ${extra.join(' ')}`);
    }
    if (NO_NETWORK.includes(file) && !/connect-src\s+'none'/i.test(policy)) {
      v.push(`NONET     ${file} lost connect-src 'none'; a reviewer can no longer prove it makes no request`);
    }
  }
  return v;
}

export function checkVendor(inventory, files) {
  const v = [];
  for (const [name, hash] of files) {
    if (!inventory.includes(name)) { v.push(`HASH      app/vendor/${name} is not listed in VENDOR.md`); continue; }
    if (!inventory.includes(hash)) v.push(`HASH      app/vendor/${name} does not match the hash recorded in VENDOR.md`);
  }
  return v;
}

if (process.argv.includes('--selftest')) {
  const bad = [
    ...checkPage('fixture.html', '<html><head></head><body><script src="https://evil.example/x.js"></script></body></html>'),
    ...checkPage('fixture2.html', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' https://cdn.example" /><html></html>'),
    ...checkPage('verify.html', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; connect-src \'self\'" /><html></html>'),
    ...checkVendor('nothing here', [['ghost.js', 'sha384-abc']]),
  ];
  const classes = ['ORIGIN', 'POLICY', 'SCRIPTSRC', 'NONET', 'HASH'];
  const silent = classes.filter((c) => !bad.some((b) => b.startsWith(c)));
  if (silent.length) { console.error('supply chain gate selftest FAILED: silent classes: ' + silent.join(', ')); process.exit(1); }
  console.log('supply chain gate selftest: every class fires on the violating fixture (' + bad.length + ' violations named)');
  process.exit(0);
}

/* A script tag in HTML is not the only way a page loads code. app/js/main.js
   set `script.src` to a CDN at runtime for the PDF and Word readers, and this
   gate reported no third-party origin the whole time, because it only read
   HTML. When the policy was tightened to script-src 'self' the injections were
   blocked and file upload stopped working, with nothing in the interface to
   say why. Source is scanned too now. */
function checkSource() {
  const v = [];
  const dirs = ['app/js', 'supabase/functions', 'tools', 'scripts'];
  const walk = (d, out = []) => {
    if (!existsSync(join(ROOT, d))) return out;
    for (const n of readdirSync(join(ROOT, d))) {
      const rel = d + '/' + n;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
      else if (/\.(js|mjs|ts)$/.test(n)) out.push(rel);
    }
    return out;
  };
  for (const dir of dirs) {
    for (const f of walk(dir)) {
      if (f.includes('/dist/')) continue;                 // generated from the sources above
      const src = readFileSync(join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/\.src\s*=\s*['"`](https?:\/\/[^'"`]+)/g)) {
        v.push(`ORIGIN    ${f} loads a script from another origin at runtime: ${m[1].slice(0, 70)}`);
      }
      /* A Deno edge function imports by URL; that is how the runtime works and
         is not a defect. A URL without an exact version is: these two functions
         hold the service role, and a floating major tag means a publish to that
         line executes with those credentials. Pinned is the requirement, not
         same-origin. */
      for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*)['"`](https?:\/\/[^'"`]+)['"`]/g)) {
        const url = m[1];
        const pinned = /@\d+\.\d+\.\d+(?:[-+][\w.]+)?(?:\/|$|\?)/.test(url) || /@\d+\.\d+\.\d+$/.test(url);
        if (!pinned) v.push(`PIN       ${f} imports ${url.slice(0, 62)} without an exact version`);
      }
      if (!f.startsWith('app/js')) continue;
      for (const m of src.matchAll(/import\s*\(\s*['"`](https?:\/\/[^'"`]+)/g)) {
        v.push(`ORIGIN    ${f} imports from another origin at runtime: ${m[1].slice(0, 70)}`);
      }
    }
  }
  return v;
}

const violations = [];
violations.push(...checkSource());
const pages = servedPages();
for (const f of pages) violations.push(...checkPage(f, read(f)));

const vendorDir = join(ROOT, 'app/vendor');
if (existsSync(vendorDir)) {
  const inventory = existsSync(join(vendorDir, 'VENDOR.md')) ? read('app/vendor/VENDOR.md') : '';
  if (!inventory) violations.push('HASH      app/vendor/VENDOR.md is missing; the inventory is the control');
  const files = readdirSync(vendorDir).filter((f) => f.endsWith('.js')).map((f) => {
    const bytes = readFileSync(join(vendorDir, f));
    return [f, 'sha384-' + createHash('sha384').update(bytes).digest('base64')];
  });
  violations.push(...checkVendor(inventory, files));
}

if (violations.length) {
  for (const x of violations) console.error('SUPPLY CHAIN GATE  ' + x);
  console.error(`supply chain gate: ${violations.length} violation${violations.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log(`supply chain gate: ${pages.length} served pages, every one carrying a policy that permits no third-party script source; ` +
  `no source file loads a script from another origin at runtime; every vendored file matches the hash recorded in VENDOR.md`);
