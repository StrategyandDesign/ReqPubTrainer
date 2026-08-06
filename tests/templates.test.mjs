/* ReqPub v2 - template tests (node tests/templates.test.mjs)
   Two contracts: (1) every starter shape validates against the question bank
   and assembles into a well-formed document through the REAL builders (the
   same rule tools/gen-prd-seed.mjs enforces on the worked examples); and
   (2) applyTemplate writes through the repo's rev-checked RPC wrappers only,
   sequentially, scalars before rows, in authored order. */
import assert from 'node:assert/strict';
import { TEMPLATES, templateByKey, validateTemplate, applyTemplate, buildTemplatePayload, applyAnswerSet } from '../app/js/templates.js';
import { ENGAGEMENT, isEngagement, assembleAnswers, buildSections, assemble } from '../app/js/domain.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const awaitTest = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };

/* Turn a template into the state shape assembleAnswers consumes (mirrors the
   seed generator's toState), with the project name injected as applyTemplate
   would inject it. */
function toState(t, name) {
  const fields = {};
  for (const [id, value] of Object.entries({ ctrl_product: name, ...(t.scalars || {}) })) fields[id] = { value, rev: 1 };
  const rows = {};
  for (const [id, arr] of Object.entries(t.lists || {})) rows[id] = arr.map((text, i) => ({ id: id + i, k: i + 1, data: { text }, pos: i + 1, rev: 1 }));
  for (const [id, arr] of Object.entries(t.rows || {})) rows[id] = arr.map((data, i) => ({ id: id + i, k: i + 1, data, pos: i + 1, rev: 1 }));
  return { fields, rows };
}

test('the starters exist, blank first, each with a distinct key', () => {
  assert.equal(TEMPLATES[0].key, 'blank');
  assert.deepEqual([...new Set(TEMPLATES.map((t) => t.key))].length, TEMPLATES.length);
  assert.equal(templateByKey('nope'), null);
});

test('every template validates against the question bank (ids exist, types match)', () => {
  for (const t of TEMPLATES) assert.equal(validateTemplate(t), true);
});

test('validateTemplate rejects an unknown field id and a type mismatch', () => {
  assert.throws(() => validateTemplate({ key: 'bad', scalars: { not_a_field: 'x' } }), /unknown field id/);
  assert.throws(() => validateTemplate({ key: 'bad', scalars: { ov_goals: 'x' } }), /list question/);
  assert.throws(() => validateTemplate({ key: 'bad', rows: { ov_vision: [{}] } }), /not rows/);
});

test('the product starter assembles into a full PRD with its fit-criterion convention visible', () => {
  const st = toState(templateByKey('product'), 'Acme');
  const a = assembleAnswers(st.fields, st.rows);
  const md = assemble(buildSections(a, null, []), a);
  assert.ok(md.startsWith('# Acme'), md.slice(0, 30));
  assert.ok(md.includes('## Part II: Requirements'));
  assert.ok(md.includes('FR-001'));
  assert.ok(md.includes('to confirm'), 'the starter must open with its own punch list');
});

test('the engagement starter assembles a charter, not a PRD, with the decision log started', () => {
  const t = templateByKey('engagement');
  assert.equal(t.scalars.ctrl_type, ENGAGEMENT);
  const st = toState(t, 'Q3 Advisory');
  const a = assembleAnswers(st.fields, st.rows);
  assert.equal(isEngagement(a), true);
  const md = assemble(buildSections(a, null, []), a);
  assert.ok(!md.includes('Part II: Requirements'), 'a charter carries no PRD parts');
  assert.ok(md.includes('DEC-001'));
});

test('the baseline starter unlocks Section 9 with guardrail criteria and the safeguarding pair set', () => {
  const t = templateByKey('baseline');
  assert.equal(t.scalars.has_ai, 'Yes');
  assert.equal(t.scalars.vulnerable, 'Yes');
  const st = toState(t, 'Profile');
  const a = assembleAnswers(st.fields, st.rows);
  const md = assemble(buildSections(a, null, []), a);
  assert.ok(md.includes('## 9. AI Evaluation Criteria'), 'Section 9 must render');
  assert.ok(md.includes('EVAL-001'));
});

/* A capturing repo double: same method names and return shapes as the real
   RPC wrappers in data.js, so the sequencing contract is asserted, not assumed. */
function mockRepo() {
  const calls = [];
  let k = 0;
  return {
    calls,
    saveField(pid, id, value, baseRev) { calls.push(['field', pid, id, value, baseRev]); return Promise.resolve({ data: { ok: true, rev: 1 } }); },
    upsertRow(pid, id, rowId, data) { calls.push(['row', pid, id, data]); return Promise.resolve({ data: { ok: true, id: 'r' + ++k, k, rev: 1, pos: k } }); }
  };
}

