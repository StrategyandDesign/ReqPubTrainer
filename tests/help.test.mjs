/* ReqPub v2 - in-app help contracts (node tests/help.test.mjs)
   Stage 1 (beacon, panel, per-user state) and Stage 2 (studio, steps,
   spotlight) as pure render and logic contracts. Every button asserted. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.location = { origin: 'https://reqpub.com', pathname: '/app/' };
const H = await import('../app/js/help.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  \u2713 ' + name); };

const topics = [
  { id: 't1', title: 'Publish a weekly update', body_md: '# How\nCompose, **publish**.', routes: ['workspace'], audience: 'all', is_published: true, sort_order: 1 },
  { id: 't2', title: 'Manager-only draft', body_md: 'wip', routes: ['*'], audience: 'all', is_published: false, sort_order: 2 },
  { id: 't3', title: 'For managers', body_md: 'm', routes: ['*'], audience: 'manager', is_published: true, sort_order: 3 },
  { id: 't4', title: 'Projects screen intro', body_md: 'p', routes: ['projects'], audience: 'all', is_published: true, sort_order: 4 },
];
const steps = [
  { id: 's1', topic_id: 't1', step_order: 1, anchor_key: 'ws.generate', title: 'Generate', body_md: 'Click it.' },
  { id: 's2', topic_id: 't1', step_order: 2, anchor_key: 'doc.updates', title: 'Compose', body_md: 'Then here.' },
];
const appOf = (over) => ({ view: 'workspace', role: 'viewer', helpTopics: topics, helpSteps: steps,
  helpState: {}, helpPrefs: { beacon_hidden: false }, help: { open: false }, ...(over || {}) });

/* ---- Stage 1 gates ---- */
test('visibility: viewers see published, in-route, right-audience topics only', () => {
  const v = H.visibleTopics(topics, 'workspace', 'viewer', {}, false).map((t) => t.id);
  assert.deepEqual(v, ['t1'], 'drafts, other routes, manager-only all excluded');
  const m = H.visibleTopics(topics, 'workspace', 'manager', {}, false).map((t) => t.id);
  assert.deepEqual(m, ['t1', 't2', 't3'], 'managers see drafts and manager topics');
});
test('dismissed topics hide until asked for, and the count is honest', () => {
  const st = { t1: { dismissed: true } };
  assert.deepEqual(H.visibleTopics(topics, 'workspace', 'viewer', st, false), []);
  assert.equal(H.visibleTopics(topics, 'workspace', 'viewer', st, true)[0].id, 't1');
  assert.equal(H.dismissedCount(topics, st), 1);
});
test('the beacon renders everywhere, hides on the pref, and is a dialog trigger', () => {
  const on = H.helpBeaconHTML(appOf());
  assert.ok(on.includes('data-action="helpopen"') && on.includes('aria-haspopup="dialog"'));
  assert.ok(on.includes('data-help-anchor="help.beacon"'));
  assert.equal(H.helpBeaconHTML(appOf({ helpPrefs: { beacon_hidden: true } })), '', 'hidden means gone');
});
test('the panel is a labeled dialog listing this screen\u2019s topics with every control wired', () => {
  const html = H.helpPanelHTML(appOf({ help: { open: true } }));
  assert.ok(/role="dialog"[^>]*aria-modal="true"[^>]*aria-label="Help"/.test(html));
  assert.ok(/help-stamp mono">v\d+\.\d+\.\d+/.test(html), 'the build stamp sits quietly in the footer, still on every screenshot');
  assert.ok(html.includes('help-pt') && html.includes('help-foot'), 'real title header and footer bar, no crowded eyebrow row');
  assert.ok(html.includes('help-scroll'), 'the body lives in one scroll container, never clipped mid-sentence');
  assert.ok(html.includes('Publish a weekly update') && !html.includes('Projects screen intro'));
  for (const act of ['helptopic', 'helpclose', 'helphide']) assert.ok(html.includes('data-action="' + act + '"'), act + ' wired');
  assert.ok(!html.includes('data-action="helpstudio"'), 'non-managers get no studio button');
  assert.ok(H.helpPanelHTML(appOf({ role: 'manager', help: { open: true } })).includes('data-action="helpstudio"'), 'managers do');
});
test('a topic view renders markdown, the dismiss control, and the walkthrough offer only when steps exist', () => {
  const html = H.helpPanelHTML(appOf({ help: { open: true, topic: 't1' } }));
  assert.ok(html.includes('<strong>publish</strong>'), 'markdown renders');
  assert.ok(html.includes('data-action="helpdismiss"') && html.includes('data-action="helpback"'));
  assert.ok(html.includes('data-action="helptour"') && html.includes('2 steps'));
  const noSteps = H.helpPanelHTML(appOf({ role: 'manager', help: { open: true, topic: 't3' } }));
  assert.ok(!noSteps.includes('data-action="helptour"'), 'no steps, no walkthrough button');
});
test('a dismissed topic offers restore instead of dismiss', () => {
  const html = H.helpPanelHTML(appOf({ help: { open: true, topic: 't1' }, helpState: { t1: { dismissed: true } } }));
  assert.ok(html.includes('data-action="helprestore"') && !html.includes('data-action="helpdismiss"'));
});

/* ---- Stage 2 gates ---- */
test('the spotlight card states its step, walks with literal actions, and is a dialog', () => {
  const first = H.helpSpotHTML(appOf({ helpSpot: { topic: 't1', ix: 0 } }));
  assert.ok(first.includes('Step 1 of 2') && first.includes('data-action="helptournext"') && !first.includes('helptourprev'));
  const last = H.helpSpotHTML(appOf({ helpSpot: { topic: 't1', ix: 1 } }));
  assert.ok(last.includes('data-action="helptourdone"') && last.includes('data-action="helptourprev"') && last.includes('data-action="helptourend"'));
  assert.ok(/role="dialog"/.test(first));
});
test('steps round-trip through the one-line-each studio format, capped at five', () => {
  const txt = H.stepsToText(steps);
  assert.equal(txt.split('\n').length, 2);
  const back = H.textToSteps(txt);
  assert.deepEqual(back.map((s) => s.anchor_key), ['ws.generate', 'doc.updates']);
  const seven = H.textToSteps(Array.from({ length: 7 }, (_, i) => 'a | t' + i + ' | b').join('\n'));
  assert.equal(seven.length, 5, 'five steps is the ceiling');
});
test('the studio lists topics with state pills, edits with every control, and previews through the reader\u2019s renderer', () => {
  const app = appOf({ role: 'manager', helpStudioOpen: true, helpEdit: { id: 't1', ...topics[0], stepsText: H.stepsToText(steps) }, helpStats: { topics: [{ topic_id: 't1', views: 7, completes: 3 }] } });
  const html = H.helpStudioHTML(app);
  assert.ok(html.includes('7 · 3'), 'per-topic view and completion counts render on the row');
  for (const act of ['helpnew', 'helpedit', 'helpsave', 'helppub', 'helpdelete', 'helpstudioclose']) assert.ok(html.includes('data-action="' + act + '"'), act + ' wired');
  assert.ok(html.includes('modal-back') && html.includes('modal-card') && html.includes('data-stop="1"'), 'the studio rides the app\u2019s real modal system, so it actually appears');
  assert.ok(html.includes('<strong>publish</strong>'), 'live preview uses the same markdown path');
  assert.ok(html.includes('ws.generate'), 'the anchor registry is listed for authors');
  assert.equal(H.helpStudioHTML(appOf({ helpStudioOpen: false })), '', 'closed renders nothing');
});
test('the spotlight ships a window and a click-catcher, not a plain dim', () => {
  const html = H.helpSpotHTML(appOf({ helpSpot: { topic: 't1', ix: 0 } }));
  assert.ok(html.includes('id="help-window"'), 'the window element exists');
  assert.ok(html.includes('help-dimcatch') && html.includes('data-action="helptourend"'), 'clicking outside ends the tour');
});

test('a found target gets a framed window over its exact rect and the card parks beside it', () => {
  const card = { style: {}, querySelector: () => null, insertAdjacentHTML: () => {} };
  const win = { style: {} };
  const el = {
    getBoundingClientRect: () => ({ top: 100, left: 50, bottom: 130, right: 250, width: 200, height: 30 }),
    scrollIntoView: () => {},
  };
  const doc = {
    getElementById: (id) => (id === 'help-spot' ? card : id === 'help-window' ? win : null),
    querySelector: (sel) => (sel.includes('ws.generate') ? el : null),
    querySelectorAll: () => [],
    defaultView: { innerHeight: 800, innerWidth: 1200 },
  };
  H.positionHelpSpot(appOf({ helpSpot: { topic: 't1', ix: 0 } }), doc);
  assert.equal(win.style.top, '78px'); assert.equal(win.style.left, '28px');
  assert.equal(win.style.width, '244px'); assert.equal(win.style.height, '74px');
  assert.equal(win.style.borderWidth, '2px', 'the frame is on');
  assert.equal(card.style.top, '164px', 'the card sits just under the window');
  const padTop = 100 - parseFloat(win.style.top); const padLeft = 50 - parseFloat(win.style.left);
  const padBottom = (parseFloat(win.style.top) + parseFloat(win.style.height)) - 130; const padRight = (parseFloat(win.style.left) + parseFloat(win.style.width)) - 250;
  assert.ok(padTop === padBottom && padLeft === padRight && padTop === padLeft, 'symmetric padding on all four sides: the target is centered in the window');
});

test('a missing anchor collapses the window to a point: uniform dim, centered card, honest message', () => {
  const calls = [];
  const win = { style: {} };
  const doc = {
    getElementById: (id) => (id === 'help-spot' ? { style: {}, querySelector: () => null, insertAdjacentHTML: (p, h) => calls.push(h) } : id === 'help-window' ? win : null),
    querySelectorAll: () => [],
    querySelector: () => null,
    defaultView: { innerHeight: 800, innerWidth: 1200 },
  };
  H.positionHelpSpot(appOf({ helpSpot: { topic: 't1', ix: 0 } }), doc);
  assert.equal(win.style.width, '0px');
  assert.equal(win.style.borderWidth, '0px', 'no orphan frame');
  assert.ok(calls[0] && calls[0].includes('not on screen right now'), 'same-screen miss says tab or role, never another screen');
  const calls2 = []; const win2 = { style: {} };
  const doc2 = { getElementById: (id) => (id === 'help-spot' ? { style: {}, querySelector: () => null, insertAdjacentHTML: (p, x) => calls2.push(x) } : id === 'help-window' ? win2 : null), querySelectorAll: () => [], querySelector: () => null, defaultView: { innerHeight: 800, innerWidth: 1200 } };
  H.positionHelpSpot(appOf({ view: 'projects', helpSpot: { topic: 't1', ix: 0 } }), doc2);
  assert.ok(calls2[0] && calls2[0].includes('another screen'), 'cross-screen miss still points home');
});


/* ---- Stage 3 addition: the starter library is itself under contract ---- */
const LIB = (await import('../app/js/help-library.js')).HELP_LIBRARY;
test('the starter library is complete, well-formed, and speaks the platform\u2019s language', () => {
  assert.ok(LIB.length >= 22, 'library plus craft tier (' + LIB.length + ' topics)');
  for (const ct of ['fit criterion clinic', 'Priority is a promise', 'Scope it so it can be signed', 'requirement that can be tested', 'why fit criteria exist']) assert.ok(LIB.some((x) => x.title.includes(ct)), 'craft topic present: ' + ct);
  const anchors = new Set(H.HELP_ANCHORS.map((a) => a.key));
  const titles = new Set();
  for (const t of LIB) {
    assert.ok(t.title && t.title.length <= 70, 'titled');
    assert.ok(!titles.has(t.title.toLowerCase()), 'no duplicate titles'); titles.add(t.title.toLowerCase());
    assert.ok(t.body_md && t.body_md.length >= 120, t.title + ' has a real body');
    assert.ok(t.routes.every((r) => H.HELP_ROUTES.includes(r)), t.title + ' routes are known');
    assert.ok(['all', 'manager', 'viewer'].includes(t.audience), t.title + ' audience valid');
    assert.ok(Number.isFinite(t.sort_order), 'ordered');
    assert.ok((t.steps || []).length <= 5, t.title + ' respects the five-step ceiling');
    for (const st of t.steps || []) assert.ok(anchors.has(st.anchor_key), t.title + ' step anchors to the registry: ' + st.anchor_key);
    assert.ok(!t.body_md.includes('\u2014') && !t.body_md.includes('\u2013'), t.title + ' carries no dashes');
    assert.ok(!/(^|[^*])\*[^*\n]+\*(?!\*)/.test(t.body_md), t.title + ' uses no single-asterisk italics: the renderer has none, so they would print raw');
    assert.ok(!/kearney/i.test(t.body_md + t.title), 'no direct partner references');
  }
  const every = LIB.filter((t) => t.routes.includes('*')).length;
  const proj = LIB.filter((t) => t.routes.includes('projects')).length;
  const ws = LIB.filter((t) => t.routes.includes('workspace')).length;
  assert.ok(every >= 3 && proj >= 2 && ws >= 9, 'coverage across every screen: * ' + every + ', projects ' + proj + ', workspace ' + ws);
});
test('the seed plan repairs duplicates and fills gaps, and is idempotent by construction', () => {
  const lib = [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }];
  const existing = [
    { id: 'a1', title: 'Alpha', sort_order: 10 },
    { id: 'a2', title: 'alpha', sort_order: 10 },
    { id: 'b1', title: 'Beta', sort_order: 20 },
    { id: 'b2', title: 'Beta ', sort_order: 20 },
  ];
  const p = H.seedPlan(existing, lib);
  assert.deepEqual(p.toDelete.sort(), ['a2', 'b2'], 'every later duplicate goes, first stays');
  assert.deepEqual(p.toInsert.map((x) => x.title), ['Gamma'], 'only the missing title inserts');
  const after = [{ id: 'a1', title: 'Alpha', sort_order: 10 }, { id: 'b1', title: 'Beta', sort_order: 20 }, { id: 'g1', title: 'Gamma', sort_order: 30 }];
  const p2 = H.seedPlan(after, lib);
  assert.equal(p2.toDelete.length + p2.toInsert.length, 0, 'second run: empty plan');
});

