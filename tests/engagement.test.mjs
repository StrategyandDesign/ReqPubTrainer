/* ReqPub v2 - engagement-mode tests (node tests/engagement.test.mjs)
   One worksheet, two document types. These tests prove (a) a consulting
   engagement assembles as a clean, contiguously numbered charter from the
   shared fields, (b) the software-only sections are gated off in engagement
   mode, and (c) the requirements (PRD) path is byte-for-byte unchanged, so
   every existing project - none of which carries ctrl_type - is untouched. */
import assert from 'node:assert/strict';
import {
  SECTIONS, ENGAGEMENT, isEngagement, assembleAnswers, buildSections, assemble,
  mdToHtml, docSecNum, docSecTitle
} from '../app/js/domain.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const base = (extra = {}, rows = {}) => assembleAnswers(
  {
    ctrl_product: { value: 'Northwind Migration' }, ctrl_org: { value: 'Collection Ventures' },
    ov_vision: { value: 'Stand up the new platform' }, ov_problem: { value: 'The legacy system is failing' },
    ov_market: { value: 'Enterprise field services' }, sol_solution: { value: 'A phased migration' },
    link_repo: { value: 'github.com/cv/nw' }, ...extra
  },
  {
    ov_goals: [{ id: 'g', k: 1, data: { text: 'Cut cost 30%' }, pos: 1, rev: 1 }],
    metrics: [{ id: 'm', k: 1, data: { metric: 'Uptime', target: '99.9%', method: 'Monitoring' }, pos: 1, rev: 1 }],
    sol_in: [{ id: 'i', k: 1, data: { text: 'Data migration' }, pos: 1, rev: 1 }],
    sol_out: [{ id: 'o', k: 1, data: { text: 'Hardware procurement' }, pos: 1, rev: 1 }],
    components: [{ id: 'c', k: 1, data: { name: 'Discovery', owner: 'Ana', status: 'Active', desc: 'Audit the estate' }, pos: 1, rev: 1 }],
    people: [{ id: 'p', k: 1, data: { name: 'Ana Reyes', role: 'Engagement lead' }, pos: 1, rev: 1 }],
    assume: [{ id: 'a', k: 1, data: { text: 'Client grants system access' }, pos: 1, rev: 1 }],
    depend: [{ id: 'd', k: 1, data: { text: 'Client SME availability' }, pos: 1, rev: 1 }],
    constrain: [{ id: 'x', k: 1, data: { text: 'Q3 deadline' }, pos: 1, rev: 1 }],
    decisions: [{ id: 'dec', k: 1, data: { decision: 'Use Postgres', options: 'Postgres vs Dynamo', rationale: 'Relational fit', owner: 'Tim', date: '2026-07' }, pos: 1, rev: 1 }],
    glossary: [{ id: 'gl', k: 1, data: { term: 'ETL', def: 'Extract, transform, load' }, pos: 1, rev: 1 }],
    // A functional requirement is present but must never surface in a charter.
    fr: [{ id: 'r', k: 1, data: { stmt: 'SOFTWARE ONLY requirement', fit: 'SECRET FIT' }, pos: 1, rev: 1 }],
    ...rows
  }
);

const engAnswers = base({ ctrl_type: { value: ENGAGEMENT } });
const versions = [{ seq: 1, label: '1.0', created_at: new Date().toISOString(), author_name: 'Micah', note: 'Initial baseline' }];
const engDoc = assemble(buildSections(engAnswers, '1.0', versions), engAnswers);

/* ---- the toggle ---- */
test('isEngagement is true only for the engagement document type', () => {
  assert.equal(isEngagement(engAnswers), true);
  assert.equal(isEngagement(base()), false);                                  // ctrl_type unset (every existing project)
  assert.equal(isEngagement(base({ ctrl_type: { value: 'Product or project requirements' } })), false);
});

/* ---- the charter assembles cleanly ---- */
test('engagement assembles a contiguous 1..8 charter, not a PRD', () => {
  assert.ok(engDoc.startsWith('# Northwind Migration'));
  ['## 1. Objective and Context', '## 2. Success Metrics', '## 3. Scope and Approach',
   '## 4. Assumptions, Dependencies, and Constraints', '## 5. Stakeholders and Roles',
   '## 6. Decisions and Rationale', '## 7. Glossary', '## 8. Revision History'
  ].forEach((h) => assert.ok(engDoc.includes(h), 'missing ' + h));
  // The PRD scaffolding is absent.
  ['## Part I', '## Part II', 'Functional Requirements', 'Appendix A', 'Appendix B', '## 9.'
  ].forEach((s) => assert.ok(!engDoc.includes(s), 'should not contain ' + s));
});

