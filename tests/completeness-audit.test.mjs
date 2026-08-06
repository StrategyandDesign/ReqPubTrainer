/* ReqPub C4 - the completeness audit (node tests/completeness-audit.test.mjs)

   Two organization states, every surface that can be rendered without a
   browser, and one question asked of each: would a person meeting this screen
   for the first time hit a blank panel, a raw null, a control that does
   nothing, or a sentence written by a machine.

   This suite exists because of a defect the owner found before it did. The
   capabilities page offered "Show me" for a control that lives on another
   screen, so pressing it lit nothing while the step text claimed otherwise.
   The walkthrough already refused to start off-route; the capabilities page
   ignored that rule. The class is now checked here for every surface, not just
   the one that failed.

   State A is a fresh organization with nothing configured: no versions, no
   signatures, no receipts, no webhooks, no MCP keys, no attachments, no
   lineage, an empty inbox. State B is an organization with every feature
   exercised. Both must render completely. */
globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const { viewProjects } = await import('../app/js/views-app.js');
const { helpPanelHTML, HELP_ANCHORS } = await import('../app/js/help.js');
const { renderCapabilities, CAPABILITIES } = await import('../app/js/capabilities.js');
const { coverHTML } = await import('../app/js/exports.js');
const { buildRecordOfDelivery } = await import('../app/js/recordofdelivery.js');
const { renderSignPage, renderBriefView, practiceMark } = await import('../app/js/views-external.js');
const { TEMPLATES } = await import('../app/js/templates.js');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };
const src = (f) => readFileSync(fileURLToPath(new URL('../app/js/' + f, import.meta.url)), 'utf8');
const ANCHOR_ROUTES = HELP_ANCHORS.reduce((m, a) => { m[a.key] = a.route; return m; }, {});

/* The marks of an unfinished screen. Each one is something a reader should
   never see, and each has been shipped by somebody at some point. */
const GARBAGE = [
  [/\bundefined\b/, 'the word undefined'],
  [/>\s*null\s*</, 'a raw null in the markup'],
  [/\bNaN\b/, 'NaN'],
  [/\[object Object\]/, 'a stringified object'],
  [/>\s*0 items?\s*</i, 'a zero count where a sentence belongs'],
  [/\bInvalid Date\b/, 'an invalid date'],
  // Only elements whose whole job is to carry copy. A layout container
  // closing after a child, a flex spacer, and a zero-width progress fill are
  // all correct and empty by design; flagging them finds wrappers, not
  // defects. A paragraph, heading, or table cell with nothing in it is a
  // defect every time.
  [/<(p|td|h1|h2|h3)(?:\s[^>]*)?>\s*<\/\1>/, 'an empty element where copy belongs'],
  [/<span>\s*<\/span>/, 'an empty unstyled span where copy belongs'],
];
const scan = (label, html) => {
  for (const [re, what] of GARBAGE) if (re.test(html)) return label + ' shows ' + what;
  return null;
};
const problems = [];
const render = (label, html) => { const p = scan(label, html); if (p) problems.push(p); return html; };

/* ---- STATE A: a fresh organization, nothing configured ---- */
const FRESH = {
  role: 'manager', org: 'New Firm', orgs: [], projects: [], projectStats: {}, acceptFacts: {},
  myApprovals: [], helpTopics: [], helpSteps: [], helpState: {}, help: {}, shares: [], signs: {},
  receipts: {}, comms: [], versions: [], view: 'projects', fields: {}, rows: {},
};

{
  const html = render('the empty projects screen', viewProjects(FRESH));
  check('a fresh organization gets a projects screen, not a blank page', html.length > 400);
  check('it says what to do rather than showing an empty list',
    /name a new|start from|nothing yet|no records|first/i.test(html));
  check('no fact pills are invented for records that do not exist',
    !html.includes('awaiting signature') && !html.includes('>Sealed<'));
  // The panel renders only when opened, which is why it is opened here.
  const helpHtml = render('the empty help panel', helpPanelHTML({ ...FRESH, help: { open: true } }));
  check('help opens with no topics loaded and still offers the reference',
    helpHtml.includes('What ReqPub does') && helpHtml.length > 200);
}

