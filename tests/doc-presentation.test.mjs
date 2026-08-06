/* ReqPub v2 - document presentation contract (node tests/doc-presentation.test.mjs)
   The guarantee behind "every PRD ReqPub produces looks like the reference":
   three layers, each pinned. Content determinism is already held by the
   fingerprint and engagement byte suites; this file pins the other two.
   Layer 2, the skeleton: sections render once each, in the canonical order,
   numbered in sequence, cover meta before the body. Layer 3, presentation:
   the exact CSS rules that produce the reference rhythm (SECTION eyebrows,
   one section per printed page, repeated table headers, the running head)
   exist by name, and the production print composition renders cover, running
   head, and body from one function the app itself uses. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.location = { origin: 'https://reqpub.com', pathname: '/app/' };
const { assemble, buildSections, mdToHtml, SECTIONS, qById } = await import('../app/js/domain.js');
const { coverHTML, printedDocHTML } = await import('../app/js/exports.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  \u2713 ' + name); };

/* A deliberately rich record: every worksheet question that renders a
   section gets a non-empty answer, so the skeleton assertion covers the
   full canonical order, not a lucky subset. */
const a = { ctrl_type: 'Product or project requirements' };
for (const q of Object.values(qById)) {
  if (q.cond && !q.cond({ ...a, [q.id]: undefined })) continue;
  if (q.type === 'rows') {
    const row = {};
    for (const c of (q.cols || [])) row[c.k] = c.sel ? c.sel[0] : (c.k + ' value');
    if (q.id === 'updates') row.title = 'Sample risk';
    a[q.id] = [row];
  } else if (q.type === 'list') a[q.id] = ['First ' + q.id + ' point.', 'Second ' + q.id + ' point.'];
  else if (q.sel) a[q.id] = q.sel[0];
  else a[q.id] = 'Sample answer for ' + q.id + '.';
}
a.pname = 'Golden Standard PRD';
const md = assemble(buildSections(a, '1.0', []), a);
const html = mdToHtml(md);

/* The golden order a full product record produces. Pinned as a literal:
   assemble() owns document composition, and this is its contract. Any
   reordering of the document is a deliberate, test-breaking act. */
const GOLDEN_ORDER = ['overview', 'users', 'solution', 'metrics', 'method', 'adc',
  'functional', 'nonfunctional', 'data', 'interfaces', 'verification',
  'traceability', 'people', 'glossary', 'decisions', 'okrs', 'revision'];

test('a full product record renders the golden section order, each exactly once', () => {
  const heads = [...html.matchAll(/<h2 id="docsec-([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(heads, GOLDEN_ORDER, 'the composition contract');
  for (const h of heads) assert.ok(SECTIONS.some((x) => x.key === h), h + ' is a known section');
});

test('the same record renders the same skeleton twice: composition is deterministic', () => {
  const again = mdToHtml(assemble(buildSections(a, '1.0', []), a));
  const h1 = [...html.matchAll(/<h2 id="docsec-([a-z0-9_]+)"/g)].map((m) => m[1]);
  const h2 = [...again.matchAll(/<h2 id="docsec-([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(h1, h2);
});

test('numbering is stable per section: the exact golden sequence, ascending, gaps only where conditional sections sit', () => {
  const nums = [...html.matchAll(/<h2 id="docsec-[a-z0-9_]+"[^>]*><span class="secn">(\d+)<\/span>/g)].map((m) => +m[1]);
  assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17],
    'a section keeps its number whether or not its conditional neighbors render');
  for (let i = 1; i < nums.length; i++) assert.ok(nums[i] > nums[i - 1], 'strictly ascending');
  assert.ok(/<h2 id="docsec-okrs"[^>]*>(?!<span class="secn">)/.test(html), 'okrs renders unnumbered by design (num: null)');
});

test('the cover meta line renders once, before the first section', () => {
  const meta = html.indexOf('doc-meta');
  const firstSec = html.indexOf('<h2 id="docsec-');
  assert.ok(meta > -1 && meta < firstSec, 'meta precedes the body');
  assert.equal((html.match(/doc-meta/g) || []).length, 1);
});

test('no empty headings and no unrendered markdown artifacts leak through', () => {
  assert.ok(!/<h2[^>]*><\/h2>/.test(html));
  assert.ok(!html.includes('<meta>'), 'the meta directive never prints raw');
});

test('the production print composition is one function: running head, cover, body, in that order', () => {
  const meta = { product: 'Golden Standard PRD', label: '1.0', status: 'approved', org: 'Collection Ventures', baselined: '2026-07-31T12:00:00Z' };
  const page = printedDocHTML(md, meta);
  const iRun = page.indexOf('rp-runhead'); const iCov = page.indexOf('rp-cover'); const iBody = page.indexOf('rp-body');
  assert.ok(iRun > -1 && iCov > iRun && iBody > iCov, 'running head, then cover, then body');
  assert.ok(page.includes('Golden Standard PRD') && page.includes('v1.0'));
  const cover = coverHTML(meta);
  assert.ok(cover.includes('rp-rail-k') && cover.includes('Version') && cover.includes('Status'), 'the cover meta rail carries labeled rows, reference style');
});

test('the presentation rules the reference depends on exist by name in the stylesheet', () => {
  const css = readFileSync(new URL('../app/app.css', import.meta.url), 'utf8');
  for (const rule of [
    ".md h2 .secn::before{content:'SECTION '}",
    '.rp-body .md h2{break-before:page',
    '.rp-body .md h2:first-of-type{break-before:auto}',
    '.md thead{display:table-header-group}',
    '.rp-cover{break-after:page',
    '.rp-runhead{display:flex',
  ]) assert.ok(css.includes(rule), 'stylesheet carries: ' + rule);
});

console.log('\ndoc-presentation.test: ' + n + '/' + n + ' passed');
