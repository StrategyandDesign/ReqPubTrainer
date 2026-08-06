/* ReqPub v2 - weekly update dashboard tests (node tests/update-dashboard.test.mjs)
   The token page renders authored content to a stranger's browser, so every
   value crosses esc/escA before it lands in markup, links published before
   the board existed render exactly as they always did, and the row IDs on
   the update log are permanent - deleting a row never renumbers the rest.
   These are the contracts a recipient's browser depends on. */
import assert from 'node:assert/strict';
import { renderUpdatePage, updateDashboardHTML, UPD_PHASES } from '../app/js/views-external.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const XSS = '<script>alert(1)</script>';
const ATTR = 'V" onmouseover="alert(1)';

const boardOf = (over) => ({
  phase: 'Development',
  phases: UPD_PHASES.slice(),
  okrs: [
    { objective: 'Close faster', kr: 'Five day close', done: 'Done' },
    { objective: 'Close faster', kr: 'One rework cycle', done: 'Open' },
    { objective: 'Steady state', kr: 'Runbook signed off', done: 'Open', phase: 'Manage' },
  ],
  items: [
    { id: 'S01', type: 'Risk', title: 'Scope creep', desc: 'D', action: 'A', owner: 'O', delivery: 'Aug 4', notes: 'watching' },
    { id: 'D01', type: 'Issue', title: 'API slip', desc: 'D', action: 'A', owner: 'O', delivery: 'Aug 11', status: 'Mitigating', notes: '' },
    { id: 'D02', type: 'Risk', title: 'Vendor risk', desc: 'D', action: 'A', owner: 'O', delivery: '', notes: 'n' },
  ],
  ...(over || {}),
});

const gOf = (over) => ({
  ok: true, revoked: false, project: 'Apollo', seq: 3, publishedAt: '2026-07-27T10:00:00Z',
  preparedBy: 'Micah', recipient: { name: 'Dana Fox', email: 'dana@client.com', role: 'Client' },
  payload: { board: boardOf(), strip: null },
  signatures: [], baselines: [],
  ...(over || {}),
});

const appOf = (g) => ({ updatePage: g, updUi: { open: {}, ex: {} }, updNotes: {}, updThread: {}, updDrafts: {}, shareForm: {} });

/* ---- escaping: a hostile author cannot script the recipient's browser ---- */

test('a script payload in every authored field renders inert on the dashboard', () => {
  const g = gOf({
    project: XSS, preparedBy: XSS,
    recipient: { name: XSS, email: 'x@y.z', role: XSS },
    payload: {
      board: boardOf({
        okrs: [{ objective: XSS, kr: XSS, done: 'Open' }],
        items: [{ id: 'D01', type: XSS, title: XSS, desc: XSS, action: XSS, owner: XSS, delivery: XSS, notes: XSS }],
      }),
    },
  });
  const html = updateDashboardHTML(g, { open: {} });
  assert.ok(!html.includes('<script'), 'no script element survives');
  assert.ok(html.includes('&lt;script&gt;'), 'the payload renders as text');
});

test('an attribute-breaking payload in the row id cannot escape its attribute', () => {
  const g = gOf({ payload: { board: boardOf({ items: [{ id: ATTR, type: 'Risk', title: 'T', notes: 'x' }] }) } });
  const html = updateDashboardHTML(g, {});
  assert.ok(html.includes('data-uid="V&quot; onmouseover=&quot;alert(1)"'), 'the attribute holds the payload as entities');
  assert.ok(!html.includes('data-uid="" '), 'the raw quote never terminates the attribute early');
});

test('the same payloads stay inert through the full page render', () => {
  const g = gOf({ payload: { board: boardOf({ items: [{ id: 'D01', type: 'Risk', title: XSS, notes: XSS }] }) } });
  const html = renderUpdatePage(appOf(g));
  assert.ok(!html.includes('<script'));
});

/* ---- the phase tabs render the authored choice ---- */

test('phases before the authored phase are done, the authored one is current, the rest upcoming', () => {
  const html = updateDashboardHTML(gOf(), {});
  const states = [...html.matchAll(/class="updash-tab ([a-z]+)( sel)?"/g)].map((m) => m[1]);
  assert.deepEqual(states, ['done', 'done', 'cur', 'up', 'up', 'up']);
});

