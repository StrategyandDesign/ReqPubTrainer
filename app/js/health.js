/* ============================================================================
   ReqPub v2 - record health (pure, tested)

   Two computations over the assembled answers and the collaboration state:

   1. healthSignals(a, ctx)  - baseline-readiness gaps, each a deterministic
      predicate over the record itself: a Must requirement without a fit
      criterion, a component without an owner, an approved version with no
      published brief, and so on. Signals are DERIVED, never stored: nothing
      here writes to the record, and a signal disappears the moment the gap is
      fixed. Levels: 'gap' (blocks a defensible baseline), 'warn' (weakens it).

   2. recordCounts(a, ctx)   - what this record already holds: versions,
      named sign-offs, decisions, discovery entries, promoted inputs, external
      submissions, evaluation criteria. Counts only; deliberately no composite
      "score" is invented, because a number that cannot be defended under
      review has no place on a requirements record.

   ctx = { versions, approvalsByVersion, shares, comms, discovery } - exactly
   the shapes openProject already loads (APP.versions, APP.approvals,
   APP.shares, APP.comms, APP.discovery). Every field is optional; a missing
   collection simply contributes nothing.
   ============================================================================ */

import { rowsFilled, isEngagement } from './domain.js';

/* Origins that arrive from outside the team (mirrors the inbox constant). */
const EXTERNAL_ORIGINS = ['brief', 'app', 'sme', 'partner'];

const filled = (arr) => rowsFilled(arr || []);
const isMust = (r) => (r.pri || 'Must') === 'Must';   // priority defaults to Must, as in the summary
const blank = (s) => !s || !String(s).trim();

/* Count 'to confirm' placeholders across every answer value (scalars, list
   items, and row cells). The phrase is the worksheet's own placeholder
   convention, so unresolved instances are open items by the record's own
   definition. Case-insensitive; '_k' bookkeeping is skipped. */
export function countToConfirm(a) {
  let n = 0;
  const scan = (v) => {
    if (v == null) return;
    if (typeof v === 'string') { const m = v.match(/to confirm/gi); if (m) n += m.length; return; }
    if (Array.isArray(v)) { v.forEach(scan); return; }
    if (typeof v === 'object') { for (const k of Object.keys(v)) if (k !== '_k') scan(v[k]); }
  };
  for (const k of Object.keys(a || {})) scan(a[k]);
  return n;
}

/* The latest version row, or null. Versions arrive ordered by seq ascending
   (projectBundle orders them); take the last rather than assuming. */
const latestVersion = (versions) => {
  const vs = versions || [];
  return vs.length ? vs.reduce((m, v) => (v.seq > m.seq ? v : m), vs[0]) : null;
};

/* Is there a live (unrevoked) published brief for this version seq? */
const briefFor = (shares, seq) =>
  (shares || []).some((s) => s.kind === 'brief' && !s.revoked && s.version_seq === seq);

/* ---------------------------------------------------------------------------
   Readiness signals. Each entry: { key, level, count, label, detail }.
   Order is severity-first, then worksheet order, so the list reads as a
   punch list. An empty array means: nothing blocks this record.
   --------------------------------------------------------------------------- */
/* Signals are DERIVED, never stored - with one deliberate exception that is
   not an exception: at version generation, main.js runs healthSignals and
   stores the RESULT inside the snapshot. That is not a live signal; it is the
   state of the record at the moment it was fixed, inside an already-immutable
   baseline. Evidence, not a score. "Approved with two known warnings, named"
   is the most defensible sentence in the product. */
/* One convention on every surface: gaps and warnings count SIGNALS (distinct
   issues), and a signal's own multiplicity shows as ×N on its row. The Health
   badge, the topbar pill, the cover rail, and the gate packet all agree. */
export const healthStateLine = (sigs) => {
  const n = (lvl) => (sigs || []).filter((s) => s.level === lvl).length;
  const g = n('gap'), w = n('warn');
  return g + ' gap' + (g === 1 ? '' : 's') + ' · ' + w + ' warning' + (w === 1 ? '' : 's');
};
/* The ambient count on the workspace topbar. Gaps outrank warnings; the label
   never calls a warning a gap. Empty string when the record is clean. */
export const healthPillLabel = (sigs) => {
  const g = (sigs || []).filter((s) => s.level === 'gap').length;
  const w = (sigs || []).filter((s) => s.level === 'warn').length;
  if (g) return g + ' gap' + (g === 1 ? '' : 's');
  if (w) return w + ' warning' + (w === 1 ? '' : 's');
  return '';
};
/* 'v1.0' / 'v1.0, v2.0' / 'v1.0, v2.0, v3.0 +2 more' - which versions a
   version-scoped signal is about, so the fix lands on the right baseline. */
