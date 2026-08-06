/* ============================================================================
   ReqPub v2 - external views
   Client portal (schema role: partner - account holders managing SMEs) and the accountless SME
   pages: review brief, app feedback form, note-request intake, and the
   tokened two-way thread each submission opens.
   ============================================================================ */

import { APP_VERSION, esc, escA, ico, IC, brandmark, relTime, initials, attachChips, attachInput } from './core.js';
import { mdToHtml, bBrief } from './domain.js';
import { wtImageUrl } from './data.js';

/* The shared walkthrough: images stream through the tokened walkthrough-image
   path, scoped to exactly the shots frozen into this share's version. */
function walkthroughCard(payload, token) {
  const shots = Array.isArray(payload && payload.walkthrough) ? payload.walkthrough : [];
  if (!shots.length || !token) return '';
  const figs = shots.map((f, i) => {
    const src = wtImageUrl(token, f.attachment_id);
    const img = src
      ? '<img src="' + escA(src) + '" alt="' + escA(f.caption || f.file_name || ('Shot ' + (i + 1))) + '" loading="lazy" style="display:block;width:100%;border:1px solid var(--line);border-radius:10px">'
      : '';
    const cap = f.caption
      ? '<div style="font-size:12.5px;line-height:1.55;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:8px 11px;margin-top:7px"><span class="mono" style="font-size:10.5px;color:var(--ink-2);margin-right:7px">' + (i + 1) + '</span>' + esc(f.caption) + '</div>'
      : '<div style="font-size:11px;color:var(--ink-2);margin-top:6px"><span class="mono">' + (i + 1) + '</span> · ' + esc(f.file_name || '') + '</div>';
    return '<figure style="margin:0 0 18px">' + img + cap + '</figure>';
  }).join('');
  return '<div class="card" style="padding:26px 30px;margin-top:18px">' +
    '<div class="eyebrow xd" style="font-size:9.5px;margin-bottom:4px">Demo walkthrough</div>' +
    '<div style="font-size:12.5px;color:var(--ink-2);margin-bottom:14px">Each screenshot shows one action, in order. Sealed with v' + esc(payload.label || '?') + '.</div>' + figs + '</div>';
}

/* The collaborator logo the internal team assigned to this PRD, co-signed by
   ReqPub. Rendered above the brief the SME/partner sees. */
const okLogo = (u) => typeof u === 'string' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u);
function brandBanner(payload) {
  // v2.55: the practice watermark rides the banner chokepoint and never
  // depends on a logo being present.
  const mark = practiceMark(payload && payload.practice);
  if (!payload || !okLogo(payload.logo)) return mark;
  return mark + '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 0 18px;margin-bottom:20px;border-bottom:1px solid var(--line)">' +
    '<div style="display:flex;align-items:center;gap:12px;min-width:0">' +
    '<img src="' + escA(payload.logo) + '" alt="' + escA(payload.brandLabel || 'Client') + '" style="max-height:52px;max-width:200px;object-fit:contain">' +
    (payload.brandLabel ? '<span style="font-size:15px;font-weight:620;color:var(--ink);letter-spacing:-.01em">' + esc(payload.brandLabel) + '</span>' : '') + '</div>' +
    '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--ink-2);flex:0 0 auto">' +
    '<span class="brandmark" style="width:18px;height:18px;border-radius:5px"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></span>ReqPub</span></div>';
}

const wrap = (inner, max) =>
  '<div style="min-height:100vh;background:var(--bg-2);padding:46px 20px"><div style="width:100%;max-width:' + (max || 600) + 'px;margin:0 auto">' + inner + '</div></div>' +
  '<div id="toast-slot" aria-live="polite" aria-atomic="true"></div>';

export const renderLoading = () =>
  '<div style="min-height:100vh;background:var(--bg-2);display:flex;align-items:center;justify-content:center;padding:24px"><div style="color:var(--ink-2);font-size:13.5px">Loading…</div></div>';

const invalidCard = (what) =>
  '<div class="card" style="padding:40px;text-align:center"><div style="font-size:16px;font-weight:620;margin-bottom:6px">This ' + what + ' link is not valid</div><div style="color:var(--ink-2);font-size:14px;line-height:1.5">It may have been revoked or replaced. Ask your contact for a current one.</div></div>';

const smeHeader = (eyebrow, title, sub) =>
  '<div style="margin-bottom:22px"><div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">' + brandmark(28) +
  '<span class="eyebrow xd" style="font-size:9.5px">' + esc(eyebrow) + '</span></div>' +
  '<h1 style="font-size:24px;letter-spacing:-.02em;font-weight:660;margin:0 0 4px">' + esc(title) + '</h1>' +
  (sub ? '<div style="font-size:13px;color:var(--ink-2)">' + esc(sub) + '</div>' : '') + '</div>';

/* ---- Accountless two-way thread (shown under a submission once sent) ---- */
/* v2.55: the practice watermark. One builder, every external surface: a
   rehearsal announces itself wherever the record shows its face. */
export const practiceMark = (on) => on
  ? '<div style="border:1.5px solid var(--amber);color:var(--amber);border-radius:9px;padding:6px 12px;margin:0 0 14px;font-weight:680;font-size:11.5px;letter-spacing:.12em;text-align:center">PRACTICE RECORD \u00b7 a rehearsal, never evidence</div>'
  : '';

export function smeThreadCard(APP) {
  const t = APP.smeThread;
  if (!t || !t.ok) return '';
  const msgs = (t.messages || []).map((m) =>
    '<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--ink-2);margin-bottom:3px;font-weight:600">' + esc(m.name || (m.from === 'team' ? 'Team' : 'You')) + (m.from === 'team' ? '' : ' (you)') + ' · ' + esc(relTime(m.at)) + '</div>' +
    '<div style="font-size:13.5px;color:var(--ink-2);line-height:1.6;white-space:pre-wrap">' + esc(m.body) + '</div></div>').join('');
  return '<div class="card" style="padding:22px;margin-top:16px">' +
    '<div style="font-size:14px;font-weight:640;margin-bottom:4px">Your conversation with the team</div>' +
    '<div style="font-size:12px;color:var(--ink-2);margin-bottom:14px">Bookmark this page. Replies from the team appear here. No account needed.</div>' +
    '<div style="border-top:1px solid var(--line);padding-top:12px;margin-bottom:4px">' +
    '<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--ink-2);margin-bottom:3px;font-weight:600">You · ' + esc(relTime(t.at)) + '</div>' +
    '<div style="font-size:13.5px;color:var(--ink-2);line-height:1.6;white-space:pre-wrap">' + esc(t.body) + '</div></div>' + msgs + '</div>' +
    '<textarea class="input" id="smeReplyBody" rows="2" placeholder="Add to the conversation" style="resize:vertical;min-height:48px;line-height:1.5"></textarea>' +
    '<div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn btn-primary btn-sm" data-action="smereply">Send</button></div></div>';
}

/* ---- SME: review brief (#brief/pid/seq/token) ---- */
export function renderBriefView(APP) {
  const s = APP.share;
  if (!s || !s.payload) return wrap(invalidCard('brief'), 680);
  const p = s.payload;
  const md = bBrief(p.answers || {}, p.sections);
  const f = APP.shareForm || {};
  const header = brandBanner(p) + '<div style="margin-bottom:22px"><div style="display:flex;align-items:center;gap:9px;margin-bottom:10px;flex-wrap:wrap">' +
    '<span class="pill pill-solid"><span class="mono">v' + esc(p.label || '?') + '</span></span><span class="eyebrow xd" style="font-size:9.5px">Review brief</span>' +
    '<div style="flex:1"></div>' +
    '<button class="btn btn-ghost btn-sm" data-action="smepresent" title="Copy a read-only link to share">' + ico(IC.link, 'i-sm') + 'Share view</button>' +
    '<button class="btn btn-sec btn-sm" data-action="brandprint" title="Print or save as PDF">' + ico(IC.print, 'i-sm') + 'Print / PDF</button></div>' +
    '<h1 style="font-size:27px;letter-spacing:-.02em;font-weight:660;margin:0 0 8px">' + esc(p.product || 'Untitled') + '</h1>' +
    '<div style="color:var(--ink-2);font-size:13.5px;line-height:1.5">' + ((p.answers && p.answers.ctrl_org) ? esc(p.answers.ctrl_org) + '. ' : '') + 'Plain-language summary for review. No requirement detail, schedule, or internal notes.' +
    (Array.isArray(p.sections) && p.sections.length && p.sections.length < 9 ? ' The team shared ' + p.sections.length + ' section' + (p.sections.length === 1 ? '' : 's') + ' of this document.' : '') + '</div></div>';
  let reviewCard;
  if (f.submitted) {
    reviewCard = '<div class="card" style="padding:30px;text-align:center;margin-top:18px">' +
      '<div style="width:42px;height:42px;border-radius:50%;background:var(--good);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;color:#fff">' + ico(IC.check) + '</div>' +
      '<div style="font-size:17px;font-weight:640;margin-bottom:5px">Thank you for reviewing</div>' +
      '<div style="color:var(--ink-2);font-size:13.5px">Your review reached the team instantly.</div></div>' + smeThreadCard(APP);
  } else {
    const vchip = (o) => '<button class="chip' + (f.verdict === o ? ' on' : '') + '" data-action="shareset" data-key="verdict" data-val="' + escA(o) + '">' + esc(o) + '</button>';
    reviewCard = '<div class="card" style="padding:24px;margin-top:18px">' +
      '<div style="font-size:15px;font-weight:620;margin-bottom:4px">Does this capture what you need?</div>' +
      '<div style="color:var(--ink-2);font-size:12.5px;margin-bottom:16px">Your review opens a two-way thread with the team. No account needed.</div>' +
      '<div style="margin-bottom:16px"><div class="eyebrow xd" style="font-size:9px;margin-bottom:7px">Your read</div><div class="choice">' + vchip('Looks complete') + vchip('Needs changes') + '</div></div>' +
      '<div style="margin-bottom:16px"><div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Your name <span style="color:var(--ink-2);font-weight:440">required</span></div><input class="input" data-share="name" value="' + escA(f.name || '') + '" placeholder="First and last"></div>' +
      '<div style="margin-bottom:16px"><div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Notes</div><textarea class="input" data-share="note" rows="4" placeholder="What is missing, what is off, or what to add" style="resize:vertical;min-height:96px;line-height:1.5">' + esc(f.note || '') + '</textarea></div>' +
      '<button class="btn btn-primary" data-action="sharesubmit"' + (f.busy ? ' disabled' : '') + ' style="width:100%;height:46px">' + ico(IC.send) + (f.busy ? 'Sending…' : 'Send review') + '</button>' +
      (f.error ? '<div style="color:var(--bad);font-size:12.5px;margin-top:10px;text-align:center;font-weight:540">' + esc(f.error) + '</div>' : '') + '</div>';
  }
  const content = md.trim() ? '<div class="card" style="padding:28px 32px">' + mdToHtml(md) + '</div>'
    : '<div class="card" style="padding:30px;color:var(--ink-2);font-size:14px">Not enough content to summarize yet.</div>';
  return wrap(header + content + walkthroughCard(p, APP.shareToken) + reviewCard, 680);
}

