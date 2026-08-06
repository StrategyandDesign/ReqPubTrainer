/* ============================================================================
   ReqPub v2 - in-app help
   The pull model, per the research this feature was built on: a persistent,
   dismissible "?" beacon on every authenticated screen opens a per-screen
   topic panel; a topic can launch a short, user-initiated spotlight
   walkthrough over stable data-help-anchor targets. Nothing auto-fires,
   nothing tracks beyond view/complete counts, and every renderer here is a
   pure function of APP so the whole surface is unit-testable.
   ========================================================================= */
import { APP_VERSION, esc, escA, ico, IC } from './core.js';
import { mdToHtml } from './domain.js';
import { renderCapabilities } from './capabilities.js';

/* The anchor registry: the explicit contract between the UI and the guides.
   Every key must exist in the views as data-help-anchor="key"; the audit
   enforces the symmetry, which is the anchor-breakage defense the research
   called for. */
export const HELP_ANCHORS = [
  { key: 'nav.account', label: 'Account and workspace menu', route: '*' },
  { key: 'projects.new', label: 'New document button', route: 'projects' },
  { key: 'ws.lens', label: 'Specification / Delivery lens toggle', route: 'workspace' },
  { key: 'ws.generate', label: 'Generate version button', route: 'workspace' },
  { key: 'ws.phase', label: 'Engagement phase control', route: 'workspace' },
  { key: 'doc.updates', label: 'Weekly updates panel', route: 'workspace' },
  { key: 'doc.share', label: 'Share controls', route: 'workspace' },
  { key: 'help.beacon', label: 'The help beacon itself', route: '*' },
];

export const HELP_ROUTES = ['*', 'projects', 'workspace'];

export const helpRouteKey = (APP) => (APP.view === 'workspace' ? 'workspace' : APP.view === 'projects' ? 'projects' : APP.view || '*');

/* Visibility is a pure rule: published (drafts for managers), route matches
   or global, audience matches the reader's role, and dismissed topics stay
   out until the reader asks for them. */
export function visibleTopics(topics, route, role, state, showDismissed) {
  const st = state || {};
  return (topics || [])
    .filter((t) => t.is_published || role === 'manager')
    .filter((t) => (t.routes || ['*']).includes('*') || (t.routes || []).includes(route))
    .filter((t) => (t.audience || 'all') === 'all' || t.audience === role)
    .filter((t) => showDismissed || !(st[t.id] && st[t.id].dismissed))
    .sort((a, b) => (a.sort_order || 100) - (b.sort_order || 100) || String(a.title).localeCompare(String(b.title)));
}

export const dismissedCount = (topics, state) =>
  (topics || []).filter((t) => state && state[t.id] && state[t.id].dismissed).length;

/* ---- The Path: six milestones, each a real act the record can prove.
   Detectors are pure over APP and defensive: data absent on this screen
   reads as not-yet, never as a crash. topicTitle links each step to its
   library topic when seeded. ---- */
export const PATH_MILESTONES = [
  { id: 'create', label: 'Create a record', topicTitle: 'Create your first record',
    detect: (A) => ((A.projects || []).length > 0) || A.view === 'workspace' || !!A.pid },
  { id: 'fit', label: 'Write a requirement with a real fit criterion', topicTitle: 'The fit criterion clinic',
    detect: (A) => ((A.rows || {}).fr || []).some((r) => String(((r && r.data) || r || {}).fit || '').trim().length >= 12) },
  { id: 'baseline', label: 'Generate a baseline', topicTitle: 'Generate a baseline, and what the fingerprint means',
    detect: (A) => ((A.versions || []).length > 0) || Object.values(A.projectStats || {}).some((s) => s && (s.latest || (s.versions || 0) > 0)) },
  { id: 'approve', label: 'Record a named sign-off', topicTitle: 'Collect approvals and signatures',
    detect: (A) => Object.values(A.approvals || {}).some((list) => (list || []).some((x) => x && x.status === 'approved' && String(x.approver_name || x.name || '').trim())) },
  { id: 'share', label: 'Share a link with a client', topicTitle: 'Share with your client, and what they can see',
    detect: (A) => ((A.shares || []).length > 0) },
  { id: 'walkthrough', label: 'Complete a walkthrough', topicTitle: 'Help, hiding it, and getting it back',
    detect: (A) => Object.values(A.helpState || {}).some((x) => x && x.completed) },
];