test('the charter reuses the shared fields', () => {
  ['Stand up the new platform', 'Cut cost 30%', 'Data migration', 'Hardware procurement',
   'Discovery', 'Ana Reyes', 'Client grants system access', 'Q3 deadline',
   'Use Postgres', 'ETL', 'Micah'
  ].forEach((v) => assert.ok(engDoc.includes(v), 'missing ' + v));
  assert.ok(engDoc.includes('| Workstream | Owner | Status | Description |')); // components reframed as workstreams
});

test('software-only content never leaks into a charter', () => {
  assert.ok(!engDoc.includes('SOFTWARE ONLY requirement'));
  assert.ok(!engDoc.includes('SECRET FIT'));
  assert.ok(!engDoc.includes('Fit Criterion'));
});

test('an almost-empty engagement still assembles with placeholders, no throw', () => {
  const thin = assembleAnswers({ ctrl_product: { value: 'Scoping' }, ctrl_type: { value: ENGAGEMENT } }, {});
  const md = assemble(buildSections(thin, null, []), thin);
  assert.ok(md.startsWith('# Scoping'));
  assert.ok(md.includes('## 6. Decisions and Rationale') && md.includes('No decisions recorded yet'));
  assert.ok(md.includes('## 8. Revision History') && md.includes('working draft'));
});

/* ---- the requirements path is untouched ---- */
test('PRD output is identical whether ctrl_type is unset or set to requirements', () => {
  const unset = base();
  const reqd = base({ ctrl_type: { value: 'Product or project requirements' } });
  const a = assemble(buildSections(unset, '1.0', versions), unset);
  const b = assemble(buildSections(reqd, '1.0', versions), reqd);
  assert.equal(a, b);                                   // the toggle's default changes nothing
  assert.ok(a.includes('## Part I: Product Definition'));
  assert.ok(a.includes('## 7. Functional Requirements') && a.includes('SOFTWARE ONLY requirement'));
});

/* ---- worksheet section gating ---- */
test('engagement hides the software sections and keeps the engagement set', () => {
  const vis = (a) => SECTIONS.filter((s) => !s.cond || s.cond(a)).map((s) => s.key);
  const eng = vis(engAnswers);
  ['method', 'functional', 'nonfunctional', 'aieval', 'interfaces', 'verification', 'traceability', 'users', 'data']
    .forEach((k) => assert.ok(!eng.includes(k), 'engagement should hide ' + k));
  ['control', 'overview', 'solution', 'metrics', 'adc', 'people', 'glossary', 'decisions', 'revision']
    .forEach((k) => assert.ok(eng.includes(k), 'engagement should show ' + k));
  // Requirements mode (has AI) still shows everything it did before.
  const prd = vis(base({ has_ai: { value: 'Yes' } }));
  ['functional', 'nonfunctional', 'aieval', 'users', 'data'].forEach((k) => assert.ok(prd.includes(k)));
});

/* ---- mode-aware numbering + titles ---- */
test('docSecNum renumbers for engagement but leaves the PRD fixed', () => {
  assert.equal(docSecNum(engAnswers, 'overview'), 1);
  assert.equal(docSecNum(engAnswers, 'solution'), 3);
  assert.equal(docSecNum(engAnswers, 'people'), 5);
  assert.equal(docSecNum(engAnswers, 'revision'), 8);
  assert.equal(docSecNum({}, 'functional'), 7);           // PRD unchanged
  assert.equal(docSecNum({}, 'revision'), 17);
});

test('docSecTitle reframes shared sections in engagement mode', () => {
  assert.equal(docSecTitle(engAnswers, 'solution'), 'Scope and Approach');
  assert.equal(docSecTitle(engAnswers, 'people'), 'Stakeholders and Roles');
  assert.equal(docSecTitle({}, 'solution'), 'Solution Overview');   // PRD unchanged
});