/* ---- SME: app feedback form (#fb/pid/seq/token) ---- */
export function renderFeedbackForm(APP) {
  const s = APP.share;
  if (!s || !s.payload) return wrap(invalidCard('feedback'), 600);
  const p = s.payload;
  const f = APP.shareForm || {};
  if (f.submitted) {
    return wrap(smeHeader('Feedback received', 'Thank you', p.product || '') +
      '<div class="card" style="padding:30px;text-align:center"><div style="width:42px;height:42px;border-radius:50%;background:var(--good);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;color:#fff">' + ico(IC.check) + '</div>' +
      '<div style="font-size:15px;font-weight:620;margin-bottom:4px">Sent to the team</div>' +
      '<div style="color:var(--ink-2);font-size:13px;margin-bottom:16px">They see it immediately, against v' + esc(p.label || '?') + (p.build ? ' (build ' + esc(p.build) + ')' : '') + '.</div>' +
      '<button class="btn btn-sec btn-sm" data-action="shareagain">Report something else</button></div>' + smeThreadCard(APP), 600);
  }
  const chip = (key, o, cur) => '<button class="chip chip-sm' + (cur === o ? ' on' : '') + '" data-action="shareset" data-key="' + key + '" data-val="' + escA(o) + '">' + esc(o) + '</button>';
  const comps = ((p.answers && p.answers.components) || []).map((c) => c.name).filter(Boolean);
  return wrap(smeHeader('App testing · v' + (p.label || '?') + (p.build ? ' · build ' + p.build : ''), p.product || 'Feedback', 'Send a bug, an idea, or a question. Each one opens a thread you can reply in.') +
    '<div class="card" style="padding:22px">' +
    '<div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Type</div><div class="choice" style="margin-bottom:16px">' + ['Bug', 'Idea', 'Question'].map((o) => chip('type', o, f.type || 'Bug')).join('') + '</div>' +
    ((f.type || 'Bug') === 'Bug' ? '<div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Severity</div><div class="choice" style="margin-bottom:16px">' + ['Critical', 'Major', 'Minor'].map((o) => chip('severity', o, f.severity || 'Minor')).join('') + '</div>' : '') +
    (comps.length ? '<div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Area</div><div class="choice" style="margin-bottom:16px">' + comps.map((o) => chip('area', o, f.area)).join('') + '</div>' : '') +
    '<div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Title <span style="color:var(--ink-2);font-weight:440">required</span></div><input class="input" data-share="title" value="' + escA(f.title || '') + '" placeholder="One line" style="margin-bottom:16px">' +
    '<div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Detail <span style="color:var(--ink-2);font-weight:440">required</span></div><textarea class="input" data-share="note" rows="4" placeholder="What happened, what you expected" style="resize:vertical;min-height:110px;line-height:1.5;margin-bottom:16px">' + esc(f.note || '') + '</textarea>' +
    ((f.type || 'Bug') === 'Bug' ? '<div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Steps to reproduce</div><textarea class="input" data-share="steps" rows="3" placeholder="1. …&#10;2. …" style="resize:vertical;min-height:80px;line-height:1.5;margin-bottom:16px">' + esc(f.steps || '') + '</textarea>' : '') +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">' +
    '<div style="flex:1;min-width:160px"><div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Your name <span style="color:var(--ink-2);font-weight:440">required</span></div><input class="input" data-share="name" value="' + escA(f.name || '') + '" placeholder="First and last"></div>' +
    '<div style="flex:1;min-width:160px"><div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Email <span style="color:var(--ink-2);font-weight:440">optional</span></div><input class="input" data-share="email" type="email" value="' + escA(f.email || '') + '" placeholder="you@company.com"></div></div>' +
    '<button class="btn btn-primary" data-action="sharesubmit"' + (f.busy ? ' disabled' : '') + ' style="width:100%;height:46px">' + ico(IC.send) + (f.busy ? 'Sending…' : 'Send feedback') + '</button>' +
    (f.error ? '<div style="color:var(--bad);font-size:12.5px;margin-top:10px;text-align:center;font-weight:540">' + esc(f.error) + '</div>' : '') +
    '</div>', 600);
}

/* ---- SME: note-request intake (#note/pid/token) ---- */
export function renderNoteIntake(APP) {
  const r = APP.request;
  if (!r || !r.ok) return wrap(invalidCard('request'), 600);
  const f = APP.shareForm || {};
  if (f.submitted) {
    return wrap(smeHeader('Request for input', 'Thank you', r.product || '') +
      '<div class="card" style="padding:34px 30px;text-align:center"><div style="width:46px;height:46px;border-radius:50%;background:var(--good);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:#fff">' + ico(IC.check) + '</div>' +
      '<div style="font-size:19px;font-weight:660;margin-bottom:6px">Your input reached the team</div>' +
      '<div style="color:var(--ink-2);font-size:12.5px;line-height:1.55;margin:0 auto 20px;max-width:340px">They review it against the current version and may reply below. Keep this link. You can add more anytime.</div>' +
      '<button class="btn btn-sec btn-sm" data-action="shareagain">Add more</button></div>' + smeThreadCard(APP), 600);
  }
  if (r.status === 'closed') {
    return wrap(smeHeader('Request for input', r.title || 'Request closed', r.product || '') +
      '<div class="card" style="padding:30px;text-align:center;color:var(--ink-2);font-size:14px">This request has been closed by the team. Thank you. No further input is needed.</div>', 600);
  }
  const thread = (r.thread || []).map((t) =>
    '<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--ink-2);margin-bottom:3px;font-weight:600">' + esc(t.name || 'Team') + '</div>' +
    '<div style="font-size:13.5px;color:var(--ink-2);line-height:1.6;white-space:pre-wrap">' + esc(t.body) + '</div></div>').join('');
  return wrap(smeHeader('Request for input', r.title || 'We would value your input', r.product || '') +
    (r.prompt ? '<div class="card" style="padding:20px 22px;margin-bottom:16px"><div style="font-size:13.5px;color:var(--ink-2);line-height:1.6;white-space:pre-wrap">' + esc(r.prompt) + '</div></div>' : '') +
    (thread ? '<div class="card" style="padding:20px 22px;margin-bottom:16px">' + thread + '</div>' : '') +
    '<div class="card" style="padding:22px">' +
    '<div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Your name <span style="color:var(--ink-2);font-weight:440">required</span></div><input class="input" data-share="name" value="' + escA(f.name || '') + '" placeholder="First and last" style="margin-bottom:16px">' +
    '<div style="font-size:12.5px;font-weight:560;margin-bottom:7px">Your input <span style="color:var(--ink-2);font-weight:440">required</span></div><textarea class="input" data-share="note" rows="6" placeholder="Share what you know, your questions, concerns, and must-haves." style="resize:vertical;min-height:140px;line-height:1.6">' + esc(f.note || '') + '</textarea>' +
    '<button class="btn btn-primary" data-action="sharesubmit"' + (f.busy ? ' disabled' : '') + ' style="width:100%;height:46px;margin-top:14px">' + ico(IC.send) + (f.busy ? 'Sending…' : 'Send input') + '</button>' +
    (f.error ? '<div style="color:var(--bad);font-size:12.5px;margin-top:10px;text-align:center;font-weight:540">' + esc(f.error) + '</div>' : '') +
    '</div>', 600);
}

/* ---------------- partner portal ---------------- */
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const partnerOf = (APP) => (APP.ctx && APP.ctx.partner) || {};

/* Per-card state the whole portal reasons about: does the team owe them a
   look (a reply is waiting), or do they owe the team one (a new version)? */
export function partnerCardState(APP, p) {
  const pay = p.payload || {};
  const thread = (APP.partnerThreads && APP.partnerThreads[p.project_id]) || [];
  const waiting = thread.filter((t) => (t.messages || []).length && (t.messages[t.messages.length - 1].from === 'team')).length;
  const seen = (APP.partnerSeen || {})[p.project_id] || '';
  const newVersion = !!(pay.label && seen && pay.label !== seen);
  const neverSeen = !!(pay.label && !seen);
  return { pay, thread, waiting, newVersion: newVersion || neverSeen, label: pay.label || '' };
}

