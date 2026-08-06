#!/usr/bin/env node
/* ReqPub - the docs gate.
 *
 * The README rotted because no gate read it. Twenty-one markdown files
 * accumulated at the repository root, each one reasonable on the day it was
 * written, and together they made the root unreadable: a reviewer opening the
 * repository could not tell which audit was live, which report was current, or
 * where to start. Nothing prevented it, so it happened.
 *
 * This gate exists so the restructure holds. It fails on:
 *
 *   ROOT      a file at the repository root that is not on the allowlist. A
 *             new root-level document forces a decision about where it belongs
 *             instead of joining a pile.
 *   INDEX     a file under docs/releases or docs/reviews missing from its
 *             directory index, or an index row pointing at nothing.
 *   TITLE     an H1 equal to its own filename, entirely uppercase, or carrying
 *             a middle dot as a separator.
 *   BANNER    a generated file whose first line does not say it is generated.
 *   LINK      a relative markdown link that does not resolve.
 *   FROZEN    a normative published path that has moved. Section numbers in
 *             docs/VERIFY.md are printed inside artifacts already delivered to
 *             customers, so those paths cannot move without invalidating them.
 *
 * --selftest runs violating fixtures through the same checks.
 * --json emits the findings for tooling.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return null; } };
const has = (p) => existsSync(join(ROOT, p));

/* The root allowlist. Everything else belongs under docs/. */
const ROOT_ALLOWED = new Set([
  'README.md', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md', 'LICENSE', 'LICENSE.md',
  'RUN_REPORT.md', 'RUN_STATE.md',
  'package.json', 'package-lock.json', 'eslint.config.js', '.editorconfig', '.gitignore',
  'SHA_MANIFEST.txt', 'reqpub-keys.json', 'site.css', 'robots.txt', 'sitemap.xml', 'CNAME',
]);
/* The site ships as static files from the repository root, so its own
   scripts and pages belong there. Documents do not. */
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.AppleDouble']);
const READER_FILES = new Set([
  'receipt.json', 'signature.txt', 'publickey.txt', 'requirements.json',
  'baseline-bundle.reqpub.json', 'manifest.json', 'chronology.json',
  'evidence-row.csv', 'tsa_primary.tsr', 'tsa_secondary.tsr', 'receipt.hash',
]);
const ROOT_ALLOWED_EXT = new Set(['.html', '.js', '.css', '.txt', '.xml', '.json']);

/* Paths other people implement against. These do not move. */
const FROZEN = [
  'docs/VERIFY.md', 'docs/SPEC.md', 'docs/MCP.md', 'docs/WEBHOOKS.md', 'docs/RECEIVERS.md',
  'docs/ARCHITECTURE.md', 'docs/POSITIONING.md', 'docs/AUDIT.md', 'docs/ATTACHMENTS.md',
  'docs/DEPLOY.md', 'docs/OPERATING_MODEL.md', 'docs/PRICING.md',
  'schemas/reqpub-baseline-bundle.schema.json', 'schemas/reqpub-receipt.schema.json',
  'schemas/reqpub-evidence-manifest.schema.json',
  'tools/reqpub-verify.mjs', 'reqpub-keys.json', 'verify.html',
];

/* Files a machine writes. A reader must not mistake one for a source. */
const GENERATED = [
  ['docs/security/AUTHZ_MATRIX.md', 'tests/backend-e2e/authz-matrix.test.mjs'],
  ['tests/COUNTS.json', 'scripts/record-counts.mjs'],
  ['supabase/functions/mcp/dist/index.ts', 'scripts/bundle-mcp-function.mjs'],
  ['supabase/functions/seal-receipt/dist/index.ts', 'scripts/bundle-seal-function.mjs'],
];

export function checkRoot(entries) {
  const v = [];
  for (const name of entries) {
    if (ROOT_ALLOWED.has(name)) continue;
    if (ROOT_ALLOWED_EXT.has(name.slice(name.lastIndexOf('.')))) continue;
    if (!name.includes('.')) continue;              // directories
    /* Dotfiles are configuration, except the ones an operating system leaves
       behind. .DS_Store reached the repository root and the manifest because
       the gate skipped everything beginning with a dot. */
    if (JUNK.has(name)) { v.push(`ROOT      ${name} is an operating system artifact and must not be committed`); continue; }
    if (name.startsWith('.')) continue;
    v.push(`ROOT      ${name} is at the repository root and not on the allowlist; move it under docs/ or add it deliberately`);
  }
  return v;
}

