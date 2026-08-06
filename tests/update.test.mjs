/* ReqPub v2 - weekly update assembler tests (node tests/update.test.mjs)
   The contract: every line of a weekly update DERIVES from record truth
   through pure functions - no clock, no network, no hand-kept status. The
   fixtures below are a realistic mid-engagement record: a baseline in
   review with a pending sign-off, a live signature link, gates with and
   without dates, and a week of activity. */
import assert from 'node:assert/strict';
import {
  healthWord, nextMilestone, askCandidates, movedLines, openItems,
  closedSince, assembleUpdate, UPDATE_CAPS
} from '../app/js/update.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const NOW = new Date('2026-07-13T12:00:00Z');
const ANSWERS = {
  fr: [{ stmt: 'Ledger reconciles nightly', fit: '', pri: 'Must', _k: 1 }],   // Must without fit → a health gap
  gates: [
    { gate: 'Requirements baseline', criteria: 'v1 approved', decider: 'Sponsor', target: '2026-07-01', _k: 1 },
    { gate: 'SOC 2 authorization', criteria: 'Auditor engaged', decider: 'Sponsor', target: '2026-09-01', _k: 2 },
    { gate: 'Sealing vendor', criteria: 'Provider selected', decider: '', target: 'to confirm', _k: 3 },
  ],
};
const VERSIONS = [
  { id: 'v-1', seq: 1, label: '1.0', status: 'approved' },
  { id: 'v-2', seq: 2, label: '1.1', status: 'in_review' },
];
const APPROVALS = {
  'v-2': [
    { id: 'ap-1', status: 'pending', approver_role: 'Sponsor', approver_name: 'Dana' },
    { id: 'ap-2', status: 'approved', approver_role: 'Product', approver_name: 'MC' },
  ],
};
const SIGNS = {
  'v-1': [
    { id: 'sg-1', status: 'pending', revoked: false, signer_role: 'Sponsor', signer_email: 'dana@northwind.com', signer_name: 'Dana' },
    { id: 'sg-2', status: 'signed', revoked: false, signer_role: 'Legal', signer_email: 'lee@northwind.com' },
  ],
};
const ACTIVITY = [
  { id: 5, action: 'sign.signed', summary: 'v1.0 signed by lee@northwind.com', created_at: '2026-07-12T10:00:00Z' },
  { id: 4, action: 'update.published', summary: 'Weekly update #1 published', created_at: '2026-07-11T10:00:00Z' },
  { id: 3, action: 'version.created', summary: 'Generated v1.1', created_at: '2026-07-10T10:00:00Z' },
  { id: 2, action: 'custom.thing', summary: 'Discovery promoted to FR-014', created_at: '2026-07-09T10:00:00Z' },
  { id: 1, action: 'version.created', summary: 'Generated v1.0', created_at: '2026-07-01T10:00:00Z' },   // before the window
];
const WINDOW = { windowFrom: '2026-07-06T00:00:00Z', windowTo: '2026-07-13T00:00:00Z' };

test('healthWord: a gap reads Needs attention, warns read On watch, clean reads On track', () => {
  assert.equal(healthWord([{ level: 'gap' }, { level: 'warn' }]), 'Needs attention');
  assert.equal(healthWord([{ level: 'warn' }]), 'On watch');
  assert.equal(healthWord([]), 'On track');
});

test('nextMilestone skips a past-target gate and lands on the first not yet passed', () => {
  const m = nextMilestone(ANSWERS, VERSIONS, NOW);
  assert.equal(m.text, 'SOC 2 authorization');
  assert.equal(m.target, '2026-09-01');
});
test('nextMilestone counts a "to confirm" target as still ahead', () => {
  const a = { gates: [{ gate: 'Only gate', target: 'to confirm', _k: 1 }] };
  assert.equal(nextMilestone(a, [], NOW).text, 'Only gate');
});
test('nextMilestone with no gates falls back to the version in review, else empty', () => {
  assert.equal(nextMilestone({}, VERSIONS, NOW).text, 'v1.1 approval');
  assert.equal(nextMilestone({}, [], NOW).text, '');
});