function partnerMenu(APP) {
  if (!APP.menuOpen) return '';
  const pr = partnerOf(APP);
  return '<div class="umback" data-action="menuclose"></div><div class="umpop">' +
    '<div class="umhead"><span class="umav lg" style="background:var(--purple)">' + esc(initials(pr.name || pr.email || 'P')) + '</span>' +
    '<div style="min-width:0"><div class="umname">' + esc(pr.name || 'Add your name') + '</div>' +
    '<div class="umsub">' + esc([pr.title, pr.company].filter(Boolean).join(' · ') || pr.email || '') + '</div>' +
    '<span class="umrole" style="margin-top:5px;color:var(--purple);background:#f1ebfd;border-color:#e4d9fb">Client contact</span></div></div>' +
    '<div class="umsep"></div>' +
    '<button class="umitem" data-action="pprofopen">' + ico(IC.user) + 'Profile &amp; name</button>' +
    '<div class="umsep"></div><button class="umitem danger" data-action="signout">' + ico(IC.signout) + 'Sign out</button></div>';
}

export function partnerProfileModal(APP) {
  const pr = partnerOf(APP);
  return '<div class="modal-back" data-action="modalback"><div class="modal-card" role="dialog" aria-modal="true" data-stop="1">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start"><h3>Your profile</h3><button class="modal-x" data-action="modalclose">' + ico(IC.close) + '</button></div>' +
    '<div class="hint" style="margin-top:4px">Shown to the build team on every note and reply you send.</div>' +
    '<div class="fldlabel">Full name</div><input class="input" id="ppName" value="' + escA(pr.name || '') + '" placeholder="First and last">' +
    '<div class="fldlabel">Title</div><input class="input" id="ppTitle" value="' + escA(pr.title || '') + '" placeholder="e.g. Director of Research">' +
    '<div class="fldlabel">Organization</div><input class="input" id="ppCompany" value="' + escA(pr.company || '') + '" placeholder="e.g. Canfield Group">' +
    '<div class="fldlabel">Email</div><input class="input" value="' + escA(pr.email || (APP.user && APP.user.email) || '') + '" readonly style="color:var(--ink-2)">' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn btn-sec" data-action="modalclose">Cancel</button>' +
    '<button class="btn btn-primary" data-action="pprofsave">Save profile</button></div></div></div>';
}

function partnerTopbar(APP) {
  const pr = partnerOf(APP);
  return '<div class="topbar"><div style="display:flex;align-items:center;gap:11px">' + brandmark() +
    '<div><div style="font-weight:660;letter-spacing:-.02em;font-size:15px">ReqPub</div><div class="eyebrow xd" style="font-size:9.5px;letter-spacing:.18em;margin-top:1px">Client portal</div></div></div>' +
    '<div style="display:flex;align-items:center;gap:8px"><span class="pill" style="color:var(--purple);border-color:var(--purple)">Client contact</span>' +
    '<button class="umbtn" data-action="usermenu" title="Account"><span class="umav" style="background:var(--purple)">' + esc(initials(pr.name || pr.email || (APP.user && APP.user.email) || 'P')) + '</span></button></div></div>';
}

const partnerChrome = (APP, inner) =>
  '<div class="app">' + partnerTopbar(APP) + inner + '</div>' +
  '<div id="toast-slot" aria-live="polite" aria-atomic="true"></div>' +
  partnerMenu(APP) + (APP.pprofOpen ? partnerProfileModal(APP) : '');

export function renderPartnerHome(APP) {
  const pr = partnerOf(APP);
  const first = (pr.name || '').split(' ')[0] || 'there';
  const projects = (APP.partnerProjects || []).slice();

  // Needs-your-attention first: team replies waiting, then unseen versions.
  projects.sort((x, y) => {
    const a = partnerCardState(APP, x), b = partnerCardState(APP, y);
    if (b.waiting !== a.waiting) return b.waiting - a.waiting;
    if (b.newVersion !== a.newVersion) return (b.newVersion ? 1 : 0) - (a.newVersion ? 1 : 0);
    return String(a.pay.product || '').localeCompare(String(b.pay.product || ''));
  });

  const nameNudge = !pr.name
    ? '<div class="card rise" style="padding:14px 16px;margin-bottom:18px;border:1px solid #e4d9fb;background:#f8f5fe;display:flex;align-items:center;gap:12px">' +
      '<span class="umav" style="background:var(--purple);flex:0 0 auto">?</span>' +
      '<div style="flex:1;font-size:13px;color:var(--ink-2)">Add your name so the team knows who is writing to them.</div>' +
      '<button class="btn btn-primary btn-sm" data-action="pprofopen">Add name</button></div>'
    : '';

  const cards = projects.length ? projects.map((p) => {
    const st = partnerCardState(APP, p);
    return '<button class="pcard" data-action="popen" data-id="' + escA(p.project_id) + '">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div style="min-width:0">' +
      '<div style="font-weight:600;font-size:15.5px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(st.pay.product || p.name || p.project_id) + '</div>' +
      '<div style="font-size:12px;color:var(--ink-2);margin-top:3px">' + (st.label ? 'Published v' + esc(st.label) : 'No published brief yet') + '</div></div>' +
      '<div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">' +
      (st.waiting ? '<span class="pill pill-brand">' + st.waiting + ' repl' + (st.waiting === 1 ? 'y' : 'ies') + '</span>' : '') +
      (st.newVersion && st.label ? '<span class="pill pill-amber">New v' + esc(st.label) + '</span>' : '') + '</div></div>' +
      '<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap"><span class="pill">' + st.thread.length + ' note' + (st.thread.length === 1 ? '' : 's') + ' sent</span></div></button>';
  }).join('') : '<div class="card" style="grid-column:1/-1;padding:34px;text-align:center;color:var(--ink-2)"><div style="font-size:15px;font-weight:600;color:var(--ink-2);margin-bottom:5px">No assignments yet</div><div style="font-size:13px">When the team assigns you a PRD it appears here with its latest published brief.</div></div>';

  return partnerChrome(APP,
    '<div style="flex:1;overflow-y:auto"><div class="wrap" style="max-width:820px">' +
    '<div class="rise" style="margin-bottom:26px"><h1 style="font-size:30px;letter-spacing:-.025em;font-weight:660;margin:0 0 8px">' + esc(greet()) + ', ' + esc(first) + '.</h1>' +
    '<p style="color:var(--ink-2);font-size:14.5px;line-height:1.6;margin:0;max-width:760px">The PRDs assigned to you for review. Any note you send opens a thread with the team.</p></div>' +
    nameNudge +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' + cards + '</div>' +
    '</div></div>');
}

export function renderPartnerProject(APP) {
  const pid = APP.partnerPid;
  const p = (APP.partnerProjects || []).find((x) => x.project_id === pid) || {};
  const pay = p.payload || {};
  const thread = (APP.partnerThreads && APP.partnerThreads[pid]) || [];
  const md = pay.answers ? bBrief(pay.answers, pay.sections) : '';
  const notes = thread.map((t) => {
    const msgs = (t.messages || []).map((m) =>
      '<div style="padding:8px 0;border-top:1px solid var(--line)"><div style="font-size:11px;color:var(--ink-2);margin-bottom:2px"><strong style="color:var(--ink-2)">' + esc(m.name || (m.from === 'team' ? 'Team' : 'You')) + '</strong> · ' + esc(relTime(m.at)) + '</div>' +
      '<div style="font-size:12.5px;color:var(--ink-2);line-height:1.5;white-space:pre-wrap">' + esc(m.body) + '</div></div>').join('');
    return '<div class="card" style="padding:15px;margin-bottom:9px">' +
      '<div style="font-size:11px;color:var(--ink-2);margin-bottom:4px">You · ' + esc(relTime(t.at)) + '</div>' +
      '<div style="font-size:13px;color:var(--ink-2);line-height:1.55;white-space:pre-wrap">' + esc(t.body) + '</div>' +
      (msgs ? '<div style="margin-top:10px">' + msgs + '</div>' : '') +
      attachChips(t.attachments || [], {}) +
      '<textarea class="input" data-preplydraft="' + escA(t.id) + '" rows="1" aria-label="Reply" style="font-size:12.5px;resize:vertical;min-height:38px;line-height:1.5;margin-top:9px"></textarea>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:8px">' + attachInput({ comm: t.id }) +
      '<button class="btn btn-sec btn-sm" data-action="preply" data-id="' + escA(t.id) + '">Reply</button></div></div>';
  }).join('');
  return partnerChrome(APP,
    '<div style="flex:1;overflow-y:auto"><div class="wrap" style="max-width:760px">' +
    '<button class="btn btn-ghost btn-sm" data-action="phome" style="margin-bottom:14px">' + ico(IC.arrow, 'i-sm') + 'All assignments</button>' +
    brandBanner(pay) +
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:18px"><h1 style="font-size:26px;letter-spacing:-.02em;font-weight:660;margin:0">' + esc(pay.product || p.name || pid) + '</h1>' +
    (pay.label ? '<span class="pill pill-solid"><span class="mono">v' + esc(pay.label) + '</span></span>' : '') +
    (md ? '<div style="flex:1"></div>' +
      '<button class="btn btn-ghost btn-sm" data-action="ppresent" data-id="' + escA(pid) + '" title="Copy a read-only link to share">' + ico(IC.link, 'i-sm') + 'Share view</button>' +
      '<button class="btn btn-sec btn-sm" data-action="brandprint" title="Print or save as PDF">' + ico(IC.print, 'i-sm') + 'Print / PDF</button>' : '') + '</div>' +
    (md ? '<div class="card" style="padding:26px 30px;margin-bottom:22px">' + mdToHtml(md) + '</div>'
        : '<div class="card" style="padding:26px;margin-bottom:22px;color:var(--ink-2);font-size:13.5px">The team has not published a brief for this PRD yet.</div>') +
    '<div class="card" style="padding:18px;margin-bottom:18px;border:1px solid var(--sky-2);background:var(--sky)">' +
    '<div style="font-size:14px;font-weight:640;margin-bottom:3px">Send a note to the team</div>' +
    '<div style="font-size:12px;color:var(--ink-2);margin-bottom:11px">It lands in their inbox and opens a thread right here.</div>' +
    '<textarea class="input" id="pPostBody" rows="3" aria-label="Note to the team" style="resize:vertical;min-height:70px;line-height:1.55"></textarea>' +
    '<div style="display:flex;justify-content:flex-end;margin-top:9px"><button class="btn btn-primary btn-sm" data-action="ppost" data-id="' + escA(pid) + '">' + ico(IC.send, 'i-sm') + 'Send to team</button></div></div>' +
    '<div class="eyebrow xd" style="font-size:9.5px;margin:0 0 10px">Your threads</div>' +
    (notes || '<div class="hint" style="padding:8px 2px">No notes yet. Anything you send appears here with the team&rsquo;s replies.</div>') +
    '</div></div>');
}