export function checkTitle(path, body) {
  const v = [];
  const m = /^#\s+(.+)$/m.exec(body || '');
  if (!m) return v;
  const h1 = m[1].trim();
  const file = path.slice(path.lastIndexOf('/') + 1);
  if (h1 === file || h1 === file.replace(/\.md$/, '')) v.push(`TITLE     ${path} has an H1 that is its own filename`);
  if (h1 === h1.toUpperCase() && /[A-Z]{4,}/.test(h1)) v.push(`TITLE     ${path} has an all-capitals H1`);
  if (h1.includes('\u00b7')) v.push(`TITLE     ${path} uses a middle dot as a title separator; use a colon`);
  return v;
}

export function checkIndex(dir, index, files) {
  const v = [];
  if (index === null) { v.push(`INDEX     ${dir}/README.md is missing`); return v; }
  for (const f of files) {
    if (f === 'README.md') continue;
    if (!index.includes(f)) v.push(`INDEX     ${dir}/${f} is not listed in ${dir}/README.md`);
  }
  for (const m of index.matchAll(/\]\(([^)]+\.md)\)/g)) {
    const target = m[1];
    if (target.startsWith('..') || target.startsWith('/')) continue;
    if (!files.includes(target)) v.push(`INDEX     ${dir}/README.md points at ${target}, which is not in that directory`);
  }
  return v;
}

if (process.argv.includes('--selftest')) {
  const bad = [
    ...checkRoot(['README.md', 'STRAY_REPORT.md']),
    ...checkTitle('docs/x/AUDIT.md', '# AUDIT.md\n'),
    ...checkTitle('docs/x/y.md', '# REPORT OF FINDINGS\n'),
    ...checkTitle('docs/x/z.md', '# ReqPub \u00b7 something\n'),
    ...checkIndex('docs/reviews', '# i\n', ['ghost.md']),
    ...checkIndex('docs/releases', '[v9.9.md](v9.9.md)', []),
  ];
  const classes = ['ROOT', 'TITLE', 'INDEX'];
  const silent = classes.filter((c) => !bad.some((b) => b.startsWith(c)));
  if (silent.length) { console.error('docs gate selftest FAILED: silent classes: ' + silent.join(', ')); process.exit(1); }
  console.log('docs gate selftest: every class fires on the violating fixture (' + bad.length + ' violations named)');
  process.exit(0);
}

const violations = [];
violations.push(...checkRoot(readdirSync(ROOT)));

for (const p of FROZEN) {
  if (!has(p)) violations.push(`FROZEN    ${p} is missing; other people implement against this path`);
}

for (const [p, by] of GENERATED) {
  /* A generated file that is absent used to be skipped, which meant the gate
     said nothing when the artifact it was policing had disappeared. An
     artifact named on this list must exist. */
  if (!has(p)) { violations.push(`BANNER    ${p} is on the generated list and does not exist; regenerate it with ${by} or take it off the list`); continue; }
  const body = read(p) || '';
  /* A banner may occupy the first two lines when a generator names both the
     artifact and its inputs, so the check reads the head rather than one line. */
  const first = p.endsWith('.json') ? body.slice(0, 200) : body.split('\n').slice(0, 3).join(' ');
  if (!/generated/i.test(first)) violations.push(`BANNER    ${p} does not open with a banner naming ${by} as its generator`);
}

/* Walk every markdown file we ship. */
let TREE = null;
function findAnywhere(name) {
  if (TREE === null) {
    TREE = new Set();
    const walk = (d) => {
      for (const n of readdirSync(join(ROOT, d) || ROOT)) {
        if (n === 'node_modules' || n === '.git') continue;
        const rel2 = d ? d + '/' + n : n;
        if (statSync(join(ROOT, rel2)).isDirectory()) walk(rel2); else TREE.add(n);
      }
    };
    walk('');
  }
  return TREE.has(name);
}

function walkMd(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name === '.git') continue;
    const rel = dir ? dir + '/' + name : name;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walkMd(rel, out);
    else if (name.endsWith('.md')) out.push(rel);
  }
  return out;
}
const mdFiles = walkMd('docs').concat(walkMd('VENDOR_PACK')).concat(
  readdirSync(ROOT).filter((f) => f.endsWith('.md')));