export function pathProgress(APP) {
  const items = PATH_MILESTONES.map((m) => ({ ...m, done: !!m.detect(APP || {}) }));
  return { items, done: items.filter((i) => i.done).length, total: items.length };
}

export function helpPathHTML(APP) {
  const p = pathProgress(APP);
  const byTitle = {};
  (APP.helpTopics || []).forEach((t) => { byTitle[String(t.title || '').toLowerCase()] = t; });
  if (p.done === p.total) {
    return '<div class="help-path"><div class="help-path-done">' +
      'Power user path complete \u00b7 ' + p.total + ' of ' + p.total + '. The record proves it.</div></div>';
  }
  const head = '<button class="help-path-h" data-action="helppathfold" title="' + (APP.helpPathFold ? 'Show the path' : 'Tuck the path away; your count stays in view') + '">' +
    '<span>Your path to power user</span><span class="help-path-n">' + p.done + ' of ' + p.total + '</span>' +
    '<span class="help-path-chev">' + (APP.helpPathFold ? '\u25b8' : '\u25be') + '</span></button>';
  if (APP.helpPathFold) return '<div class="help-path help-path-folded">' + head + '</div>';
  return '<div class="help-path">' + head +
    '<div class="help-path-bar"><span style="width:' + Math.round((p.done / p.total) * 100) + '%"></span></div>' +
    p.items.map((m) => {
      const t = byTitle[m.topicTitle.toLowerCase()];
      const go = !m.done && t ? '<button class="btn btn-ghost btn-sm" data-action="helptopic" data-id="' + escA(t.id) + '" style="height:22px;font-size:10.5px;padding:0 8px">Show me</button>' : '';
      return '<div class="help-path-row' + (m.done ? ' ok' : '') + '">' +
        '<span class="help-path-mark">' + (m.done ? '\u2713' : '\u2192') + '</span>' +
        '<span style="flex:1">' + esc(m.label) + '</span>' + go + '</div>';
    }).join('') + '</div>';
}

/* ---- The beacon: present everywhere, dismissible, always re-summonable
   with the ? key. aria-expanded tracks the panel. ---- */
/* A long flat list reads like a wall. Topics group into four named shelves
   by their sort band, the same bands the library was authored in, so custom
   topics land sensibly too (default 100 falls in the loop). */
export function groupTopics(topics) {
  const bands = [
    { label: 'Start', max: 19 },
    { label: 'The working loop', max: 139 },
    { label: 'People and platform', max: 199 },
    { label: 'The craft of requirements', max: Infinity },
  ];
  const out = bands.map((b) => ({ label: b.label, items: [] }));
  for (const t of topics) {
    const so = t.sort_order == null ? 100 : t.sort_order;
    out[bands.findIndex((b) => so <= b.max)].items.push(t);
  }
  return out.filter((g) => g.items.length);
}

export function helpBeaconHTML(APP) {
  if (APP.helpPrefs && APP.helpPrefs.beacon_hidden) return '';
  return '<button class="help-beacon" data-help-anchor="help.beacon" data-action="helpopen" aria-haspopup="dialog" ' +
    'aria-expanded="' + (APP.help && APP.help.open ? 'true' : 'false') + '" title="Help. Press ? anywhere">?</button>';
}

/* ---- The panel: a dialog, not a tooltip. Focus moves in on open, Esc
   closes and returns focus to the beacon (wired in main). ---- */