/* ---------------- read-only presentation of a published PRD ----------------
   A fixed, branded, account-free page. Same section-scoped brief content, shown
   as a clean document with no review form - the "just look at it" link. */
export function renderPresentShare(APP) {
  const s = APP.share;
  if (!s || !s.payload) return wrap(invalidCard('presentation'), 760);
  const p = s.payload;
  const md = bBrief(p.answers || {}, p.sections);
  const brand = brandBanner(p);
  const head = brand +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:20px">' +
    '<div style="min-width:0"><div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:8px">' +
    '<span class="pill pill-solid"><span class="mono">v' + esc(p.label || '?') + '</span></span>' +
    '<span class="eyebrow xd" style="font-size:9.5px">Requirements · read-only</span></div>' +
    '<h1 style="font-size:30px;letter-spacing:-.025em;font-weight:660;margin:0">' + esc(p.product || 'Untitled') + '</h1></div>' +
    '<button class="btn btn-sec btn-sm" data-action="brandprint" title="Print or save as PDF" style="flex:0 0 auto">' + ico(IC.print, 'i-sm') + 'Print / PDF</button>' +
    '</div>';
  const body = (md.trim()
    ? '<div class="card" style="padding:30px 34px">' + mdToHtml(md) + '</div>'
    : '<div class="card" style="padding:34px;color:var(--ink-2);font-size:14px;text-align:center">This presentation has no shared content yet.</div>')
    + walkthroughCard(p, APP.shareToken);
  const foot = '<div style="text-align:center;margin-top:24px;font-size:11.5px;color:var(--ink-2);display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<span class="brandmark" style="width:16px;height:16px;border-radius:4px"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></span>' +
    'A read-only requirements record, published with ReqPub. This link cannot be edited.</div>';
  return wrap(head + body + foot, 780);
}

/* ---------------- e-sign v1 (#sign/token) ----------------
   The signer's page: the exact stored baseline rendered like a presentation
   link, a fingerprint the signer's own browser recomputes and verifies, and a
   plain signature panel - consent, typed name, sign or decline. After signing
   the same URL is the signer's archive copy forever: it re-renders the exact
   signed document with the receipt, and prints to PDF. The words on the page
   say what this is and is not: a recorded electronic signature with an audit
   trail; cryptographic sealing is a later phase. */
export function renderSignPage(APP) {
  const g = APP.sign;
  if (!g) return wrap(invalidCard('signature request'), 760);
  const fpShort = (h) => 'sha256:' + String(h || '').slice(0, 16);
  const verify = g.fingerprint
    ? (g.verified
      ? '<span class="pill" style="background:var(--ok-bg,#e8f6ee);color:var(--ok,#1a7f4b);border:1px solid rgba(26,127,75,.25)">Document verified · fingerprint matches</span>'
      : '<span class="pill" style="background:#fdf1f1;color:#a13030;border:1px solid rgba(161,48,48,.25)">Fingerprint mismatch. Do not sign; contact the sender</span>')
    : '<span class="pill">' + esc(fpShort(g.computedFp)) + '</span>';
  const who = g.signer || {};
  let panel = '';
  if (g.status === 'signed') {
    panel =
      '<div class="card" style="padding:22px 26px;margin-top:16px;border-left:3px solid var(--ok,#1a7f4b)">' +
      '<div style="font-weight:650;font-size:15px;margin-bottom:6px">Signed</div>' +
      '<div style="font-size:13.5px;color:var(--ink-2);line-height:1.65">' +
      '<span class="mono">' + esc(g.signedName || who.name || '') + '</span> signed version ' + esc(g.label || '') +
      (g.signedAt ? ' on <span class="mono">' + esc(new Date(g.signedAt).toLocaleString()) + '</span>' : '') +
      '. Document fingerprint <span class="mono">' + esc(fpShort(g.fingerprint || g.computedFp)) + '</span>.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
      '<button class="btn btn-sec btn-sm" data-action="brandprint">' + ico(IC.print, 'i-sm') + 'Print / save PDF</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="signreceipt">Email me this receipt</button></div>' +
      (APP.signReceiptSent ? '<div style="font-size:12px;color:var(--ink-2);margin-top:8px">Receipt sent to ' + esc(who.email || 'your email') + '.</div>' : '') +
      '<div style="font-size:11.5px;color:var(--ink-2);line-height:1.55;margin-top:12px">This page is your archive copy: the same link always renders the exact document you signed, with this receipt. ' +
      'What was recorded: your typed name, the time, the document fingerprint, and the request trail. This is a recorded electronic signature with an audit trail, not cryptographic sealing; sealing ships in a later phase.</div></div>';
  } else if (g.status === 'declined') {
    panel =
      '<div class="card" style="padding:22px 26px;margin-top:16px;border-left:3px solid #a13030">' +
      '<div style="font-weight:650;font-size:15px;margin-bottom:6px">Declined</div>' +
      '<div style="font-size:13.5px;color:var(--ink-2);line-height:1.6">This signature request was declined' +
      (g.declineReason ? ': <span style="color:var(--ink-2)">' + esc(g.declineReason) + '</span>' : '.') +
      ' The team has been notified on the record.</div></div>';
  } else {
    const err = APP.signError ? '<div style="font-size:12.5px;color:#a13030;margin-bottom:10px">' + esc(APP.signError) + '</div>' : '';
    panel =
      '<div class="card" style="padding:22px 26px;margin-top:16px">' +
      '<div style="font-weight:650;font-size:15px;margin-bottom:4px">Sign this version</div>' +
      '<div style="font-size:12.5px;color:var(--ink-2);line-height:1.6;margin-bottom:14px">You were asked to sign as ' +
      '<b>' + esc(who.role || 'Signer') + '</b>' + (who.email ? ' (' + esc(who.email) + ')' : '') +
      '. Read the document above, then sign with your typed name. Your name, the time, and the document fingerprint are recorded with an audit trail.</div>' +
      err +
      '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:center">' +
      '<input class="input" id="signName" placeholder="Type your full name to sign" value="' + escA(APP.signName || who.name || '') + '" style="flex:1;min-width:220px;height:44px"' + (APP.signBusy ? ' disabled' : '') + '>' +
      '<button class="btn btn-primary" data-action="signsubmit" style="height:44px"' + (APP.signBusy ? ' disabled' : '') + '>' + (APP.signBusy ? 'Signing…' : 'Sign version ' + esc(g.label || '')) + '</button></div>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--ink-2);line-height:1.5;margin-top:11px;cursor:pointer">' +
      '<input type="checkbox" id="signConsent" style="margin-top:2px"' + (APP.signConsent ? ' checked' : '') + '>' +
      '<span>I agree to sign electronically, and the typed name above is mine.</span></label>' +
      (APP.signDeclineOpen
        ? '<div style="display:flex;gap:8px;margin-top:14px"><input class="input" id="signWhy" placeholder="Why are you declining? (optional, goes on the record)" style="flex:1">' +
          '<button class="btn btn-sec btn-sm" data-action="signdeclinego"' + (APP.signBusy ? ' disabled' : '') + '>Decline</button></div>'
        : '<button class="btn btn-ghost btn-sm" data-action="signdeclineopen" style="margin-top:12px">Decline instead…</button>') +
      '</div>';
  }
  const strip =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
    '<span class="eyebrow xd" style="font-size:9.5px">Signature request</span>' + verify + '</div>' +
    '<span style="font-size:11.5px;color:var(--ink-2)">Requested for version ' + esc(g.label || '') + (g.author ? ' · recorded by ' + esc(g.author) : '') + '</span></div>';
  return wrapSign(practiceMark(g.practice) + strip, panel, APP);
}
function wrapSign(strip, panel, APP) {
  const g = APP.sign; const p = (APP.share && APP.share.payload) || {};
  const md = bBrief(p.answers || {}, p.sections);
  const brand = brandBanner(p);
  const body = md.trim()
    ? '<div class="card" style="padding:30px 34px">' + mdToHtml(md) + '</div>'
    : '<div class="card" style="padding:34px;color:var(--ink-2);font-size:14px;text-align:center">This request has no document content.</div>';
  const head = brand +
    '<div style="min-width:0;margin-bottom:18px"><div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:8px">' +
    '<span class="pill pill-solid"><span class="mono">v' + esc(g.label || '?') + '</span></span>' +
    '<span class="eyebrow xd" style="font-size:9.5px">Requirements · for signature</span></div>' +
    '<h1 style="font-size:30px;letter-spacing:-.025em;font-weight:660;margin:0">' + esc(g.project || p.product || 'Untitled') + '</h1></div>';
  const foot = '<div style="text-align:center;margin-top:24px;font-size:11.5px;color:var(--ink-2);display:flex;align-items:center;justify-content:center;gap:6px">' +
    '<span class="brandmark" style="width:16px;height:16px;border-radius:4px"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></span>' +
    'A signature request on a fingerprinted requirements record, served by ReqPub.</div>';
  return wrap(practiceMark(g.practice) + strip + head + body + panel + foot, 780);
}

