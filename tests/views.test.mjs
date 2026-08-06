/* ReqPub v2 - view render tests (node tests/views.test.mjs)
   Views are pure string builders, so their contracts pin in Node with no DOM.
   These lock the 2.19 surfaces and the one-click-one-project guard: while a
   create is in flight the view must render the button dead, because the
   handler's re-entry flag only helps if the second click has nothing live to
   land on (the 2026-07-13 duplicate-project incident). */
import assert from 'node:assert/strict';
import { viewProjects, roleWelcome, intakeZone, overlays } from '../app/js/views-app.js';
import { renderTab } from '../app/js/views-collab.js';
import { assembleAnswers, ENGAGEMENT } from '../app/js/domain.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const dashBase = () => ({
  view: 'projects', role: 'manager', org: 'Collection Ventures', user: { id: 'u1' },
  projects: [{ id: 'p1', name: 'ReqPub', updated_at: new Date().toISOString() }],
  projectStats: { p1: { unread: 0, open: 1, newExt: 0, latest: { seq: 1, label: '1.0', status: 'approved' } } },
  myApprovals: []
});

test('the dashboard renders the Start-from picker with all four starters and the selected description', () => {
  const html = viewProjects({ ...dashBase(), newTpl: 'baseline' });
  for (const s of ['Start from', 'Blank', 'Product requirements', 'Consulting engagement', 'Baseline assessment']) {
    assert.ok(html.includes(s), 'missing: ' + s);
  }
  assert.ok(html.includes('Section 9 unlocked'), 'the selected template describes itself');
});

test('the typed project name survives a template re-render', () => {
  const html = viewProjects({ ...dashBase(), newTpl: 'product', newName: 'Vora' });
  assert.ok(html.includes('value="Vora"'));
});

test('while a create is in flight, the name field and button are dead and the button reads Creating…', () => {
  const html = viewProjects({ ...dashBase(), creating: true, newName: 'Vora' });
  assert.ok(html.includes('Creating…'), 'busy label');
  assert.ok(/id="newName"[^>]*disabled/.test(html), 'input disabled');
  assert.ok(/data-action="new"[^>]*disabled/.test(html), 'button disabled');
  assert.ok(html.includes('pointer-events:none'), 'button refuses the second click');
  const idle = viewProjects(dashBase());
  assert.ok(!idle.includes('Creating…') && !/data-action="new"[^>]*disabled/.test(idle), 'idle state unchanged');
});

/* Shared workspace fixture: one gap of each family, one promotable entry. */
const a = assembleAnswers(
  { has_ai: { value: 'Yes', rev: 1 } },
  {
    fr: [{ id: 'r1', k: 1, data: { stmt: 'Does X', fit: '', pri: 'Must', comp: '' }, pos: 1, rev: 1 }],
    components: [{ id: 'c1', k: 1, data: { name: 'Core', owner: '' }, pos: 1, rev: 1 }]
  });
const wsBase = () => ({
  role: 'manager', user: { id: 'u1' }, docTab: 'health',
  versions: [{ id: 'v1', seq: 1, label: '1.0', status: 'approved', created_at: new Date().toISOString(), note: '+1 requirement · FR-001 from Discovery · Jane' }],
  approvals: { v1: [{ status: 'approved', approver_role: 'Owner' }] }, shares: [],
  comms: [{ id: 'x', origin: 'sme', status: 'new', promoted_to: 'FR-001' }],
  discovery: [{ id: 'd1', takeaway: 'Spanish flow', notes: 'Heard it', who: 'Jane', created_at: new Date().toISOString(), promoted_to: '' }],
  openDisc: { d1: true }, reads: {}, msgs: {}, attachments: [], members: [], fingers: { v1: 'a'.repeat(64) }
});

test('the Health tab renders gaps, warnings, and the record counts', () => {
  const html = renderTab(wsBase(), a);
  for (const s of ['Record health', 'without a fit criterion', 'no evaluation criteria', 'without an owner', 'What this record holds', 'Named sign-offs']) {
    assert.ok(html.includes(s), 'missing: ' + s);
  }
});