const labelList = (vs) => {
  const ls = (vs || []).map((v) => 'v' + (v.label || v.seq));
  return ls.slice(0, 3).join(', ') + (ls.length > 3 ? ' +' + (ls.length - 3) + ' more' : '');
};

export function healthSignals(a, ctx = {}) {
  a = a || {};
  const eng = isEngagement(a);
  const out = [];
  const add = (key, level, count, label, detail) => {
    if (count > 0 || count === true) out.push({ key, level, count: count === true ? 1 : count, label, detail });
  };

  if (!eng) {
    // Must requirements without a fit criterion (FR + NFR). A requirement
    // without its measurable acceptance condition cannot be verified, which
    // is the platform's own definition of a requirement.
    const noFit = [...filled(a.fr), ...filled(a.nfr)].filter((r) => isMust(r) && !blank(r.stmt) && blank(r.fit));
    add('must_no_fit', 'gap', noFit.length,
      'Must requirement' + (noFit.length === 1 ? '' : 's') + ' without a fit criterion',
      'Every Must needs its measurable acceptance condition before a baseline is defensible.');

    // AI declared, but Section 9 is empty: probabilistic components cannot be
    // verified by a single expected output; they need evaluation criteria.
    if (a.has_ai === 'Yes') {
      add('ai_no_evals', 'gap', filled(a.eval).length === 0,
        'AI declared with no evaluation criteria',
        'Section 9 needs at least a grounding guardrail and a safety threshold against a golden dataset.');
      add('ai_no_golden', 'warn', filled(a.eval).length > 0 && blank(a.golden),
        'No golden dataset or red-team approach stated',
        'The evaluation criteria exist, but not what they are measured against.');
    }

    // Safeguarding declared necessary but not designed.
    add('vulnerable_no_safeguard', 'gap', a.vulnerable === 'Yes' && blank(a.safeguard),
      'Vulnerable users declared with no safeguarding response',
      'Section 10 requires the response, and it needs clinical or policy sign-off.');

    // Requirements untagged to a component, once components exist. Untagged
    // requirements fall out of every component view and brief grouping.
    const comps = filled(a.components);
    if (comps.length) {
      const untagged = [...filled(a.fr), ...filled(a.nfr)].filter((r) => blank(r.comp));
      add('req_untagged', 'warn', untagged.length,
        'Requirement' + (untagged.length === 1 ? '' : 's') + ' not tagged to a component',
        'Tag them in Sections 7 and 8 so ownership and grouping hold.');
    }
  }

  // Components (workstreams, in an engagement) without an owner.
  const noOwner = filled(a.components).filter((r) => !blank(r.name) && blank(r.owner));
  add('comp_no_owner', 'warn', noOwner.length,
    (eng ? 'Workstream' : 'Component') + (noOwner.length === 1 ? '' : 's') + ' without an owner',
    'Unowned work is unaccountable work; name someone per row.');

  // Out of scope left empty: the record's own help text calls this the
  // clearest protection against scope creep during handoff.
  add('no_out_of_scope', 'warn', (a.sol_out || []).filter(Boolean).length === 0,
    'Nothing declared out of scope',
    'An empty exclusion list is the clearest invitation to scope creep.');

  // An engagement with no decisions recorded has not yet captured the one
  // thing an engagement record exists to defend.
  if (eng) {
    add('eng_no_decisions', 'warn', filled(a.decisions).length === 0,
      'No decisions recorded yet',
      'Key decisions with owner and rationale are the record you defend later.');
  }

  // Latest version approved, but no live brief published for it: the team
  // Every version gets named approvers before it goes to review. The state
  // machine blocks Approved while a sign-off is PENDING, but a version with
  // zero slots sails through the gate - one manager, alone, no names on the
  // cover. The operational rule, made visible instead of made a new
  // permission tier.
  const slotsOf = (v) => ((ctx.approvalsByVersion || {})[v.id] || []).length;
  const inReviewNoAppr = (ctx.versions || []).filter((v) => v.status === 'in_review' && !slotsOf(v));
  add('review_no_approvers', 'gap', inReviewNoAppr.length,
    'In review with no named approvers' + (inReviewNoAppr.length ? ': ' + labelList(inReviewNoAppr) : ''),
    'The approvals gate only protects versions that have sign-off slots. Name the approvers on that version, then send it to review.');
  // A signal must be fixable, and this one is: a manager can record a manual
  // sign-off on an approved baseline from Version history (the schema permits
  // it and stamps who recorded it, when). It names its versions so the fix
  // lands on the right one - and it clears the moment the sign-off does.
  const approvedNoAppr = (ctx.versions || []).filter((v) => v.status === 'approved' && !slotsOf(v));
  add('approved_no_signoff', 'warn', approvedNoAppr.length,
    'Approved without a named sign-off' + (approvedNoAppr.length ? ': ' + labelList(approvedNoAppr) : ''),
    'The cover shows approval by state alone. Open that version in Version history and record the sign-off - it is stamped to whoever records it - and this clears the moment it lands.');

  // signed a baseline the client-facing surface does not yet reflect.
  const lv = latestVersion(ctx.versions);
  if (lv && lv.status === 'approved') {
    add('approved_no_brief', 'warn', !briefFor(ctx.shares, lv.seq),
      'v' + lv.label + ' is approved with no published brief',
      'Publish the brief so external reviewers see the baseline that was actually signed.');
  }

  // Unresolved placeholders anywhere in the record.
  const tc = countToConfirm(a);
  add('to_confirm', 'warn', tc,
    'Unresolved "to confirm" placeholder' + (tc === 1 ? '' : 's'),
    'Each one is an open item by the record\u2019s own convention.');

  const rank = { gap: 0, warn: 1 };
  out.sort((x, y) => rank[x.level] - rank[y.level]);
  return out;
}