/* ---------------- durable SME workspace (#sme/replyToken) ----------------
   The SME's permanent home for one PRD: the branded read-only brief plus a
   single continuous thread with the team. Reached by a stable personal link,
   so it resumes on any device with no login and no lost bookmarks. */
export function renderSmeWorkspace(APP) {
  const t = APP.smeThread;
  if (!t || !t.ok) return wrap(invalidCard('workspace'), 760);
  const brief = t.brief || {};
  const md = brief.answers ? bBrief(brief.answers, brief.sections) : '';
  const msgs = (t.messages || []).map((m) =>
    '<div style="padding:10px 0;border-top:1px solid var(--line)">' +
    '<div style="font-size:11px;color:var(--ink-2);margin-bottom:3px;font-weight:600">' +
    esc(m.name || (m.from === 'team' ? 'Team' : 'You')) + (m.from === 'team' ? '' : ' (you)') + ' · ' + esc(relTime(m.at)) + '</div>' +
    '<div style="font-size:13.5px;color:var(--ink-2);line-height:1.6;white-space:pre-wrap">' + esc(m.body) + '</div></div>').join('');
  const head = brandBanner(brief) +
    '<div style="margin-bottom:20px"><div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">' + brandmark(28) +
    '<span class="eyebrow xd" style="font-size:9.5px">SME review workspace' + (brief.label ? ' · v' + esc(brief.label) : '') + '</span></div>' +
    '<h1 style="font-size:27px;letter-spacing:-.02em;font-weight:660;margin:0 0 4px">' + esc(t.product || 'Requirements') + '</h1>' +
    (t.name ? '<div style="font-size:13px;color:var(--ink-2)">Reviewer: ' + esc(t.name) + '</div>' : '') + '</div>';
  const prd = md
    ? '<div class="card" style="padding:26px 30px;margin-bottom:20px">' + mdToHtml(md) + '</div>'
    : '<div class="card" style="padding:24px;margin-bottom:20px;color:var(--ink-2);font-size:13.5px">The team has not published a brief for this PRD yet. Your conversation with them is below. It stays here as the document takes shape.</div>';
  const myFiles = attachChips(t.attachments || [], {});
  const thread = '<div class="card" style="padding:22px">' +
    '<div style="font-size:14px;font-weight:640;margin-bottom:3px">Your conversation with the team</div>' +
    '<div style="font-size:12px;color:var(--ink-2);margin-bottom:12px">This link is yours. Bookmark it. Everything you and the team exchange stays here, across every version. No account needed. You can attach documents and PDFs too.</div>' +
    (msgs || '<div class="hint" style="padding:6px 2px">No messages yet. Start the conversation below.</div>') + myFiles +
    '<textarea class="input" id="smeReplyBody" rows="3" placeholder="Write to the team" style="resize:vertical;min-height:64px;line-height:1.55;margin-top:12px"></textarea>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px">' + attachInput({ token: APP.smeReplyToken }) +
    '<button class="btn btn-primary btn-sm" data-action="smereply">Send</button></div></div>';
  return wrap(head + prd + thread, 760);
}

/* ---------------- signed in, but no workspace ---------------- */
export function renderNoOrg(APP) {
  return '<div style="min-height:100vh;background:var(--bg-2);display:flex;align-items:center;justify-content:center;padding:24px"><div style="width:100%;max-width:400px;text-align:center">' +
    '<div style="display:flex;align-items:center;justify-content:center;gap:9px;margin-bottom:14px">' + brandmark(30) + '<span style="font-size:20px;font-weight:680;letter-spacing:-.02em">ReqPub</span></div>' +
    '<div class="card" style="padding:28px;text-align:left">' +
    '<div style="font-size:17px;font-weight:660;margin-bottom:6px">Create your workspace</div>' +
    '<div class="hint" style="margin-bottom:16px">You are signed in as ' + esc((APP.user && APP.user.email) || '') + ' but not yet in a workspace. Create one, or ask a manager to invite this email.</div>' +
    '<input class="input" id="woName" placeholder="Workspace name, e.g. Collection Ventures" style="margin-bottom:12px">' +
    '<button class="btn btn-primary" data-action="createorg" style="width:100%;height:44px"' + (APP.authBusy ? ' disabled' : '') + '>' + (APP.authBusy ? 'Creating…' : 'Create workspace') + '</button>' +
    (APP.authError ? '<div style="color:var(--bad);font-size:12.5px;margin-top:10px">' + esc(APP.authError) + '</div>' : '') +
    '<div style="text-align:center;margin-top:14px"><button class="btn btn-ghost btn-sm" data-action="signout">Sign out</button></div>' +
    '</div></div></div><div id="toast-slot" aria-live="polite" aria-atomic="true"></div>';
}

/* ---- Weekly update: the client's ten-second read (v2.27.0) ----
   One white page. Position and weight carry priority: a three-fact strip,
   then the asks, then everything the second read may never reach. The
   artifact builder is shared by the live page and print, so the PDF and
   the link can never disagree. Every line arrived derived from the record;
   a hand-typed line carries its "note" stamp. */
const updFmtDay = (d) => { const x = d ? new Date(d) : null; return x && !isNaN(+x) ? x.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''; };

export function updateArtifactHTML(g) {
  const p = g.payload || {};
  const strip = p.strip || {};
  const asks = p.asks || [];
  const moved = p.moved || [];
  const open = (p.open || []).slice(0, 6);
  const closed = p.closed || [];
  const winFrom = updFmtDay(g.windowFrom || (p.window || {}).from);
  const winTo = updFmtDay(g.windowTo || (p.window || {}).to || g.publishedAt);
  const hr = (strong) => '<div style="border-top:1px solid ' + (strong ? 'var(--ink-2)' : 'var(--line)') + ';margin:16px 0 12px"></div>';
  const sec = (t) => '<div style="font-size:12.5px;font-weight:640;letter-spacing:.01em;margin:0 0 7px">' + t + '</div>';
  const logo = g.logo ? '<img src="' + escA(g.logo) + '" alt="" style="max-height:26px;max-width:120px;object-fit:contain">'
    : (g.brandLabel ? '<span style="font-size:12px;color:var(--ink-2)">' + esc(g.brandLabel) + '</span>' : '');

  const asksHtml = asks.length
    ? asks.map((a, i) =>
      '<div style="display:flex;gap:10px;margin:0 0 8px;font-size:14px;line-height:1.55">' +
      '<span style="color:var(--brand);font-weight:640;flex:0 0 auto">' + (i + 1) + '</span>' +
      '<span style="min-width:0"><span style="font-weight:600">' + esc(a.text) + (/[.?!]$/.test(String(a.text || '').trim()) ? '' : '.') + '</span>' +
      (a.why ? ' <span style="color:var(--ink-2)">' + esc(a.why) + (/[.?!]$/.test(String(a.why).trim()) ? '' : '.') + '</span>' : '') +
      (a.src === 'note' ? ' <span style="color:var(--ink-2);font-size:11px">note</span>' : '') + '</span></div>').join('')
    : '<div style="font-size:13.5px;color:var(--ink-2)">Nothing needed from you this week.</div>';

  const movedHtml = moved.map((m) =>
    '<div style="font-size:13.5px;line-height:1.6;margin:0 0 4px">' + esc(m.text) +
    (m.ref ? ' <span style="color:var(--ink-2);font-size:11.5px">' + esc(updFmtDay(m.ref) || m.ref) + '</span>' : '') +
    (m.note ? ' <span style="color:var(--ink-2);font-size:11px">note</span>' : '') + '</div>').join('');

  const openHtml = open.map((o) =>
    '<div style="font-size:13.5px;line-height:1.6;margin:0 0 4px">' +
    (o.grade === 'high' ? '<span style="font-weight:640">High</span>' : '<span style="color:var(--ink-2)">Watch</span>') +
    ' · ' + esc(o.text) + (o.lead ? ' · ' + esc(o.lead) : '') + (o.by ? ' · by ' + esc(o.by) : '') + '</div>').join('') +
    (p.openMore ? '<div style="font-size:12px;color:var(--ink-2);margin-top:3px">and ' + p.openMore + ' more on the record</div>' : '') +
    closed.map((c) => '<div style="font-size:13px;color:var(--ink-2);text-decoration:line-through;margin-top:3px">Closed · ' + esc(c.text) + '</div>').join('');

  return '<div style="background:#fff;color:#0f1114;border-radius:14px;padding:34px 38px;border:1px solid var(--line)">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">' +
    '<div style="min-width:0"><div style="font-size:20px;font-weight:640;letter-spacing:-.015em">' + esc(g.project || 'Project') + '</div>' +
    '<div style="font-size:11.5px;color:var(--ink-2);margin-top:3px">Weekly update no. ' + (g.seq || 1) +
    (winFrom || winTo ? ' · ' + (winFrom ? winFrom + ' to ' : 'through ') + winTo : '') +
    (g.preparedBy ? ' · prepared by ' + esc(g.preparedBy) : '') + '</div></div>' + logo + '</div>' +
    hr(true) +
    '<div style="display:flex;gap:16px">' +
    '<div style="flex:1.1"><div style="font-size:10px;color:var(--ink-2);letter-spacing:.05em;text-transform:uppercase">Needed from you</div>' +
    '<div style="font-size:16.5px;font-weight:640;color:var(--brand)">' + (asks.length ? asks.length + (asks.length === 1 ? ' decision' : ' decisions') : 'Nothing') + '</div></div>' +
    '<div style="flex:1;border-left:1px solid var(--line);padding-left:14px"><div style="font-size:10px;color:var(--ink-2);letter-spacing:.05em;text-transform:uppercase">Health</div>' +
    '<div style="font-size:16.5px;font-weight:640">' + esc(strip.health || '') + '</div></div>' +
    '<div style="flex:1.5;border-left:1px solid var(--line);padding-left:14px"><div style="font-size:10px;color:var(--ink-2);letter-spacing:.05em;text-transform:uppercase">Next milestone</div>' +
    '<div style="font-size:16.5px;font-weight:640;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc((strip.next || {}).text || 'To be set') + '</div></div></div>' +
    hr() + sec('Needed from you this week') + asksHtml +
    (moved.length ? hr() + sec('What moved') + movedHtml : '') +
    (open.length || closed.length ? hr() + sec('Open on the record') + openHtml : '') +
    (p.next ? hr() + sec('Next') + '<div style="font-size:13.5px;line-height:1.6">' + esc(p.next) + '</div>' : '') +
    '<div style="border-top:1px solid var(--ink-2);margin-top:18px;padding-top:10px;font-size:10.5px;color:var(--ink-2);line-height:1.6">Produced from the ReqPub record' +
    ((p.baseline || {}).label ? ' · baseline v' + esc(p.baseline.label) : '') +
    ((p.baseline || {}).fp ? ' · fingerprint sha256:' + esc(String(p.baseline.fp).slice(0, 12)) + '\u2026' : '') +
    (g.publishedAt ? ' · published ' + esc(updFmtDay(g.publishedAt)) : '') +
    ' · this link always renders exactly this update</div></div>';
}