export function helpPanelHTML(APP) {
  const h = APP.help || {};
  if (!h.open) return '';
  const route = helpRouteKey(APP);
  const topics = visibleTopics(APP.helpTopics, route, APP.role, APP.helpState, h.showDismissed);
  const open = h.topic ? (APP.helpTopics || []).find((t) => t.id === h.topic) : null;
  const nDismissed = dismissedCount(APP.helpTopics, APP.helpState);
  let body;
  if (h.caps) {
    // v2.54: the capabilities page. One pinned reference, rendered pure
    // from the registry; the freshness gate holds it current at every tag.
    body = '<button class="umitem" data-action="helpcapsback" style="margin:0 0 6px;padding-left:6px">' + ico(IC.back || IC.fwd, 'i-sm') + 'All topics</button>' +
      renderCapabilities(APP, HELP_ANCHORS.reduce((m, a) => { m[a.key] = a.route; return m; }, {}));
  } else if (open) {
    const steps = (APP.helpSteps || []).filter((s) => s.topic_id === open.id);
    const st = (APP.helpState || {})[open.id] || {};
    body = '<button class="umitem" data-action="helpback" style="margin:0 0 6px;padding-left:6px">' + ico(IC.back || IC.fwd, 'i-sm') + 'All topics</button>' +
      '<div style="font-size:15px;font-weight:660;margin-bottom:6px">' + esc(open.title) + (open.is_published ? '' : ' <span class="pill" style="height:16px;font-size:9px">Draft</span>') + '</div>' +
      '<div class="help-body">' + mdToHtml(open.body_md || '') + '</div>' +
      (steps.length ? (() => {
        const homeOf = {}; HELP_ANCHORS.forEach((x) => { homeOf[x.key] = x.route; });
        const away = steps.map((st) => homeOf[st.anchor_key]).filter((rt) => rt && rt !== '*' && rt !== route);
        if (!away.length) return '<button class="btn btn-primary btn-sm" data-action="helptour" data-id="' + escA(open.id) + '" style="margin-top:10px">Walk me through it \u00b7 ' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + '</button>';
        const home = away[0] === 'workspace' ? 'the worksheet' : 'the projects screen';
        return '<div class="help-offroute">The walkthrough runs on ' + home + '. Open it there, press ?, and this topic carries the tour.</div>';
      })() : '') +
      '<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:8px">' +
      (st.dismissed
        ? '<button class="btn btn-ghost btn-sm" data-action="helprestore" data-id="' + escA(open.id) + '">Show this topic again</button>'
        : '<button class="btn btn-ghost btn-sm" data-action="helpdismiss" data-id="' + escA(open.id) + '">Hide this topic for me</button>') + '</div>';
  } else {
    body = helpPathHTML(APP) + (topics.length ? '' : '');
    // The pinned link sits above the shelves, after the Path: the one
    // reference that is never a topic, never dismissible, always current.
    body += '<button class="help-item" data-action="helpcaps" style="border:1px solid var(--line);border-radius:9px;margin-bottom:9px">' +
      '<span style="font-weight:640">What ReqPub does</span>' +
      '<span class="pill" style="height:15px;font-size:8.5px">v' + esc(APP_VERSION) + '</span></button>';
    body += topics.length
      ? groupTopics(topics).map((g) => '<div class="help-group">' + esc(g.label) + '</div>' + g.items.map((t) => '<button class="help-item" data-action="helptopic" data-id="' + escA(t.id) + '">' +
          '<span style="font-weight:620">' + esc(t.title) + '</span>' +
          (t.is_published ? '' : '<span class="pill" style="height:15px;font-size:8.5px">Draft</span>') +
          ((APP.helpState || {})[t.id] && APP.helpState[t.id].dismissed ? '<span class="pill" style="height:15px;font-size:8.5px">Hidden</span>' : '') +
          '</button>').join('')).join('')
      : '<div class="help-empty">No topics for this screen yet.' + (APP.role === 'manager' ? '<br><span style="color:var(--ink-2)">Write the first one in Help Studio below.</span>' : '') + '</div>';
    body += nDismissed && !h.showDismissed
      ? '<button class="btn btn-ghost btn-sm" data-action="helpshowdismissed" style="margin-top:8px">Show ' + nDismissed + ' hidden topic' + (nDismissed === 1 ? '' : 's') + '</button>'
      : '';
  }
  return '<div class="umback" data-action="helpclose"></div>' +
    '<div class="help-panel" data-stop="1" role="dialog" aria-modal="true" aria-label="Help" id="help-panel" tabindex="-1">' +
    '<div class="help-ph"><div style="min-width:0;flex:1">' +
    '<div class="help-pt">Help</div>' +
    '<div class="help-psub">' + (route === 'projects' ? 'Topics for the projects screen' : route === 'workspace' ? 'Topics for the worksheet' : 'Topics for this screen') + '</div></div>' +
    '<button class="btn btn-ghost btn-sm" data-action="helpclose" aria-label="Close help" style="flex:0 0 auto">' + ico(IC.close, 'i-sm') + '</button></div>' +
    '<div class="help-scroll">' + body + '</div>' +
    '<div class="help-foot">' +
    (APP.role === 'manager' ? '<button class="btn btn-sec btn-sm" data-action="helpstudio">Help Studio</button>' : '') +
    '<span style="flex:1"></span>' +
    '<button class="btn btn-ghost btn-sm" data-action="helphide" title="Hide the beacon; press ? to bring help back">Hide help</button>' +
    '<span class="help-stamp mono">v' + APP_VERSION + '</span>' +
    '</div></div>';
}