/* ---- anchors resolve so jump-to-section works in both modes ---- */
test('engagement headings anchor to their worksheet section, PRD anchors unchanged', () => {
  const html = mdToHtml(engDoc);
  assert.ok(html.includes('id="docsec-overview"'));      // ## 1 Objective and Context
  assert.ok(html.includes('id="docsec-solution"'));      // ## 3 Scope and Approach
  assert.ok(html.includes('id="docsec-people"'));        // ## 5 Stakeholders and Roles
  assert.ok(html.includes('id="docsec-decisions"'));     // ## 6 Decisions and Rationale
  // The PRD still maps its numbered headings by number.
  const prdHtml = mdToHtml('## 7. Functional Requirements\n\ntext');
  assert.ok(prdHtml.includes('id="docsec-functional"'));
});

/* ---- AI acceptance enters the charter exactly when declared ---- */
const aiAnswers = base(
  { ctrl_type: { value: ENGAGEMENT }, has_ai: { value: 'Yes' }, golden: { value: 'Labeled set of 500 transcripts; monthly red-team pass.' } },
  { eval: [{ id: 'e', k: 1, data: { dim: 'Hallucination guardrail', metric: 'Grounded-answer rate vs golden set', thresh: 'at least 95%', comp: 'Discovery' }, pos: 1, rev: 1 }] }
);
const aiDoc = assemble(buildSections(aiAnswers, '1.0', versions), aiAnswers);

test('declaring AI renumbers the charter contiguously 1..9 with acceptance as section 3', () => {
  ['## 1. Objective and Context', '## 2. Success Metrics', '## 3. AI Acceptance Criteria',
   '## 4. Scope and Approach', '## 5. Assumptions, Dependencies, and Constraints',
   '## 6. Stakeholders and Roles', '## 7. Decisions and Rationale', '## 8. Glossary',
   '## 9. Revision History'
  ].forEach((h) => assert.ok(aiDoc.includes(h), 'missing ' + h));
  assert.ok(!aiDoc.includes('## 3. Scope'), 'scope moved below acceptance');
});

test('the signed number is on the charter; the FR fit doctrine still holds', () => {
  assert.ok(aiDoc.includes('EVAL-001'));
  assert.ok(aiDoc.includes('at least 95%'));
  assert.ok(aiDoc.includes('Golden dataset and red-team method.'));
  assert.ok(!aiDoc.includes('SECRET FIT'));
  assert.ok(!aiDoc.includes('## Part I'));
});

test('subsection numbering follows the shifted layout', () => {
  assert.ok(aiDoc.includes('### 4.1 Approach'));
  assert.ok(aiDoc.includes('### 6.2 Links'));
});

test('docSecNum and docSecTitle track the dynamic layout in both shapes', () => {
  assert.equal(docSecNum(aiAnswers, 'aieval'), 3);
  assert.equal(docSecNum(aiAnswers, 'solution'), 4);
  assert.equal(docSecNum(aiAnswers, 'revision'), 9);
  assert.equal(docSecTitle(aiAnswers, 'aieval'), 'AI Acceptance Criteria');
  assert.equal(docSecNum(engAnswers, 'aieval'), null);
  assert.equal(docSecNum(engAnswers, 'solution'), 3);
});

test('a PRD that declares AI is untouched: Section 9 stays AI Evaluation Criteria', () => {
  const prd = base({ has_ai: { value: 'Yes' } }, { eval: [{ id: 'e', k: 1, data: { dim: 'Guardrail', metric: 'Rate', thresh: '95%' }, pos: 1, rev: 1 }] });
  const prdDoc = assemble(buildSections(prd, '1.0', versions), prd);
  assert.ok(prdDoc.includes('## 9. AI Evaluation Criteria'));
  assert.ok(prdDoc.includes('## Part II'));
  assert.equal(docSecNum(prd, 'aieval'), 9);
});

/* ---- the gate plan enters the charter exactly when planned ---- */
const gateRows = { gates: [{ id: 'gt', k: 1, data: { gate: 'Requirements Baseline', criteria: 'Every Must has a fit criterion', decider: 'Sponsor', target: 'Q3' }, pos: 1, rev: 1 }] };
const gatedAnswers = base({ ctrl_type: { value: ENGAGEMENT } }, gateRows);
const gatedDoc = assemble(buildSections(gatedAnswers, '1.0', versions), gatedAnswers);

