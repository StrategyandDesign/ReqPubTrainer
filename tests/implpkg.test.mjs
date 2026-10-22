/* ReqPub v2 - implementation-package tests (node tests/implpkg.test.mjs)
   The package is the builders' counterpart to the client report: same
   baseline, same fingerprint, full internal detail. These tests pin the
   requirements.json shape (ids, fit, priority, source, attested recorder),
   the acceptance checklist, the per-column CHANGES evidence, the first-
   baseline shape, and the fingerprint recipe symmetry. */
import assert from 'node:assert/strict';
import { buildImplementationFiles } from '../app/js/implpkg.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const answers = {
  ctrl_product: 'Northwind Migration', ctrl_org: 'Collection Ventures',
  fr: [
    { _k: 1, stmt: 'Records a session', fit: 'A 30-minute session persists', pri: 'Must', comp: 'Recorder', src: 'Discovery · Jane', _by: 'Ana Reyes' },
    { _k: 2, stmt: 'Exports the archive', fit: '', pri: 'Should', comp: '' }
  ],
  nfr: [{ _k: 1, stmt: 'P95 under 300ms', fit: 'Load test at 9 writers', pri: 'Must', comp: 'Core' }],
  eval: [{ _k: 4, dim: 'Hallucination guardrail', metric: 'Grounded rate vs golden set', thresh: 'at least 95%', comp: 'Core' }],
  interfaces: [{ _k: 1, iface: 'Supabase', req: 'RLS on every table', fit: 'Rival org reads nothing', comp: 'Core' }],
  components: [{ _k: 1, name: 'Recorder', owner: 'Ana', status: 'Active', desc: 'Captures sessions' }],
  golden: 'Labeled set of 500 transcripts.'
};
const meta = {
  product: 'Northwind Migration', label: '2.0', seq: 2, status: 'approved',
  note: 'Client feedback round', author: 'Micah',
  baselined: '2026-07-13T15:30:00Z', approvedAt: '2026-07-14T09:00:00Z',
  fingerprint: 'a'.repeat(64), answers,
  prevAnswers: {
    fr: [{ _k: 1, stmt: 'Records a session', fit: 'A 5-minute session persists', pri: 'Must', comp: 'Recorder' },
         { _k: 3, stmt: 'Legacy import', fit: 'x', pri: 'Could' }],
    eval: [{ _k: 4, dim: 'Hallucination guardrail', metric: 'Grounded rate vs golden set', thresh: 'at least 90%', comp: 'Core' }]
  },
  prevLabel: '1.0',
  versions: [{ seq: 1, label: '1.0', created_at: '2026-07-01T00:00:00Z', author_name: 'Micah', note: 'Initial baseline' },
             { seq: 2, label: '2.0', created_at: '2026-07-13T15:30:00Z', author_name: 'Micah', note: 'Client feedback round' }]
};

const files = buildImplementationFiles(meta);
const byName = Object.fromEntries(files.map((f) => [f.name, f.text]));

test('the package is five named files plus the knowledge map, index and log first and last', () => {
  assert.deepEqual(files.slice(0, 5).map((f) => f.name), ['requirements.json', 'acceptance.md', 'CHANGES.md', 'prd.md', 'README.md']);
  const km = files.slice(5).map((f) => f.name);
  assert.equal(km[0], 'knowledge/index.md');
  assert.equal(km[km.length - 1], 'knowledge/log.md');
  assert.ok(km.includes('knowledge/requirements/FR-001.md'));
  assert.ok(km.includes('knowledge/evaluation/EVAL-004.md'));
  assert.ok(km.includes('knowledge/interfaces/IR-001.md'));
});

test('requirements.json carries ids, fit, priority, source, and the attested recorder', () => {
  const j = JSON.parse(byName['requirements.json']);
  assert.equal(j.requirements.fr[0].id, 'FR-001');
  assert.equal(j.requirements.fr[0].fit, 'A 30-minute session persists');
  assert.equal(j.requirements.fr[0].priority, 'Must');
  assert.equal(j.requirements.fr[0].source, 'Discovery · Jane');
  assert.equal(j.requirements.fr[0].recordedBy, 'Ana Reyes');
  assert.equal(j.requirements.fr[1].source, undefined, 'absent keys are omitted, not empty');
  assert.equal(j.requirements.eval[0].id, 'EVAL-004');
  assert.equal(j.requirements.eval[0].threshold, 'at least 95%');
  assert.equal(j.requirements.interfaces[0].id, 'IR-001');
  assert.equal(j.components[0].owner, 'Ana');
});