/* ---- The spotlight: user-initiated, five steps or fewer by authoring
   convention, anchored to data-help-anchor targets. Markup only here;
   geometry lands in positionHelpSpot after paint. ---- */
export function helpSpotHTML(APP) {
  const sp = APP.helpSpot;
  if (!sp) return '';
  const steps = sp.inline ? [sp.inline]
    : (APP.helpSteps || []).filter((s) => s.topic_id === sp.topic).sort((a, b) => a.step_order - b.step_order);
  const s = steps[sp.ix];
  if (!s) return '';
  return '<div class="help-dimcatch" data-action="helptourend"></div><div class="help-window" id="help-window"></div>' +
    '<div class="help-spot" role="dialog" aria-modal="true" aria-label="Walkthrough step" id="help-spot" tabindex="-1">' +
    '<div class="eyebrow xd" style="font-size:9px;margin-bottom:5px">Step ' + (sp.ix + 1) + ' of ' + steps.length + '</div>' +
    '<div style="font-weight:660;font-size:13.5px;margin-bottom:4px">' + esc(s.title) + '</div>' +
    '<div class="help-body" style="font-size:12.5px">' + mdToHtml(s.body_md || '') + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
    (sp.ix > 0 ? '<button class="btn btn-sec btn-sm" data-action="helptourprev">Back</button>' : '') +
    '<span style="flex:1"></span>' +
    '<button class="btn btn-ghost btn-sm" data-action="helptourend">End</button>' +
    (sp.ix + 1 < steps.length
      ? '<button class="btn btn-primary btn-sm" data-action="helptournext">Next</button>'
      : '<button class="btn btn-primary btn-sm" data-action="' + (sp.inline ? 'helptourend' : 'helptourdone') + '">Done</button>') +
    '</div></div>';
}

/* Geometry after paint: light the anchor, park the card beside it. A missing
   anchor is stated, never a crash: the card centers and says so. */
export function positionHelpSpot(APP, doc) {
  const sp = APP.helpSpot;
  const card = doc.getElementById('help-spot');
  const win = doc.getElementById('help-window');
  if (!sp || !card) return;
  const steps = sp.inline ? [sp.inline]
    : (APP.helpSteps || []).filter((s) => s.topic_id === sp.topic).sort((a, b) => a.step_order - b.step_order);
  const s = steps[sp.ix];
  const el = s && s.anchor_key ? doc.querySelector('[data-help-anchor="' + s.anchor_key + '"]') : null;
  if (!el) {
    if (win) { win.style.top = '50%'; win.style.left = '50%'; win.style.width = '0px'; win.style.height = '0px'; win.style.borderWidth = '0px'; }
    card.style.left = 'calc(50% - 160px)'; card.style.top = '25%';
    const homeOf = {}; HELP_ANCHORS.forEach((x) => { homeOf[x.key] = x.route; });
    const home = s && homeOf[s.anchor_key];
    const msg = (home === '*' || home === helpRouteKey(APP))
      ? 'That control is not on screen right now. It may be under another tab, or it may need a manager role. The text above says the same thing.'
      : 'That control is on another screen. Close this, open that screen, and start the tour again from its topic.';
    if (!card.querySelector('.help-missing')) card.insertAdjacentHTML('beforeend', '<div class="help-missing" style="font-size:10.5px;color:var(--ink-3);margin-top:6px">' + msg + '</div>');
    return;
  }
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  // A generous frame: the target floats centered in the window rather than
  // hugging its edge. Symmetric padding is what centers it, by construction.
  const pad = 22;
  if (win) {
    win.style.top = (r.top - pad) + 'px'; win.style.left = (r.left - pad) + 'px';
    win.style.width = (r.width + pad * 2) + 'px'; win.style.height = (r.height + pad * 2) + 'px';
    win.style.borderWidth = '2px';
  }
  const cw = 320; const vh = doc.defaultView.innerHeight; const vw = doc.defaultView.innerWidth;
  let top = r.bottom + pad + 12; if (top + 190 > vh) top = Math.max(10, r.top - pad - 200);
  const left = Math.min(Math.max(10, r.left), vw - cw - 10);
  card.style.top = top + 'px'; card.style.left = left + 'px';
}

