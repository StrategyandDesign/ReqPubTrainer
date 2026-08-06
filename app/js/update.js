/* ReqPub v2 - weekly update assembler. A published update is the client's
   ten-second read: what we need from you, what moved, what stays open. The
   doctrine line it must never cross (docs/DEPLOY.md): no RAID log, no
   hand-maintained status. So every line here DERIVES from record truth -
   pending approvals, pending signatures, gate rows, health signals, the
   activity trail - through pure functions with no clock and no network.
   The composer picks and rewords; publishing freezes the result; next
   week's assembly diffs against the frozen payload to age closed items
   off. main.js only wires inputs and the one async fingerprint. */

import { healthSignals } from './health.js';

const blank = (s) => !String(s == null ? '' : s).trim();
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; };
const filledRows = (rows) => (rows || []).filter((r) => r && Object.keys(r).some((k) => k !== '_k' && !blank(r[k])));

/* One word the strip leads with. gap → the record is missing something a
   defensible baseline needs; warn → watch it; clean → on track. */
export function healthWord(sigs) {
  const s = sigs || [];
  if (s.some((x) => x.level === 'gap')) return 'Needs attention';
  if (s.length) return 'On watch';
  return 'On track';
}

/* The next milestone, by a fixed rule: the first gate row (record order)
   whose target date has not passed - blank and "to confirm" targets count
   as not passed, they are exactly the undated future. No gates: the newest
   version still in review is the milestone. Nothing at all: empty. */
export function nextMilestone(a, versions, now) {
  const gates = filledRows((a || {}).gates);
  for (const g of gates) {
    const t = String(g.target || '').trim();
    const d = t && !/to confirm/i.test(t) ? Date.parse(t) : NaN;
    if (isNaN(d) || d >= +now) return { text: clip(g.gate || 'Next gate', 60), target: t };
  }
  const inRev = (versions || []).filter((v) => v.status === 'in_review').sort((x, y) => y.seq - x.seq)[0];
  if (inRev) return { text: 'v' + inRev.label + ' approval', target: '' };
  return { text: '', target: '' };
}

/* Ask candidates - what only the client can unblock, from three derived
   sources. The composer picks up to three and may reword; src survives so
   a reworded ask still traces. */
export function askCandidates({ answers, versions, approvalsByVersion, signsByVersion }) {
  const out = [];
  const vs = (versions || []).slice().sort((x, y) => y.seq - x.seq);
  for (const v of vs) {
    for (const sg of (signsByVersion || {})[v.id] || []) {
      if (sg.status === 'pending' && !sg.revoked) {
        out.push({
          text: 'Sign v' + v.label + (sg.signer_role ? ' as ' + sg.signer_role : ''),
          why: 'Your signature link is live' + (sg.signer_email ? ' at ' + sg.signer_email : ''),
          src: 'sign:' + sg.id,
        });
      }
    }
    for (const ap of (approvalsByVersion || {})[v.id] || []) {
      if (ap.status === 'pending') {
        out.push({
          text: 'Approve v' + v.label + (ap.approver_role ? ' as ' + ap.approver_role : ''),
          why: ap.approver_name ? 'Assigned to ' + ap.approver_name : 'Sign-off slot is open',
          src: 'appr:' + ap.id,
        });
      }
    }
  }
  for (const g of filledRows((answers || {}).gates)) {
    if (!blank(g.decider)) {
      out.push({
        text: 'Decide ' + clip(g.gate || 'the next gate', 50),
        why: clip(g.criteria || '', 80) || 'Criteria on the record',
        src: 'gate:' + (g._k != null ? g._k : ''),
      });
    }
  }
  return out;
}

/* What moved: activity rows inside the window, mapped to client language.
   Unknown actions fall back to the row's own summary - honest, never
   invented. Newest last so the section reads as the week's story. */
const MOVED = {
  'version.created': (r) => 'Baseline ' + (r.summary || '').replace(/^Generated /, '') + ' generated',
  'version.status': (r) => r.summary,
  'version.build': (r) => r.summary,
  'sign.requested': (r) => r.summary,
  'sign.signed': (r) => r.summary,
  'sign.declined': (r) => r.summary,
  'comm.received': () => 'Subject-matter input received',
  'attachment.added': () => 'Evidence attached to the record',
  'sme.seated': () => 'A subject-matter expert joined their workspace',
};
export function movedLines({ activity, windowFrom, windowTo }) {
  const from = windowFrom ? +new Date(windowFrom) : -Infinity;
  const to = windowTo ? +new Date(windowTo) : Infinity;
  const seen = new Set();
  const out = [];
  const rows = (activity || []).slice().sort((x, y) => (x.id || 0) - (y.id || 0));
  for (const r of rows) {
    const t = +new Date(r.created_at || 0);
    if (!(t > from && t <= to)) continue;
    if (r.action === 'update.published' || r.action === 'update.revoked') continue;
    const make = MOVED[r.action] || ((x) => x.summary || '');
    let text = clip(make(r), 140);
    if (r.action && r.action.indexOf('approval') === 0 && !text) text = clip(r.summary || 'Sign-off recorded', 140);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, ref: (r.created_at || '').slice(0, 10), note: false });
  }
  return out;
}