/* ---------------- the update dashboard (v2.35.0) ----------------
   One screen of AUTHORED content, frozen at publish. The phase strip renders
   the single ctrl_phase answer against the fixed option order: phases before
   it read completed, the answer reads current, later ones dim. That is a
   rendering of one authored choice, not a judgment; the platform computes
   nothing here - no rollup, no colour, no verdict (docs/POSITIONING.md).
   Clicking a tab filters the table to rows whose permanent ID carries that
   phase's letter; clicking the active tab again shows everything. Objectives
   group their key results on the left; the risk and issue rows sit on the
   right with a click-open notes line per row. All of it is a read of the
   frozen payload: next week's link is next week's publish. */
export const UPD_PHASES = ['Discovery', 'Design', 'Development', 'Test', 'Implement', 'Manage'];
export const UPD_LETTER = { Discovery: 'S', Design: 'D', Development: 'V', Test: 'T', Implement: 'I', Manage: 'M' };

function updPhaseTabs(board, ui) {
  const cur = UPD_PHASES.indexOf(board.phase);
  const sel = (ui || {}).vphase || board.phase;
  // Tabs are phase VIEWS over this frozen update. The current phase keeps
  // its filled style whatever you are viewing, so where-we-are and
  // where-I-am-looking never blur. Everything shown under any tab was
  // authored and frozen at publish; browsing phases browses this update.
  return '<div class="updash-tabs">' + UPD_PHASES.map((ph, i) => {
    const state = cur < 0 ? 'up' : i < cur ? 'done' : i === cur ? 'cur' : 'up';
    return '<button class="updash-tab ' + state + (ph === sel ? ' sel' : '') + '" data-action="updphase" data-val="' + escA(ph) + '" title="' +
      (state === 'done' ? 'Completed phase' : state === 'cur' ? 'Current phase, as set by the team' : 'Upcoming phase') +
      '. Click to view its objectives, risks, and issues">' +
      (state === 'done' ? ico(IC.check, 'i-sm') : '') + esc(ph) + '</button>';
  }).join('') +
  (sel !== board.phase ? '</div><div class="updash-vctx">Viewing <strong>' + esc(sel) + '</strong> \u00b7 ' +
    (UPD_PHASES.indexOf(sel) < cur ? 'a completed phase' : 'an upcoming phase, so its rows are what the team anticipates') +
    ' \u00b7 the engagement is in <strong>' + esc(board.phase) + '</strong> \u00b7 every value frozen at publish' : '</div><div style="display:none">') + '</div>';
}

function updOkrsHTML(board, ui) {
  const sel = (ui || {}).vphase || board.phase;
  // A row with no phase belongs to the current phase, the backward-
  // compatible reading: every pre-existing row renders where it always did.
  const rows = (board.okrs || []).filter((r) => (r.phase || board.phase) === sel);
  if (!rows.length) return '<div style="font-size:12.5px;color:var(--ink-2)">No objectives in ' + esc(sel) + ' on this update.</div>';
  const groups = [];
  rows.forEach((r) => {
    const obj = (r.objective || '').trim() || 'Objective';
    const g = groups.length && groups[groups.length - 1].obj === obj ? groups[groups.length - 1] : null;
    if (g) g.krs.push(r); else groups.push({ obj, krs: [r] });
  });
  return groups.map((g) =>
    '<div style="margin:0 0 12px"><div style="font-size:12.5px;font-weight:640;line-height:1.4;margin-bottom:3px">' + esc(g.obj) + '</div>' +
    g.krs.map((r) => {
      const done = r.done === 'Done';
      return '<div class="updash-kr' + (done ? ' done' : '') + '"><span class="box">' + (done ? ico(IC.check, 'i-sm') : '') + '</span>' +
        '<span class="txt" style="min-width:0">' + esc(r.kr || '') + '</span></div>';
    }).join('') + '</div>').join('');
}

function updItemsHTML(board, ui) {
  const sel = (ui || {}).vphase || board.phase;
  const letter = UPD_LETTER[sel];
  const all = (board.items || []).filter((r) => String(r.id || '').charAt(0) === letter);
  const open = (ui || {}).open || {};
  if (!all.length) return '<div style="font-size:12.5px;color:var(--ink-2)">No risks or issues in ' + esc(sel) + ' on this update.</div>';
  const head = '<div class="updash-head"><span>Update</span><span>Title</span><span>Description</span><span>Action</span><span>Owner</span><span>Delivery</span><span>Status</span></div>';
  const cell = (l, v) => '<span class="updash-cell" data-l="' + escA(l) + '">' + esc(v || '') + '</span>';
  const line = (r) => {
    const isOpen = !!open[r.id];
    const letter = String(r.type || 'Risk').charAt(0).toUpperCase();
    return '<div class="updash-row" data-action="updrowtoggle" data-uid="' + escA(r.id || '') + '" title="' + (r.notes ? 'Click for notes' : 'No notes on this row') + '">' +
      '<span class="updash-upd"><span class="updash-typebox" style="color:' + (letter === 'I' ? 'var(--amber,#b26a00)' : 'var(--ink-2)') + '" title="' + escA(r.type || '') + '">' + esc(letter) + '</span>' +
      '<span class="updash-id mono">' + esc(r.id || '') + '</span></span>' +
      '<span class="updash-titlecell"><span class="updash-title">' + esc(r.title || '') + '</span>' +
      (r.notes ? '<span class="updash-noteslink">' + (isOpen ? 'Hide notes' : 'Click for notes') + '</span>' : '') + '</span>' +
      cell('Description', r.desc) + cell('Action', r.action) + cell('Owner', r.owner) + cell('Delivery', r.delivery) + cell('Status', r.status) +
      '</div>' +
      (isOpen && r.notes ? '<div class="updash-notes">' + esc(r.notes) + '</div>' : '');
  };
  return head + all.map(line).join('');
}