test('the Studio offers the seed action to managers', () => {
  const app = appOf({ role: 'manager', helpStudioOpen: true, helpEdit: null });
  assert.ok(H.helpStudioHTML(app).includes('data-action="helpseed"'));
});


/* ---- The Path: novice-to-power-user, detected from the record ---- */
test('the milestone detectors read the record truthfully across both screens', () => {
  const novice = { view: 'projects', projects: [] };
  assert.equal(H.pathProgress(novice).done, 0, 'a fresh account starts at zero');
  const mid = { view: 'workspace', pid: 'p1',
    fields: Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['q' + i, { value: 'a' }])),
    rows: { fr: [{ id: 'r1', data: { fit: 'A first-time user finds it in under thirty seconds. Test.' } }] },
    versions: [{ seq: 1 }], approvals: {}, shares: [], helpState: {} };
  const pm = H.pathProgress(mid);
  assert.equal(pm.done, 3, 'create, a real fit criterion, baseline');
  const noFit = { ...mid, rows: { fr: [{ id: 'r1', data: { fit: ' ' } }] } };
  assert.equal(H.pathProgress(noFit).done, 2, 'an empty fit line earns nothing: quality, not activity');
  const proj = { view: 'projects', projects: [{ id: 'p' }], projectStats: { p: { latest: { seq: 2 } } },
    approvals: { 1: [{ status: 'approved', approver_name: 'Tim Harris' }] }, shares: [{ id: 's' }], helpState: { t: { completed: true } } };
  const unnamed = { ...proj, approvals: { 1: [{ status: 'approved' }] } };
  assert.equal(H.pathProgress(unnamed).done, 4, 'approval without a name does not count as the sign-off milestone');
  assert.equal(H.pathProgress(proj).done, 5, 'the projects screen detects from stats and org data');
});
test('the Path renders a meter, marks, Show me links into seeded topics, and a complete state', () => {
  const app = appOf({ view: 'workspace', pid: 'p1', versions: [{ seq: 1 }], projects: [{ id: 'p' }], helpTopics: [{ id: 'lib1', title: 'The fit criterion clinic', is_published: true }] });
  const html = H.helpPathHTML(app);
  assert.ok(html.includes('Your path to power user') && /\d of 6/.test(html));
  assert.ok(html.includes('help-path-bar'));
  assert.ok(html.includes('data-action="helptopic"'), 'Show me routes into the seeded topic');
  assert.ok((html.match(/\u2713/g) || []).length >= 1 && html.includes('\u2192'), 'done and next marks');
  const full = { view: 'workspace', pid: 'p1',
    fields: {}, rows: { fr: [{ id: 'r1', data: { fit: 'Locates it in under thirty seconds. Test.' } }] },
    versions: [{ seq: 1 }], approvals: { 1: [{ status: 'approved', approver_name: 'T' }] }, shares: [{ id: 's' }],
    helpState: { t1: { completed: true } }, helpTopics: [] };
  assert.ok(H.helpPathHTML(full).includes('Power user path complete'), 'completion collapses to one line');
});
test('the Path sits at the top of the topic list and never inside an open topic', () => {
  const app = appOf({ help: { open: true } });
  const listView = H.helpPanelHTML(app);
  assert.ok(listView.indexOf('help-path') > -1 && listView.indexOf('help-path') < listView.indexOf('help-item'));
  const openView = H.helpPanelHTML(appOf({ help: { open: true, topic: 't1' } }));
  assert.ok(!openView.includes('help-path'), 'reading a topic is reading, not a scoreboard');
});


