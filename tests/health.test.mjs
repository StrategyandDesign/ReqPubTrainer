/* ReqPub v2 - record-health tests (node tests/health.test.mjs)
   Signals are DERIVED predicates over the record itself; every one must be
   deterministic, must appear exactly when its gap exists, and must vanish
   the moment the gap is fixed. Counts must be plain, defensible tallies. */
import assert from 'node:assert/strict';
import { healthSignals, recordCounts, countToConfirm, landingTab, incorporatedRows, healthStateLine , healthPillLabel } from '../app/js/health.js';
import { ENGAGEMENT } from '../app/js/domain.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const keys = (sigs) => sigs.map((s) => s.key);
const get = (sigs, key) => sigs.find((s) => s.key === key);

/* A record with nothing wrong: every Must has a fit, the component has an
   owner and every requirement is tagged to it, scope exclusions exist, AI is
   declared off, and no placeholder remains. */
const clean = {
  ctrl_product: 'Acme', has_ai: 'No', vulnerable: 'No',
  sol_out: ['No mobile app in phase one'],
  components: [{ _k: 1, name: 'Core', owner: 'Jo', status: 'Active' }],
  fr: [{ _k: 1, stmt: 'Does X', fit: 'X measured. Test.', pri: 'Must', comp: 'Core' }],
  nfr: [{ _k: 1, stmt: 'P95 under 200ms', fit: 'Load test.', pri: 'Should', comp: 'Core' }]
};

test('a clean record raises no signals', () => {
  assert.deepEqual(healthSignals(clean, {}), []);
});

test('a Must requirement without a fit criterion is a gap, counted across FR and NFR', () => {
  const a = { ...clean,
    fr: [...clean.fr, { _k: 2, stmt: 'Does Y', fit: '', pri: 'Must', comp: 'Core' }],
    nfr: [{ _k: 1, stmt: 'Encrypted at rest', fit: '', pri: 'Must', comp: 'Core' }] };
  const s = get(healthSignals(a, {}), 'must_no_fit');
  assert.equal(s.level, 'gap');
  assert.equal(s.count, 2);
});

test('a Should without a fit criterion is not the Must signal', () => {
  const a = { ...clean, nfr: [{ _k: 1, stmt: 'Nice to have', fit: '', pri: 'Should', comp: 'Core' }] };
  assert.equal(get(healthSignals(a, {}), 'must_no_fit'), undefined);
});

test('priority defaults to Must, so an unprioritized statement without a fit still gates', () => {
  const a = { ...clean, fr: [{ _k: 1, stmt: 'Does X', fit: '', comp: 'Core' }] };
  assert.equal(get(healthSignals(a, {}), 'must_no_fit').count, 1);
});

test('AI declared with no evaluation criteria is a gap; criteria without a golden set is a warning', () => {
  const noEvals = { ...clean, has_ai: 'Yes', eval: [] };
  assert.equal(get(healthSignals(noEvals, {}), 'ai_no_evals').level, 'gap');
  const noGolden = { ...clean, has_ai: 'Yes', eval: [{ _k: 1, dim: 'Grounding', metric: 'm', thresh: '95%' }], golden: '' };
  assert.equal(get(healthSignals(noGolden, {}), 'ai_no_golden').level, 'warn');
  assert.equal(get(healthSignals(noGolden, {}), 'ai_no_evals'), undefined);
});

test('vulnerable users declared with no safeguarding response is a gap', () => {
  const a = { ...clean, vulnerable: 'Yes', safeguard: '' };
  assert.equal(get(healthSignals(a, {}), 'vulnerable_no_safeguard').level, 'gap');
  assert.equal(get(healthSignals({ ...a, safeguard: 'Support resource shown; clinical review.' }, {}), 'vulnerable_no_safeguard'), undefined);
});

test('untagged requirements signal only once components exist', () => {
  const untagged = { ...clean, fr: [{ _k: 1, stmt: 'Does X', fit: 'ok', pri: 'Must', comp: '' }] };
  assert.equal(get(healthSignals(untagged, {}), 'req_untagged').count, 1);
  const noComps = { ...untagged, components: [] };
  assert.equal(get(healthSignals(noComps, {}), 'req_untagged'), undefined);
});

test('a component without an owner warns; an empty out-of-scope list warns', () => {
  const a = { ...clean, components: [{ _k: 1, name: 'Core', owner: '' }], sol_out: [] };
  const sigs = healthSignals(a, {});
  assert.equal(get(sigs, 'comp_no_owner').count, 1);
  assert.equal(get(sigs, 'no_out_of_scope').level, 'warn');
});

test('gaps sort ahead of warnings', () => {
  const a = { ...clean, sol_out: [], fr: [{ _k: 1, stmt: 'X', fit: '', pri: 'Must', comp: 'Core' }] };
  const ks = keys(healthSignals(a, {}));
  assert.ok(ks.indexOf('must_no_fit') < ks.indexOf('no_out_of_scope'), ks.join(','));
});