/* ---- The Help Studio: manager-only authoring. Topic list, editor with
   draft/publish, route and audience scope, steps as one line each
   (anchor | title | body), live preview through the same renderer the
   reader sees, per-topic view and completion counts. ---- */
/* The seed plan, pure: given the topics actually in the database and the
   library, return what to delete (every later duplicate of a title, first
   occurrence kept) and what to insert (library topics whose titles are
   absent). Running it twice yields an empty plan: idempotence by
   construction, not by hope. */
export function seedPlan(existing, library) {
  const seen = new Map();
  const toDelete = [];
  const sorted = (existing || []).slice().sort((a, b) => (a.sort_order || 100) - (b.sort_order || 100) || String(a.id).localeCompare(String(b.id)));
  for (const t of sorted) {
    const k = String(t.title || '').trim().toLowerCase();
    if (seen.has(k)) toDelete.push(t.id); else seen.set(k, t.id);
  }
  const toInsert = (library || []).filter((t) => !seen.has(t.title.trim().toLowerCase()));
  return { toDelete, toInsert };
}

export function stepsToText(steps) {
  return (steps || []).slice().sort((a, b) => a.step_order - b.step_order)
    .map((s) => [s.anchor_key, s.title, s.body_md].join(' | ')).join('\n');
}
export function textToSteps(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5)
    .map((l, i) => {
      const [anchor_key = '', title = '', ...rest] = l.split('|').map((x) => x.trim());
      return { step_order: i + 1, anchor_key, title, body_md: rest.join(' | ') };
    })
    .filter((s) => s.title || s.body_md);
}

