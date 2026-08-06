/* ReqPub v2 - the capabilities page (node tests/capabilities.test.mjs)
   Pins v2.54: tier order and labels; the mandated coverage present by id;
   authored order preserved within tiers; escaping on every rendered string;
   the freshness stamp in the footer; the pinned link above the shelves;
   Show me rendered for every anchored entry through the inline spotlight;
   the gate self-test tripping every class; the registry passing its own
   gate; unconfigured parity for the help panel's prior states. */
globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const { CAPABILITIES, COVERED_THROUGH, TIER_ORDER, TIER_LABELS, renderCapabilities } = await import('../app/js/capabilities.js');
const { helpPanelHTML, helpSpotHTML, HELP_ANCHORS } = await import('../app/js/help.js');
const { APP_VERSION } = await import('../app/js/core.js');
const { checkRegistry } = await import('../tools/capabilities-gate.mjs');
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

/* ---- the registry ---- */
check('the registry lands inside the thirty to forty-five band', CAPABILITIES.length >= 30 && CAPABILITIES.length <= 45, CAPABILITIES.length);
check('three tiers in their fixed order', TIER_ORDER.join(',') === 'plain,hood,work'
  && TIER_LABELS.plain === 'In plain sight' && TIER_LABELS.hood === 'Under the hood' && TIER_LABELS.work === 'Where it earns its keep');
check('COVERED_THROUGH equals APP_VERSION', COVERED_THROUGH === APP_VERSION, [COVERED_THROUGH, APP_VERSION]);
const ids = new Set(CAPABILITIES.map((c) => c.id));
check('every id is unique', ids.size === CAPABILITIES.length);
const mandated = ['baselines', 'approval-gate', 'esign', 'signer-archive', 'sealed-receipts', 'verify-anywhere',
  'activity-chain', 'attachment-hashing', 'update-dashboard', 'sme-input', 'populate', 'evidence-pack',
  'signed-webhooks', 'billing-trigger', 'mcp-surface', 'integrator-standard', 'key-transparency',
  'rls-rpc', 'token-model', 'insert-only', 'rate-limits', 'no-drift-gates', 'honest-limit'];
check('the mandated coverage is present by id', mandated.every((m) => ids.has(m)),
  mandated.filter((m) => !ids.has(m)));
check('the v2.48 receipt language appears exactly',
  CAPABILITIES.find((c) => c.id === 'sealed-receipts').body.includes('signed with Ed25519 and timestamped by two independent RFC 3161 authorities'));
check('the honest limit is stated', CAPABILITIES.find((c) => c.id === 'honest-limit').body.includes('proves content, not signer or time'));

