/* ReqPub v2 - intake tests (node tests/intake.test.mjs)
   The contract: a team member's drafted documents land in the record's own
   framework deterministically. Headings segment, keywords classify, bullets
   and tables extract into the right row shapes with provenance stamped,
   unknown sections stay unplaced for a human decision, and intake NEVER
   overwrites a non-empty field. The fixture below is the realistic case:
   a product doc drafted in a chat assistant, pasted or uploaded as-is. */
import assert from 'node:assert/strict';
import {
  segmentText, classifySegment, intakeKind, bulletItems, mdTableIn, splitPair, extractRows, mapArtifacts, applyPlan, executeOps, pdfTextFromItems, mdUnescape, pdfMarkdownFromItems, mdTablesAll, inferColumns, htmlToIntakeMd, pdfEmptyDiagnosis, pasteToRows
} from '../app/js/intake.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const DOC = `Northwind Ledger is an internal reconciliation tool. This preamble has no heading.

# Overview
Northwind Ledger reconciles partner statements against the general ledger nightly.

## Problem
Finance closes late every month. Reconciliation is manual and error-prone.

GOALS
- Cut close time to 3 business days
- Zero unexplained variances above $500

## Personas
- Staff accountant: needs a worklist of exceptions each morning
- Controller - needs a sign-off view before close

## Success Metrics
| Metric | Target | Method |
| --- | --- | --- |
| Close time | 3 days | Month-end audit |
| Auto-match rate | 92% | Pipeline telemetry |

## In scope
- Nightly ingestion of partner statements
- Exception worklist

## Out of scope
- Payments execution

## Functional Requirements
- The system must ingest partner statements nightly. Acceptance: 100% of files processed by 06:00 local.
- The system should flag unmatched lines for review
- Users could export the exception list to CSV

## Non-functional requirements
- Nightly run must complete within 90 minutes

## Evaluation criteria
| Dimension | Metric | Threshold | Eval set |
| --- | --- | --- | --- |
| Match accuracy | F1 | 0.95 | golden-500 |

## Glossary
- Variance: difference between statement and ledger
- Exception - a line requiring human review

## Risks
- Partner file formats drift without notice