export function updateDashboardHTML(g, ui) {
  const board = (g.payload || {}).board || {};
  const winFrom2 = updFmtDay(g.windowFrom || ((g.payload || {}).window || {}).from);
  const winTo2 = updFmtDay(g.windowTo || ((g.payload || {}).window || {}).to || g.publishedAt);
  const logo = g.logo ? '<img src="' + escA(g.logo) + '" alt="" style="max-height:26px;max-width:120px;object-fit:contain">'
    : (g.brandLabel ? '<span style="font-size:12px;color:var(--ink-2)">' + esc(g.brandLabel) + '</span>' : '');
  const who = (g.recipient || {}).name;
  const role = (g.recipient || {}).role;
  return '<div class="updash">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">' +
    '<div style="min-width:0"><div class="updash-h1">' + esc(g.project || 'Project') + '</div>' +
    '<div class="updash-meta">Weekly update no. ' + (g.seq || 1) +
    (winFrom2 || winTo2 ? ' \u00b7 ' + (winFrom2 ? winFrom2 + ' to ' : 'through ') + winTo2 : '') +
    (g.preparedBy ? ' \u00b7 prepared by ' + esc(g.preparedBy) : '') + '</div>' +
    // The recipient is never buried and never omitted: their own line, name
    // and role in full weight when the link was issued to someone, and the
    // read-only state said plainly when it was not.
    '<div class="updash-issued">Issued to ' +
    (who ? '<strong>' + esc(who) + '</strong>' + (role ? ' <span class="pill" style="height:18px;font-size:10px;padding:0 8px;vertical-align:1px">' + esc(role) + '</span>' : '')
         : '<strong>nobody</strong> \u00b7 read-only link \u00b7 notes and questions are off') +
    '</div></div>' + logo + '</div>' +
    '<div style="margin-top:16px"><div class="eyebrow xd" style="font-size:10px;margin-bottom:9px">Engagement phase</div>' + updPhaseTabs(board, ui) + '</div>' +
    '<div class="updash-grid">' +
    '<div><div class="eyebrow xd" style="font-size:10px;margin-bottom:8px">Objectives and key results</div><div class="updash-scroll">' + updOkrsHTML(board, ui) + '</div></div>' +
    '<div style="min-width:0"><div class="eyebrow xd" style="font-size:10px;margin-bottom:8px">Risks and issues</div><div class="updash-tablebox"><div class="updash-scroll">' + updItemsHTML(board, ui) + '</div></div></div>' +
    '</div>' +
    '<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:9px;font-size:10.5px;color:var(--ink-2);line-height:1.6">Every value on this board was written by the team and frozen when this update was published' +
    (((g.payload || {}).baseline || {}).label ? ' \u00b7 baseline v' + esc(g.payload.baseline.label) : '') +
    (g.publishedAt ? ' \u00b7 published ' + esc(updFmtDay(g.publishedAt)) : '') +
    ' \u00b7 the platform computes nothing here \u00b7 this link always renders exactly this update \u00b7 ReqPub v' + APP_VERSION + '</div></div>';
}

/* The middle card, key era: two authored sections in the team's own words,
   frozen at publish. No strip, no derived verdicts, no rollups: if a line is
   here, someone wrote it. */
export function updKeyCardHTML(g) {
  const key = (g.payload || {}).key;
  if (!key) return '';
  const lines = (arr) => (arr && arr.length)
    ? arr.map((x) => '<div class="updkey-line">' + esc(x) + '</div>').join('')
    : '<div class="updkey-line" style="color:var(--ink-2)">Nothing this week.</div>';
  return '<div class="card updkey" style="padding:22px 24px;margin-top:14px">' +
    '<div class="updkey-h">Key Updates</div>' + lines(key.updates) +
    '<div class="updkey-h" style="margin-top:20px">Key Questions</div>' + lines(key.questions) +
    '<div style="border-top:1px solid var(--line);margin-top:18px;padding-top:9px;font-size:11px;color:var(--ink-2)">Produced from the ReqPub record \u00b7 published ' + esc(updFmtDay(g.publishedAt)) + ' \u00b7 this link always renders exactly this update</div></div>';
}

/* One screen, then expand: each lower section renders as a slim bar; the
   full card appears only when the reader opens it. Print expands nothing
   here because print renders the board and the key card. */
function updSectBar(k, title, meta, open, body) {
  return '<div class="card updsec" data-action="updsecx" data-k="' + escA(k) + '">' +
    '<span class="updsec-t">' + esc(title) + '</span>' +
    (meta ? '<span class="updsec-m">' + esc(meta) + '</span>' : '') +
    '<span class="updsec-c">' + ico(open ? IC.close : IC.fwd, 'i-sm') + '</span></div>' +
    (open ? body : '');
}

/* The recipient's notes: their own scratch space on their own link,
   rev-checked on save. Scoped to this link's token; not encrypted at rest,
   and the words below say exactly that. */
export function updateNotesHTML(APP, g) {
  if (!((g.recipient || {}).name || (g.recipient || {}).email)) return '';
  const n = APP.updNotes || {};
  const saved = (g.note || {});
  const body = n.body != null ? n.body : (saved.body || '');
  return '<div class="card" style="padding:18px 20px;margin-top:14px">' +
    '<div class="eyebrow xd" style="font-size:9px;margin-bottom:6px">Your notes</div>' +
    '<textarea class="input" id="updnotesbox" rows="4" placeholder="Anything you want to keep beside this update. Your notes, for your next visit to this link" style="font-size:13px;resize:vertical;min-height:76px;line-height:1.5">' + esc(body) + '</textarea>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:9px;flex-wrap:wrap">' +
    '<span style="font-size:11px;color:var(--ink-2)">' + (n.savedAt ? 'Saved ' + esc(relTime(n.savedAt)) + '. ' : '') + 'Saved to this link only.</span>' +
    '<button class="btn btn-primary btn-sm" data-action="updnotesave"' + (n.busy ? ' disabled' : '') + '>' + (n.busy ? 'Saving\u2026' : 'Save notes') + '</button></div>' +
    '<div style="font-size:11px;color:var(--ink-2);margin-top:8px;line-height:1.55">These notes are stored with this update and readable only through this link\u2019s token. They are not encrypted at rest, and the team does not see them in the app. Nothing here changes the record.</div></div>';
}

/* The recipient's threads: a question, comment, or request for information
   opens a real thread in the team's inbox, named as the recipient and their
   role, never anonymous. Team replies from inside the app land back here. */