test('an approved latest version with no live brief warns; a published brief clears it; revoked does not', () => {
  const versions = [{ seq: 1, label: '1.0', status: 'approved' }];
  assert.equal(get(healthSignals(clean, { versions, shares: [] }), 'approved_no_brief').level, 'warn');
  const live = [{ kind: 'brief', version_seq: 1, revoked: false }];
  assert.equal(get(healthSignals(clean, { versions, shares: live }), 'approved_no_brief'), undefined);
  const revoked = [{ kind: 'brief', version_seq: 1, revoked: true }];
  assert.equal(get(healthSignals(clean, { versions, shares: revoked }), 'approved_no_brief').level, 'warn');
});

test('the brief warning tracks the LATEST version, not any approved one', () => {
  const versions = [{ seq: 1, label: '1.0', status: 'approved' }, { seq: 2, label: '1.1', status: 'draft' }];
  assert.equal(get(healthSignals(clean, { versions, shares: [] }), 'approved_no_brief'), undefined);
});

test('countToConfirm scans scalars, list items, and row cells, case-insensitively, skipping _k', () => {
  const a = { golden: 'To Confirm', ov_goals: ['fine', 'to confirm later'], fr: [{ _k: 1, stmt: 'ok', fit: 'to confirm' }] };
  assert.equal(countToConfirm(a), 3);
  assert.equal(get(healthSignals({ ...clean, golden: 'to confirm' }, {}), 'to_confirm').count, 1);
});

test('an engagement skips the software signals and warns on an empty decision log', () => {
  const eng = { ctrl_type: ENGAGEMENT, sol_out: ['x'], components: [{ _k: 1, name: 'WS1', owner: 'Jo' }], decisions: [] };
  const sigs = healthSignals(eng, {});
  assert.equal(get(sigs, 'must_no_fit'), undefined);
  assert.equal(get(sigs, 'eng_no_decisions').level, 'warn');
  assert.equal(get(healthSignals({ ...eng, decisions: [{ _k: 1, decision: 'Chose A', owner: 'Jo' }] }, {}), 'eng_no_decisions'), undefined);
});

test('recordCounts tallies versions, sign-offs, promotions, external input, and open threads', () => {
  const ctx = {
    versions: [{ seq: 1, status: 'approved' }, { seq: 2, status: 'draft' }],
    approvalsByVersion: { a: [{ status: 'approved' }, { status: 'pending' }], b: [{ status: 'approved' }] },
    comms: [
      { origin: 'sme', status: 'new', promoted_to: 'FR-002' },
      { origin: 'partner', status: 'closed' },
      { origin: 'team', status: 'in_review' }
    ],
    discovery: [{ promoted_to: 'DEC-001' }, { promoted_to: '' }]
  };
  const c = recordCounts(clean, ctx);
  assert.equal(c.versions, 2);
  assert.equal(c.approvedVersions, 1);
  assert.equal(c.signoffs, 2);
  assert.equal(c.external, 2);          // sme + partner; team is internal
  assert.equal(c.promoted, 2);          // one comm + one discovery entry
  assert.equal(c.openThreads, 2);       // new + in_review
  assert.equal(c.discovery, 2);
  assert.equal(c.requirements, 2);      // 1 fr + 1 nfr in the clean record
});

test('empty context contributes nothing and never throws', () => {
  const c = recordCounts({}, {});
  assert.equal(c.versions + c.signoffs + c.promoted + c.external + c.openThreads, 0);
  assert.deepEqual(keys(healthSignals({}, {})).includes('no_out_of_scope'), true);
});

/* ---- accumulation facts: derived only from the approved baseline ---- */
test('incorporated counts promotion-sourced rows in the latest approved snapshot only', () => {
  const ctx = {
    versions: [{ seq: 1, status: 'approved', created_at: '2026-07-01T00:00:00Z' }],
    latestApprovedAnswers: {
      fr: [{ _k: 1, stmt: 'From client', src: 'Discovery · Jane' }, { _k: 2, stmt: 'In-house' }],
      nfr: [{ _k: 1, stmt: 'Promoted too', src: 'Inbox · SME' }]
    }
  };
  assert.equal(recordCounts({}, ctx).incorporated, 2);
  // No snapshot loaded → stays quiet at zero, never guessed from the draft.
  assert.equal(recordCounts({ fr: [{ _k: 9, stmt: 'Draft only', src: 'Discovery · X' }] }, { versions: [] }).incorporated, 0);
});

