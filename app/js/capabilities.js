/* ReqPub v2.54 - the capabilities page. One reference opened from Help,
   finished in five minutes: the obvious, the mechanisms, and the situations
   the platform was built for. Every word here is authored, never generated,
   and tools/capabilities-gate.mjs blocks the build unless COVERED_THROUGH
   equals package.json, every sinceVersion matches a CHANGELOG heading,
   every anchor exists, and the copy discipline holds: short titles, bodies
   under forty words, no exclamation, no condescension, no superlatives,
   and no claim the positioning doctrine forbids. The reader is assumed
   competent; nothing is explained twice. */

import { esc, escA, APP_VERSION } from './core.js';

export const COVERED_THROUGH = '3.0.1';

export const TIER_LABELS = { plain: 'In plain sight', hood: 'Under the hood', work: 'Where it earns its keep' };
export const TIER_ORDER = ['plain', 'hood', 'work'];

export const CAPABILITIES = [
  /* ---- In plain sight ---- */
  { id: 'baselines', tier: 'plain', title: 'Baselines are immutable', sinceVersion: '2.2.0', anchor: 'ws.generate',
    body: 'Generate a version and it never changes. Every later edit becomes the next baseline, so what was agreed stays exactly as it was agreed.' },
  { id: 'approval-gate', tier: 'plain', title: 'Approvals advance the version', sinceVersion: '2.28.1',
    body: 'The first approval moves a draft into review, and the last one marks it Approved. No separate publish step, and never while an approver is pending.' },
  { id: 'esign', tier: 'plain', title: 'Signatures on the exact baseline', sinceVersion: '2.30.0', anchor: 'doc.share',
    body: 'A sign link carries one baseline and its fingerprint. The signer sees what was agreed, types a name, and the record captures both.' },
  { id: 'signer-archive', tier: 'plain', title: 'Signers keep an archive link', sinceVersion: '2.38.0',
    body: 'After signing, the same link becomes a permanent read-only archive of the signed baseline and its receipt. Nothing to install, nothing to lose.' },
  { id: 'sealed-receipts', tier: 'plain', title: 'Receipts sealed with dual timestamps', sinceVersion: '2.48.1',
    body: 'Each acceptance receipt is signed with Ed25519 and timestamped by two independent RFC 3161 authorities, so its moment of existence is provable outside ReqPub.' },
  { id: 'verify-anywhere', tier: 'plain', title: 'Verify without the platform', sinceVersion: '2.29.0',
    body: 'Every export restates its own recipe. The public verify page and a standalone CLI recompute the fingerprint from the file alone, offline, with nothing installed from ReqPub.' },
  { id: 'update-dashboard', tier: 'plain', title: 'Weekly updates with recipient threads', sinceVersion: '2.35.0', anchor: 'doc.updates',
    body: 'Send a dated update from the record; each recipient gets a private thread whose replies land back in your Inbox, attributed and filed.' },
  { id: 'inbox-triage', tier: 'plain', title: 'One Inbox for every submission', sinceVersion: '2.24.0',
    body: 'Briefs, SME notes, partner replies, and agent proposals arrive in one place, and a human decides what each becomes. Nothing enters the record on its own.' },
  { id: 'populate', tier: 'plain', title: 'A document populates the worksheet', sinceVersion: '2.42.0', anchor: 'projects.new',
    body: 'Upload a PRD and the deterministic mapper places its sections into the worksheet for review. You approve every row before anything lands.' },
  { id: 'evidence-pack', tier: 'plain', title: 'One evidence pack per project', sinceVersion: '2.52.0',
    body: 'A manager exports the whole record as one zip: chronology, baselines, receipts, attachments manifest, chain result. A lawyer or auditor verifies it offline with one command.' },
  { id: 'practice-mode', tier: 'plain', title: 'Practice records rehearse safely', sinceVersion: '2.55.0',
    body: 'A practice project is a rehearsal, never evidence: immutable at creation, watermarked everywhere, silent to webhooks, refused by evidence packs, absent from the Book.' },
  { id: 'help-walkthroughs', tier: 'plain', title: 'Help that walks the room', sinceVersion: '2.40.0', anchor: 'help.beacon',
    body: 'Press the question mark anywhere. Topics group into shelves, and a spotlight walkthrough lights the real controls on the page you are on.' },

  /* ---- Under the hood: mechanism, then consequence ---- */
  { id: 'pursuit-mode', tier: 'plain', title: 'Pursuits scope before engagements', sinceVersion: '2.56.0',
    body: 'A pursuit record trims the worksheet to objective, success, approach, assumptions, and stakeholders, and states three facts: baselines captured, shared, signed.' },
  { id: 'lineage', tier: 'work', title: 'Records cite where they came from', sinceVersion: '2.56.0',
    body: 'Promoting a signed pursuit creates an engagement that carries its content and cites the parent, the sequence, and the fingerprint signed. A citation, never a pipeline.' },
  { id: 'canonical-fingerprint', tier: 'hood', title: 'One recipe, one fingerprint', sinceVersion: '2.29.0',
    body: 'SHA-256 over canonical JSON of label, seq, and snapshot, keys sorted, UTF-8 bytes. The same recipe runs in the app, the verify page, and the CLI, so none can drift.' },
  { id: 'activity-chain', tier: 'hood', title: 'Every action rides a hash chain', sinceVersion: '2.47.0',
    body: 'Each activity row links to the previous row hash. Rewriting history breaks the chain at the exact seam, and verification names the divergence.' },
  { id: 'key-transparency', tier: 'hood', title: 'Signing keys are published', sinceVersion: '2.48.1',
    body: 'Seal keys live only in function secrets; their public halves publish at reqpub-keys.json with kids. A receipt verifies against a key anyone can fetch and pin.' },
  { id: 'attachment-hashing', tier: 'hood', title: 'Files prove their bytes', sinceVersion: '2.49.0',
    body: 'Every stored file carries a SHA-256 computed at upload. The evidence pack lists those hashes, so an attachment swapped later no longer matches its manifest.' },
  { id: 'signed-webhooks', tier: 'hood', title: 'Webhooks arrive signed and timestamped', sinceVersion: '2.50.0',
    body: 'Each delivery is Ed25519-signed over its body and timestamp with replay windows and dedupe ids. A receiver rejects forgeries and duplicates on arithmetic, not trust.' },
  { id: 'mcp-surface', tier: 'hood', title: 'Agents read; humans accept', sinceVersion: '2.51.0',
    body: 'The MCP server exposes five read tools and one gated propose that files an ordinary Inbox comm. No tool can touch versions, approvals, signatures, or keys.' },
  { id: 'rls-rpc', tier: 'hood', title: 'Row security and RPC-only writes', sinceVersion: '2.34.2',
    body: 'Every table carries row-level security; sensitive writes pass through definer functions that stamp identity server-side. A client cannot claim to be someone else.' },
  { id: 'token-model', tier: 'hood', title: 'Tokens grant one surface each', sinceVersion: '2.34.2',
    body: 'Sign, update, reply, and share links each carry a single-purpose token that never appears in any export, receipt, or log. Revocation closes the door immediately.' },
  { id: 'insert-only', tier: 'hood', title: 'Trails are insert-only', sinceVersion: '2.47.0',
    body: 'Activity, audit, and receipt tables accept inserts and refuse updates and deletes by policy and trigger. The record grows; it does not get edited.' },
  { id: 'rate-limits', tier: 'hood', title: 'Rate limits under advisory locks', sinceVersion: '2.51.0',
    body: 'Anonymous and key-scoped endpoints admit calls through atomic counters, sixty per key per minute on MCP. A flood gets clean refusals, and every refusal is logged.' },
  { id: 'no-drift-gates', tier: 'hood', title: 'The docs gate the build', sinceVersion: '2.53.0',
    body: 'CI holds VERIFY.md, SPEC.md, the schemas, the CLI, and the implementation equal, byte for byte where stated. A drift in any one fails the release.' },
  { id: 'no-model', tier: 'hood', title: 'No AI model inside', sinceVersion: '2.42.0',
    body: 'The intake mapper is deterministic and the platform calls no model API, provable by grep. What enters the record was typed, uploaded, or approved by a person.' },
  { id: 'honest-limit', tier: 'hood', title: 'What a fingerprint cannot prove', sinceVersion: '2.48.1',
    body: 'A fingerprint without a receipt proves content, not signer or time. Sealing adds the who and the when; the docs say so wherever the fingerprint appears.' },

  /* ---- Where it earns its keep: situations, not promises ---- */
  { id: 'record-of-delivery', tier: 'work', title: 'Engagements close with a record', sinceVersion: '2.57.0',
    body: 'One client-facing document: what was agreed, what changed between approved baselines, what thresholds were accepted, who signed, and how to verify it all offline.' },
  { id: 'receiver-templates', tier: 'work', title: 'Integrators get runnable references', sinceVersion: '2.57.0',
    body: 'Two dependency-free receivers and a normative field mapping, so a competent integrator wires signed deliveries into their own system on any platform.' },
  { id: 'sow-exhibit', tier: 'work', title: 'The contract gets an exhibit', sinceVersion: '2.29.0',
    body: 'When the SOW needs the agreed scope attached, the export builds the exhibit from the baseline itself, fingerprint printed, so the contract and the record cannot disagree.' },
  { id: 'acceptance-question', tier: 'work', title: 'When acceptance is questioned', sinceVersion: '2.48.1',
    body: 'A signed, sealed baseline with dual timestamps answers what was agreed and when it existed. The conversation moves from memory to arithmetic.' },
  { id: 'audit-request', tier: 'work', title: 'When the auditor asks', sinceVersion: '2.52.0',
    body: 'Export the evidence pack and hand over the zip. Their team verifies every hash and seal offline against the published recipe, without an account.' },
  { id: 'finance-recognition', tier: 'work', title: 'When finance needs the signatures', sinceVersion: '2.52.0',
    body: 'evidence.csv lists one row per signature with fingerprints, receipt hashes, and timestamps. Mapping to revenue recognition judgments belongs to the firm and its auditors; ReqPub asserts none.' },
  { id: 'client-signoff', tier: 'work', title: 'When the client signs scope', sinceVersion: '2.30.0',
    body: 'Send the sign link on the approved baseline. The signer confirms the fingerprint they see, and the sealed receipt lands beside the version it covers.' },
  { id: 'sme-input', tier: 'work', title: 'When experts hold the details', sinceVersion: '2.26.0',
    body: 'SME workspaces collect structured answers on their own durable links; contributions arrive attributed in the Inbox for promotion into the worksheet.' },
  { id: 'partner-followup', tier: 'work', title: 'When recipients go quiet', sinceVersion: '2.35.0',
    body: 'Weekly update threads keep each recipient replies attached to the record. The follow-up cites the thread, not a recollection.' },
  { id: 'agent-drafting', tier: 'work', title: 'When agents draft against spec', sinceVersion: '2.51.0',
    body: 'An agent reads the baseline and its fingerprint over MCP, executes against the stored spec, and proposes changes into the Inbox for human triage.' },
  { id: 'billing-trigger', tier: 'work', title: 'When billing waits on acceptance', sinceVersion: '2.50.0',
    body: 'A signed webhook fires on sealed acceptance; the cookbook receiver verifies the signature and opens the invoice task. Finance acts on a provable event.' },
  { id: 'integrator-standard', tier: 'work', title: 'When another system consumes records', sinceVersion: '2.53.0',
    body: 'The three formats are published JSON Schemas with SPEC.md as the normative document. An integrator validates and builds against them without asking us anything.' },
  { id: 'assurance-state', tier: 'work', title: 'Assurance is a state',
    body: 'The version describes the software. The assurance state describes what third parties have verified. ReqPub is self-attested and says so.',
    sinceVersion: '3.0.0' },
  { id: 'migration-ledger', tier: 'hood', title: 'Migrations are ordered and recorded',
    body: 'Every migration is numbered and records its own checksum, so a database can report what revision it is at and a replay is proven to match the schema.',
    sinceVersion: '3.0.0' },
];

