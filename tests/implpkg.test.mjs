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

test('the package is exactly five files, all named for their job', () => {
  assert.deepEqual(files.map((f) => f.name), ['requirements.json', 'acceptance.md', 'CHANGES.md', 'prd.md', 'README.md']);
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

console.log('\nimplpkg.test: ' + n + '/' + n + ' passed');
