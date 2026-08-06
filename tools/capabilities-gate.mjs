#!/usr/bin/env node
/* ReqPub v2.54 - the capabilities freshness gate (a named CI step before the
   suites). Prose here is authored, never generated, and this gate is what
   keeps it honest at every tag:

   A, stamp parity: COVERED_THROUGH equals package.json, so every version
      push forces a conscious registry review.
   B, reference integrity: every sinceVersion matches a CHANGELOG heading;
      every anchor exists in HELP_ANCHORS and renders a Show me.
   C, copy discipline, mechanical: title six words or fewer; body forty
      words or fewer; no exclamation points; no question marks in bodies;
      the condescension list and the superlative list are banned outright.
   D, claims discipline: the phrases the positioning doctrine never makes
      are grep-banned across every title and body.

   --selftest feeds a violating fixture through the same checker and
   asserts every gate class fires, so the gate cannot rot silently. */
import { readFileSync } from 'node:fs';

const CONDESCENSION = ['simply', 'just', 'easy', 'easily', 'obviously', 'of course', 'clearly', 'as you know', "don't worry"];
const SUPERLATIVES = ['revolutionary', 'game-changing', 'cutting-edge', 'seamless', 'powerful', 'robust', 'world-class', 'best-in-class', 'incredible', 'amazing', 'effortless'];
const BANNED_CLAIMS = ['tamper-proof', 'tamper proof', 'guarantee', 'unhackable', 'complete security', 'ai acceptance criteria', 'prevents ai project failure', 'decides scope disputes', 'satisfies the eu ai act', 'legally binding'];

export function checkRegistry({ coveredThrough, entries, pkgVersion, changelog, anchors, rendered }) {
  const v = [];
  const words = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;
  const heads = new Set([...String(changelog).matchAll(/^## v?(\d+\.\d+\.\d+)/gm)].map((m) => m[1]));
  const anchorKeys = new Set(anchors);

  if (coveredThrough !== pkgVersion)
    v.push('A stamp parity: COVERED_THROUGH ' + coveredThrough + ' does not equal package.json ' + pkgVersion + '; review the registry and restamp');

  for (const c of entries) {
    const where = c.id || '(no id)';
    if (!heads.has(c.sinceVersion))
      v.push('B reference: ' + where + ' sinceVersion ' + c.sinceVersion + ' matches no changelog heading in CHANGELOG.md or docs/changelog/v2.md');
    if (c.anchor && !anchorKeys.has(c.anchor))
      v.push('B reference: ' + where + ' anchor ' + c.anchor + ' is not in HELP_ANCHORS');
    if (c.anchor && rendered && !rendered.includes('data-anchor="' + c.anchor + '"'))
      v.push('B reference: ' + where + ' anchor ' + c.anchor + ' does not render a Show me');
    if (words(c.title) > 6)
      v.push('C copy: ' + where + ' title runs past six words');
    if (words(c.body) > 40)
      v.push('C copy: ' + where + ' body runs past forty words');
    const all = (c.title + ' ' + c.body);
    const low = all.toLowerCase();
    if (all.includes('!'))
      v.push('C copy: ' + where + ' carries an exclamation point');
    if (String(c.body).includes('?'))
      v.push('C copy: ' + where + ' body carries a question mark');
    for (const w of CONDESCENSION)
      if (new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(all))
        v.push('C copy: ' + where + ' uses the condescension word "' + w + '"');
    for (const w of SUPERLATIVES)
      if (low.includes(w))
        v.push('C copy: ' + where + ' uses the superlative "' + w + '"');
    for (const w of BANNED_CLAIMS)
      if (low.includes(w))
        v.push('D claims: ' + where + ' carries the banned phrase "' + w + '"');
  }
  return v;
}

const selftest = process.argv.includes('--selftest');
if (selftest) {
  const bad = checkRegistry({
    coveredThrough: '0.0.1', pkgVersion: '9.9.9',
    changelog: '## 1.0.0 · real\n',
    anchors: ['real.anchor'],
    rendered: '<div></div>',
    entries: [
      { id: 'x1', tier: 'plain', title: 'A title that runs well past six words', sinceVersion: '8.8.8', anchor: 'ghost.anchor',
        body: 'Is this easy? It is simply revolutionary and tamper-proof! ' + 'word '.repeat(41) },
    ],
  });
  const classes = ['A stamp parity', 'B reference', 'C copy', 'D claims'];
  const missing = classes.filter((c) => !bad.some((m) => m.startsWith(c)));
  if (missing.length) { console.error('gate selftest FAILED: classes never fired: ' + missing.join(', ')); process.exit(1); }
  const want = ['six words', 'forty words', 'exclamation', 'question mark', 'condescension', 'superlative', 'matches no changelog heading', 'not in HELP_ANCHORS', 'does not render'];
  const silent = want.filter((w) => !bad.some((m) => m.includes(w)));
  if (silent.length) { console.error('gate selftest FAILED: checks never fired: ' + silent.join(', ')); process.exit(1); }
  console.log('capabilities gate selftest: every gate class fires on the violating fixture (' + bad.length + ' violations named)');
  process.exit(0);
}

globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const caps = await import('../app/js/capabilities.js');
const help = await import('../app/js/help.js');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
/* The 2.x history was archived to docs/changelog/v2.md in v3.0.0. A
   sinceVersion resolves against either file, because splitting a changelog
   must not silently invalidate every historical capability entry. */
const changelog = ['CHANGELOG.md', 'docs/changelog/v2.md']
  .map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } })
  .join('\n');

const violations = checkRegistry({
  coveredThrough: caps.COVERED_THROUGH,
  entries: caps.CAPABILITIES,
  pkgVersion: pkg.version,
  changelog,
  anchors: help.HELP_ANCHORS.map((a) => a.key),
  rendered: caps.renderCapabilities(),
});

if (violations.length) {
  for (const m of violations) console.error('CAPABILITIES GATE  ' + m);
  console.error('capabilities gate: ' + violations.length + ' violation' + (violations.length === 1 ? '' : 's') + '; the registry is not fit to ship');
  process.exit(1);
}
console.log('capabilities gate: ' + caps.CAPABILITIES.length + ' entries clean; COVERED_THROUGH ' + caps.COVERED_THROUGH + ' equals package.json; every reference resolves; the copy discipline holds');
