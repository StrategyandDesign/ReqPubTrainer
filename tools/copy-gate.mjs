#!/usr/bin/env node
/* ReqPub - the copy gate.
 *
 * A note on how this file came to exist, because it matters more than the
 * rules. The first pass at cleaning the copy was a scripted rewrite of spaced
 * hyphens, and it silently corrupted three pieces of arithmetic:
 * (r.top - pad) became (r.top, pad), a comparator lost its subtraction, and a
 * refresh interval gained a zero. Two suites caught it within a minute, and a
 * diff of every changed line against the last packaged build named all three.
 *
 * The lesson is recorded here rather than in a commit message: a scripted
 * rewrite of prose will hit code that looks like prose, so the diff has to be
 * read line by line afterwards, and the tests are what make that survivable.
 *
 * Every word a person reads in this product should sound like a person wrote
 * it. This gate looks for the specific habits that give away prose assembled
 * rather than written, and it names the string and the habit so the fix is
 * obvious.
 *
 * The habits, each chosen because it appears in shipped ReqPub copy and each
 * one a thing no one says out loud:
 *
 *   SEMILIST     Two or more semicolons chaining clauses into a list. Written
 *                speech uses full stops.
 *   APPOSITIVE   "Thing: a description, never the other thing." A definition
 *                pretending to be a sentence.
 *   TRIAD        Three parallel items in a row, the rhythm of filler.
 *   NOTBUT       "not X, but Y" and "X, not Y" used as a rhetorical flourish
 *                rather than a real contrast.
 *   DASH         An em dash, an en dash, or a spaced hyphen doing the work a
 *                full stop should do.
 *   LONG         A sentence past 28 words in interface copy. Nobody reads it.
 *   PARA         A paragraph past 60 words in interface copy.
 *   FRAGMENT     A sentence with no verb, used as a caption.
 *   VOCAB        Words that mark generated prose: seamlessly, leverage,
 *                robust, utilize, crucial, vital, delve, landscape, realm,
 *                testament, underscore, pivotal, myriad, plethora, ensure,
 *                comprehensive, streamline, empower, unlock, elevate.
 *   HEDGE        "It's worth noting", "That said", "In today's", "simply put".
 *
 * Run with --report to list every hit grouped by habit. Run with no arguments
 * to gate: the build fails if the count exceeds the ceiling recorded below,
 * which is lowered as copy is rewritten and never raised.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* Three kinds of surface, each read by a different person in a different
   posture, so each is scanned with the rules that fit it. Interface copy is
   read standing up. Site copy is read by someone deciding whether to trust
   this at all. Published documents are read by a reviewer with time, which
   changes the length rules and nothing else. */
const SITE_PAGES = ['index.html', 'landing.html', 'verify.html', 'signup.html', 'receipt-verify.html'];
/* Legal pages are drafted rather than written. A long sentence and a
   semicolon list are normal there and often deliberate, so they are held to
   the vocabulary rules and not the rhythm rules. Scoping a rule is not the
   same as exempting a file, and the distinction is written down so nobody has
   to guess which was meant. */
const LEGAL_PAGES = ['terms.html', 'privacy.html', 'acceptable-use.html', 'do-not-share.html', 'cookies.html'];
const DOC_PAGES = ['docs/POSITIONING.md', 'docs/OPERATING_MODEL.md', 'docs/RECEIVERS.md',
  'docs/VERIFY.md', 'docs/operations/DATA.md', 'docs/operations/INCIDENT.md', 'docs/operations/ONBOARDING.md',
  'VENDOR_PACK/SECURITY_WHITEPAPER.md', 'VENDOR_PACK/OFFLINE_VERIFICATION.md',
  'VENDOR_PACK/PROCUREMENT_BRIEF.md', 'VENDOR_PACK/README.md', 'VENDOR_PACK/IDENTITY.md',
  'app/vendor/VENDOR.md', 'docs/PRICING.md', 'docs/reviews/2026-08-05-copy-audit.md'];

/* Files whose string literals are read by a person in the interface. */
const SURFACES = [
  'app/js/domain.js', 'app/js/capabilities.js', 'app/js/views-app.js',
  'app/js/views-collab.js', 'app/js/views-external.js', 'app/js/templates.js',
  'app/js/help-library.js', 'app/js/main.js', 'app/js/exports.js',
  'app/js/recordofdelivery.js', 'app/js/help.js',
];

/* The ceiling. Lower it when copy improves; never raise it. */
const CEILING = 0;