test('discovery offers both promotions on a PRD', () => {
  const APP = wsBase(); APP.docTab = 'discovery';
  const html = renderTab(APP, a);
  assert.ok(html.includes('To requirement') && html.includes('To decision'));
});

test('an engagement hides To requirement and keeps To decision', () => {
  const APP = wsBase(); APP.docTab = 'discovery';
  const html = renderTab(APP, { ...a, ctrl_type: ENGAGEMENT });
  assert.ok(!html.includes('To requirement'));
  assert.ok(html.includes('To decision'));
});

test('a promoted entry shows its back-link pill and the promote buttons retire', () => {
  const APP = wsBase(); APP.docTab = 'discovery';
  APP.discovery[0].promoted_to = 'FR-002';
  const html = renderTab(APP, a);
  assert.ok(html.includes('Promoted to FR-002'));
  assert.ok(!html.includes('To decision'));
});

test('a version row carries the fingerprint chip and the attributed change note', () => {
  const APP = wsBase(); APP.docTab = 'versions';
  const html = renderTab(APP, a);
  assert.ok(html.includes('sha256:aaaa aaaa'), 'computed fingerprint renders truncated');
  assert.ok(html.includes('FR-001 from Discovery · Jane'), 'attribution renders on the note');
  assert.ok(html.includes('data-action="vfinger"'));
});

test('the empty dashboard speaks to the role in front of it', () => {
  assert.ok(roleWelcome('viewer').includes('you keep them honest'));
  assert.ok(roleWelcome('manager').includes('defends itself under review'));
  assert.notEqual(roleWelcome('viewer'), roleWelcome('manager'));
});

test('the intake preview button arms as the primary action the moment there is anything to map', () => {
  const base = { pid: 'p1', role: 'manager', viewSeq: null, answers: {}, versions: [] };
  const idle = intakeZone({ ...base, intake: { open: true, text: '', files: [], plan: null } });
  assert.ok(idle.includes('btn-sec btn-sm" data-action="intakepreview">Preview mapping<'), 'idle stays secondary');
  const armed = intakeZone({ ...base, intake: { open: true, text: '', files: [{ name: 'prd.pdf', text: 'x' }], plan: null } });
  assert.ok(armed.includes('btn-primary btn-sm" data-action="intakepreview">Preview mapping before applying<'), 'files arm the button');
  const pasted = intakeZone({ ...base, intake: { open: true, text: '# Goals', files: [], plan: null } });
  assert.ok(pasted.includes('Preview mapping before applying'), 'pasted text arms it too');
});

test('the creation row offers Documents, firm templates with their reviewed date, and a clone picker', () => {
  const html = viewProjects({ ...dashBase(), newTpl: 'documents',
    recordTemplates: [{ id: 't1', name: 'Standard engagement', reviewed_at: '2026-07-01T00:00:00Z' }],
    projects: [{ id: 'p1', name: 'RecordMade', archived: false, updated_at: '2026-07-10T00:00:00Z' }] });
  assert.ok(html.includes('>Documents<'), 'the Documents chip renders');
  assert.ok(html.includes('Standard engagement'), 'the firm template chip renders');
  assert.ok(html.includes('Reviewed'), 'the reviewed date travels on the chip');
  assert.ok(html.includes('Clone a record'), 'the clone picker renders');
  assert.ok(html.includes('straight into Populate from documents'), 'the documents hint explains the path');
});

test('the paste overlay previews the parsed rows and arms the add button', () => {
  const html = overlays({ pasteQ: { qid: 'fr', text: 'x', preview: [
    { stmt: 'FR-1: Sync nightly.' }, { stmt: 'FR-2: Log access.' }] } });
  assert.ok(html.includes('<b>2 rows</b> parsed'), 'the count is stated');
  assert.ok(html.includes('FR-1: Sync nightly.'), 'the first row previews');
  assert.ok(html.includes('Add 2 rows'), 'the apply button carries the count');
});

console.log('\nviews.test: ' + n + '/' + n + ' passed');
