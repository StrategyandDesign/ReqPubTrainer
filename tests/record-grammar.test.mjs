/* ReqPub v2 - record-form intake (node tests/record-grammar.test.mjs)
   The FC-PRD-001 dialect, pinned on a synthetic structural twin: running
   footers and page stamps stripped, two-line SECTION and PILLAR headings
   folded, ID-labeled requirement records with Done means criteria and the
   MUST/SHOULD · R# · VERIFY tail parsed into complete fr rows, and the
   confident prose homes (Never build, Open items, People and words) placed.
   Ends with the whole pipeline: text in, assembled document skeleton out. */
import assert from 'node:assert/strict';
globalThis.location = { origin: 'https://reqpub.com', pathname: '/app/' };
const { normalizeRecordDoc, recordFromSegment, segmentText, mapArtifacts } = await import('../app/js/intake.js');
const { assemble, buildSections, mdToHtml } = await import('../app/js/domain.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  \u2713 ' + name); };

const MID = '\u00b7';
const TWIN = [
  'ACME INSTITUTE ' + MID + ' EXAMPLE.ORG',
  'The Example Platform.',
  'SECTION 1',
  '',
  'Purpose and how to read this document.',
  'This document defines what the platform must do.',
  'AB-PRD-9 ' + MID + ' THE EXAMPLE PLATFORM ' + MID + ' REQUIREMENTS   PAGE 2',
  '\fSECTION 3',
  '',
  'People and words.',
  'PARTICIPANT Any person using the platform.',
  'PAGE 3',
  '\fPILLAR ONE',
  '',
  'Two assessments.',
  'The profile is live and validated.',
  '',
  'AS-01 START THE PROFILE',
  'A man opens the Profile from a phone link. No app install,',
  'no payment step.',
  'Done means. A new visitor reaches item one in under sixty seconds',
  'on a phone.',
  'MUST ' + MID + ' R1 ' + MID + ' VERIFY DEMO',
  '',
  'LN-05 REQUIRE VIDEO CODES',
  'Two codes appear at random points per video.',
  'Done means. Video completion requires both codes.',
  'SHOULD ' + MID + ' R2 ' + MID + ' VERIFY TEST',
  '',
  'XP-04 ENFORCE ROW SECURITY',
  'No participant reads another record.',
  'Done means. Row level security tests pass on every participant table.',
  'MUST ' + MID + ' R1 ' + MID + ' VERIFY TEST',
  '\fSECTION 8',
  '',
  'Never build.',
  'No letter grades. No leaderboards.',
  '\fSECTION 9',
  '',
  'Open items.',
  'OI-1 The award needs one name. Owner Micah.',
].join('\n');

test('footers, page stamps, and form feeds vanish; content lines survive', () => {
  const t = normalizeRecordDoc(TWIN);
  assert.ok(!t.includes('PAGE 2') && !t.includes('PAGE 3') && !t.includes('\f'));
  assert.ok(t.includes('No app install'));
});

test('two-line SECTION and PILLAR headings fold into headings the segmenter numbers', () => {
  const t = normalizeRecordDoc(TWIN);
  assert.ok(t.includes('1. Purpose and how to read this document'));
  assert.ok(t.includes('8. Never build'));
  assert.ok(t.includes('# Two assessments'));
  const titles = segmentText(t, 'x').map((s) => s.title);
  assert.ok(titles.includes('Purpose and how to read this document'));
});

test('a record segment parses into one complete fr row, every column right', () => {
  const seg = segmentText(normalizeRecordDoc(TWIN), 'x').find((s) => s.title.startsWith('AS-01'));
  const row = recordFromSegment(seg);
  assert.equal(row.stmt, 'AS-01 ' + MID + ' Start the profile. A man opens the Profile from a phone link. No app install, no payment step.');
  assert.equal(row.fit, 'A new visitor reaches item one in under sixty seconds on a phone. Verify DEMO.');
  assert.equal(row.pri, 'Must');
  assert.equal(row.comp, 'R1');
});

test('SHOULD and R2 and TEST map through; a prose segment is never a record', () => {
  const segs = segmentText(normalizeRecordDoc(TWIN), 'x');
  const ln = recordFromSegment(segs.find((s) => s.title.startsWith('LN-05')));
  assert.equal(ln.pri, 'Should'); assert.equal(ln.comp, 'R2'); assert.ok(ln.fit.endsWith('Verify TEST.'));
  assert.equal(recordFromSegment(segs.find((s) => s.title === 'Never build')), null);
});

test('mapArtifacts places the whole twin: three records to fr, prose to its homes', () => {
  const { placements, unplaced } = mapArtifacts([{ name: 'twin.pdf', text: TWIN }]);
  const by = {}; placements.forEach((p) => { by[p.qid] = p; });
  assert.equal(by.fr.rows.length, 3, 'all three records land');
  assert.ok(by.fr.rows.some((r) => r.stmt.startsWith('XP-04')), 'protection records are requirements too');
  assert.ok(by.constrain, 'Never build lands in constraints');
  assert.ok(by.decisions, 'Open items lands in decisions');
  assert.ok(by.glossary, 'People and words lands in the glossary');
  assert.ok(by.ov_purpose, 'the purpose section lands');
  assert.ok((unplaced || []).length <= 2, 'little is left behind: ' + (unplaced || []).length);
});

test('end to end: the twin assembles into a document whose skeleton carries the records', () => {
  const { placements } = mapArtifacts([{ name: 'twin.pdf', text: TWIN }]);
  const a = { ctrl_type: 'Product or project requirements', pname: 'The Example Platform' };
  for (const p of placements) {
    if (p.kind === 'long') a[p.qid] = p.value;
    else if (p.kind === 'list') a[p.qid] = p.rows.map((r) => r.text);
    else a[p.qid] = p.rows;
  }
  const html = mdToHtml(assemble(buildSections(a, '1.0', []), a));
  assert.ok(html.includes('id="docsec-functional"'), 'the functional section renders');
  assert.ok(html.includes('AS-01') && html.includes('LN-05') && html.includes('XP-04'), 'the IDs survive to the document');
  assert.ok(html.includes('Verify DEMO.'), 'the fit criteria survive');
});

console.log('\nrecord-grammar.test: ' + n + '/' + n + ' passed');
