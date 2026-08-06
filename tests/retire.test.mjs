/* ReqPub v2 - consolidation safety (node tests/retire.test.mjs)
   The fold's no-breaks contract: the legacy risk register is retired, never
   deleted. Hidden where empty, rendered forever where rows exist, closed to
   new rows, and renamed so only one section is called Risks and Issues. */
import assert from 'node:assert/strict';
import { qById, SECTIONS, tagDoneCandidates } from '../app/js/domain.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  \u2713 ' + name); };

const ENG = { ctrl_type: 'Consulting engagement' };

test('the legacy register is retired: flagged, renamed, and no longer the duplicate title', () => {
  assert.equal(qById.risks.retired, true);
  assert.equal(qById.risks.prompt, 'Risk register (archive)');
  const dupes = SECTIONS.filter((s) => s.title === 'Risks and Issues');
  assert.equal(dupes.length, 1, 'exactly one section carries the name');
  assert.equal(dupes[0].key, 'updates', 'and it is the phase-ID home');
});

test('hidden where empty, visible wherever rows already exist', () => {
  const sec = SECTIONS.find((s) => s.key === 'risks');
  assert.equal(sec.cond({ ...ENG, risks: [] }), false, 'no rows, no section');
  assert.equal(sec.cond({ ...ENG, risks: [{ risk: 'Data access', owner: 'MC' }] }), true, 'existing rows keep their home');
  assert.equal(qById.risks.cond({ ...ENG, risks: [{ risk: 'Data access' }] }), true, 'the question renders its rows');
  assert.equal(qById.risks.cond({ ...ENG, risks: [{}] }), false, 'blank rows do not count');
});

test('the surviving section carries the Status column the register expressed', () => {
  const st = qById.updates.cols.find((c) => c.k === 'status');
  assert.ok(st, 'status column exists');
  assert.deepEqual(st.sel, ['Open', 'Mitigating', 'Accepted', 'Closed']);
  assert.equal(st.def, 'Open');
});


test('the carryover offer picks exactly the done, untagged key results', () => {
  const rows = [
    { id: 'a', data: { objective: 'O', kr: 'Done and untagged', done: 'Done', phase: '' } },
    { id: 'b', data: { objective: 'O', kr: 'Done but already tagged', done: 'Done', phase: 'Discovery' } },
    { id: 'c', data: { objective: 'O', kr: 'Still open', done: 'Open', phase: '' } },
    { id: 'd', data: { objective: 'O', kr: 'Whitespace phase counts as untagged', done: 'Done', phase: '  ' } },
    { id: 'e' },
  ];
  const got = tagDoneCandidates(rows).map((r) => r.id);
  assert.deepEqual(got, ['a', 'd'], 'only done rows with no phase of their own');
  assert.deepEqual(tagDoneCandidates([]), [], 'empty in, empty out');
  assert.deepEqual(tagDoneCandidates(null), [], 'null tolerated');
});

console.log('\nretire.test: ' + n + '/' + n + ' passed');