test('requirements.json states the fingerprint, its algorithm, and the exact recipe', () => {
  const j = JSON.parse(byName['requirements.json']);
  assert.equal(j.fingerprint.algorithm, 'SHA-256');
  assert.equal(j.fingerprint.value, 'a'.repeat(64));
  assert.ok(j.fingerprint.recipe.includes('canonical JSON'));
  assert.ok(j.fingerprint.recipe.includes('{label, seq, snapshot}'));
  assert.deepEqual(j.version, { label: '2.0', seq: 2, status: 'approved', baselined: '2026-07-13T15:30:00Z', approvedAt: '2026-07-14T09:00:00Z', note: 'Client feedback round', author: 'Micah' });
});

test('acceptance.md is a testable checklist: every requirement a box, every box a fit', () => {
  const md = byName['acceptance.md'];
  assert.ok(md.includes('- [ ] **FR-001** Records a session'));
  assert.ok(md.includes('Fit: A 30-minute session persists'));
  assert.ok(md.includes('Fit: to confirm'), 'a missing fit criterion is named, not hidden');
  assert.ok(md.includes('- [ ] **EVAL-004** Hallucination guardrail'));
  assert.ok(md.includes('threshold: at least 95%'));
  assert.ok(md.includes('Golden dataset and red-team method: Labeled set of 500 transcripts.'));
  assert.ok(md.includes('not a signature or a trusted timestamp'));
});

test('CHANGES.md is per-column evidence: added, modified with before/after, removed', () => {
  const md = byName['CHANGES.md'];
  assert.ok(md.includes('# Changes in v2.0 (compared to v1.0)'));
  assert.ok(md.includes('- **FR-002** Exports the archive'));
  assert.ok(md.includes('**FR-001**'));
  assert.ok(md.includes('- fit criterion: ~~A 5-minute session persists~~ → A 30-minute session persists'));
  assert.ok(md.includes('- threshold: ~~at least 90%~~ → at least 95%'));
  assert.ok(md.includes('- FR-003'), 'removed rows are listed');
  assert.ok(md.includes('> Client feedback round'));
});

test('a first baseline states its shape instead of diffing against nothing', () => {
  const first = buildImplementationFiles({ ...meta, prevAnswers: null, prevLabel: '' });
  const md = Object.fromEntries(first.map((f) => [f.name, f.text]))['CHANGES.md'];
  assert.ok(md.includes('initial baseline'));
  assert.ok(md.includes('2 functional'));
  assert.ok(md.includes('1 AI acceptance'));
});

test('prd.md is the full assembled document for the baseline', () => {
  const md = byName['prd.md'];
  assert.ok(md.startsWith('# Northwind Migration'));
  assert.ok(md.includes('FR-001'));
  assert.ok(md.includes('Revision History'));
});

test('requirements.json carries each row\u2019s author and origin beside the attested recorder', () => {
  const withAuthor = buildImplementationFiles({ ...meta, answers: { ...answers,
    fr: [{ _k: 7, stmt: 'When a form is retyped, the system shall flag it', fit: 'Flagged within 1s. Test.', pri: 'Must', src: 'Inbox · Dr Priya Nair', _by: 'Ana Reyes', _author: 'Dr Priya Nair', _origin: 'sme' }] } });
  const j = JSON.parse(withAuthor.find((f) => f.name === 'requirements.json').text);
  const r = j.requirements.fr.find((x) => x.id === 'FR-007');
  assert.equal(r.author, 'Dr Priya Nair');
  assert.equal(r.origin, 'sme');
  assert.equal(r.recordedBy, 'Ana Reyes');
  assert.equal(r.source, 'Inbox · Dr Priya Nair');
});

test('every file in the package carries the full fingerprint, so one file alone still names its baseline', () => {
  const fp = 'a'.repeat(64);
  for (const f of files) {
    assert.ok(f.text.includes(fp), f.name + ' carries the full 64-character fingerprint');
  }
  assert.ok(!byName['acceptance.md'].includes(fp.slice(0, 16) + '…'), 'no truncated fingerprint remains');
  const first = buildImplementationFiles({ ...meta, prevAnswers: null, prevLabel: '' });
  assert.ok(first.find((f) => f.name === 'CHANGES.md').text.includes(fp), 'an initial baseline CHANGES.md carries it too');
  const prd = byName['prd.md'];
  assert.ok(prd.indexOf(fp) < prd.indexOf('FR-001'), 'prd.md states the fingerprint before the content it covers');
});