export function updateThreadsHTML(APP, g) {
  if (!((g.recipient || {}).name || (g.recipient || {}).email)) return '';
  const f = APP.updThread || {};
  const drafts = APP.updDrafts || {};
  const who = (g.recipient || {}).name || (g.recipient || {}).email;
  const role = (g.recipient || {}).role;
  const threads = g.threads || [];
  const msg = (m) => '<div style="padding:8px 0;border-top:1px solid var(--line);font-size:13px;line-height:1.55">' +
    '<div style="font-size:11px;color:var(--ink-2);margin-bottom:2px"><strong style="color:var(--ink-2)">' + esc(m.name || '') + '</strong>' +
    (m.from === 'team' ? ' \u00b7 team' : '') + ' \u00b7 ' + esc(relTime(m.at)) + '</div>' +
    '<div style="white-space:pre-wrap">' + esc(m.body) + '</div></div>';
  const thread = (t) => '<div style="border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin-top:10px">' +
    '<div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">' +
    (t.ref ? '<span class="mono" style="font-size:10px;color:var(--ink-2);border:1px solid var(--line);border-radius:5px;padding:1px 5px">' + esc(t.ref) + '</span>' : '') +
    '<span class="pill" style="height:18px;font-size:9.5px;padding:0 6px">' + esc(t.kind || 'Question') + '</span>' +
    '<span style="font-weight:620;font-size:13.5px;min-width:0">' + esc(t.title || '') + '</span>' +
    '<span style="flex:1"></span><span style="font-size:11px;color:var(--ink-2)">' + esc(relTime(t.at)) + '</span></div>' +
    '<div style="font-size:13px;line-height:1.55;white-space:pre-wrap;margin-top:6px">' + esc(t.body) + '</div>' +
    ((t.messages || []).length ? '<div style="margin-top:8px">' + t.messages.map(msg).join('') + '</div>' : '') +
    '<div style="display:flex;gap:8px;margin-top:9px">' +
    '<textarea class="input" data-updreply="' + escA(t.id) + '" rows="1" placeholder="Reply as ' + escA(who) + '" style="font-size:12.5px;resize:vertical;min-height:38px;line-height:1.5;flex:1">' + esc(drafts[t.id] || '') + '</textarea>' +
    '<button class="btn btn-sec btn-sm" data-action="updthreadreply" data-id="' + escA(t.id) + '" style="flex:0 0 auto">Reply</button></div></div>';
  return '<div class="card" style="padding:18px 20px;margin-top:14px">' +
    '<div class="eyebrow xd" style="font-size:9px;margin-bottom:6px">Questions and requests</div>' +
    '<div style="font-size:12px;color:var(--ink-2);line-height:1.55;margin-bottom:9px">Push a question, a comment, or a request for information to the team. It opens a thread in their inbox, on the record, under your name' + (role ? ' as ' + esc(role) : '') + '. Their replies appear here.</div>' +
    (f.sent ? '<div style="border-left:3px solid var(--brand);padding:8px 12px;font-size:12.5px;color:var(--ink-2);margin-bottom:10px">Sent' + (f.sentRef ? ' as ' + esc(f.sentRef) : '') + '. The team sees it in their inbox.</div>' : '') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    '<select class="input" id="updthreadkind" style="height:32px;font-size:12.5px;width:auto;padding:0 8px">' +
    ['Question', 'Comment', 'Request for information'].map((k) => '<option' + ((f.kind || 'Question') === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select>' +
    '<input class="input" id="updthreadtitle" value="' + escA(f.title || '') + '" placeholder="Title (optional. The first line is used if blank)" style="height:32px;font-size:12.5px;flex:1;min-width:180px"></div>' +
    '<textarea class="input" id="updthreadbody" rows="3" placeholder="What do you need from the team?" style="font-size:13px;resize:vertical;min-height:64px;line-height:1.5;margin-top:8px">' + esc(f.body || '') + '</textarea>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:9px;flex-wrap:wrap">' +
    '<span style="font-size:11px;color:var(--ink-2)">Posted as <strong>' + esc(who) + '</strong>' + (role ? ' (' + esc(role) + ')' : '') + '. Never anonymous.</span>' +
    '<button class="btn btn-primary btn-sm" data-action="updthreadsend"' + (f.busy ? ' disabled' : '') + '>' + (f.busy ? 'Sending\u2026' : 'Send to the team') + '</button></div>' +
    '<div style="font-size:11px;color:var(--ink-2);margin-top:8px;line-height:1.55">A thread is a message on the record, not an approval and not a change to the agreement. To authorize anything, use a signature link below.</div>' +
    (threads.length ? threads.map(thread).join('') : '') + '</div>';
}

/* ---------------- the update panel (v2.34.0) ----------------
   Everything below the published artifact is a VIEW onto the record, not a
   second copy of it and not a place record state begins. Signatures link out
   to the real sign page. Baselines link out to read-only presentation links
   that already exist. The comment box files a message into the inbox and
   changes nothing about the agreement. Nothing here approves, authorizes, or
   edits; the panel's whole job is to make the record reachable from the
   client's ten-second read. */
function updSignaturesHTML(g) {
  const pendScore = (x) => (x.token && x.status !== 'signed' && x.status !== 'declined') ? 0 : 1;
  const sigs = (g.signatures || []).slice().sort((x, y) => pendScore(x) - pendScore(y));
  if (!sigs.length) return '';
  const label = g.baselineLabel ? 'v' + esc(g.baselineLabel) : 'this baseline';
  const row = (s) => {
    const done = s.status === 'signed';
    const declined = s.status === 'declined';
    const state = done ? 'Signed ' + esc(updFmtDay(s.signedAt)) + (s.signedName ? ' as ' + esc(s.signedName) : '')
      : declined ? 'Declined'
        : 'Awaiting signature';
    const color = done ? 'var(--ok,#1a7f4b)' : declined ? '#a13030' : 'var(--ink-2)';
    // A link appears only when update_context released a token, which it does
    // only for the person this update was issued to. Everyone else is status.
    const ctl = s.token
      ? '<a class="btn ' + (done || declined ? 'btn-sec' : 'btn-primary') + ' btn-sm" href="#sign/' + escA(s.token) + '" style="font-size:11.5px;flex:0 0 auto">' +
        (done ? 'View receipt' : declined ? 'Open' : 'Sign now') + '</a>'
      : '';
    return '<div style="display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid var(--line);font-size:13px">' +
      '<span style="flex:1;min-width:0"><strong>' + esc(s.name || s.role || 'Signer') + '</strong>' +
      (s.role && s.name ? ' <span style="color:var(--ink-2)">· ' + esc(s.role) + '</span>' : '') +
      '<div style="font-size:11.5px;color:' + color + ';margin-top:1px">' + state + '</div></span>' + ctl + '</div>';
  };
  const mine = sigs.some((s) => s.token);
  return '<div class="card" style="padding:18px 20px;margin-top:14px">' +
    '<div class="eyebrow xd" style="font-size:9px;margin-bottom:3px">Signatures on ' + label + '</div>' +
    sigs.map(row).join('') +
    '<div style="font-size:11px;color:var(--ink-2);margin-top:9px;line-height:1.55">' +
    (mine ? 'Your signature link opens the signature page for the exact baseline. Signing happens there, never here. '
          : '') +
    'Other signers are shown for status only; their links were sent to them directly.</div></div>';
}

function updBaselinesHTML(g) {
  const bs = (g.baselines || []).filter((b) => b.presentToken || b.fingerprint);
  if (!bs.length) return '';
  // Same shape the team's own present links use: #present/pid/seq/token.
  const pLink = (b) => '#present/' + encodeURIComponent(g.projectId || '') + '/' + b.seq + '/' + encodeURIComponent(b.presentToken);
  const fp = (h) => 'sha256:' + String(h).slice(0, 12) + '\u2026';
  const row = (b) => '<div style="display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid var(--line);font-size:13px">' +
    '<span class="mono" style="font-weight:600;flex:0 0 auto">v' + esc(b.label) + '</span>' +
    '<span style="flex:1;min-width:0;color:var(--ink-2);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    (b.fingerprint ? '<span class="mono">' + esc(fp(b.fingerprint)) + '</span>' : 'no fingerprint recorded') + '</span>' +
    (b.presentToken
      ? '<a class="btn btn-ghost btn-sm" href="' + escA(pLink(b)) + '" style="font-size:11.5px;flex:0 0 auto">Read</a>'
      : '<span style="font-size:11px;color:var(--ink-2);flex:0 0 auto">not published</span>') + '</div>';
  return '<div class="card" style="padding:18px 20px;margin-top:14px">' +
    '<div class="eyebrow xd" style="font-size:9px;margin-bottom:3px">Baselines</div>' +
    bs.map(row).join('') +
    '<div style="font-size:11px;color:var(--ink-2);margin-top:9px;line-height:1.55">Read-only copies of what was agreed at each baseline. The fingerprint is the one recorded when that baseline was sent for signature; it identifies the exact document and verifies outside this platform.</div></div>';
}

function updCommentHTML(APP, g) {
  const who = (g.recipient || {}).name || '';
  if (!who) return '';
  const f = APP.shareForm || {};
  if (f.commentSent) {
    return '<div class="card" style="padding:18px 20px;margin-top:14px;border-left:3px solid var(--brand)">' +
      '<div style="font-size:13.5px;font-weight:620;margin-bottom:3px">Comment sent</div>' +
      '<div style="font-size:12.5px;color:var(--ink-2);line-height:1.55">It reached the team\u2019s inbox' +
      (f.commentRef ? ' as ' + esc(f.commentRef) : '') + ', recorded under your name. It is a message on the record, not a change to it.</div></div>';
  }
  return '<div class="card" style="padding:18px 20px;margin-top:14px">' +
    '<div class="eyebrow xd" style="font-size:9px;margin-bottom:6px">Comment</div>' +
    '<textarea class="input" id="updcommentbox" rows="3" placeholder="Anything you want on the record about this update" style="font-size:13px;resize:vertical;min-height:64px;line-height:1.5">' + esc(f.comment || '') + '</textarea>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:9px;flex-wrap:wrap">' +
    '<span style="font-size:11px;color:var(--ink-2)">Recorded as <strong>' + esc(who) + '</strong>.</span>' +
    '<button class="btn btn-primary btn-sm" data-action="updcommentsend"' + (f.commentBusy ? ' disabled' : '') + '>' +
    (f.commentBusy ? 'Sending\u2026' : 'Send comment') + '</button></div>' +
    '<div style="font-size:11px;color:var(--ink-2);margin-top:8px;line-height:1.55">This is a message, not an approval. Nothing you write here changes the agreement. To authorize anything, use a signature link above.</div></div>';
}

export function renderUpdatePage(APP) {
  const g = APP.updatePage;
  if (!g || !g.ok) return wrap(invalidCard('update'), 720);
  if (g.revoked) return wrap(
    '<div class="card" style="padding:40px;text-align:center"><div style="font-size:16px;font-weight:620;margin-bottom:6px">This update was withdrawn</div>' +
    '<div style="color:var(--ink-2);font-size:14px;line-height:1.5">The team replaced it. Ask your contact for the current one.</div></div>', 720);
  const bar = '<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px">' +
    '<button class="btn btn-sec btn-sm" data-action="updprint">' + ico(IC.print, 'i-sm') + 'Print / save PDF</button></div>';
  const board = (g.payload || {}).board;
  if (!board) {
    // A link published before v2.35.0 carries no board. It renders exactly as
    // it always did - the frozen digest is evidence and its page never changes
    // shape under it - including the single comment box that release shipped.
    return wrap(bar + updateArtifactHTML(g) +
      updSignaturesHTML(g) + updBaselinesHTML(g) + updCommentHTML(APP, g), 720);
  }
  // The dashboard leads. Key-era links (v2.36.0+) put the authored Key
  // updates and Key questions card under it and fold everything else into
  // one-screen bars that expand on demand. Links from the 2.35 era keep
  // their digest and full cards exactly as published.
  const ui = APP.updUi || {};
  const ex = ui.ex || {};
  if ((g.payload || {}).key) {
    const nThreads = (g.threads || []).length;
    const nSigs = (g.signatures || []).length;
    const nBase = (g.baselines || []).length;
    const hasRecipient = !!((g.recipient || {}).name || (g.recipient || {}).email);
    return wrap(bar + updateDashboardHTML(g, ui) + updKeyCardHTML(g) +
      (hasRecipient ? updSectBar('notes', 'Your notes', (APP.updNotes && APP.updNotes.rev ? 'saved' : 'private to this link'), !!ex.notes, updateNotesHTML(APP, g)) : '') +
      (hasRecipient ? updSectBar('threads', 'Questions and requests', nThreads ? nThreads + ' thread' + (nThreads === 1 ? '' : 's') : 'send one to the team', !!ex.threads, updateThreadsHTML(APP, g)) : '') +
      updSectBar('sign', 'Signatures', (g.signatures || []).some((x) => x.token && x.status !== 'signed' && x.status !== 'declined') ? 'awaiting your signature' : nSigs ? String(nSigs) : 'none yet', ('sign' in ex) ? !!ex.sign : (g.signatures || []).some((x) => x.token && x.status !== 'signed' && x.status !== 'declined'), updSignaturesHTML(g) || '<div class="card" style="padding:14px 18px;margin-top:8px;font-size:12.5px;color:var(--ink-2)">No signature requests on this baseline.</div>') +
      updSectBar('base', 'Baselines', nBase ? String(nBase) : 'none yet', !!ex.base, updBaselinesHTML(g) || '<div class="card" style="padding:14px 18px;margin-top:8px;font-size:12.5px;color:var(--ink-2)">No baselines to show.</div>'), 1020);
  }
  const digest = (g.payload || {}).strip
    ? '<div style="margin-top:14px">' + updateArtifactHTML(g) + '</div>' : '';
  return wrap(bar + updateDashboardHTML(g, ui) + digest +
    updateNotesHTML(APP, g) + updateThreadsHTML(APP, g) +
    updSignaturesHTML(g) + updBaselinesHTML(g), 1020);
}