Verification
============
Reconciliation results are verified against the month-end audit.`;

/* ---- segmentation ---- */
test('the preamble before any heading is an untitled segment', () => {
  const segs = segmentText(DOC, 'plan.md');
  assert.equal(segs[0].title, '');
  assert.ok(segs[0].body.includes('This preamble has no heading'));
});
test('markdown, ALLCAPS, and setext headings all segment', () => {
  const titles = segmentText(DOC, 'plan.md').map((s) => s.title);
  for (const t of ['Overview', 'Problem', 'GOALS', 'Out of scope', 'Verification']) {
    assert.ok(titles.includes(t), 'missing heading: ' + t);
  }
});
test('a bold line is a heading too', () => {
  const segs = segmentText('**Purpose**\nWhy this exists.', 'x.md');
  assert.equal(segs[0].title, 'Purpose');
  assert.equal(segs[0].body, 'Why this exists.');
});

/* ---- classification ---- */
test('out of scope wins over scope; the ordered map holds', () => {
  assert.equal(classifySegment('Out of scope'), 'sol_out');
  assert.equal(classifySegment('In scope'), 'sol_in');
  assert.equal(classifySegment('Scope'), 'sol_in');
});
test('the fixture headings classify to the right questions', () => {
  assert.equal(classifySegment('Overview'), 'ov_purpose');
  assert.equal(classifySegment('Problem'), 'ov_problem');
  assert.equal(classifySegment('GOALS'), 'ov_goals');
  assert.equal(classifySegment('Personas'), 'persona');
  assert.equal(classifySegment('Success Metrics'), 'metrics');
  assert.equal(classifySegment('Functional Requirements'), 'fr');
  assert.equal(classifySegment('Non-functional requirements'), 'nfr');
  assert.equal(classifySegment('Evaluation criteria'), 'eval');
  assert.equal(classifySegment('Glossary'), 'glossary');
  assert.equal(classifySegment('Verification'), 'verify_note');
});
test('unknown headings are never guessed', () => {
  assert.equal(classifySegment('Risks'), null);
  assert.equal(classifySegment('Appendix B'), null);
  assert.equal(classifySegment(''), null);
});
test('intakeKind reports the landing shape per target', () => {
  assert.equal(intakeKind('ov_purpose'), 'long');
  assert.equal(intakeKind('sol_in'), 'list');
  assert.equal(intakeKind('fr'), 'rows');
  assert.equal(intakeKind('nope'), null);
});

/* ---- extraction primitives ---- */
test('bulletItems strips markers and inline markdown', () => {
  const items = bulletItems('- **Bold** point\n* star point\n1. numbered point\nplain line');
  assert.deepEqual(items, ['Bold point', 'star point', 'numbered point']);
});
test('mdTableIn parses the first markdown table', () => {
  const seg = segmentText(DOC, 'plan.md').find((s) => s.title === 'Success Metrics');
  const t = mdTableIn(seg.body);
  assert.deepEqual(t.headers, ['metric', 'target', 'method']);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[1][0], 'Auto-match rate');
});
test('splitPair handles colon and spaced-hyphen separators', () => {
  assert.deepEqual(splitPair('Variance: difference'), { head: 'Variance', rest: 'difference' });
  assert.deepEqual(splitPair('Exception - a line'), { head: 'Exception', rest: 'a line' });
  assert.deepEqual(splitPair('No separator here'), { head: 'No separator here', rest: '' });
});

/* ---- extraction per target ---- */
test('fr rows: priority detected, Acceptance tail becomes the fit, provenance stamped', () => {
  const seg = segmentText(DOC, 'plan.md').find((s) => s.title === 'Functional Requirements');
  const rows = extractRows('fr', seg.body, 'plan.md');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].pri, 'Must');
  assert.equal(rows[0].fit, '100% of files processed by 06:00 local.');
  assert.ok(rows[0].stmt.startsWith('The system must ingest') && !/Acceptance:/i.test(rows[0].stmt));
  assert.equal(rows[1].pri, 'Should');
  assert.equal(rows[1].fit, 'to confirm');
  assert.equal(rows[2].pri, 'Could');
  assert.ok(rows.every((r) => r.src === 'Import · plan.md'));
});
test('eval rows from a table carry the dataset column', () => {
  const seg = segmentText(DOC, 'plan.md').find((s) => s.title === 'Evaluation criteria');
  const rows = extractRows('eval', seg.body, 'plan.md');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dim, 'Match accuracy');
  assert.equal(rows[0].metric, 'F1');
  assert.equal(rows[0].thresh, '0.95');
  assert.equal(rows[0].dataset, 'golden-500');
});
test('metrics rows map table headers by name, not position luck', () => {
  const seg = segmentText(DOC, 'plan.md').find((s) => s.title === 'Success Metrics');
  const rows = extractRows('metrics', seg.body, 'plan.md');
  assert.deepEqual(rows[0], { metric: 'Close time', target: '3 days', method: 'Month-end audit' });
});
test('glossary rows pair term and definition from either separator', () => {
  const seg = segmentText(DOC, 'plan.md').find((s) => s.title === 'Glossary');
  const rows = extractRows('glossary', seg.body, 'plan.md');
  assert.deepEqual(rows, [
    { term: 'Variance', def: 'difference between statement and ledger' },
    { term: 'Exception', def: 'a line requiring human review' },
  ]);
});

/* ---- the plan ---- */
test('mapArtifacts lands every recognized section in its shape', () => {
  const { placements, unplaced } = mapArtifacts([{ name: 'plan.md', text: DOC }]);
  const by = Object.fromEntries(placements.map((p) => [p.qid, p]));
  assert.ok(by.ov_purpose && by.ov_purpose.kind === 'long' && by.ov_purpose.value.includes('reconciles partner statements'));
  assert.equal(by.ov_goals.rows.length, 2);
  assert.equal(by.sol_in.rows.length, 2);
  assert.equal(by.sol_out.rows.length, 1);
  assert.equal(by.fr.rows.length, 3);
  assert.equal(by.nfr.rows.length, 1);
  assert.equal(by.eval.rows.length, 1);
  assert.equal(by.metrics.rows.length, 2);
  assert.equal(by.persona.rows.length, 2);
  assert.equal(by.glossary.rows.length, 2);
  assert.ok(by.verify_note.value.includes('month-end audit'));
  const titles = unplaced.map((u) => u.title);
  assert.ok(titles.includes('Risks'), 'Risks must stay unplaced');
  assert.ok(titles.includes('(untitled)'), 'the preamble stays unplaced');
  assert.equal(unplaced.find((u) => u.title === 'Risks').source, 'plan.md');
});
test('long sections merge across files with their sources tracked', () => {
  const { placements } = mapArtifacts([
    { name: 'a.md', text: '# Overview\nFirst take.' },
    { name: 'b.md', text: '# Purpose\nSecond take.' },
  ]);
  const p = placements.find((x) => x.qid === 'ov_purpose');
  assert.equal(p.value, 'First take.\n\nSecond take.');
  assert.deepEqual(p.sources, ['a.md', 'b.md']);
});
test('applyPlan never overwrites a non-empty field, and says so', () => {
  const { placements } = mapArtifacts([{ name: 'plan.md', text: DOC }]);
  const { ops, kept } = applyPlan(placements, { ov_purpose: 'Already written by the team.' });
  assert.ok(kept.includes('ov_purpose'));
  assert.ok(!ops.some((o) => o.kind === 'field' && o.qid === 'ov_purpose'));
  assert.ok(ops.some((o) => o.kind === 'field' && o.qid === 'ov_problem'));
});
test('row operations always land, additive by nature, with provenance intact', () => {
  const { placements } = mapArtifacts([{ name: 'plan.md', text: DOC }]);
  const { ops } = applyPlan(placements, {});
  const frOps = ops.filter((o) => o.kind === 'row' && o.qid === 'fr');
  assert.equal(frOps.length, 3);
  assert.ok(frOps.every((o) => o.data.src === 'Import · plan.md'));
  const listOps = ops.filter((o) => o.kind === 'row' && o.qid === 'ov_goals');
  assert.ok(listOps.every((o) => typeof o.data.text === 'string' && o.data.text));
});

/* ---- execution through the repo wrappers ---- */
const awaited = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
await awaited('executeOps writes through the rev-checked wrappers in plan order', async () => {
  const calls = [];
  const repo = {
    saveField: async (pid, qid, value, rev) => { calls.push(['field', pid, qid, value, rev]); return { data: { ok: true } }; },
    upsertRow: async (pid, qid, id, data) => { calls.push(['row', pid, qid, id, data.src || data.text]); return { data: { ok: true } }; },
  };
  const ops = [
    { kind: 'field', qid: 'ov_problem', value: 'Late closes.', baseRev: 3 },
    { kind: 'row', qid: 'fr', data: { stmt: 'Ingest nightly', fit: 'to confirm', pri: 'Must', comp: '', src: 'Import · plan.md' } },
    { kind: 'row', qid: 'ov_goals', data: { text: 'Close in 3 days' } },
  ];
  const steps = [];
  const out = await executeOps(repo, 'ledger', ops, (d, t) => steps.push(d + '/' + t));
  assert.deepEqual(out, { ok: true, fields: 1, rows: 2, failed: 0 });
  assert.deepEqual(calls[0], ['field', 'ledger', 'ov_problem', 'Late closes.', 3]);
  assert.deepEqual(calls[1], ['row', 'ledger', 'fr', null, 'Import · plan.md']);
  assert.deepEqual(steps, ['1/3', '2/3', '3/3']);
});
await awaited('executeOps counts failures honestly and keeps going', async () => {
  let i = 0;
  const repo = {
    saveField: async () => ({ data: { ok: true } }),
    upsertRow: async () => (++i === 1 ? { error: { message: 'down' } } : { data: { ok: true } }),
  };
  const out = await executeOps(repo, 'p', [
    { kind: 'row', qid: 'fr', data: {} }, { kind: 'row', qid: 'fr', data: {} }, { kind: 'field', qid: 'ov_vision', value: 'x' },
  ]);
  assert.deepEqual(out, { ok: false, fields: 1, rows: 1, failed: 1 });
});

/* pdf.js hands main.js {str, hasEOL} items per page; this pure helper is the
   whole transformation, so the line structure the segmenter depends on is
   pinned here without a browser or a worker in sight. */
test('pdfTextFromItems rebuilds lines from hasEOL and joins pages with a blank line', () => {
  const pages = [
    [{ str: 'GOALS', hasEOL: true }, { str: 'Cut close time ', hasEOL: false }, { str: 'to 3 days', hasEOL: true }],
    [{ str: 'Second page opens here.', hasEOL: true }],
  ];
  assert.equal(pdfTextFromItems(pages), 'GOALS\nCut close time to 3 days\n\nSecond page opens here.');
});
test('pdf lines feed the segmenter: an ALLCAPS heading on its own line still classifies', () => {
  const text = pdfTextFromItems([[
    { str: 'ASSUMPTIONS', hasEOL: true },
    { str: '- Partners deliver statements nightly', hasEOL: true },
  ]]);
  const segs = segmentText(text, 'brief.pdf');
  assert.equal(segs.length, 1);
  assert.equal(classifySegment(segs[0].title), 'assume');
  assert.deepEqual(bulletItems(segs[0].body), ['Partners deliver statements nightly']);
});
test('pdfTextFromItems strips trailing spaces before breaks and drops empty pages', () => {
  const pages = [
    [{ str: 'SCOPE   ', hasEOL: true }, { str: 'Nightly ingestion', hasEOL: true }],
    [],
    [{ str: '   ', hasEOL: true }],
  ];
  assert.equal(pdfTextFromItems(pages), 'SCOPE\nNightly ingestion');
});
test('pdfTextFromItems is safe on degenerate input: nulls, missing fields, no pages', () => {
  assert.equal(pdfTextFromItems(null), '');
  assert.equal(pdfTextFromItems([]), '');
  assert.equal(pdfTextFromItems([[null, { hasEOL: true }, { str: 'ok' }]]), 'ok');
});

/* mammoth's convertToMarkdown escapes punctuation; mdUnescape is the exact
   inverse main.js applies before the text reaches the segmenter. */
test('mdUnescape cleans mammoth escapes without touching real markdown structure', () => {
  const md = '# Problem\n\nFinance closes late every month\\. Costs \\#1 concern \\- truly\\.\n\n- Cut close time';
  const out = mdUnescape(md);
  assert.equal(out, '# Problem\n\nFinance closes late every month. Costs #1 concern - truly.\n\n- Cut close time');
  const segs = segmentText(out, 'brief.docx');
  assert.equal(classifySegment(segs[0].title), 'ov_problem');
  assert.ok(!segs[0].body.includes('\\'));
});
test('mdUnescape restores a literal source backslash from its doubled escape', () => {
  assert.equal(mdUnescape('path C:\\\\temp and a kept \\\\. pair'), 'path C:\\temp and a kept \\. pair');
  assert.equal(mdUnescape(null), '');
});


/* ---- v2.28.0: tables from geometry, headerless inference, docx html ---- */
/* A consulting-grade PRD is mostly tables, and a real consulting PRD proved the
   old pipeline shredded them: cells interleaved as bare lines, "M M1 T"
   priority cells became ALLCAPS headings that shattered the document into
   98 junk segments. The fixture below is REAL geometry, frozen verbatim
   from page 5 of that PDF (the A-4..A-9 assumptions rows), so the engine
   is pinned against the exact document that exposed the failure. */
import { readFileSync } from 'node:fs';
const GEO_ITEMS = JSON.parse(readFileSync(new URL('./fixtures/legacy-pdf-page5-geometry.json', import.meta.url), 'utf8'));

test('the geometry engine rebuilds a real table from real coordinates, wrapped cells merged', () => {
  const md = pdfMarkdownFromItems([GEO_ITEMS]);
  const t = mdTablesAll(md)[0];
  assert.ok(t, 'a pipe table is emitted');
  const rowsAll = [t.headersRaw, ...t.rows];
  assert.equal(rowsAll.length, 6, 'A-4 through A-9, one logical row each');
  const a6 = rowsAll.find((r) => r[0] === 'A-6');
  assert.ok(/deployable in the tenant runtime, or the hosted equivalent binds identity with equal strength\./.test(a6[1]),
    'the wrapped statement cell reads as one sentence');
  const a7 = rowsAll.find((r) => r[0] === 'A-7');
  assert.equal(a7[2], 'Fact, external timeline', 'the wrapped label cell merges too');
});

test('the same real table lands as an assumptions list, IDs and labels kept', () => {
  const md = pdfMarkdownFromItems([GEO_ITEMS]);
  const { placements } = mapArtifacts([{ name: 'a.pdf', text: '# Assumptions\n' + md }]);
  const rows = placements.find((p) => p.qid === 'assume').rows.map((r) => r.text);
  assert.equal(rows.length, 6);
  assert.ok(rows.some((t2) => /^A-8: Design partner one signs under M0 terms\. \(Dependency, commercial\)$/.test(t2)));
});

test('items without coordinates degrade to the plain line join, exactly', () => {
  const pages = [[{ str: 'One line', hasEOL: true }, { str: 'Two', hasEOL: false }]];
  assert.equal(pdfMarkdownFromItems(pages), pdfTextFromItems(pages));
});

test('running headers and footers vanish when they repeat across pages, page numbers normalized', () => {
  const body = ['The ledger reconciles.', 'The gateway decides.', 'The verifier proves.'];
  const page = (n) => [
    { str: 'Doc v1 | Internal | Page ' + n, x: 60, y: 780 },
    { str: body[n - 1], x: 60, y: 700 },
  ];
  const md = pdfMarkdownFromItems([page(1), page(2), page(3)]);
  assert.ok(!/Internal/.test(md), 'the furniture line is gone');
  assert.ok(/The gateway decides\./.test(md), 'the content stays');
});

test('a wrapped ID cell never starts a false row: the vertical rhythm decides', () => {
  const items = [
    { str: 'EVAL-M2-0', x: 70, y: 300 }, { str: 'Catch rate holds.', x: 126, y: 300 }, { str: '48 of 50.', x: 316, y: 300 }, { str: 'M', x: 464, y: 300 },
    { str: '1', x: 70, y: 289 }, { str: 'Reproduced on re-run.', x: 126, y: 289 },
    { str: 'EVAL-M2-02', x: 70, y: 272 }, { str: 'Determinism holds.', x: 126, y: 272 }, { str: 'Bit for bit.', x: 316, y: 272 }, { str: 'M', x: 464, y: 272 },
  ];
  const t = mdTablesAll(pdfMarkdownFromItems([items]))[0];
  assert.equal([t.headersRaw, ...t.rows].length, 2, 'two logical rows, not three');
  assert.equal(t.headersRaw[0], 'EVAL-M2-0 1', 'the wrapped ID joins in the cell');
});

test('uniform spacing (no wrapped cells) falls back to the leftmost-column rule', () => {
  const items = [
    { str: 'G1', x: 70, y: 300 }, { str: 'First goal.', x: 126, y: 300 }, { str: 'Q1', x: 316, y: 300 },
    { str: 'G2', x: 70, y: 286 }, { str: 'Second goal.', x: 126, y: 286 }, { str: 'Q2', x: 316, y: 286 },
    { str: 'G3', x: 70, y: 272 }, { str: 'Third goal.', x: 126, y: 272 }, { str: 'Q3', x: 316, y: 272 },
  ];
  const t = mdTablesAll(pdfMarkdownFromItems([items]))[0];
  assert.equal([t.headersRaw, ...t.rows].length, 3);
});

test('a one-row page stub (a table split by the page break) survives and is restored as a row', () => {
  const items = [
    { str: 'FR-M1-006', x: 70, y: 300 }, { str: 'The system shall store documents.', x: 126, y: 300 },
    { str: 'Hash matches the upload.', x: 316, y: 300 }, { str: 'M', x: 464, y: 300 }, { str: 'M1', x: 496, y: 300 }, { str: 'T', x: 524, y: 300 },
  ];
  const rows = extractRows('fr', pdfMarkdownFromItems([items]), 'a.pdf');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stmt, 'FR-M1-006: The system shall store documents.');
  assert.equal(rows[0].fit, 'Hash matches the upload.');
  assert.equal(rows[0].pri, 'Must');
});

test('inferColumns reads a headerless table by content: leftmost wide column is the statement even when fit criteria run longer', () => {
  const t = {
    headers: ['fr-9', 'short shall text here', 'a much much much longer fit criterion sentence than the statement', 'm'],
    headersRaw: ['FR-9', 'Short shall text here', 'A much much much longer fit criterion sentence than the statement', 'M'],
    rows: [['FR-10', 'Another shall text.', 'Another very very long fit criterion for the second row of the table.', 'S']],
  };
  const inf = inferColumns(t);
  assert.equal(inf.idc, 0);
  assert.equal(inf.pric, 3);
  assert.ok(inf.stmtc === 1 && inf.fitc === 2, 'statement left, criterion right');
  assert.equal(inf.headerIsData, true);
});

test('a wrapped ID is recognized de-spaced and lands normalized, and the Rel column cannot steal the id role', () => {
  const body = [
    '| EVAL-M2-0 1 | Catch rate holds. | 48 of 50. | M | M2 | T |',
    '| --- | --- | --- | --- | --- | --- |',
    '| EVAL-M2-0 2 | Determinism holds. | Bit for bit. | M | M2 | T |',
  ].join('\n');
  const rows = extractRows('eval', body, 'a.pdf');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dim, 'EVAL-M2-01: Catch rate holds.');
  assert.equal(rows[1].dim, 'EVAL-M2-02: Determinism holds.');
});

test('MoSCoW letters expand: M, S, C, W', () => {
  const body = [
    '| ID | Requirement | Fit criterion | Pri |', '| --- | --- | --- | --- |',
    '| R-1 | Alpha shall run. | It runs. | M |', '| R-2 | Beta shall log. | It logs. | S |',
    '| R-3 | Gamma shall sing. | It sings. | C |', '| R-4 | Delta shall wait. | It waits. | W |',
  ].join('\n');
  const pri = extractRows('fr', body, 'a.pdf').map((r) => r.pri);
  assert.deepEqual(pri, ['Must', 'Should', 'Could', "Won't"]);
});

test('the ALLCAPS heading guard: "M M1 T" cannot shatter a document, real headings still do', () => {
  const segs = segmentText('ASSUMPTIONS\n- one\nM M1 T\n- two', 'x.txt');
  assert.equal(segs.length, 1, 'one segment, not two');
  assert.equal(segs[0].title, 'ASSUMPTIONS');
  assert.ok(segs[0].body.includes('M M1 T'), 'the cell line stays as body');
});

test('a numbered subsection of a rows section inherits it, whatever its own title says', () => {
  const doc2 = [
    '7. Functional Requirements', '',
    '7.4 Simulation, scoring, and the CI gate',
    '| ID | Requirement | Fit criterion | Pri |', '| --- | --- | --- | --- |',
    '| FR-M2-007 | The CI plugin shall fail low scores. | Nonzero exit below threshold. | M |',
  ].join('\n');
  const { placements } = mapArtifacts([{ name: 'p.pdf', text: doc2 }]);
  const fr2 = placements.find((p) => p.qid === 'fr');
  assert.ok(fr2 && fr2.rows.length === 1 && /CI plugin/.test(fr2.rows[0].stmt), 'the CI gate row is a functional requirement');
  assert.ok(!placements.find((p) => p.qid === 'gates'), 'nothing leaked into stage gates');
});

test('under a long-form parent a numbered subsection speaks for itself, and an unknown one stays unplaced', () => {
  const doc2 = [
    '1. Overview', 'Prose about the product.',
    '1.2 Releases',
    '| Release | Name | Closes |', '| --- | --- | --- |',
    '| M2 | Simulate and Score. | AT-1, AT-2. |',
    '1.9 Unrecognized Ritual', 'Mystery content.',
  ].join('\n');
  const { placements, unplaced } = mapArtifacts([{ name: 'p.pdf', text: doc2 }]);
  const g = placements.find((p) => p.qid === 'gates');
  assert.ok(g && g.rows.length === 1 && g.rows[0].gate === 'M2: Simulate and Score.', 'Releases classifies itself');
  assert.ok(unplaced.some((u) => u.title === 'Unrecognized Ritual'), 'unplaced beats misplaced');
});

test('a rows section with neither bullets nor tables contributes nothing: intro prose is not a requirement', () => {
  assert.deepEqual(extractRows('fr', 'Grouped by surface and engine. Each group opens with its user story.', 'a.pdf'), []);
});

test('htmlToIntakeMd: mammoth HTML becomes the segmenter markdown with tables intact', () => {
  const html = '<h1>Functional Requirements</h1>' +
    '<table><tr><td><p>ID</p></td><td><p>Requirement</p></td><td><p>Fit criterion</p></td><td><p>Pri</p></td></tr>' +
    '<tr><td><p>FR-1</p></td><td><p>Sync nightly | fully.</p></td><td><p>Done by 06:00 &amp; logged.</p></td><td><p>M</p></td></tr></table>' +
    '<p>Intro &lt;text&gt;.</p><ul><li>a bullet</li></ul>';
  const md = htmlToIntakeMd(html);
  assert.ok(md.startsWith('# Functional Requirements'));
  assert.ok(md.includes('| FR-1 | Sync nightly / fully. | Done by 06:00 & logged. | M |'), 'cells decode entities, pipes neutralized');
  assert.ok(md.includes('- a bullet'));
  assert.ok(md.includes('Intro <text>.'));
  const rows = extractRows('fr', md, 't.docx');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pri, 'Must');
});

test('an empty PDF is diagnosed by its operators: scan, outlined text, or truly empty - and scanned outranks outlined on a tie', () => {
  assert.equal(pdfEmptyDiagnosis([{ images: 1, paths: 4, text: 0 }, { images: 1, paths: 2, text: 0 }]), 'scanned');
  assert.equal(pdfEmptyDiagnosis([{ images: 0, paths: 2082, text: 0 }, { images: 0, paths: 879, text: 0 }]), 'outlined');
  assert.equal(pdfEmptyDiagnosis([{ images: 0, paths: 3, text: 0 }]), 'empty');
  assert.equal(pdfEmptyDiagnosis([{ images: 1, paths: 4, text: 0 }, { images: 0, paths: 900, text: 0 }]), 'scanned');
  assert.equal(pdfEmptyDiagnosis([]), 'empty');
});

test('bulk paste: an Excel table with a header row lands as requirement rows, MoSCoW expanded, IDs prefixed', () => {
  const tsv = 'ID\tRequirement\tFit criterion\tPri\nFR-1\tThe system shall sync nightly.\tSync completes by 06:00.\tM\nFR-2\tThe system shall log access.\tEvery access logged.\tS';
  const rows = pasteToRows('fr', tsv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stmt, 'FR-1: The system shall sync nightly.');
  assert.deepEqual(rows.map((r) => r.pri), ['Must', 'Should']);
});

test('bulk paste: a headerless tab table with IDs is read by content inference', () => {
  const tsv = 'NFR-01\tSingle tenant isolation from day one.\tDefault deny tests on every table.\tM\nNFR-02\tAppend-only storage with proofs.\tProof publication observable.\tM';
  const rows = pasteToRows('nfr', tsv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stmt, 'NFR-01: Single tenant isolation from day one.');
  assert.equal(rows[0].fit, 'Default deny tests on every table.');
});

test('bulk paste: a headerless tab table WITHOUT IDs keeps every line as a row via the blank header', () => {
  const tsv = 'The vault encrypts at rest.\tKeys rotate quarterly.\nExports carry the fingerprint.\tRecipe printed on the cover.';
  const rows = pasteToRows('fr', tsv);
  assert.equal(rows.length, 2, 'the first line is data, not a header');
  assert.ok(rows[0].stmt.includes('vault encrypts'));
});

test('bulk paste: plain lines become bullets and split on the acceptance marker', () => {
  const rows = pasteToRows('fr', 'The system must ingest statements nightly. Acceptance: 100% of files by 06:00.\nUsers could export the worklist.');
  assert.equal(rows.length, 2);
  assert.ok(!/Acceptance:/i.test(rows[0].stmt) && /100% of files/.test(rows[0].fit));
});

test('bulk paste: input larger than the cap is truncated, never a hang', () => {
  const big = ('The system shall process the nightly batch without loss.\tVerified by the replay test.\n').repeat(20000);
  const rows = pasteToRows('fr', big);
  assert.ok(rows.length > 0 && rows.length < 20000);
});

console.log(`intake.test: ${n}/${n} passed`);