await awaitTest('applyTemplate injects the project name as ctrl_product and writes scalars before rows, in authored order', async () => {
  const repo = mockRepo();
  const out = await applyTemplate(repo, 'p1', 'product', 'Acme');
  assert.equal(out.ok, true);
  assert.equal(out.failed, 0);
  const t = templateByKey('product');
  const wantFields = 1 + Object.keys(t.scalars).length;
  const wantRows = Object.values(t.lists).flat().length + Object.values(t.rows).flat().length;
  assert.equal(out.fields, wantFields);
  assert.equal(out.rows, wantRows);
  assert.equal(repo.calls.length, wantFields + wantRows);
  assert.deepEqual(repo.calls[0].slice(0, 4), ['field', 'p1', 'ctrl_product', 'Acme']);
  const firstRow = repo.calls.findIndex((c) => c[0] === 'row');
  assert.ok(repo.calls.slice(0, firstRow).every((c) => c[0] === 'field'), 'every scalar lands before the first row');
  // List items travel as {text}, exactly as live editing stores them.
  const goal = repo.calls.find((c) => c[0] === 'row' && c[2] === 'ov_goals');
  assert.ok(goal && typeof goal[3].text === 'string');
  // Rows keep authored order: the three approver roles arrive as written.
  const roles = repo.calls.filter((c) => c[0] === 'row' && c[2] === 'ctrl_approvers').map((c) => c[3].role);
  assert.deepEqual(roles, t.rows.ctrl_approvers.map((r) => r.role));
});

await awaitTest('blank is a true no-op: zero writes, ok', async () => {
  const repo = mockRepo();
  const out = await applyTemplate(repo, 'p1', 'blank', 'Acme');
  assert.deepEqual([out.ok, out.fields, out.rows, repo.calls.length], [true, 0, 0, 0]);
});

await awaitTest('a failed write is counted, not fatal: the rest still lands', async () => {
  const repo = mockRepo();
  const realSave = repo.saveField.bind(repo);
  let first = true;
  repo.saveField = (...args) => { if (first) { first = false; return Promise.resolve({ error: new Error('net') }); } return realSave(...args); };
  const out = await applyTemplate(repo, 'p1', 'baseline', 'Profile');
  assert.equal(out.ok, false);
  assert.equal(out.failed, 1);
  assert.ok(out.rows > 0, 'rows still applied after a scalar failure');
});

await awaitTest('an unknown template key applies nothing and reports ok', async () => {
  const repo = mockRepo();
  const out = await applyTemplate(repo, 'p1', 'nope', 'Acme');
  assert.deepEqual([out.ok, repo.calls.length], [true, 0]);
});

test('buildTemplatePayload keeps only the standing structure - client content never travels', () => {
  const state = {
    fields: { ctrl_org: { value: 'Collection Ventures' }, ctrl_doctype: { value: 'engagement' },
      ctrl_product: { value: 'SECRET CLIENT NAME' }, ov_problem: { value: 'confidential problem' } },
    rows: { nfr: [{ data: { stmt: 'Single tenant.', fit: 'Deny by default.', pri: 'Must' } }],
      glossary: [{ data: { term: 'Baseline', meaning: 'Immutable snapshot.' } }],
      fr: [{ data: { stmt: 'CLIENT FR', fit: 'x', pri: 'Must' } }],
      eval: [{ data: { dim: 'CLIENT EVAL' } }] }
  };
  const p = buildTemplatePayload(state);
  assert.deepEqual(Object.keys(p.scalars).sort(), ['ctrl_doctype', 'ctrl_org']);
  assert.deepEqual(Object.keys(p.rows).sort(), ['glossary', 'nfr']);
  assert.ok(!JSON.stringify(p).includes('SECRET') && !JSON.stringify(p).includes('CLIENT'), 'nothing client-side leaks');
});

test('buildTemplatePayload drops empty rows and blank scalars instead of storing noise', () => {
  const p = buildTemplatePayload({ fields: { ctrl_org: { value: '   ' } },
    rows: { nfr: [{ data: { stmt: '', fit: ' ' } }], glossary: [] } });
  assert.deepEqual(p, { scalars: {}, rows: {} });
});

test('applyAnswerSet writes through the rev-checked wrappers, whitelisted, name first as ctrl_product', async () => {
  const calls = [];
  const repo = {
    saveField: async (pid, id, value, rev) => { calls.push(['field', id, value, rev]); return { data: { ok: true } }; },
    upsertRow: async (pid, id, rowid, data) => { calls.push(['row', id, data]); return { data: { ok: true } }; }
  };
  const out = await applyAnswerSet(repo, 'p1', {
    scalars: { ctrl_org: 'CV', ctrl_doctype: 'engagement', ov_problem: 'SMUGGLED' },
    rows: { nfr: [{ stmt: 'Single tenant.', pri: 'Must' }], fr: [{ stmt: 'SMUGGLED FR' }] }
  }, 'New Record');
  assert.equal(out.ok, true);
  assert.equal(out.fields, 3, 'ctrl_product + two whitelisted scalars');
  assert.equal(out.rows, 1, 'only the whitelisted collection lands');
  assert.ok(!JSON.stringify(calls).includes('SMUGGLED'), 'the whitelist holds on apply');
  assert.deepEqual(calls[0], ['field', 'ctrl_product', 'New Record', 0], 'the record titles itself first');
});

console.log('\ntemplates.test: ' + n + '/' + n + ' passed');