test('README.md states the symmetry: one fingerprint across client report and package', () => {
  const md = byName['README.md'];
  assert.ok(md.includes('a'.repeat(64)));
  assert.ok(md.includes('same fingerprint'));
  assert.ok(md.includes('byte-identical baselines'));
  assert.ok(md.includes('not a signature or a trusted timestamp'));
});

test('a gate name rides in requirements.json when the baseline carries one', () => {
  const gated = buildImplementationFiles({ ...meta, gate: 'Requirements Baseline' });
  const j = JSON.parse(Object.fromEntries(gated.map((f) => [f.name, f.text]))['requirements.json']);
  assert.equal(j.version.gate, 'Requirements Baseline');
  const plain = JSON.parse(byName['requirements.json']);
  assert.equal(plain.version.gate, undefined, 'absent gates are omitted, not empty');
});

test('the signed thresholds travel machine-readable, anchored to their eval set', () => {
  const withEval = buildImplementationFiles({ ...meta, answers: { ...meta.answers,
    eval: [{ _k: 1, dim: 'Grounding', metric: 'Faithfulness', thresh: 'at least 95%', dataset: 'acceptance-set v3 · 100 cases' }] } });
  const j = JSON.parse(Object.fromEntries(withEval.map((f) => [f.name, f.text]))['requirements.json']);
  assert.equal(j.acceptance.length, 1);
  assert.equal(j.acceptance[0].id, 'EVAL-001');
  assert.equal(j.acceptance[0].threshold, 'at least 95%');
  assert.equal(j.acceptance[0].dataset, 'acceptance-set v3 · 100 cases');
  const md = Object.fromEntries(withEval.map((f) => [f.name, f.text]))['acceptance.md'];
  assert.ok(md.includes('Signed acceptance thresholds'));
  assert.ok(md.includes('acceptance-set v3'));
  const gapped = buildImplementationFiles({ ...meta, answers: { ...meta.answers,
    eval: [{ _k: 1, dim: 'Grounding', metric: 'Faithfulness', thresh: '95%', dataset: 'set v1' },
           { _k: 3, dim: 'Safety', metric: 'Refusal rate', thresh: '99%', dataset: 'red-team v2' }] } });
  const gj = JSON.parse(Object.fromEntries(gapped.map((f) => [f.name, f.text]))['requirements.json']);
  assert.deepEqual(gj.acceptance.map((x) => x.id), ['EVAL-001', 'EVAL-003'], 'permanent keys survive deletions; ids never renumber across artifacts');
  const noEval = buildImplementationFiles({ ...meta, answers: { ...meta.answers, eval: [] } });
  const jj = JSON.parse(Object.fromEntries(noEval.map((f) => [f.name, f.text]))['requirements.json']);
  assert.equal(jj.acceptance, undefined, 'no eval rows, no acceptance block');
});

test('approvals ride as labeled record-state, never as baseline content', () => {
  const withAp = buildImplementationFiles({ ...meta, approvals: [
    { approver_role: 'Sponsor', approver_name: 'Tim', status: 'approved', decided_at: '2026-07-10T00:00:00Z' },
    { approver_role: 'Engineering', approver_name: 'Ana', status: 'approved', decided_at: '2026-07-12T00:00:00Z' }
  ] });
  const j = JSON.parse(Object.fromEntries(withAp.map((f) => [f.name, f.text]))['requirements.json']);
  assert.equal(j.approvals.records.length, 2);
  assert.equal(j.approvals.latest_decision_at, '2026-07-12T00:00:00Z');
  assert.ok(j.approvals.note.includes('fingerprint covers the baseline'));
  const plain = JSON.parse(byName['requirements.json']);
  assert.equal(plain.approvals, undefined, 'no approvals passed, no block');
});

test('the package is deterministic for a given baseline', () => {
  const again = buildImplementationFiles(meta);
  assert.deepEqual(again, files);
});