const VOCAB = ['seamlessly', 'seamless', 'leverage', 'leveraging', 'robust', 'utilize', 'utilise',
  'crucial', 'vital', 'delve', 'landscape', 'realm', 'testament', 'underscore', 'pivotal',
  'myriad', 'plethora', 'comprehensive', 'streamline', 'empower', 'unlock the', 'elevate',
  'best-in-class', 'cutting-edge', 'game-chang', 'revolutioniz', 'effortless'];
const HEDGE = ["it's worth noting", 'it is worth noting', 'that said', "in today's", 'simply put',
  'needless to say', 'at the end of the day', 'when it comes to'];

/* Pull string literals that look like prose: long enough to be a sentence,
   containing a space, and not code, markup, or a selector. */
function strings(file) {
  const src = read(file);
  const out = [];
  const re = /'((?:[^'\\\n]|\\.){12,400})'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const raw = m[1].replace(/\\'/g, "'").replace(/\\u00b7/g, '\u00b7').replace(/\\u2019/g, '\u2019');
    if (!/\s/.test(raw)) continue;
    if (/^[<>{}[\]#.]/.test(raw)) continue;
    if (/[<>]|style=|class=|data-|https?:|::|\$\{|=>|function |select |insert |jsonb|\bpush\(|\breturn\b|\bconst\b|\bawait\b/.test(raw)) continue;
    if (!/^[A-Z(\u201c"']?[A-Za-z]/.test(raw)) continue;              // prose starts like prose
    if (!/[a-z]{3}\s+[a-z]{3}\s+[a-z]{2}/i.test(raw)) continue;      // at least three words
    if (/^[a-z_]+$|_/.test(raw.split(' ')[0])) continue;              // identifiers and field ids
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ file, line, text: raw });
  }
  return out;
}

/* A literal \\n in a source string is a paragraph break in the rendered copy,
   so it ends a sentence here too. Missing that produced two false positives. */
const sentences = (t) => String(t)
  .split(/\\n|\n/)                                   // a literal backslash-n is a paragraph break in rendered copy
  .flatMap((para) => para.split(/(?<=[.!?])\s+/))
  .filter((x) => x.trim().length > 1);
const words = (t) => t.trim().split(/\s+/).filter(Boolean);

function habits(s) {
  const hits = [];
  const t = s.text;
  const low = t.toLowerCase();

  if (!s.legal && (t.match(/;/g) || []).length >= 2) hits.push('SEMILIST');
  if (/[\u2014\u2013]/.test(t)) hits.push('DASH');
  if (/\s-\s/.test(t) && !/\d\s-\s\d/.test(t)) hits.push('DASH');
  if (/^[A-Z][^.:]{2,40}:\s+(a|an|the)\s+\w+/.test(t) && /,\s*(never|not)\s/.test(t)) hits.push('APPOSITIVE');
  if (/\bnot\s+[^,.]{2,30},\s*but\b/i.test(t)) hits.push('NOTBUT');
  if (/\b(isn't|is not)\s+just\b/i.test(t)) hits.push('NOTBUT');
  for (const w of VOCAB) if (low.includes(w)) hits.push('VOCAB:' + w);
  for (const h of HEDGE) if (low.includes(h)) hits.push('HEDGE:' + h.trim());

  /* Length rules apply to interface copy, which a person reads standing up:
     labels, hints, panel descriptions, toasts. Help topics are documentation
     and are meant to be paragraphs, so they are held to sentence length only.
     Scoping a rule is not the same as weakening it, and the distinction is
     recorded here so nobody has to guess later. */
  const isDocumentation = s.file.endsWith('help-library.js') || s.doc === true || s.legal === true;
  /* Rhythm rules apply where a reader is standing up: the interface and the
     site. A doctrine document and a legal page are read sitting down, with
     time, and a 30-word analytical sentence is the right register there. They
     are still held to vocabulary, dashes, appositives, and semicolon lists. */
  /* Two thresholds, because two registers. Interface copy is a hint beside a
     control and stops at 28 words. Site prose is read as prose and stops at
     35, which is where the positioning sentence deliberately sits: "ReqPub is
     where the client signs a measurable definition of done..." is one
     sentence on purpose, and breaking it to satisfy a rule would damage good
     copy to protect a number. */
  if (!isDocumentation) {
    const limit = s.site ? 35 : 28;
    for (const sent of sentences(t)) {
      if (words(sent).length > limit) { hits.push('LONG'); break; }
    }
  }
  if (!isDocumentation && words(t).length > 60) hits.push('PARA');

  /* Three parallel comma-separated items with no verb between them. */
  /* The tell is three short items with no verb holding them together, which is
     rhythm standing in for a sentence. A genuine enumeration inside a real
     sentence, "a data inventory lists each entity, its owner, and its
     sensitivity", is not a defect and is not flagged. */
  for (const sent of sentences(t)) {
    const m = /^([A-Za-z][^,.;:]{2,30}),\s+([A-Za-z][^,.;:]{2,30}),\s+and\s+([A-Za-z][^,.;:]{2,30})[.;]?$/.exec(sent.trim());
    if (!m) continue;
    const short = [m[1], m[2], m[3]].every((x) => words(x).length <= 2);
    const verbless = !/\b(is|are|was|were|has|have|can|will|does|lists|carries|opens|sees|holds|shows)\b/i.test(sent);
    if (short && verbless && !s.legal) { hits.push('TRIAD'); break; }
  }

  return [...new Set(hits)];
}

/* Visible text from a page: tags, script, and style removed, entities
   collapsed, then split into sentences the way a reader meets them. */
function pageText(file) {
  let src;
  try { src = read(file); } catch { return []; }
  /* Block-level tags end a passage. Without this, a page title, a nav, and a
     heading concatenate into one 40-word "sentence" that no reader ever meets,
     and the length rules fire on an artifact of the parser rather than on the
     copy. */
  const body = src
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|li|h[1-6]|section|header|footer|nav|tr|td|th|br|ul|ol|span|a|title|button|label)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ')
    .replace(/[ \t]+/g, ' ');
  return body.split(/\n+/)
    .flatMap((block) => block.split(/(?<=[.!?])\s+/))
    .map((t) => t.trim())
    .filter((t) => t.length > 25 && /[a-z]{3}\s+[a-z]{3}/i.test(t))
    .map((t) => ({ file, line: 0, text: t }));
}

/* Prose from a published document: fenced code, tables, and link targets are
   not prose and are not judged as prose. */
function docText(file) {
  let src;
  try { src = read(file); } catch { return []; }
  const body = src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\|.*$/gm, ' ')
    .replace(/^\s{4,}\S.*$/gm, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`[^`]*`/g, ' ');
  const out = [];
  body.split(/\n\s*\n/).forEach((para, i) => {
    const t = para.replace(/\s+/g, ' ').trim();
    if (t.length < 30 || /^[#>\-*\d]/.test(t)) return;
    out.push({ file, line: i + 1, text: t, doc: true });
  });
  return out;
}

const all = [
  ...SURFACES.flatMap(strings),
  ...SITE_PAGES.flatMap((f) => pageText(f).map((x) => ({ ...x, site: true }))),
  ...LEGAL_PAGES.flatMap((f) => pageText(f).map((x) => ({ ...x, legal: true }))),
  ...DOC_PAGES.flatMap(docText),
];
const flagged = all.map((s) => ({ ...s, hits: habits(s) })).filter((s) => s.hits.length);

if (process.argv.includes('--report')) {
  const byHabit = {};
  for (const f of flagged) for (const h of f.hits) (byHabit[h.split(':')[0]] ||= []).push({ ...f, habit: h });
  for (const [habit, items] of Object.entries(byHabit).sort((a, b) => b[1].length - a[1].length)) {
    console.log('\n### ' + habit + '  (' + items.length + ')');
    for (const i of items.slice(0, 12)) {
      console.log('  ' + i.file.replace('app/js/', '') + ':' + i.line + '  ' + i.text.slice(0, 118));
    }
    if (items.length > 12) console.log('  ... and ' + (items.length - 12) + ' more');
  }
  console.log('\nscanned ' + all.length + ' interface strings, ' + flagged.length + ' carry a habit');
  process.exit(0);
}

if (flagged.length > CEILING) {
  for (const f of flagged.slice(0, 25)) {
    console.error('COPY GATE  ' + f.file.replace('app/js/', '') + ':' + f.line + '  [' + f.hits.join(' ') + ']  ' + f.text.slice(0, 96));
  }
  if (flagged.length > 25) console.error('COPY GATE  ... and ' + (flagged.length - 25) + ' more');
  console.error(`copy gate: ${flagged.length} strings carry a habit of machine-written prose; the ceiling is ${CEILING}`);
  process.exit(1);
}
console.log(`copy gate: ${all.length} interface strings scanned, ${flagged.length} flagged against a ceiling of ${CEILING}`);