/* Open items - the register, strictly derived, graded by a fixed rubric:
   high = a health gap, a past-due gate, or a pending sign-off on a version
   already in review; watch = health warnings, undated gates, pending
   signature links. Sorted high first, record order within grade. Each item
   carries a stable key so next week's assembly can tell resolved from
   still-open without any hand bookkeeping. */
export function openItems({ answers, versions, approvalsByVersion, signsByVersion, now }) {
  const sigs = healthSignals(answers || {}, { versions: versions || [], approvalsByVersion: approvalsByVersion || {} });
  const out = [];
  for (const s of sigs) {
    out.push({ grade: s.level === 'gap' ? 'high' : 'watch', text: clip(s.label, 110), lead: '', by: '', key: 'health:' + s.key });
  }
  for (const g of filledRows((answers || {}).gates)) {
    const t = String(g.target || '').trim();
    const d = t && !/to confirm/i.test(t) ? Date.parse(t) : NaN;
    const name = clip(g.gate || 'Gate', 60);
    if (!isNaN(d) && d < +now) {
      out.push({ grade: 'high', text: name + ' past its target', lead: clip(g.decider || '', 40), by: t, key: 'gatedue:' + (g._k != null ? g._k : name) });
    } else if (blank(t) || /to confirm/i.test(t)) {
      out.push({ grade: 'watch', text: name + ' has no target date', lead: clip(g.decider || '', 40), by: '', key: 'gatedate:' + (g._k != null ? g._k : name) });
    }
  }
  for (const v of (versions || [])) {
    const pend = ((approvalsByVersion || {})[v.id] || []).filter((x) => x.status === 'pending');
    for (const ap of pend) {
      out.push({
        grade: v.status === 'in_review' ? 'high' : 'watch',
        text: 'v' + v.label + ' awaiting ' + (ap.approver_role || 'a') + ' sign-off',
        lead: clip(ap.approver_name || '', 40), by: '', key: 'appr:' + ap.id,
      });
    }
    for (const sg of ((signsByVersion || {})[v.id] || [])) {
      if (sg.status === 'pending' && !sg.revoked) {
        out.push({ grade: 'watch', text: 'Signature pending on v' + v.label, lead: clip(sg.signer_name || sg.signer_email || '', 40), by: '', key: 'sign:' + sg.id });
      }
    }
  }
  const rank = { high: 0, watch: 1 };
  return out.sort((x, y) => rank[x.grade] - rank[y.grade]);
}

/* Items open last week and gone now: closed once, then aged off. Purely a
   key diff against the frozen previous payload - no state anywhere else. */
export function closedSince(prevPayload, open) {
  const live = new Set((open || []).map((x) => x.key));
  return (((prevPayload || {}).open) || [])
    .filter((x) => x.key && !live.has(x.key))
    .map((x) => ({ text: x.text }))
    .slice(0, 3);
}

/* The whole draft, deterministically. Caps are the one-page discipline:
   asks 3, moved 4, open 6 with the remainder counted, closed 3. */
export const UPDATE_CAPS = { asks: 3, moved: 4, open: 6, closed: 3 };
export function assembleUpdate({ answers, versions, approvalsByVersion, signsByVersion, activity, prevPayload, windowFrom, windowTo, now }) {
  now = now || windowTo || new Date();
  const sigs = healthSignals(answers || {}, { versions: versions || [], approvalsByVersion: approvalsByVersion || {} });
  const asks = askCandidates({ answers, versions, approvalsByVersion, signsByVersion });
  const moved = movedLines({ activity, windowFrom, windowTo });
  const open = openItems({ answers, versions, approvalsByVersion, signsByVersion, now });
  const closed = closedSince(prevPayload, open);
  return {
    strip: { health: healthWord(sigs), next: nextMilestone(answers, versions, now) },
    asks, moved, open, closed,
    openMore: Math.max(0, open.length - UPDATE_CAPS.open),
    window: { from: windowFrom || null, to: windowTo || null },
  };
}