/* ---- v3.2 ---- */
const disc = { ...answers,
  fr: [{ _k: 1, stmt: 'When a quote is requested, the system shall draft it within one hour.', fit: 'Drafted within 60 minutes on the acceptance set. Test.', input: 'Request #4471 from the acceptance set', expected: 'A draft quote in the queue within 60 minutes', pri: 'Must', exec: 'Agent', _author: 'Jane Roe', _origin: 'sme' }],
  eval: [{ _k: 2, dim: 'Price accuracy', metric: 'Exact match to the price book', thresh: 'at least 98%', dataset: 'quote-set v2 · 200 cases', grader: 'Pricing desk lead, rubric R1', pass_rate: '19 of 20 runs' }],
  metrics: [{ _k: 1, metric: 'Hours from request to quote', target: 'under 4', method: 'Desk log, weekly', baseline: '11.2 hours on 40 requests, week of observation', comparison: 'Matched desk without the system, same period' }],
  clearance: [{ _k: 1, item: 'Quote data, masked', scope: 'Read only, 2025 and 2026', approver: 'R. Patel, Security', date: '2026-10', status: 'Approved' }],
  ranking: [{ _k: 1, problem: 'Quote desk turnaround', mechanism: 'hours from request to quote', gap: '11 hours per quote across 40 a week', rank: '1', status: 'Taken forward' }, { _k: 2, problem: 'Invoice disputes', mechanism: 'days to cash', gap: 'to price', rank: '2', status: 'Candidate' }],
  findings: [{ _k: 1, finding: 'Quotes are retyped from the CRM into the pricing sheet', contradicts: 'Session 2 claim that pricing reads the CRM', source: 'A. Gomez, observed 14 Oct', owner: 'Business owner', kind: 'Failed claim' }],
  controls: [{ _k: 1, constraint: 'When a quote leaves the system, the system shall write it to the ERP and nowhere else.', owner: 'Security, R. Patel', fit: 'No quote file exists outside the ERP after export. Inspection.', negotiable: 'No' }, { _k: 2, constraint: 'Only masked data in the sandbox', owner: 'Privacy', fit: '', negotiable: 'No' }],
  returns: [{ _k: 1, build: 'a1b2c3d', fingerprint: 'a'.repeat(64), result: 'Pass', notes: '', accepted: 'M. Chen', date: '2026-11' }],
  decisions: [{ _k: 3, decision: 'Quotes under 500 need no review', ref: 'FR-001', kind: 'Reconcile', options: 'All reviewed; none reviewed', rationale: 'Operators showed review adds nothing under 500', owner: 'Business owner', date: '2026-10', supersedes: '' }],
  glossary: [{ _k: 1, term: 'Quote desk', def: 'The three people who price inbound requests' }]
};
const dfiles = buildImplementationFiles({ ...meta, answers: disc, prevAnswers: null, prevLabel: '' });
const dby = Object.fromEntries(dfiles.map((f) => [f.name, f.text]));

test('requirements.json carries test inputs, expected results, graders and pass rates', () => {
  const j = JSON.parse(dby['requirements.json']);
  assert.equal(j.requirements.fr[0].testInput, 'Request #4471 from the acceptance set');
  assert.equal(j.requirements.fr[0].expectedResult, 'A draft quote in the queue within 60 minutes');
  assert.equal(j.requirements.eval[0].grader, 'Pricing desk lead, rubric R1');
  assert.equal(j.acceptance[0].passRate, '19 of 20 runs');
  assert.equal(j.acceptance[0].dataset, 'quote-set v2 · 200 cases');
});

test('requirements.json carries the discovery record, the decisions, the commercial thresholds and the glossary', () => {
  const j = JSON.parse(dby['requirements.json']);
  assert.deepEqual(j.discovery.ranking.map((r) => r.id), ['RANK-001', 'RANK-002']);
  assert.equal(j.discovery.ranking[0].pricedGap, '11 hours per quote across 40 a week');
  assert.equal(j.discovery.clearance[0].approvedBy, 'R. Patel, Security');
  assert.equal(j.discovery.findings[0].kind, 'Failed claim');
  assert.equal(j.discovery.constraints[1].negotiable, 'No');
  assert.equal(j.discovery.releaseReviews[0].baselineFingerprint, 'a'.repeat(64));
  assert.equal(j.decisions[0].id, 'DEC-003');
  assert.equal(j.decisions[0].concerns, 'FR-001');
  assert.equal(j.thresholds[0].comparisonMethod, 'Matched desk without the system, same period');
  assert.equal(j.glossary[0].term, 'Quote desk');
  const plain = JSON.parse(byName['requirements.json']);
  assert.equal(plain.discovery, undefined, 'a record without discovery rows carries no discovery block');
  assert.equal(plain.decisions, undefined);
});