test('askCandidates derives from pending signatures, pending approvals, and gate deciders - and only those', () => {
  const c = askCandidates({ answers: ANSWERS, versions: VERSIONS, approvalsByVersion: APPROVALS, signsByVersion: SIGNS });
  const srcs = c.map((x) => x.src);
  assert.ok(srcs.includes('sign:sg-1'), 'pending signature is an ask');
  assert.ok(!srcs.includes('sign:sg-2'), 'a signed request is not');
  assert.ok(srcs.includes('appr:ap-1'), 'pending approval is an ask');
  assert.ok(!srcs.includes('appr:ap-2'), 'a decided approval is not');
  assert.equal(c.filter((x) => x.src.startsWith('gate:')).length, 2, 'gates with a decider named');
  const sign = c.find((x) => x.src === 'sign:sg-1');
  assert.equal(sign.text, 'Sign v1.0 as Sponsor');
});

test('movedLines keeps the window, maps known actions, and never shows the update machinery', () => {
  const m = movedLines({ activity: ACTIVITY, ...WINDOW });
  const texts = m.map((x) => x.text);
  assert.deepEqual(texts, [
    'Discovery promoted to FR-014',            // unknown action falls back to its own summary
    'Baseline v1.1 generated',
    'v1.0 signed by lee@northwind.com',
  ]);
  assert.ok(!texts.some((t) => /Weekly update/.test(t)), 'update.published is excluded');
  assert.equal(m[0].ref, '2026-07-09');
});
test('movedLines dedupes identical lines and reads oldest to newest', () => {
  const twice = [
    { id: 1, action: 'comm.received', summary: 'x', created_at: '2026-07-10T10:00:00Z' },
    { id: 2, action: 'comm.received', summary: 'y', created_at: '2026-07-11T10:00:00Z' },
  ];
  const m = movedLines({ activity: twice, ...WINDOW });
  assert.deepEqual(m.map((x) => x.text), ['Subject-matter input received']);
});

test('openItems grades by the fixed rubric and sorts high first', () => {
  const o = openItems({ answers: ANSWERS, versions: VERSIONS, approvalsByVersion: APPROVALS, signsByVersion: SIGNS, now: NOW });
  const byKey = Object.fromEntries(o.map((x) => [x.key, x]));
  assert.equal(byKey['health:must_no_fit'].grade, 'high', 'a health gap is high');
  assert.equal(byKey['gatedue:1'].grade, 'high', 'a past-due gate is high');
  assert.equal(byKey['gatedue:1'].lead, 'Sponsor');
  assert.equal(byKey['gatedate:3'].grade, 'watch', 'an undated gate is watch');
  assert.equal(byKey['appr:ap-1'].grade, 'high', 'a pending sign-off on a version in review is high');
  assert.equal(byKey['sign:sg-1'].grade, 'watch', 'a live signature link is watch');
  const grades = o.map((x) => x.grade);
  assert.deepEqual(grades, grades.slice().sort((a, b) => (a === 'high' ? 0 : 1) - (b === 'high' ? 0 : 1)), 'high sorts first');
});

test('closedSince is a pure key diff against the frozen previous payload, capped', () => {
  const open = [{ key: 'appr:ap-1' }];
  const prev = { open: [
    { key: 'appr:ap-1', text: 'still open' },
    { key: 'health:old_gap', text: 'resolved gap' },
    { key: 'gatedue:9', text: 'resolved gate' },
    { key: 'x:1', text: 'a' }, { key: 'x:2', text: 'b' },
  ] };
  const c = closedSince(prev, open);
  assert.equal(c.length, UPDATE_CAPS.closed);
  assert.ok(!c.some((x) => x.text === 'still open'));
  assert.equal(c[0].text, 'resolved gap');
});

test('assembleUpdate composes the strip, counts the overflow, and is deterministic', () => {
  const input = {
    answers: ANSWERS, versions: VERSIONS, approvalsByVersion: APPROVALS,
    signsByVersion: SIGNS, activity: ACTIVITY, prevPayload: null,
    windowFrom: WINDOW.windowFrom, windowTo: WINDOW.windowTo, now: NOW,
  };
  const a = assembleUpdate(input);
  const b = assembleUpdate(input);
  assert.equal(a.strip.health, 'Needs attention');
  assert.equal(a.strip.next.text, 'SOC 2 authorization');
  assert.equal(a.openMore, Math.max(0, a.open.length - UPDATE_CAPS.open));
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same input, same update, always');
});

console.log(`update.test: ${n}/${n} passed`);
