/* ReqPub v2 - section-scoped share payload tests (node tests/share.test.mjs)
   The section picker is a security boundary: unselected sections must be
   ABSENT from the payload served to anonymous readers, not merely unrendered. */
import assert from 'node:assert/strict';
import { buildSharePayload } from '../app/js/data.js';
import { bBrief, BRIEF_SECTIONS, defaultBriefSections } from '../app/js/domain.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const answers = {
  ctrl_org: 'Collection Ventures', ctrl_product: 'RecordMade',
  ov_vision: 'THE VISION', ov_problem: 'THE PROBLEM', ov_market: 'THE MARKET',
  ov_goals: ['G1', 'G2'],
  persona: [{ _k: 1, persona: 'Operator', needs: 'Speed' }],
  seg: [{ _k: 1, segment: 'Fathers', share: 'High', desc: 'Core' }],
  context: 'USED IN CLINICS',
  sol_solution: 'THE SOLUTION',
  sol_in: ['CAP-A'], sol_out: ['EXCLUDED-Z'],
  components: [{ _k: 1, name: 'Recorder', desc: 'COMPONENT DESC' }],
  fr: [{ _k: 1, stmt: 'Records a session', fit: 'INTERNAL FIT', pri: 'Must', comp: 'Recorder' }],
  metrics: [{ _k: 1, metric: 'Completion', target: '75%', method: 'Analytics' }],
  has_ai: 'Yes',
  eval: [{ _k: 1, dim: 'Hallucination guardrail', metric: 'Grounded-answer rate vs golden set', thresh: 'at least 95%', dataset: 'acceptance-set v1 · 100 cases', comp: 'Recorder' }],
  golden: 'GOLDEN SET METHOD'
};
const project = { name: 'RecordMade' };

test('default selection matches the preselected set', () => {
  const d = defaultBriefSections();
  assert.deepEqual(d, ['building', 'goals', 'who', 'solution', 'willdo', 'oos']);
  assert.equal(BRIEF_SECTIONS.length, 10);
  assert.ok(!d.includes('aieval'), 'AI acceptance is deliberate disclosure, never a default');
});

test('unscoped payload (legacy path) includes every section and says so', () => {
  const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', null);
  assert.equal(p.sections.length, 10);
  assert.equal(p.answers.ov_vision, 'THE VISION');
  assert.equal(p.answers.metrics[0].metric, 'Completion');
});

test('scoped payload physically omits unselected sections', () => {
  const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', ['building', 'oos']);
  const json = JSON.stringify(p);
  assert.ok(json.includes('THE VISION'));
  assert.ok(json.includes('EXCLUDED-Z'));           // oos selected
  assert.ok(!json.includes('Records a session'));   // willdo not selected
  assert.ok(!json.includes('Completion'));          // success not selected
  assert.ok(!json.includes('CAP-A'));               // includes not selected
  assert.ok(!json.includes('Operator'));            // who not selected
  assert.ok(!json.includes('THE SOLUTION'));        // solution not selected
  assert.deepEqual(p.sections, ['building', 'oos']);
});

test('fit criteria and internal fields never appear regardless of selection', () => {
  const all = BRIEF_SECTIONS.map((s) => s.key);
  const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', all);
  const json = JSON.stringify(p);
  assert.ok(!json.includes('INTERNAL FIT'));
  assert.ok(!json.includes('"_k"'));
});

test('requirements grouping keeps component names (names only) when components are unshared', () => {
  const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', ['willdo']);
  assert.equal(p.answers.components[0].name, 'Recorder');
  assert.equal(p.answers.components[0].desc, undefined);
  const md = bBrief(p.answers);
  assert.ok(md.includes('Recorder'));
  assert.ok(md.includes('Records a session'));
  assert.ok(!md.includes('COMPONENT DESC'));
});

test('brief renders exactly what a scoped payload contains', () => {
  const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', ['goals', 'success']);
  const md = bBrief(p.answers);
  assert.ok(md.includes('G1'));
  assert.ok(md.includes('Completion'));
  assert.ok(!md.includes('THE VISION'));
  assert.ok(!md.includes('EXCLUDED-Z'));
});

test('pilot payloads are unaffected by brief scoping', () => {
  const p = buildSharePayload(project, answers, '1.0', 1, 'pilot', '0.9.4', ['building']);
  assert.equal(p.build, '0.9.4');
  assert.equal(p.answers.components[0].name, 'Recorder');
  assert.ok(!JSON.stringify(p).includes('THE VISION'));
});