test('acceptance.md lists inputs and expected results, the commercial thresholds, and testable constraints as boxes', () => {
  const md = dby['acceptance.md'];
  assert.ok(md.includes('Input: Request #4471'));
  assert.ok(md.includes('Expected: A draft quote'));
  assert.ok(md.includes('## Commercial thresholds'));
  assert.ok(md.includes('11.2 hours on 40 requests'));
  assert.ok(md.includes('| Grader | Pass rate |'));
  assert.ok(md.includes('- [ ] **CON-001**'), 'a constraint with a fit criterion is a test');
  assert.ok(!md.includes('CON-002'), 'a constraint without a fit criterion is not a box');
});

test('CHANGES.md names changes on every id-bearing table, by permanent id and column', () => {
  const next = { ...disc, ranking: [{ ...disc.ranking[0], status: 'Taken forward' }, { ...disc.ranking[1], rank: '3' }], findings: [...disc.findings, { _k: 2, finding: 'New', source: 'x' }], controls: [disc.controls[0]] };
  const f2 = buildImplementationFiles({ ...meta, answers: next, prevAnswers: disc, prevLabel: '1.0', label: '2.0' });
  const md = f2.find((f) => f.name === 'CHANGES.md').text;
  assert.ok(md.includes('- **FND-002** New'));
  assert.ok(md.includes('**RANK-002**'));
  assert.ok(md.includes('- rank: ~~2~~ → 3'));
  assert.ok(md.includes('- CON-002'), 'a removed constraint is listed');
  const first = dby['CHANGES.md'];
  assert.ok(first.includes('7 discovery record rows'));
  assert.ok(first.includes('1 decisions'));
});

test('the knowledge map is an OKF 0.2 bundle: typed frontmatter on every concept, an index of links, a dated log', () => {
  const idx = dby['knowledge/index.md'];
  assert.ok(idx.startsWith('---\nokf_version: "0.2"\n---'));
  assert.ok(idx.includes('## Ranked problems'));
  assert.ok(idx.includes('- [RANK-001](/discovery/ranking/RANK-001): Quote desk turnaround'));
  assert.ok(idx.includes('- [Quote desk](/glossary/quote-desk): The three people'));
  const fr = dby['knowledge/requirements/FR-001.md'];
  assert.ok(fr.startsWith('---\ntype: requirement\n'));
  assert.ok(fr.includes('  fingerprint: ' + 'a'.repeat(64)));
  assert.ok(fr.includes('  author: Jane Roe'));
  assert.ok(fr.includes('  origin: sme'));
  assert.ok(fr.includes('**Test input.** Request #4471'));
  const log = dby['knowledge/log.md'];
  assert.ok(/^## \d{4}-\d{2}-\d{2}$/m.test(log), 'ISO date headings');
  assert.ok(log.indexOf('v2.0') < log.indexOf('v1.0'), 'newest first');
  for (const f of dfiles) {
    if (!f.name.startsWith('knowledge/') || f.name === 'knowledge/index.md' || f.name === 'knowledge/log.md') continue;
    assert.ok(/^---\ntype: [a-z-]+\n/.test(f.text), f.name + ' opens with typed frontmatter');
    assert.ok(/\n---\n\n# /.test(f.text), f.name + ' closes its frontmatter before the title');
  }
  assert.ok(!dfiles.some((f) => /\.md$/.test(f.name) && /\/(index|log)\.md$/.test(f.name) && !/^knowledge\/(index|log)\.md$/.test(f.name)), 'reserved names appear only at the bundle root');
});

test('the knowledge map is deterministic and carries the fingerprint on every file', () => {
  const again = buildImplementationFiles({ ...meta, answers: disc, prevAnswers: null, prevLabel: '' });
  assert.deepEqual(again, dfiles);
  for (const f of dfiles) assert.ok(f.text.includes('a'.repeat(64)), f.name);
});

console.log('\nimplpkg.test: ' + n + '/' + n + ' passed');