for (const f of mdFiles) {
  /* The archived changelog is history. It cites documents as they were named
     on the day each entry was written, and rewriting history to satisfy a
     path check would be the wrong repair. */
  if (f === 'docs/changelog/v2.md') continue;
  /* The deletion list names paths that must NOT exist. It is the one document
     whose citations are correct precisely when they do not resolve. */
  if (f === 'docs/operations/STALE_PATHS.md') continue;
  const body = read(f);
  violations.push(...checkTitle(f, body));
  /* Backticked paths are how this repository cites files in prose, and they
     were unchecked: docs/ASSURANCE.md pointed a verifier at `CONTRIBUTING.md`
     while the gate reported success. A citation is a link with different
     punctuation. */
  const prose = (body || '').replace(/```[\s\S]*?```/g, ' ');
  for (const m of prose.matchAll(/`([A-Za-z0-9_./-]+\.(?:md|mjs|js|ts|sql|json|html|css|txt))`/g)) {
    const cited = m[1];
    if (cited.startsWith('http')) continue;
    /* A walkthrough names files the reader creates or receives. Those are not
       repository paths and cannot be resolved here. Every entry is a file a
       verifier produces while following docs/VERIFY.md. */
    if (READER_FILES.has(cited)) continue;
    const fromDoc = resolve(join(ROOT, dirname(f)), cited);
    const fromRoot = join(ROOT, cited);
    const bare = !cited.includes('/');
    const anywhere = bare && findAnywhere(cited);
    if (!existsSync(fromDoc) && !existsSync(fromRoot) && !anywhere) {
      violations.push(`LINK      ${f} cites \`${cited}\`, which does not resolve from that document or from the root`);
    }
  }
  for (const m of (body || '').matchAll(/\]\(([^)#][^)]*)\)/g)) {
    const target = m[1].split('#')[0].trim();
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const abs = resolve(join(ROOT, dirname(f)), target);
    if (!existsSync(abs)) violations.push(`LINK      ${f} links to ${target}, which does not resolve`);
  }
}

/* Structural integrity of served pages. A scripted edit spliced a pricing
   section over the end of the security section, leaving a sentence truncated
   mid-word and a stray closing tag welded to a fragment. Every gate passed:
   contrast was fine, the copy was fine, the claims were fine, and the page was
   broken. Tag balance is cheap to check and nothing was checking it. */
for (const page of readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
  const html = read(page);
  if (!html) continue;
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['section', 'div']) {
    const open = (body.match(new RegExp('<' + tag + '\\b', 'g')) || []).length;
    const close = (body.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    if (open !== close) violations.push(`STRUCT    ${page} has ${open} <${tag}> and ${close} </${tag}>; the markup is unbalanced`);
  }
  if (/<\/section>[A-Za-z]/.test(body)) violations.push(`STRUCT    ${page} has text welded onto a closing tag, which is what a bad splice looks like`);
}

/* A static host serves a .md file as unstyled text or a download. The site's
   assurance link pointed at /docs/ASSURANCE.md, so the best new copy on the
   page ended in a bad landing. A served page links to a page. */
for (const page of readdirSync(ROOT).filter((f) => f.endsWith('.html')).concat(['docs/index.html'])) {
  const html = read(page);
  if (!html) continue;
  for (const m of html.matchAll(/href="(\/?[A-Za-z0-9._\/-]+\.md)"/g)) {
    violations.push(`LINK      ${page} links to ${m[1]}, which a static host serves as raw text; link to a page instead`);
  }
}

for (const dir of ['docs/releases', 'docs/reviews']) {
  if (!has(dir)) { violations.push(`INDEX     ${dir} is missing`); continue; }
  violations.push(...checkIndex(dir, read(dir + '/README.md'), readdirSync(join(ROOT, dir))));
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ violations, markdownFiles: mdFiles.length }, null, 2));
  process.exit(violations.length ? 1 : 0);
}
if (violations.length) {
  for (const x of violations.slice(0, 30)) console.error('DOCS GATE  ' + x);
  if (violations.length > 30) console.error('DOCS GATE  ... and ' + (violations.length - 30) + ' more');
  console.error(`docs gate: ${violations.length} violation${violations.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log(`docs gate: the root carries only its allowlist, ${mdFiles.length} markdown files carry titles rather than filenames, ` +
  `every index is complete, every generated file says so, every relative link resolves, and all ${FROZEN.length} frozen paths are present`);
