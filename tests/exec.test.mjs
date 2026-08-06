/* ReqPub v2 - executed-by tests (node tests/exec.test.mjs)
   Executed by is an authored attribute on requirement and evaluation rows:
   Human, Agent, or Mixed, defaulting to Human. It renders wherever the row
   renders and travels wherever the row travels. Nothing is computed from it;
   these tests pin that it persists, that a blank means Human on every
   surface, and that every export carries it. */
import assert from 'node:assert/strict';
import { execOf, buildSections, assemble, qById, reqDiffDetail, bBrief, assembleEngagement, engSections } from '../app/js/domain.js';
import { buildImplementationFiles } from '../app/js/implpkg.js';
import { sowExhibitMd } from '../app/js/exports.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

/* ---- the column and its default ---- */

test('fr, nfr, and eval each carry an exec column with Human/Agent/Mixed and a Human default', () => {
  for (const id of ['fr', 'nfr', 'eval']) {
    const q = qById[id];
    const col = (q.cols || []).find((c) => c.k === 'exec');
    assert.ok(col, id + ' has an exec column');
    assert.equal(col.l, 'Executed by');
    assert.deepEqual(col.sel, ['Human', 'Agent', 'Mixed']);
    assert.equal(col.def, 'Human', id + ' defaults to Human');
  }
});

test('execOf treats a blank and an explicit Human as the same fact', () => {
  assert.equal(execOf({}), 'Human');
  assert.equal(execOf({ exec: '' }), 'Human');
  assert.equal(execOf({ exec: 'Human' }), 'Human');
  assert.equal(execOf({ exec: 'Agent' }), 'Agent');
  assert.equal(execOf(null), 'Human');
});

/* ---- persistence: the value survives assembly into the document ---- */

test('an authored exec value persists through the assembled PRD tables', () => {
  const a = {
    pname: 'P', purpose: 'x',
    fr: [{ _k: 1, stmt: 'Does A', fit: 'Test', pri: 'Must', exec: 'Agent' }],
    nfr: [{ _k: 1, stmt: 'Fast', fit: 'Under 1s', pri: 'Must', exec: 'Mixed' }],
  };
  const md = assemble(buildSections(a, '1.0', []), a);
  assert.ok(md.includes('Executed by'), 'the column header renders');
  assert.ok(/FR-001[^\n]*Agent/.test(md), 'FR row carries Agent');
  assert.ok(/NFR-001[^\n]*Mixed/.test(md), 'NFR row carries Mixed');
});

test('a row without exec renders as Human in both requirement tables', () => {
  const a = { pname: 'P', fr: [{ _k: 1, stmt: 'S', fit: 'F', pri: 'Must' }], nfr: [{ _k: 1, stmt: 'S', fit: 'F', pri: 'Must' }] };
  const md = assemble(buildSections(a, '1.0', []), a);
  assert.ok(/FR-001[^\n]*Human/.test(md));
  assert.ok(/NFR-001[^\n]*Human/.test(md));
});

test('the engagement document eval table carries the exec value', () => {
  const a = {
    doc_type: 'Engagement record', pname: 'E', has_ai: 'Yes',
    eval: [{ _k: 1, dim: 'Grounding', metric: 'Judge', thresh: '95%', dataset: 'set v1 · 100 · fixed', exec: 'Agent' }],
  };
  const md = assembleEngagement(engSections(a), a);
  assert.ok(/EVAL-001[^\n]*Agent/.test(md), 'engagement eval row carries Agent');
});

/* ---- the brief tags only the non-default ---- */

test('the brief tags agent-executed rows and stays silent on human rows', () => {
  const a = {
    pname: 'P', purpose: 'x', has_ai: 'Yes',
    fr: [
      { _k: 1, stmt: 'Human row', fit: 'T', pri: 'Must' },
      { _k: 2, stmt: 'Agent row', fit: 'T', pri: 'Must', exec: 'Agent' },
    ],
    eval: [{ _k: 1, dim: 'Safety', metric: 'M', thresh: '99%', dataset: 'set', exec: 'Mixed' }],
  };
  const brief = bBrief(a);
  assert.ok(brief.includes('executed by agent'), 'the agent row is tagged');
  assert.ok(brief.includes('executed by mixed'), 'the mixed eval row is tagged');
  assert.ok(!/Human row[^\n]*executed by/.test(brief), 'the human row carries no tag');
});