test('the phase tabs are views: clickable, in order, current stays marked while another is selected', () => {
  const html = updateDashboardHTML(gOf(), {});
  const names = [...html.matchAll(/data-action="updphase" data-val="([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, UPD_PHASES, 'all six phases are clickable in the fixed order');
  assert.ok(/updash-tab cur sel"/.test(html), 'with no selection the current phase is the selected view');
  const viewing = updateDashboardHTML(gOf(), { vphase: 'Discovery' });
  assert.ok(/updash-tab done sel"[^>]*data-val="Discovery"/.test(viewing), 'the viewed tab carries sel');
  assert.ok(/updash-tab cur"/.test(viewing), 'the current phase keeps its filled marking regardless');
});

test('viewing another phase filters both columns and states the context', () => {
  const disc = updateDashboardHTML(gOf(), { vphase: 'Discovery' });
  assert.ok(disc.includes('S01') && !disc.includes('D01') && !disc.includes('D02'), 'risks filter by the id letter');
  assert.ok(disc.includes('No objectives in Discovery'), 'a blank-phase OKR belongs to the current phase, not here');
  assert.ok(disc.includes('a completed phase'), 'the context line says what you are looking at');
  const man = updateDashboardHTML(gOf(), { vphase: 'Manage' });
  assert.ok(man.includes('Runbook signed off'), 'a future-phase OKR renders under its phase');
  assert.ok(man.includes('anticipates'), 'future rows are named as anticipated');
  assert.ok(man.includes('No risks or issues in Manage'), 'per-phase empty states name the phase');
  const cur = updateDashboardHTML(gOf(), {});
  assert.ok(cur.includes('Five day close') && !cur.includes('Runbook signed off'), 'blank-phase OKRs belong to the current phase only');
  assert.ok(!cur.includes('Viewing <strong>'), 'no context line when viewing the current phase');
});

test('the table carries the sketch header, scoped to the viewed phase', () => {
  const design = updateDashboardHTML(gOf(), { vphase: 'Design' });
  for (const label of ['Update', 'Title', 'Description', 'Action', 'Owner', 'Delivery', 'Status']) {
    assert.ok(new RegExp('updash-head[^>]*><span>' + label + '|<span>' + label + '</span>').test(design), label + ' is in the header row');
  }
  assert.ok(design.includes('D01') && design.includes('D02') && !design.includes('S01'), 'only the viewed phase\u2019s rows render');
  assert.ok(design.includes('Mitigating'), 'an authored status word travels to the link');
  assert.ok(design.includes('updash-tablebox'), 'the table sits in its bounded scroll box');
  const cur = updateDashboardHTML(gOf(), {});
  assert.ok(!cur.includes('S01') && !cur.includes('D01') && cur.includes('No risks or issues in Development'), 'the default view is the current phase, empty stated by name');
});

/* ---- OKRs and the notes expander ---- */

test('a done key result renders checked and struck; an open one does not', () => {
  const html = updateDashboardHTML(gOf(), {});
  assert.ok(/updash-kr done/.test(html), 'the done row carries the done class');
  const openRow = html.split('One rework cycle')[0].split('updash-kr').pop();
  assert.ok(!/ done/.test(openRow.split('"')[0]), 'the open row does not');
});

test('row notes render only when that row is open, with the click-for-notes line under the title', () => {
  const closed = updateDashboardHTML(gOf(), { vphase: 'Discovery', open: {} });
  assert.ok(!closed.includes('watching'), 'notes hidden until the row is clicked');
  assert.ok(closed.includes('Click for notes'), 'a row with notes says so under its title');
  const open = updateDashboardHTML(gOf(), { vphase: 'Discovery', open: { S01: true } });
  assert.ok(open.includes('watching'), 'the clicked row shows its notes');
  assert.ok(open.includes('Hide notes'), 'the open row offers the way back');
  const design = updateDashboardHTML(gOf(), { vphase: 'Design', open: {} });
  assert.ok(design.includes('No notes on this row'), 'the notes-free row says so in its title');
});

/* ---- the recipient line ---- */

test('the recipient line is never hidden: name and role when issued, the read-only state when not', () => {
  const html = updateDashboardHTML(gOf(), {});
  assert.ok(/updash-issued">Issued to <strong>Dana Fox<\/strong>/.test(html), 'their own line, in full weight');
  assert.ok(/pill[^>]*>Client</.test(html), 'the role pill rides the line');
  const nobody = updateDashboardHTML(gOf({ recipient: { name: '', email: '', role: '' } }), {});
  assert.ok(nobody.includes('Issued to <strong>nobody</strong>'), 'a read-only link says so');
  assert.ok(nobody.includes('read-only link'), 'and says what that means');
});

test('no light grey ink anywhere on the board, and a visible build stamp', () => {
  const html = updateDashboardHTML(gOf(), {});
  assert.ok(!html.includes('var(--ink-4)'), 'the lightest grey tier is banned');
  assert.ok(!html.includes('var(--ink-3)'), 'the second-lightest tier is banned too');
  assert.ok(html.includes('eyebrow xd'), 'section labels render in full ink');
  assert.ok(/ReqPub v\d+\.\d+\.\d+/.test(html), 'the footer states which build rendered this page');
});

/* ---- legacy links render exactly as they always did ---- */

test('a payload without a board renders the legacy digest with its comment box and no dashboard', () => {
  const g = gOf({ payload: { strip: { done: 1, total: 2 }, asks: [], moved: [], open: [], closed: [], window: {} } });
  delete g.payload.board;
  const html = renderUpdatePage(appOf(g));
  assert.ok(!html.includes('updash'), 'no dashboard on a pre-board link');
  assert.ok(html.includes('updcommentbox'), 'the single comment box that release shipped is still there');
  assert.ok(html.includes('Send comment'));
});

test('a board payload renders the dashboard, drops the legacy comment box, and appends the digest only when a strip exists', () => {
  const withStrip = gOf({ payload: { board: boardOf(), strip: { done: 1, total: 2 }, asks: [], moved: [], open: [], closed: [], window: {} } });
  const h1 = renderUpdatePage(appOf(withStrip));
  assert.ok(h1.includes('updash'), 'the dashboard renders');
  assert.ok(!h1.includes('updcommentbox'), 'threads replace the comment box on new links');
  assert.ok(h1.includes('Weekly update no.'));
  const noStrip = renderUpdatePage(appOf(gOf()));
  assert.ok(noStrip.includes('updash'));
});

test('a key-era link renders the Key card and folds the rest into one-screen bars', () => {
  const g = gOf({ payload: { board: boardOf(), key: { updates: ['Crew formation shipped', 'Norm recalibration scheduled'], questions: ['Confirm the Aug 8 licensing call'] } } });
  const html = renderUpdatePage(appOf(g));
  assert.ok(html.includes('Key Updates') && html.includes('Key Questions'), 'both authored sections render');
  assert.ok(html.includes('Crew formation shipped') && html.includes('Confirm the Aug 8 licensing call'), 'the authored lines render verbatim');
  assert.ok(!html.includes('Needed from you'), 'no derived digest on a key-era link');
  assert.ok(html.includes('Your notes') && html.includes('Questions and requests'), 'the bars are on screen');
  assert.ok(!html.includes('updnotesbox') && !html.includes('updthreadbody'), 'their bodies stay folded until opened');
});

test('opening a bar expands exactly that section', () => {
  const g = gOf({ payload: { board: boardOf(), key: { updates: [], questions: [] } } });
  const app = appOf(g); app.updUi.ex = { notes: true };
  const html = renderUpdatePage(app);
  assert.ok(html.includes('updnotesbox'), 'the opened section shows its full card');
  assert.ok(!html.includes('updthreadbody'), 'the others stay folded');
  assert.ok(html.includes('Nothing this week.'), 'empty key sections say so instead of vanishing');
});

test('a signature awaiting this recipient opens the bar itself, first, with the primary action', () => {
  const g = gOf({ payload: { board: boardOf(), key: { updates: [], questions: [] } }, signatures: [
    { name: 'Board Chair', role: 'Sponsor', status: 'signed', signedAt: '2026-07-20', signedName: 'B. Chair' },
    { name: 'Dana Fox', role: 'Client', status: 'pending', token: 'sig-tok-1' },
  ] });
  const html = renderUpdatePage(appOf(g));
  assert.ok(html.includes('awaiting your signature'), 'the bar says why it is open');
  assert.ok(html.includes('Sign now'), 'the pending request carries the primary action without a click');
  assert.ok(html.indexOf('Dana Fox') < html.indexOf('Board Chair'), 'pending-for-you sorts first');
  const closed = appOf(g); closed.updUi.ex = { sign: false };
  assert.ok(!renderUpdatePage(closed).includes('Sign now'), 'the recipient can still fold it');
});

test('a key-era link issued to nobody shows no notes or thread bars at all', () => {
  const g = gOf({ recipient: { name: '', email: '', role: '' }, payload: { board: boardOf(), key: { updates: ['x'], questions: [] } } });
  const html = renderUpdatePage(appOf(g));
  assert.ok(!html.includes('Your notes') && !html.includes('Questions and requests'));
  assert.ok(html.includes('Signatures') && html.includes('Baselines'), 'the record bars remain');
});

test('a revoked link is dead regardless of what the payload holds', () => {
  const html = renderUpdatePage(appOf(gOf({ revoked: true })));
  assert.ok(html.includes('withdrawn'));
  assert.ok(!html.includes('updash'));
});

/* ---- permanent ids: deleting a row never renumbers the rest ---- */

test('removing the middle row leaves every other id exactly as allocated', () => {
  const rows = [
    { id: 'r1', data: { _uid: 'D01', type: 'Risk', title: 'One' } },
    { id: 'r2', data: { _uid: 'D02', type: 'Risk', title: 'Two' } },
    { id: 'r3', data: { _uid: 'D03', type: 'Risk', title: 'Three' } },
  ];
  const after = rows.filter((r) => r.id !== 'r2');
  const ids = after.map((r) => r.data._uid);
  assert.deepEqual(ids, ['D01', 'D03'], 'no renumbering, no reuse');
  const html = updateDashboardHTML(gOf({
    payload: { board: boardOf({ items: after.map((r) => ({ id: r.data._uid, type: r.data.type, title: r.data.title })) }) },
  }), { vphase: 'Design' });
  assert.ok(html.includes('D01') && html.includes('D03') && !html.includes('D02'), 'the dashboard shows the surviving ids verbatim');
});

console.log('\nupdate-dashboard.test: ' + n + '/' + n + ' passed');