/* The full-height view: a pure string builder from the registry. Tiers in
   their fixed order, entries in authored order, everything through esc,
   the freshness stamp at the foot. Anchored entries carry a quiet Show me
   that lights the real control through the walkthrough spotlight. */
/* renderCapabilities(APP, anchorRoutes) - anchorRoutes maps an anchor key to
   the screen its control lives on, passed in from help.js so this module does
   not import back into it. An entry whose control is on another screen says
   where it lives instead of offering a Show me that would light nothing: a
   control that promises to point at something and then points at nothing is
   worse than no control. */
export function renderCapabilities(APP, anchorRoutes) {
  const routes = anchorRoutes || {};
  const here = (APP && APP.view === 'workspace') ? 'workspace'
    : (APP && APP.view === 'projects') ? 'projects' : (APP && APP.view) || '*';
  const SCREEN = { workspace: 'the record screen', projects: 'the projects screen' };
  const reachable = (key) => { const r = routes[key]; return !r || r === '*' || r === here; };
  const elsewhereNote = (key) => {
    const r = routes[key];
    return '<span style="color:var(--ink-4);font-size:9.5px;font-style:italic" title="This control is not on the screen you are on right now">On ' +
      esc(SCREEN[r] || r) + '</span>';
  };
  const tiers = TIER_ORDER.map((t) => {
    const items = CAPABILITIES.filter((c) => c.tier === t).map((c) =>
      '<div style="padding:9px 0;border-top:1px solid var(--line)">' +
      '<div style="display:flex;align-items:baseline;gap:8px">' +
      '<div style="font-weight:640;font-size:13px">' + esc(c.title) + '</div>' +
      '<span style="flex:1"></span>' +
      (c.anchor
        ? (reachable(c.anchor)
            ? '<button class="btn btn-ghost btn-sm" data-action="capshow" data-anchor="' + escA(c.anchor) + '" data-title="' + escA(c.title) + '" style="height:20px;font-size:10px;padding:0 7px">Show me</button>'
            : elsewhereNote(c.anchor))
        : '') +
      '<span style="color:var(--ink-4);font-size:9.5px" title="In the product since this release">v' + esc(c.sinceVersion) + '</span>' +
      '</div>' +
      '<div style="font-size:12.5px;color:var(--ink-2);margin-top:2px;line-height:1.45">' + esc(c.body) + '</div>' +
      '</div>').join('');
    return '<div class="help-group" style="margin-top:14px">' + esc(TIER_LABELS[t]) + '</div>' + items;
  }).join('');
  return '<div style="font-size:15px;font-weight:660;margin-bottom:2px">What ReqPub does</div>' +
    '<div style="font-size:12px;color:var(--ink-3);margin-bottom:4px">The obvious, the mechanisms, and the situations it was built for. Five minutes, no filler.</div>' +
    tiers +
    '<div style="border-top:1px solid var(--line);margin-top:14px;padding-top:8px;font-size:10.5px;color:var(--ink-4)">Current through v' + esc(APP_VERSION) + '</div>';
}