/* ---- exports: requirements.json, checklist, thresholds, SOW exhibit ---- */

test('requirements.json states executedBy on every fr, nfr, and eval row, defaulted rows included', () => {
  const files = buildImplementationFiles({
    product: 'P', label: '1.0', fingerprint: 'abc', answers: {
      fr: [{ _k: 1, stmt: 'A', fit: 'T', pri: 'Must' }, { _k: 2, stmt: 'B', fit: 'T', pri: 'Must', exec: 'Agent' }],
      nfr: [{ _k: 1, stmt: 'C', fit: 'T', pri: 'Must', exec: 'Mixed' }],
      eval: [{ _k: 1, dim: 'D', metric: 'M', thresh: '95%', dataset: 'set v1' }],
    },
  });
  const spec = JSON.parse(files.find((f) => f.name === 'requirements.json').text);
  assert.equal(spec.requirements.fr[0].executedBy, 'Human', 'a blank exports as Human');
  assert.equal(spec.requirements.fr[1].executedBy, 'Agent');
  assert.equal(spec.requirements.nfr[0].executedBy, 'Mixed');
  assert.equal(spec.requirements.eval[0].executedBy, 'Human');
  assert.equal(spec.acceptance[0].executedBy, 'Human', 'the machine-readable acceptance block carries it too');
});

test('the acceptance checklist tags non-human boxes and the thresholds table has an Executed by column', () => {
  const files = buildImplementationFiles({
    product: 'P', label: '1.0', fingerprint: 'abc', answers: {
      fr: [{ _k: 1, stmt: 'Agent work', fit: 'T', pri: 'Must', exec: 'Agent' }, { _k: 2, stmt: 'Human work', fit: 'T', pri: 'Must' }],
      eval: [{ _k: 1, dim: 'D', metric: 'M', thresh: '95%', dataset: 'set v1', exec: 'Agent' }],
    },
  });
  const md = files.find((f) => f.name === 'acceptance.md').text;
  assert.ok(/FR-001[^\n]*\(executed by agent\)/.test(md), 'the agent box is tagged');
  assert.ok(!/FR-002[^\n]*executed by/.test(md), 'the human box is not');
  assert.ok(md.includes('Signed acceptance thresholds'));
  assert.ok(/Executed by/.test(md), 'the thresholds table names the column');
});

test('the SOW exhibit acceptance table carries Executed by', () => {
  const md = sowExhibitMd({ label: '1.0', fingerprint: 'f', approvals: [] }, {
    fr: [{ stmt: 'X', fit: 'Y', pri: 'Must' }],
    eval: [{ _k: 1, dim: 'D', metric: 'M', thresh: '95%', dataset: 'set', exec: 'Agent' }],
  });
  assert.ok(md.includes('Executed by'));
  assert.ok(/\| *D *\|[^\n]*Agent/.test(md), 'the eval row states Agent');
});

/* ---- the diff sees the column ---- */

test('an exec change is evidence in the per-column diff on fr, nfr, and eval', () => {
  const cases = [
    ['fr', { _k: 1, stmt: 'S', fit: 'F', pri: 'Must' }],
    ['nfr', { _k: 1, stmt: 'S', fit: 'F', pri: 'Must' }],
    ['eval', { _k: 1, dim: 'D', metric: 'M', thresh: '9', dataset: 's' }],
  ];
  for (const [id, base] of cases) {
    const prev = { [id]: [{ ...base, exec: 'Human' }] };
    const next = { [id]: [{ ...base, exec: 'Agent' }] };
    const line = JSON.stringify(reqDiffDetail(prev, next));
    assert.ok(/executed by/.test(line), id + ': the change is labelled executed by');
    assert.ok(/Agent/.test(line), id + ': the new value appears');
  }
});

console.log('\nexec.test: ' + n + '/' + n + ' passed');