/* ---------------------------------------------------------------------------
   What the record holds. Plain counts from data already loaded; every number
   here is defensible by pointing at rows.
   --------------------------------------------------------------------------- */
/* Where a project opens: on Health once a baseline exists (the job is
   defending), on the document before one does (the job is drafting). A blanket
   health-first landing would punish the drafting session with a thin page. */
export const landingTab = (versions) => ((versions || []).length ? 'health' : 'document');

/* Promotion-sourced rows in a snapshot's answers, with their permanent ids -
   the rows a client can be shown as "your input, in the baseline you signed". */
export function incorporatedRows(answers) {
  const a = answers || {};
  const groups = [['fr', 'FR'], ['nfr', 'NFR'], ['eval', 'EVAL'], ['interfaces', 'IR']];
  const out = [];
  groups.forEach(([k, pre]) => (a[k] || []).forEach((r) => {
    if (r && r.src && r._k != null) out.push({ id: pre + '-' + String(r._k).padStart(3, '0'), src: r.src });
  }));
  return out;
}

export function recordCounts(a, ctx = {}) {
  a = a || {};
  const versions = ctx.versions || [];
  const approvalsByVersion = ctx.approvalsByVersion || {};
  const comms = ctx.comms || [];
  const discovery = ctx.discovery || [];

  let signoffs = 0;
  for (const id of Object.keys(approvalsByVersion)) {
    signoffs += (approvalsByVersion[id] || []).filter((ap) => ap.status === 'approved').length;
  }
  const promoted =
    comms.filter((c) => c.promoted_to).length +
    discovery.filter((d) => d.promoted_to).length;

  // Two accumulation facts a client relationship stands on, both derived:
  // how many promoted inputs made it INTO an approved baseline (rows in the
  // latest approved snapshot carrying a promotion src), and when the client
  // last saw the record move (the latest approved baseline's date).
  const approvedSnap = ctx.latestApprovedAnswers || null;
  const incorporated = approvedSnap ? incorporatedRows(approvedSnap).length : 0;
  const approvedDates = versions.filter((v) => v.status === 'approved' && v.created_at).map((v) => v.created_at).sort();
  const lastClientVisible = approvedDates.length ? approvedDates[approvedDates.length - 1] : '';

  return {
    versions: versions.length,
    approvedVersions: versions.filter((v) => v.status === 'approved').length,
    incorporated,
    lastClientVisible,
    signoffs,
    decisions: filled(a.decisions).length,
    requirements: filled(a.fr).length + filled(a.nfr).length,
    evals: filled(a.eval).length,
    discovery: discovery.length,
    external: comms.filter((c) => EXTERNAL_ORIGINS.includes(c.origin)).length,
    promoted,
    openThreads: comms.filter((c) => c.status === 'new' || c.status === 'in_review').length,
    toConfirm: countToConfirm(a)
  };
}
