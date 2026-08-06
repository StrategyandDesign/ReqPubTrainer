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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

const violations = [];
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
  `every vendored file matches the hash recorded in VENDOR.md`);