test('a walkthrough never offers itself on the wrong screen: pointer, not a dead tour', () => {
  const wsTopic = { id: 'w1', title: 'Share', body_md: 'x', routes: ['*'], audience: 'all', is_published: true };
  const wsSteps = [{ id: 'ws1', topic_id: 'w1', step_order: 1, anchor_key: 'doc.share', title: 'S', body_md: 'b' }];
  const onProjects = H.helpPanelHTML(appOf({ view: 'projects', helpTopics: [wsTopic], helpSteps: wsSteps, help: { open: true, topic: 'w1' } }));
  assert.ok(!onProjects.includes('data-action="helptour"'), 'no tour button off-route');
  assert.ok(onProjects.includes('runs on the worksheet'), 'the pointer names the home screen');
  const onWs = H.helpPanelHTML(appOf({ view: 'workspace', helpTopics: [wsTopic], helpSteps: wsSteps, help: { open: true, topic: 'w1' } }));
  assert.ok(onWs.includes('data-action="helptour"'), 'the tour offers itself at home');
});
test('the Path folds to one line and the fold is a wired control', () => {
  const app = appOf({ view: 'workspace', pid: 'p1', versions: [{ seq: 1 }], projects: [{ id: 'p' }], helpPathFold: true });
  const folded = H.helpPathHTML(app);
  assert.ok(folded.includes('data-action="helppathfold"') && /\d of 6/.test(folded), 'header with count survives');
  assert.ok(!folded.includes('help-path-bar') && !folded.includes('help-path-row'), 'rows and bar tucked away');
  const openP = H.helpPathHTML({ ...app, helpPathFold: false });
  assert.ok(openP.includes('help-path-bar') && openP.includes('data-action="helppathfold"'), 'expanded keeps the same toggle');
});


test('topics shelve into four named groups by band, custom topics land in the loop', () => {
  const g = H.groupTopics([{ title: 'a', sort_order: 10 }, { title: 'b', sort_order: 90 }, { title: 'c' }, { title: 'd', sort_order: 150 }, { title: 'e', sort_order: 220 }]);
  assert.deepEqual(g.map((x) => x.label), ['Start', 'The working loop', 'People and platform', 'The craft of requirements']);
  assert.deepEqual(g[1].items.map((x) => x.title), ['b', 'c'], 'unsorted customs join the loop');
  const html = H.helpPanelHTML(appOf({ help: { open: true } }));
  assert.ok(html.includes('help-group'), 'the list renders its shelf labels');
  const cssRule = readFileSync(new URL('../app/app.css', import.meta.url), 'utf8');
  assert.ok(cssRule.includes('.help-item > span:first-child{font-weight:560!important;color:var(--brand)}'), 'topic titles carry the brand blue');
});

console.log('\nhelp.test: ' + n + '/' + n + ' passed');