test('a gate plan renumbers the charter with Gate Plan as section 3', () => {
  ['## 1. Objective and Context', '## 2. Success Metrics', '## 3. Gate Plan', '## 4. Scope and Approach', '## 9. Revision History']
    .forEach((h) => assert.ok(gatedDoc.includes(h), 'missing ' + h));
  assert.ok(gatedDoc.includes('Requirements Baseline'));
  assert.ok(gatedDoc.includes('Sponsor'));
  assert.ok(!engDoc.includes('Gate Plan'), 'a plain engagement charter is untouched');
});

test('gates and AI acceptance stack: plan at 3, the signed numbers at 4, contiguous to 10', () => {
  const both = base(
    { ctrl_type: { value: ENGAGEMENT }, has_ai: { value: 'Yes' } },
    { ...gateRows, eval: [{ id: 'e', k: 1, data: { dim: 'Guardrail', metric: 'Rate', thresh: '95%' }, pos: 1, rev: 1 }] }
  );
  const doc = assemble(buildSections(both, '1.0', versions), both);
  ['## 3. Gate Plan', '## 4. AI Acceptance Criteria', '## 5. Scope and Approach', '## 10. Revision History']
    .forEach((h) => assert.ok(doc.includes(h), 'missing ' + h));
  assert.equal(docSecNum(both, 'gates'), 3);
  assert.equal(docSecNum(both, 'aieval'), 4);
});

/* ---- risks and issues: authored record content, never a rollup ---- */
const riskRows = { risks: [
  { id: 'r1', k: 1, data: { risk: 'Source data access not yet granted', impact: 'Slips the eval window a week', owner: 'Ada Lovelace', status: 'Open' }, pos: 1, rev: 1 },
  { id: 'r2', k: 2, data: { risk: 'Second reviewer unnamed', impact: 'No sign-off path at Gate V', owner: '', status: 'Mitigating' }, pos: 2, rev: 1 },
] };
const riskAnswers = base({ ctrl_type: { value: ENGAGEMENT } }, riskRows);
const riskDoc = assemble(buildSections(riskAnswers, '1.0', versions), riskAnswers);

test('risks render in the charter as an authored table', () => {
  assert.ok(riskDoc.includes('## 3. Risks and Issues'), 'section is numbered into the charter');
  ['Risk or Issue', 'Impact', 'Owner', 'Status'].forEach((h) => assert.ok(riskDoc.includes(h), 'missing column ' + h));
  assert.ok(riskDoc.includes('Source data access not yet granted'));
  assert.ok(riskDoc.includes('Ada Lovelace'));
  assert.ok(!engDoc.includes('Risks and Issues'), 'a charter with no risks is untouched');
});

test('an unowned risk says to confirm rather than inventing an owner', () => {
  assert.ok(riskDoc.includes('to confirm'), 'blank owner falls back to to confirm');
});

test('risks travel in the answers, so they travel in the baseline', () => {
  assert.equal(riskAnswers.risks.length, 2);
  assert.equal(riskAnswers.risks[0].status, 'Open');
});

test('the three optional sections stack contiguously: gates 3, acceptance 4, risks 5', () => {
  const all3 = base(
    { ctrl_type: { value: ENGAGEMENT }, has_ai: { value: 'Yes' } },
    { ...gateRows, ...riskRows, eval: [{ id: 'e', k: 1, data: { dim: 'Guardrail', metric: 'Rate', thresh: '95%' }, pos: 1, rev: 1 }] }
  );
  const doc = assemble(buildSections(all3, '1.0', versions), all3);
  ['## 3. Gate Plan', '## 4. AI Acceptance Criteria', '## 5. Risks and Issues', '## 6. Scope and Approach', '## 11. Revision History']
    .forEach((h) => assert.ok(doc.includes(h), 'missing ' + h));
  assert.equal(docSecNum(all3, 'risks'), 5);
});

test('risks stay out of the PRD path, exactly like the gate plan', () => {
  const prdWithRisks = base({}, riskRows);
  const doc = assemble(buildSections(prdWithRisks, '1.0', versions), prdWithRisks);
  assert.ok(!doc.includes('Risks and Issues'), 'engagement-only, like gates');
});

console.log('\nengagement.test: ' + n + '/' + n + ' passed');