test('lastClientVisible is the latest approved baseline date, absent when nothing is approved', () => {
  const c = recordCounts({}, { versions: [
    { seq: 1, status: 'approved', created_at: '2026-06-01T00:00:00Z' },
    { seq: 2, status: 'draft', created_at: '2026-07-10T00:00:00Z' },
    { seq: 3, status: 'approved', created_at: '2026-07-05T00:00:00Z' }
  ] });
  assert.equal(c.lastClientVisible, '2026-07-05T00:00:00Z');
  assert.equal(recordCounts({}, { versions: [{ seq: 1, status: 'draft', created_at: '2026-07-01T00:00:00Z' }] }).lastClientVisible, '');
});

test('a project lands on Health once a baseline exists, on the document before one does', () => {
  assert.equal(landingTab([]), 'document');
  assert.equal(landingTab(null), 'document');
  assert.equal(landingTab([{ seq: 1 }]), 'health');
});

test('incorporatedRows names the promotion-sourced rows by permanent id', () => {
  const rows = incorporatedRows({
    fr: [{ _k: 12, stmt: 'x', src: 'Inbox · Dana' }, { _k: 2, stmt: 'y' }],
    nfr: [{ _k: 2, stmt: 'z', src: 'Discovery · Lee' }],
    eval: [], interfaces: []
  });
  assert.deepEqual(rows, [{ id: 'FR-012', src: 'Inbox · Dana' }, { id: 'NFR-002', src: 'Discovery · Lee' }]);
  assert.deepEqual(incorporatedRows(null), []);
});

test('a version in review with zero named approvers is a gap; slots clear it', () => {
  const versions = [{ id: 'v1', seq: 1, status: 'in_review', created_at: '2026-07-01T00:00:00Z' }];
  const bare = healthSignals({}, { versions, approvalsByVersion: {} });
  assert.ok(bare.some((s) => s.key === 'review_no_approvers' && s.level === 'gap'));
  const named = healthSignals({}, { versions, approvalsByVersion: { v1: [{ status: 'pending' }] } });
  assert.ok(!named.some((s) => s.key === 'review_no_approvers'));
});

test('an approved version with zero sign-off slots warns; drafts never trip it', () => {
  const sigs = healthSignals({}, { versions: [
    { id: 'v1', seq: 1, status: 'approved', created_at: '2026-07-01T00:00:00Z' },
    { id: 'v2', seq: 2, status: 'draft', created_at: '2026-07-02T00:00:00Z' }
  ], approvalsByVersion: {} });
  const hit = sigs.find((s) => s.key === 'approved_no_signoff');
  assert.ok(hit && hit.level === 'warn' && hit.count === 1);
});

test('healthStateLine counts signals per level - the one convention on every surface', () => {
  assert.equal(healthStateLine([]), '0 gaps · 0 warnings');
  assert.equal(healthStateLine([{ level: 'gap', count: 1 }, { level: 'warn', count: 7 }]), '1 gap · 1 warning', 'multiplicity stays on the row as ×N, not in the line');
  assert.equal(healthStateLine([{ level: 'warn', count: 2 }, { level: 'warn', count: 1 }]), '0 gaps · 2 warnings');
});

test('the topbar pill never calls a warning a gap', () => {
  assert.equal(healthPillLabel([]), '');
  assert.equal(healthPillLabel([{ level: 'warn', count: 7 }, { level: 'warn', count: 1 }]), '2 warnings');
  assert.equal(healthPillLabel([{ level: 'gap', count: 3 }, { level: 'warn', count: 1 }]), '1 gap', 'gaps outrank warnings');
});

test('version-scoped signals name their versions, and recording a sign-off clears the warning', () => {
  const ctx = { versions: [
    { id: 'v1', seq: 1, label: '1.0', status: 'approved', created_at: '2026-07-01T00:00:00Z' },
    { id: 'v2', seq: 2, label: '1.1', status: 'draft', created_at: '2026-07-02T00:00:00Z' }
  ], approvalsByVersion: { v2: [{ status: 'approved', approver_name: 'Micah Canfield' }] } };
  const sigs = healthSignals({ ctrl_product: 'P' }, ctx);
  const hit = sigs.find((s) => s.key === 'approved_no_signoff');
  assert.ok(hit, 'v1.0 is approved with zero slots - the warning fires');
  assert.ok(hit.label.includes('v1.0'), 'the signal names the version it is about');
  assert.ok(!hit.label.includes('v1.1'), 'a sign-off on the draft is not the issue and is not named');
  const fixed = healthSignals({ ctrl_product: 'P' },
    { ...ctx, approvalsByVersion: { ...ctx.approvalsByVersion, v1: [{ status: 'approved', approver_name: 'Tim', approver_role: 'Sponsor' }] } });
  assert.ok(!fixed.find((s) => s.key === 'approved_no_signoff'), 'it clears the moment the sign-off lands on v1.0');
});

console.log('\nhealth.test: ' + n + '/' + n + ' passed');