export function helpStudioHTML(APP) {
  if (!APP.helpStudioOpen) return '';
  const topics = (APP.helpTopics || []).slice().sort((a, b) => (a.sort_order || 100) - (b.sort_order || 100));
  const ed = APP.helpEdit;
  const stats = {}; ((APP.helpStats && APP.helpStats.topics) || []).forEach((r) => { stats[r.topic_id] = r; });
  const list = topics.length ? topics.map((t) => {
    const sN = stats[t.id] || {};
    return '<button class="help-item hs-row' + (ed && ed.id === t.id ? ' on' : '') + '" data-action="helpedit" data-id="' + escA(t.id) + '">' +
      '<span class="hs-rowt">' + esc(t.title || 'Untitled') + '</span>' +
      '<span class="hs-rowm"><span class="pill" style="height:16px;font-size:8.5px">' + (t.is_published ? 'Published' : 'Draft') + '</span>' +
      '<span>' + (sN.views || 0) + ' \u00b7 ' + (sN.completes || 0) + '</span></span></button>';
  }).join('') : '<div class="hs-empty">No topics yet.<br>Create the first one and it appears in the help panel the moment you publish.</div>';
  const field = (label, inner, hint) => '<div class="hs-field"><div class="hs-label">' + label +
    (hint ? '<span class="hs-hint">' + hint + '</span>' : '') + '</div>' + inner + '</div>';
  const editor = ed ? (
    field('Title', '<input class="input" data-hf="title" value="' + escA(ed.title || '') + '" placeholder="What this topic teaches" style="height:36px;font-size:13.5px">') +
    '<div class="hs-two">' +
    field('Audience', '<select class="input" data-hf="audience" style="height:36px;font-size:12.5px;width:100%;padding:0 10px">' +
      [['all', 'Everyone'], ['manager', 'Managers only'], ['viewer', 'Viewers only']].map(([v, l]) => '<option value="' + v + '"' + ((ed.audience || 'all') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>') +
    field('Shows on', '<div class="hs-checks">' + HELP_ROUTES.map((r) =>
      '<label class="hs-check"><input type="checkbox" data-hroute="' + r + '"' + ((ed.routes || ['*']).includes(r) ? ' checked' : '') + '>' + (r === '*' ? 'Everywhere' : r === 'projects' ? 'Projects screen' : 'Worksheet') + '</label>').join('') + '</div>') +
    '</div>' +
    field('Body', '<textarea class="textarea" data-hf="body_md" placeholder="Write it the way you would explain it across the desk. Markdown works: # headings, **bold**, lists." style="min-height:150px;font-size:13px;line-height:1.6">' + esc(ed.body_md || '') + '</textarea>') +
    field('Walkthrough steps', '<textarea class="textarea" data-hf="stepsText" placeholder="ws.generate | Generate a version | Click here when the worksheet is ready." style="min-height:84px;font-size:12px;font-family:var(--mono);line-height:1.7">' + esc(ed.stepsText || '') + '</textarea>' +
      '<div class="hs-anchors">' + HELP_ANCHORS.map((a) => '<span class="hs-anchor mono" title="' + escA(a.label) + '">' + esc(a.key) + '</span>').join('') + '</div>',
      'one per line \u00b7 anchor | title | body \u00b7 five max \u00b7 leave empty for no walkthrough') +
    '<div class="hs-actions">' +
    '<button class="btn btn-primary" data-action="helpsave" style="height:36px">Save</button>' +
    '<button class="btn btn-sec" data-action="helppub" style="height:36px">' + (ed.is_published ? 'Unpublish' : 'Publish') + '</button>' +
    '<span class="hs-status">' + (ed.is_published ? 'Live \u00b7 readers see this now' : 'Draft \u00b7 managers only until published') + '</span>' +
    (ed.id ? '<button class="btn btn-ghost btn-sm danger" data-action="helpdelete" data-id="' + escA(ed.id) + '">Delete</button>' : '') +
    '</div>' +
    field('Preview \u00b7 exactly what readers see', '<div class="help-body hs-preview">' + (String(ed.body_md || '').trim() ? mdToHtml(ed.body_md) : '<span style="color:var(--ink-3)">Nothing yet.</span>') + '</div>')
  ) : '<div class="hs-empty" style="padding-top:60px">Pick a topic on the left, or create a new one.</div>';
  return '<div class="modal-back" data-action="modalback"><div class="modal-card help-studio" role="dialog" aria-modal="true" aria-label="Help Studio" data-stop="1">' +
    '<div class="hs-head"><div><div style="font-size:17px;font-weight:680;letter-spacing:-.015em">Help Studio</div>' +
    '<div style="font-size:11.5px;color:var(--ink-2);margin-top:2px">What you publish here renders in the help panel on every screen you scope it to.</div></div>' +
    '<button class="btn btn-sec btn-sm" data-action="helpnew">' + ico(IC.plus, 'i-sm') + 'New topic</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="helpseed"' + (APP.helpSeeding ? ' disabled style="opacity:.55;pointer-events:none"' : '') + ' title="Fifteen starter topics for a new requirements manager: the loop, the lenses, baselines, sharing, updates. Yours to edit the moment they land.">' + (APP.helpSeeding ? 'Loading\u2026' : 'Load starter library') + '</button>' +
    '<button class="modal-x" data-action="helpstudioclose" aria-label="Close">' + ico(IC.close) + '</button></div>' +
    '<div class="hs-grid">' +
    '<div class="hs-list"><div class="hs-label" style="margin-bottom:6px">Topics \u00b7 ' + topics.length + '</div>' + list + '</div>' +
    '<div class="hs-editor">' + editor + '</div></div></div></div>';
}