test('assigned brand logo travels with the brief payload for accountless viewers', () => {
  const branded = { name: 'RecordMade', brand_logo: 'data:image/png;base64,AAAA', brand_label: 'Northwind Field Services' };
  const p = buildSharePayload(branded, answers, '1.0', 1, 'brief', '', ['building']);
  assert.equal(p.logo, 'data:image/png;base64,AAAA');
  assert.equal(p.brandLabel, 'Northwind Field Services');
  // No logo assigned → empty strings, never undefined (stable payload shape).
  const plain = buildSharePayload(project, answers, '1.0', 1, 'brief', '', ['building']);
  assert.equal(plain.logo, '');
  assert.equal(plain.brandLabel, '');
});

test('bBrief renders exactly the published sections even when more data is present', () => {
  // Full answers, but the team published only Goals. Partners/SMEs must see Goals
  // and nothing else, regardless of what other data the answers object holds.
  const md = bBrief(answers, ['goals']);
  assert.ok(md.includes('## Goals') && md.includes('G1'));
  assert.ok(!md.includes('THE VISION'));         // building not selected
  assert.ok(!md.includes('Records a session'));  // willdo not selected
  assert.ok(!md.includes('## Not in scope'));    // oos not selected
});

test('a new registry section is shareable with no change to data.js, and stays hidden until bBrief renders it', () => {
  const before = BRIEF_SECTIONS.length;
  answers.roadmap = ['Q1 launch', 'Q2 scale'];
  BRIEF_SECTIONS.push({ key: 'roadmap', label: 'Roadmap', def: false, fields: ['roadmap'] });
  try {
    // Selecting the new section carries its field in the payload (available to share)…
    const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', ['roadmap']);
    assert.deepEqual(p.answers.roadmap, ['Q1 launch', 'Q2 scale']);
    assert.ok(p.sections.includes('roadmap'));
    // …but bBrief has no block for it yet, so it is not displayed.
    assert.ok(!bBrief(p.answers, p.sections).includes('Q1 launch'));
    // Not selecting it omits the field entirely.
    const p2 = buildSharePayload(project, answers, '1.0', 1, 'brief', '', ['goals']);
    assert.equal(p2.answers.roadmap, undefined);
  } finally {
    BRIEF_SECTIONS.length = before;   // restore the shared registry
    delete answers.roadmap;
  }
});

test('AI acceptance never travels in a default brief', () => {
  const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', defaultBriefSections());
  const json = JSON.stringify(p);
  assert.equal(p.answers.eval, undefined);
  assert.ok(!json.includes('GOLDEN SET METHOD'));
  assert.ok(!json.includes('at least 95%'));
});

test('opting in shares the signed number, shaped: dimension, metric, threshold - nothing else', () => {
  const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', ['aieval']);
  assert.deepEqual(p.answers.eval, [{ dim: 'Hallucination guardrail', metric: 'Grounded-answer rate vs golden set', thresh: 'at least 95%', dataset: 'acceptance-set v1 · 100 cases' }], 'the named eval set travels with the signed number');
  assert.equal(p.answers.golden, 'GOLDEN SET METHOD');
  const json = JSON.stringify(p);
  assert.ok(!json.includes('INTERNAL FIT'), 'FR fit doctrine is absolute');
  assert.ok(!json.includes('"comp"'), 'component tags do not ride along');
  assert.ok(!json.includes('"_k"'));
});

test('the brief renders the acceptance block only when opted in', () => {
  const opted = buildSharePayload(project, answers, '1.0', 1, 'brief', '', ['aieval']);
  const md = bBrief(opted.answers, opted.sections);
  assert.ok(md.includes('## AI acceptance criteria'));
  assert.ok(md.includes('EVAL-001 Hallucination guardrail'));
  assert.ok(md.includes('Threshold at least 95%'));   // the brief states it as a sentence since the copy pass
  assert.ok(md.includes('GOLDEN SET METHOD'));
  const def = buildSharePayload(project, answers, '1.0', 1, 'brief', '', defaultBriefSections());
  assert.ok(!bBrief(def.answers, def.sections).includes('AI acceptance'));
});

/* ---- the walkthrough on the brief ---- */
test('the brief carries the frozen walkthrough, minimal fields only', () => {
  const wt = [{ n: 1, caption: 'Sign in', file_name: 'login.png', attachment_id: 'a-1', extra: 'never' }];
  const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', null, wt);
  assert.equal(p.walkthrough.length, 1);
  assert.deepEqual(Object.keys(p.walkthrough[0]).sort(), ['attachment_id', 'caption', 'file_name', 'n']);
});

test('an empty walkthrough leaves no key on the payload', () => {
  const p = buildSharePayload(project, answers, '1.0', 1, 'brief', '', null, []);
  assert.equal('walkthrough' in p, false);
});

test('the pilot payload never carries a walkthrough', () => {
  const p = buildSharePayload(project, answers, '1.0', 1, 'pilot', '', null, [{ n: 1, attachment_id: 'a-1' }]);
  assert.equal('walkthrough' in p, false);
});

console.log('\nshare.test: ' + n + '/' + n + ' passed');