/* ---- the registry passes its own gate, run in-process ---- */
{
  const v = checkRegistry({
    coveredThrough: COVERED_THROUGH, entries: CAPABILITIES,
    pkgVersion: JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version,
    // The 2.x history lives in docs/changelog/v2.md since v3.0.0; a
    // sinceVersion resolves against either file.
    changelog: ['../CHANGELOG.md', '../docs/changelog/v2.md']
      .map((f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')).join('\n'),
    anchors: HELP_ANCHORS.map((a) => a.key), rendered: renderCapabilities(),
  });
  check('the shipped registry passes every gate class', v.length === 0, v.slice(0, 3));
}

/* ---- the gate self-test trips every class ---- */
{
  let code = 0, out = '';
  try { out = execFileSync(process.execPath, [fileURLToPath(new URL('../tools/capabilities-gate.mjs', import.meta.url)), '--selftest'], { encoding: 'utf8' }); }
  catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  check('the gate self-test passes: every class fires on the violating fixture', code === 0 && out.includes('every gate class fires'), out.trim());
}

/* ---- the render ---- */
const html = renderCapabilities();
check('tiers render in order with their labels',
  html.indexOf('In plain sight') > -1 && html.indexOf('In plain sight') < html.indexOf('Under the hood')
  && html.indexOf('Under the hood') < html.indexOf('Where it earns its keep'));
check('entries render in authored order within a tier',
  html.indexOf('Baselines are immutable') < html.indexOf('Approvals advance the version'));
check('the freshness stamp closes the page', html.includes('Current through v' + APP_VERSION));
const anchored = CAPABILITIES.filter((c) => c.anchor);
check('every anchored entry renders a Show me and nothing else does',
  anchored.every((c) => html.includes('data-anchor="' + c.anchor + '"'))
  && (html.match(/data-action="capshow"/g) || []).length === anchored.length);
check('every rendered string passes through esc', !html.includes('<script') && html.includes('&') === html.includes('&'));

/* ---- the Show me is contextual: a control is never offered where it cannot
   exist. The walkthrough already refused to start off-route; the capabilities
   page did not, and a reader on the projects screen who pressed Show me for a
   worksheet control got a spotlight with nothing under it. ---- */
{
  const routes = HELP_ANCHORS.reduce((m, a) => { m[a.key] = a.route; return m; }, {});
  const onProjects = renderCapabilities({ view: 'projects' }, routes);
  const onWorkspace = renderCapabilities({ view: 'workspace' }, routes);
  const offRoute = CAPABILITIES.filter((c) => c.anchor && routes[c.anchor] === 'workspace');
  check('no worksheet control is offered from the projects screen',
    offRoute.every((c) => !onProjects.includes('data-anchor="' + c.anchor + '"')),
    offRoute.filter((c) => onProjects.includes('data-anchor="' + c.anchor + '"')).map((c) => c.id));
  check('instead the entry says which screen the control lives on',
    offRoute.length === 0 || onProjects.includes('On the record screen'));
  check('the same control is offered once the reader is on that screen',
    offRoute.every((c) => onWorkspace.includes('data-anchor="' + c.anchor + '"')));
  const universal = CAPABILITIES.filter((c) => c.anchor && routes[c.anchor] === '*');
  check('a control that exists everywhere is offered everywhere',
    universal.every((c) => onProjects.includes('data-anchor="' + c.anchor + '"') && onWorkspace.includes('data-anchor="' + c.anchor + '"')));
  check('an off-route entry offers no button at all, rather than a disabled one',
    !/data-action="capshow"[^>]*disabled/.test(onProjects));
}

/* ---- the same rule, pinned at its other site: the walkthrough refuses to
   start when any of its steps points off-route ---- */
{
  const helpSrc = readFileSync(fileURLToPath(new URL('../app/js/help.js', import.meta.url)), 'utf8');
  check('the walkthrough still gates its start button on every step being reachable',
    helpSrc.includes('if (!away.length) return') && helpSrc.includes('The walkthrough runs on'));
}

/* ---- the help panel wiring ---- */
const base = { help: { open: true }, helpTopics: [], helpSteps: [], helpState: {}, role: 'manager', view: 'projects' };
const listHtml = helpPanelHTML(base);
check('the pinned link sits above the shelves', listHtml.includes('data-action="helpcaps"') && listHtml.includes('What ReqPub does'));
const capsHtml = helpPanelHTML({ ...base, help: { open: true, caps: true } });
check('the caps state renders the page with a way back',
  capsHtml.includes('Current through v' + APP_VERSION) && capsHtml.includes('data-action="helpcapsback"'));
check('a topic view is untouched by the caps branch',
  helpPanelHTML({ ...base, helpTopics: [{ id: 't1', title: 'T', body_md: 'b', is_published: true }], help: { open: true, topic: 't1' } }).includes('data-action="helpback"'));

/* ---- the inline spotlight ---- */
const spot = helpSpotHTML({ helpSpot: { inline: { anchor_key: 'ws.generate', title: 'Baselines are immutable', body_md: 'The control is lit on this page.' }, ix: 0 }, helpSteps: [] });
check('an inline spot renders one step through the walkthrough machinery',
  spot.includes('Step 1 of 1') && spot.includes('Baselines are immutable'));
check('the inline Done ends cleanly, never writing topic state',
  spot.includes('data-action="helptourend"') && !spot.includes('helptourdone'));

/* ---- unconfigured parity: prior help states render as before ---- */
check('with caps false the shelf list still renders shelves and topics',
  helpPanelHTML({ ...base, helpTopics: [{ id: 't1', title: 'Topic One', body_md: 'b', is_published: true }] }).includes('Topic One'));

console.log(`capabilities: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