/* ---- STATE B: an organization with everything exercised ---- */
const FULL = {
  ...FRESH,
  org: 'Collection Ventures',
  projects: [
    { id: 'p1', name: 'Riverbend rollout', updated_at: '2026-08-01T10:00:00Z', practice: false,
      born_from_project_id: 'p0', born_from_seq: 2, born_from_fingerprint: 'ab'.repeat(32) },
    { id: 'p2', name: 'Rehearsal', updated_at: '2026-08-01T10:00:00Z', practice: true },
  ],
  projectStats: { p1: { latest: { label: '1.1', status: 'approved' }, unread: 2, open: 1 }, p2: { unread: 0, open: 0 } },
  acceptFacts: { p1: { pending: 1, signed: 2, sealed: true }, p2: { pending: 0, signed: 0, sealed: false } },
  helpTopics: [{ id: 't1', title: 'The practice engagement', body_md: 'A rehearsal.', is_published: true, routes: ['projects'] }],
};
{
  const html = render('the configured projects screen', viewProjects(FULL));
  check('a configured organization shows its records with their facts',
    html.includes('Riverbend rollout') && html.includes('2 signed') && html.includes('>Sealed<'));
  check('a practice record is marked wherever it appears', html.includes('PRACTICE'));
  check('the manager controls are present', html.includes('data-action="bookexport"'));
  const viewer = render('the viewer projects screen', viewProjects({ ...FULL, role: 'viewer' }));
  check('a viewer sees the records without the manager controls',
    viewer.includes('Riverbend rollout') && !viewer.includes('data-action="bookexport"'));
}

/* ---- every empty state carries a human sentence ---- */
{
  const rod = render('the close document for an empty record',
    buildRecordOfDelivery({ project: { id: 'p9', name: 'Nothing yet' } }));
  const sentences = ['states no objective', 'states no success metrics', 'No baseline was generated',
    'nothing to compare', 'states no evaluation thresholds', 'No signature was captured'];
  check('every empty section of the close document is a written sentence, not a blank',
    sentences.every((s) => rod.includes(s)), sentences.filter((s) => !rod.includes(s)));
  check('an empty close document never implies success',
    !/complete|on track|successful|healthy|passed/i.test(rod.replace(/verification|verify/gi, '')));
  const cover = render('a cover with nothing configured', coverHTML({ product: 'Nothing yet' }));
  check('a cover renders with no brand, no approvals, and no lineage', cover.length > 200);
}

/* ---- the dead-end rule, checked on every surface that points at a control ---- */
{
  for (const view of ['projects', 'workspace']) {
    const caps = render('the capabilities page on ' + view, renderCapabilities({ view }, ANCHOR_ROUTES));
    const offered = [...caps.matchAll(/data-anchor="([^"]+)"/g)].map((m) => m[1]);
    const wrong = offered.filter((a) => ANCHOR_ROUTES[a] && ANCHOR_ROUTES[a] !== '*' && ANCHOR_ROUTES[a] !== view);
    check('on the ' + view + ' screen every offered control actually lives there', wrong.length === 0, wrong);
  }
  const helpSrc = src('help.js');
  check('the walkthrough refuses to start when any step points off-route',
    helpSrc.includes('if (!away.length) return') && helpSrc.includes('The walkthrough runs on'));
  check('a control whose target is elsewhere says where, rather than offering a dead press',
    renderCapabilities({ view: 'projects' }, ANCHOR_ROUTES).includes('On the record screen'));
}

/* ---- external surfaces render for a stranger ---- */
{
  const sign = render('the sign page', renderSignPage({
    sign: { status: 'pending', project: 'Riverbend rollout', label: '1.1', seq: 2,
            snapshot: { answers: {}, sections: {} }, fingerprint: 'cd'.repeat(32) }, share: null }));
  check('the sign page renders for a signer with no account', sign.length > 400 && sign.includes('Riverbend'));
  const brief = render('the brief', renderBriefView({
    share: { payload: { answers: {}, sections: {}, product: 'Riverbend rollout' } }, shareForm: {} }));
  check('a brief with no answers still renders a page', brief.length > 200);
  check('the practice mark is available to every external surface through one helper',
    practiceMark(true).includes('PRACTICE RECORD') && practiceMark(false) === '');
}

/* ---- every template start is complete ---- */
{
  const bad = TEMPLATES.filter((t) => !t.key || !t.label || !t.desc || t.desc.length < 20);
  check('every template start has a name and a description a person can act on', bad.length === 0, bad.map((t) => t.key));
  check('every capability entry has a body, and none is a placeholder',
    CAPABILITIES.every((c) => c.body && c.body.length > 40 && !/TODO|TBD|coming soon/i.test(c.body)));
}

/* ---- error copy: plain language with a next step ---- */
{
  const mainSrc = src('main.js');
  const toasts = [...mainSrc.matchAll(/toast\('([^']{6,120})'/g)].map((m) => m[1]);
  const shouty = toasts.filter((t) => /error occurred|failed to|unexpected|something went wrong/i.test(t) && !/try again|reload|check|open|contact/i.test(t));
  check('no user-facing error says only that something went wrong',
    shouty.length === 0, shouty.slice(0, 3));
  const jargon = toasts.filter((t) => /\b(null|undefined|exception|stack|500|PGRST)\b/i.test(t));
  check('no user-facing message leaks an implementation word', jargon.length === 0, jargon.slice(0, 3));
}

check('no surface in either organization state showed a mark of an unfinished screen',
  problems.length === 0, problems.slice(0, 4));

console.log(`completeness audit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
