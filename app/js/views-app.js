/* ============================================================================
   ReqPub v2 - member views: shell, dashboard, workspace (worksheet + live doc)
   Views are pure functions of APP state; main.js owns events via data-action.
   ============================================================================ */

import { esc, escA, ico, IC, brandmark, initials, relTime, themeGet, APP_VERSION } from './core.js';
import { helpBeaconHTML, helpPanelHTML, helpSpotHTML, helpStudioHTML } from './help.js';
import { Q, SECTIONS, qBySec, visQL, lensHasSec, PHASES, currentPhase, isAnswered, assembleAnswers, buildSections, assemble, mdToHtml, reqDiff, reqDiffDetail, BRIEF_SECTIONS, docSecNum, docSecTitle, isPursuit, pursuitSection } from './domain.js';
import { healthSignals, healthPillLabel } from './health.js';
import { renderTab, newReplyCount } from './views-collab.js';
import { execSummaryHTML } from './exports.js';
import { TEMPLATES } from './templates.js';

export const STATUS_LABEL = { draft: 'Draft', in_review: 'In review', approved: 'Approved', changes_requested: 'Changes requested' };

/* ---------------- chrome ---------------- */
export const shell = (inner, APP) =>
  '<div class="app">' + inner + '</div><div id="toast-slot" aria-live="polite" aria-atomic="true"></div>' + overlays(APP);

export function userMenu(APP) {
  const name = (APP.ctx && APP.ctx.display_name) || (APP.user && APP.user.email) || 'U';
  return '<button class="umbtn" data-help-anchor="nav.account" data-action="usermenu" title="Account"><span class="umav">' + esc(initials(name)) +
    '</span><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>';
}

export function saveChip(APP) {
  const s = APP.saveState || 'idle';
  if (s === 'idle') return '';
  const map = {
    saving: '<span class="spin"></span>Saving…',
    saved: ico(IC.check, 'i-sm') + 'Saved',
    offline: 'Offline. Will retry',
    error: 'Save failed - Retry'
  };
  return '<button class="savechip ' + s + '"' + (s === 'error' ? ' data-action="retrysave"' : ' disabled') +
    ' title="Every edit is saved to the shared workspace">' + map[s] + '</button>';
}

export function presenceBar(APP) {
  const ps = APP.presence || [];
  if (!ps.length) return '';
  const cls = ['', '', 'p2', 'p3', 'p4', 'p5'];
  const avs = ps.slice(0, 5).map((p, i) =>
    '<span class="pav ' + (cls[i + 1] || '') + '" title="' + escA(p.n + (p.f ? ', editing' : ', viewing')) + '">' + esc(initials(p.n)) + '</span>').join('');
  const more = ps.length > 5 ? '<span class="pav" title="' + ps.length + ' people here">+' + (ps.length - 5) + '</span>' : '';
  return '<div class="pres" title="Also in this project now">' + avs + more + '</div>';
}

function themeRow() {
  const cur = themeGet();
  const opt = (v, label) => '<button class="chip chip-sm' + (cur === v ? ' on' : '') + '" data-action="themeset" data-val="' + v + '">' + label + '</button>';
  return '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px"><span class="eyebrow" style="font-size:9px">Theme</span><div class="choice">' + opt('light', 'Light') + opt('dark', 'Dark') + opt('system', 'Auto') + '</div></div>';
}

export function overlays(APP) {
  let out = '';
  if (APP.pasteQ) {
    const pq = APP.pasteQ;
    const n2 = pq.preview ? pq.preview.length : 0;
    const prim = (r) => r.stmt || r.dim || r.metric || r.term || r.persona || r.iface || r.gate || r.decision || r.entity || '';
    out += '<div class="ovl" data-action="pastecancel"><div class="modal" style="max-width:640px" onclick="event.stopPropagation()">' +
      '<div style="font-weight:660;margin-bottom:6px">Paste rows</div>' +
      '<p class="hint" style="margin:0 0 10px">Paste a list, or a table copied from Word or Excel. Parsing is deterministic: named headers map, headerless tables are read by content, MoSCoW letters expand, IDs stay as prefixes. Nothing is added until you approve the preview.</p>' +
      '<textarea id="pasteText" class="input" rows="8" style="width:100%;font-family:var(--mono);font-size:12.5px" placeholder="Paste here">' + esc(pq.text || '') + '</textarea>' +
      (pq.preview ? '<div class="hint" style="margin:10px 0 4px"><b>' + n2 + ' row' + (n2 === 1 ? '' : 's') + '</b> parsed' + (n2 ? ':' : '. Adjust the text and preview again.') + '</div>' +
        (n2 ? '<ul style="margin:0 0 6px 18px;font-size:12.5px;color:var(--ink-3)">' + pq.preview.slice(0, 3).map((r) => '<li>' + esc(String(prim(r)).slice(0, 90)) + '</li>').join('') + (n2 > 3 ? '<li>\u2026 and ' + (n2 - 3) + ' more</li>' : '') + '</ul>' : '') : '') +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      '<button class="btn btn-sec btn-sm" data-action="pastecancel">Cancel</button>' +
      '<button class="btn btn-sec btn-sm" data-action="pastepreview">Preview</button>' +
      (n2 ? '<button class="btn btn-primary btn-sm" data-action="pasteapply">Add ' + n2 + ' row' + (n2 === 1 ? '' : 's') + '</button>' : '') +
      '</div></div></div>';
  }
  if (APP.kbHelp) {
    const row = (k, d) => '<div style="display:flex;gap:14px;align-items:baseline;margin:6px 0"><span class="kbd" style="font-family:var(--mono);font-size:12px;border:1px solid var(--line);border-radius:6px;padding:2px 8px;min-width:86px;text-align:center">' + k + '</span><span style="font-size:13px;color:var(--ink-2)">' + d + '</span></div>';
    out += '<div class="ovl" data-action="kbclose"><div class="modal" style="max-width:420px" onclick="event.stopPropagation()">' +
      '<div style="font-weight:660;margin-bottom:10px">Keyboard</div>' +
      row('\u2318/Ctrl K', 'Command palette, with your recent questions on top') +
      row('j / k', 'Next / previous question') +
      row('Enter', 'Open the current question for editing') +
      row('Alt Enter', 'Add a row to the question you are editing') +
      row('\u2318/Ctrl Enter', 'Send the message you are writing') +
      row('?', 'This sheet') + row('Esc', 'Close') +
      '<div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn btn-sec btn-sm" data-action="kbclose">Close</button></div></div></div>';
  }
  if (APP.tplSave) {
    out += '<div class="ovl" data-action="tplsavecancel"><div class="modal" style="max-width:460px" onclick="event.stopPropagation()">' +
      '<div style="font-weight:660;margin-bottom:6px">Save as firm template</div>' +
      '<p class="hint" style="margin:0 0 10px">Saves the standing structure of this record for reuse at creation: non-functional requirements and the glossary, plus organization and document type. No client content. Every template shows its last-reviewed date.</p>' +
      '<input id="tplName" class="input" placeholder="Template name" maxlength="80" value="' + escA(APP.tplSave.name || '') + '">' +
      (APP.tplSave.error ? '<div class="hint" style="color:var(--bad);margin-top:6px">' + esc(APP.tplSave.error) + '</div>' : '') +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      '<button class="btn btn-sec btn-sm" data-action="tplsavecancel">Cancel</button>' +
      '<button class="btn btn-primary btn-sm" data-action="tplsaveconfirm">Save template</button>' +
      '</div></div></div>';
  }
  if (APP.menuOpen) {
    const name = (APP.ctx && APP.ctx.display_name) || '';
    const email = (APP.user && APP.user.email) || '';
    const orgs = (APP.ctx && APP.ctx.memberships) || [];
    const orgRows = orgs.length > 1 ? orgs.map((m) =>
      '<button class="umitem" data-action="orgswitch" data-id="' + escA(m.org_id) + '">' + ico(IC.layers) +
      esc(m.org_name) + (m.org_id === APP.orgId ? '<span class="umrole" style="margin-left:auto">current</span>' : '') + '</button>').join('') + '<div class="umsep"></div>' : '';
    out += '<div class="umback" data-action="menuclose"></div><div class="umpop">' +
      '<div class="umhead"><span class="umav lg">' + esc(initials(name || email)) + '</span><div style="min-width:0">' +
      '<div class="umname">' + esc(name || 'Set your name') + '</div><div class="umsub">' + esc(email) + '</div>' +
      '<span class="umrole" style="margin-top:5px">' + esc(APP.role === 'manager' ? 'Manager' : APP.role === 'viewer' ? 'Viewer' : 'Client contact') + '</span></div></div>' +
      '<div class="umsep"></div>' + orgRows +
      '<button class="umitem" data-action="profileopen">' + ico(IC.user) + 'Profile &amp; display name</button>' +
      (APP.role === 'manager' ? '<button class="umitem" data-action="orgopen">' + ico(IC.users) + 'Organization &amp; people</button>' : '') +
      '<button class="umitem" data-action="palette">' + ico(IC.search) + 'Command palette<span class="k" style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">⌘K</span></button>' +
      themeRow() +
      '<div class="umsep"></div><button class="umitem danger" data-action="signout">' + ico(IC.signout) + 'Sign out</button>' + '<div style="padding:7px 12px 4px;font-size:10px;color:var(--ink-3);font-family:var(--mono)">ReqPub v' + APP_VERSION + '</div></div>';
  }
  if (APP.wsMenuOpen) out += wsMenu(APP);
  if (APP.profileOpen) out += profileModal(APP);
  if (APP.orgOpen) out += orgModal(APP);
  if (APP.genOpen) out += generateModal(APP);
  if (APP.palOpen) out += palette(APP);
  if (APP.delPending) out += deleteModal(APP);
  if (APP.shareOpen) out += shareModal(APP);
  if (APP.briefPickOpen) out += briefPicker(APP);
  if (APP.view === 'projects' || APP.view === 'workspace') {
    out += helpBeaconHTML(APP) + helpPanelHTML(APP) + helpSpotHTML(APP) + helpStudioHTML(APP);
  }
  return out;
}

/* Workspace switcher: one email, many workspaces, one obvious place to move
   between them, create another, or open settings. */
function wsMenu(APP) {
  const orgs = (APP.ctx && APP.ctx.memberships) || [];
  const rows = orgs.map((m) =>
    '<button class="umitem" data-action="orgswitch" data-id="' + escA(m.org_id) + '">' +
    '<span class="acctdot">' + esc((m.org_name || 'W').charAt(0).toUpperCase()) + '</span>' +
    '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.org_name) + '</span>' +
    (m.org_id === APP.orgId ? ico(IC.check, 'i-sm') : '<span class="umrole">' + esc(m.role) + '</span>') + '</button>').join('');
  const create = APP.wsCreating
    ? '<div style="display:flex;gap:6px;padding:10px 16px"><input class="input" id="wsName" placeholder="New workspace name" style="height:34px;font-size:12.5px;flex:1">' +
      '<button class="btn btn-primary btn-sm" data-action="wscreatego">Create</button></div>'
    : '<button class="umitem" data-action="wscreate">' + ico(IC.plus) + 'Create a new workspace…</button>';
  return '<div class="umback" data-action="menuclose"></div><div class="umpop left" role="menu" aria-label="Workspaces">' +
    '<div style="padding:12px 16px 6px" class="eyebrow">Your workspaces</div>' + rows +
    '<div class="umsep"></div>' +
    (APP.role === 'manager' ? '<button class="umitem" data-action="orgopen">' + ico(IC.users) + 'Workspace settings &amp; invites</button>' : '') +
    create + '</div>';
}

/* Section picker for review briefs: preselected defaults, adjustable, and the
   choice is remembered per project. Filtering happens at payload build. */
function briefPicker(APP) {
  const picked = APP.briefPick || [];
  const latest = APP.versions.length ? APP.versions[APP.versions.length - 1] : null;
  const chips = BRIEF_SECTIONS.map((s) =>
    '<button class="chip' + (picked.includes(s.key) ? ' on' : '') + '" data-action="briefpicktoggle" data-val="' + s.key + '" style="height:36px;font-size:13px">' + esc(s.label) + '</button>').join('');
  return '<div class="modal-back" data-action="modalback"><div class="modal-card" role="dialog" aria-modal="true" data-stop="1">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start"><h3>What do client contacts and SMEs see?</h3><button class="modal-x" data-action="modalclose">' + ico(IC.close) + '</button></div>' +
    '<div class="hint" style="margin-top:4px">These are the sections' + (latest ? ' of v' + esc(latest.label) : '') + ' that every external party sees: client contacts in their portal, SMEs in their workspace, and anyone with a review link. Unselected content is left out of the share entirely, not hidden. Fit criteria, schedules, and internal notes are never included.</div>' +
    '<div class="fldlabel">Sections</div><div class="choice">' + chips + '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:18px">' +
    '<span class="hint">' + picked.length + ' of ' + BRIEF_SECTIONS.length + ' selected</span>' +
    '<div style="display:flex;gap:8px"><button class="btn btn-sec" data-action="modalclose">Cancel</button>' +
    '<button class="btn btn-primary" data-action="briefpickconfirm"' + (picked.length && latest ? '' : ' disabled') + '>Publish &amp; copy link</button></div></div>' +
    '</div></div>';
}

/* One door for every audience: pick who, get exactly the right next step. */
function shareModal(APP) {
  const latest = APP.versions.length ? APP.versions[APP.versions.length - 1] : null;
  const row = (iconPath, bg, color, title, desc, action, disabled) =>
    '<button class="umitem" data-action="' + action + '"' + (disabled ? ' disabled' : '') +
    ' style="padding:13px 16px;gap:12px;align-items:flex-start' + (disabled ? ';opacity:.45;cursor:not-allowed' : '') + '">' +
    '<span class="acc-ic" style="background:' + bg + ';color:' + color + ';width:32px;height:32px;flex:0 0 auto">' + ico(iconPath, 'i-sm') + '</span>' +
    '<span style="min-width:0"><span style="display:block;font-size:13.5px;font-weight:600;color:var(--ink)">' + title + '</span>' +
    '<span style="display:block;font-size:11.5px;color:var(--ink-4);line-height:1.45;margin-top:1px">' + desc + '</span></span>' +
    '<span style="margin-left:auto;color:var(--ink-4);align-self:center">' + ico(IC.fwd, 'i-sm') + '</span></button>';
  return '<div class="modal-back" data-action="modalback"><div class="modal-card" role="dialog" aria-modal="true" style="max-width:440px;padding:0;overflow:hidden" data-stop="1">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:22px 22px 4px"><div><h3>Share this project</h3>' +
    '<div class="hint" style="margin-top:4px">Pick who you are bringing in. Each audience gets its own door and sees only what it should.</div></div>' +
    '<button class="modal-x" data-action="modalclose">' + ico(IC.close) + '</button></div>' +
    '<div style="padding:10px 6px 12px">' +
    row(IC.users, 'var(--sky)', 'var(--brand)', 'A teammate', 'Full workspace access with an account. Managers edit; Viewers read and reply.', 'shr-team') +
    row(IC.user, '#f1ebfd', 'var(--purple)', 'A client contact', 'Client-side manager of SMEs. Signs in, sees published briefs of granted projects only.', 'shr-partner') +
    row(IC.send, '#e6f7fb', 'var(--teal)', 'An SME reviewer', latest ? 'Pick which sections of v' + esc(latest.label) + ' they see, then copy the link. No account needed.' : 'Generate a version first.', 'shr-brief', !latest) +
    row(IC.link, '#e6f7fb', 'var(--teal)', 'An app tester', latest ? 'Copies the testing link for v' + esc(latest.label) + '. Bug reports land in your Inbox.' : 'Generate a version first.', 'shr-pilot', !latest) +
    row(IC.msg, 'var(--amber-bg)', 'var(--amber)', 'A question for an SME', 'Compose an input request and send its link. Answers thread back to the Inbox.', 'shr-request') +
    '<div class="umsep" style="margin:4px 0"></div>' +
    row(IC.eye, 'var(--bg-3)', 'var(--ink)', 'Anyone, read-only', latest ? 'Copies a fixed, branded, view-only link of v' + esc(latest.label) + '. No account, no review. Just the record.' : 'Generate a version first.', 'copypresent', !latest) +
    '</div></div></div>';
}

function profileModal(APP) {
  return '<div class="modal-back" data-action="modalback"><div class="modal-card" role="dialog" aria-modal="true" data-stop="1">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start"><h3>Profile</h3><button class="modal-x" data-action="modalclose">' + ico(IC.close) + '</button></div>' +
    '<div class="fldlabel">Display name</div><input class="input" id="pfName" value="' + escA((APP.ctx && APP.ctx.display_name) || '') + '" placeholder="First and last">' +
    '<div class="hint" style="margin-top:8px">Shown on versions you generate, edits you make, replies you send, and to teammates working alongside you.</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn btn-sec" data-action="modalclose">Cancel</button><button class="btn btn-primary" data-action="profilesave">Save</button></div>' +
    '</div></div>';
}

function generateModal(APP) {
  const g = APP.gen || {};
  const nextMinor = nextLabel(APP.versions, false), nextMajor = nextLabel(APP.versions, true);
  return '<div class="modal-back" data-action="modalback"><div class="modal-card" role="dialog" aria-modal="true" data-stop="1">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start"><h3>Generate a version</h3><button class="modal-x" data-action="modalclose">' + ico(IC.close) + '</button></div>' +
    '<div class="hint" style="margin-top:6px">Locks the current worksheet into an immutable baseline that reviewers, SMEs, and client contacts see.</div>' +
    '<div class="fldlabel">Version</div><div class="choice">' +
    '<button class="chip' + (!g.major ? ' on' : '') + '" data-action="genkind" data-val="minor">Minor · v' + esc(nextMinor) + '</button>' +
    '<button class="chip' + (g.major ? ' on' : '') + '" data-action="genkind" data-val="major">Major · v' + esc(nextMajor) + '</button></div>' +
    '<div class="fldlabel">Change note (optional. A summary is added automatically)</div>' +
    '<input class="input" id="genNote" value="' + escA(g.note || '') + '" placeholder="e.g. Added e-signature requirements after SME review">' +
    '<div class="fldlabel">Gate (optional. Names this baseline as a stage-gate decision point)</div>' +
    '<input class="input" id="genGate" value="' + escA(g.gate || '') + '" placeholder="e.g. Requirements Baseline, Design Baseline, Go-Live">' +
    (g.error ? '<div style="color:var(--bad);font-size:12.5px;margin-top:10px">' + esc(g.error) + '</div>' : '') +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn btn-sec" data-action="modalclose">Cancel</button>' +
    '<button class="btn btn-primary" data-action="genconfirm"' + (g.busy ? ' disabled' : '') + '>' + (g.busy ? 'Generating…' : 'Generate v' + esc(g.major ? nextMajor : nextMinor)) + '</button></div>' +
    '</div></div>';
}

export function nextLabel(versions, major) {
  if (!versions || !versions.length) return '1.0';
  const top = versions.reduce((a, b) => ((b && b.seq) || 0) > ((a && a.seq) || 0) ? b : a, versions[0]);
  const prev = (top && top.label) || '1.0';
  const maj = parseInt(prev.split('.')[0], 10) || 1;
  const min = parseInt(prev.split('.')[1] || '0', 10) || 0;
  return major ? (maj + 1) + '.0' : maj + '.' + (min + 1);
}

function deleteModal(APP) {
  const p = APP.delPending;
  return '<div class="modal-back"><div class="modal-card" role="dialog" aria-modal="true" style="max-width:400px">' +
    '<div style="font-size:17px;font-weight:660;margin-bottom:6px">Archive this project?</div>' +
    '<div style="font-size:13.5px;color:var(--ink-3);line-height:1.5;margin-bottom:16px">&ldquo;' + esc(p.name) + '&rdquo; will be hidden from the workspace. Its data, versions, and communications are kept and an administrator can restore it in the database. Type <strong>' + esc(p.name) + '</strong> to confirm.</div>' +
    '<input class="input" id="delCode" autocomplete="off" placeholder="' + escA(p.name) + '" style="height:44px;font-size:15px;margin-bottom:' + (APP.delError ? '10px' : '14px') + '">' +
    (APP.delError ? '<div style="color:var(--bad);font-size:12.5px;font-weight:560;margin-bottom:14px">' + esc(APP.delError) + '</div>' : '') +
    '<div style="display:flex;gap:8px"><button class="btn btn-sec" data-action="delcancel" style="flex:1;height:44px">Cancel</button><button class="btn btn-danger" data-action="delconfirm" style="flex:1;height:44px">Archive</button></div>' +
    '</div></div>';
}

/* ---------------- command palette ---------------- */
export function paletteItems(APP) {
  const items = [];
  // Recent questions first: the last places edited are the most likely
  // next destination for a power user. Session memory only.
  if (APP.view === 'workspace' && (APP.recentQ || []).length) {
    APP.recentQ.forEach((qid) => {
      const q = Q.find((x) => x.id === qid);
      if (q) items.push({ label: q.prompt || qid, hint: 'Recent', ico: IC.fwd, action: 'jumpq', id: qid });
    });
  }
  (APP.projects || []).forEach((p) => items.push({ label: p.name, hint: 'Open project', ico: IC.doc, action: 'open', id: p.id }));
  if (APP.view === 'workspace') {
    [['document', 'Document · Read'], ['summary', 'Document · Summary'], ['changes', 'Document · Changes'], ['versions', 'Document · Versions'],
     ['health', 'Document · Health'], ['updates', 'Document · Updates'], ['inbox', 'Inbox · Messages'], ['feedback', 'Inbox · App feedback'], ['notes', 'Inbox · Notes'], ['discovery', 'Discovery'],
     ['access', 'Share · Access'], ['people', 'Share · People'], ['activity', 'Activity']]
      .forEach(([t, lbl]) => items.push({ label: 'Go to ' + lbl, hint: 'View', ico: IC.fwd, action: 'tab', id: t }));
    if (APP.role === 'manager') items.push({ label: 'Generate a version', hint: 'Baseline', ico: IC.layers, action: 'genopen' });
    if (APP.role === 'manager') items.push({ label: 'Share this project', hint: 'Access', ico: IC.send, action: 'shareopen' });
    if (APP.role === 'manager') items.push({ label: 'Save as firm template', hint: 'Reuse', ico: IC.layers, action: 'tplsaveopen' });
    items.push({ label: 'Presentation mode', hint: 'Document', ico: IC.expand, action: 'present' });
    items.push({ label: 'Export Word document', hint: 'Export', ico: IC.word, action: 'word' });
    items.push({ label: 'Print / save as PDF', hint: 'Export', ico: IC.print, action: 'print' });
    items.push({ label: 'Client baseline report (PDF)', hint: 'Export', ico: IC.shield, action: 'clientprint' });
    items.push({ label: 'SOW exhibit (PDF)', hint: 'Export', ico: IC.shield, action: 'sowexhibit' });
    items.push({ label: 'Implementation package (ZIP)', hint: 'Export', ico: IC.download, action: 'implpkg' });
    items.push({ label: 'Verification bundle (JSON)', hint: 'Export', ico: IC.shield, action: 'verbundle' });
    items.push({ label: 'Gate packet (PDF)', hint: 'Export', ico: IC.check, action: 'gatepacket' });
  }
  items.push({ label: 'New project', hint: 'Create', ico: IC.plus, action: 'palnew' });
  items.push({ label: 'Toggle dark mode', hint: 'Theme', ico: IC.moon, action: 'themetoggle' });
  if (APP.role === 'manager') items.push({ label: 'Organization & people', hint: 'Admin', ico: IC.users, action: 'orgopen' });
  const q = (APP.palQ || '').toLowerCase().trim();
  return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
}
function palette(APP) {
  const items = paletteItems(APP);
  const sel = Math.min(APP.palSel || 0, Math.max(items.length - 1, 0));
  return '<div class="pal-back" data-action="palclose"><div class="pal" data-stop="1">' +
    '<input id="palInput" aria-label="Command palette" placeholder="Type a command or project name…" value="' + escA(APP.palQ || '') + '" autocomplete="off">' +
    '<div class="pal-list">' + (items.length ? items.map((it, i) =>
      '<button class="pal-item' + (i === sel ? ' on' : '') + '" data-action="palgo" data-ix="' + i + '">' + ico(it.ico || IC.fwd, 'i-sm') +
      '<span>' + esc(it.label) + '</span><span class="k">' + esc(it.hint || '') + '</span></button>').join('')
      : '<div style="padding:18px;text-align:center;color:var(--ink-4);font-size:13px">No matches.</div>') +
    '</div></div></div>';
}

/* ---------------- organization modal ---------------- */
function orgModal(APP) {
  const o = APP.orgData || { members: [], invites: [], partners: [], tab: 'members' };
  const tab = o.tab || 'members';
  const tabBtn = (t, l) => '<button class="seg-it' + '" data-action="orgtab" data-val="' + t + '" style="height:32px;padding:0 14px;border-radius:8px;font-size:13px;font-weight:540;' + (tab === t ? 'background:var(--bg);color:var(--ink);box-shadow:var(--shadow-sm)' : 'color:var(--ink-3)') + '">' + l + '</button>';
  let body = '';
  if (tab === 'members') {
    const rows = (o.members || []).map((m) =>
      '<div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--line)">' +
      '<span class="umav">' + esc((m.email || 'U').charAt(0).toUpperCase()) + '</span>' +
      '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:560;overflow:hidden;text-overflow:ellipsis">' + esc(m.email || m.user_id) + '</div></div>' +
      (m.user_id === APP.user.id ? '<span class="umrole">' + esc(m.role) + ' · you</span>'
        : '<select class="input" data-action="mrole" data-id="' + escA(m.user_id) + '" style="height:30px;padding:0 8px;width:auto;font-size:12px">' +
          ['manager', 'viewer'].map((r) => '<option' + (m.role === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>' +
          '<button class="icobtn" data-action="mremove" data-id="' + escA(m.user_id) + '" title="Remove">' + ico(IC.close, 'i-sm') + '</button>') +
      '</div>').join('');
    const inv = (o.invites || []).map((i) => {
      const invLink = location.origin + '/signup/?ws=' + encodeURIComponent(APP.org || '') + '&email=' + encodeURIComponent(i.email);
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">' +
        '<span style="flex:1;min-width:0;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis">' + esc(i.email) + '</span><span class="pill">' + esc(i.role) + ' · invited</span>' +
        '<button class="btn btn-sec btn-sm" data-action="copylink" data-link="' + escA(invLink) + '" title="Copy an invite link to send them yourself">' + ico(IC.copy, 'i-sm') + 'Link</button>' +
        '<button class="icobtn" data-action="invrevoke" data-id="' + escA(i.email) + '">' + ico(IC.close, 'i-sm') + '</button></div>';
    }).join('');
    body = '<div class="fldlabel">Invite a teammate</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="invEmail" type="email" placeholder="name@company.com" style="flex:1;min-width:180px">' +
      '<select class="input" id="invRole" style="width:auto"><option value="manager">Manager, edits documents</option><option value="viewer">Viewer, read + comment</option></select>' +
      '<button class="btn btn-primary" data-action="invsend">Invite</button></div>' +
      '<div class="hint" style="margin-top:7px">Managers write; Viewers read everything and can reply in the Inbox. The invite email needs the send-invite function deployed. The invite itself works either way.</div>' +
      '<div class="fldlabel" style="margin-top:18px">Members</div>' + (rows || '<div class="hint">Just you so far.</div>') +
      (inv ? '<div class="fldlabel" style="margin-top:14px">Pending invites</div>' + inv : '');
  } else {
    const projs = APP.projects || [];
    const rows = (o.partners || []).map((p) => {
      const chips = projs.map((pr) =>
        '<button class="chip chip-sm' + (p.acc[pr.id] ? ' on' : '') + '" data-action="paccess" data-id="' + escA(p.id) + '" data-pid="' + escA(pr.id) + '">' + esc(pr.name) + '</button>').join('');
      return '<div style="padding:12px 0;border-bottom:1px solid var(--line)">' +
        '<div style="display:flex;align-items:center;gap:10px"><span class="umav" style="background:var(--purple)">' + esc((p.name || p.email).charAt(0).toUpperCase()) + '</span>' +
        '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:560">' + esc(p.name || p.email) + '</div><div style="font-size:11.5px;color:var(--ink-4)">' + esc(p.email) + '</div></div>' +
        '<button class="icobtn" data-action="premove" data-id="' + escA(p.id) + '">' + ico(IC.close, 'i-sm') + '</button></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;padding-left:40px">' + (chips || '<span class="hint">Create a project to assign.</span>') + '</div></div>';
    }).join('');
    body = '<div class="fldlabel">Add a client contact</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="pName" placeholder="Name" style="flex:1;min-width:120px"><input class="input" id="pEmail" type="email" placeholder="email" style="flex:1.4;min-width:170px"><button class="btn btn-primary" data-action="paddnew">Add</button></div>' +
      '<div class="hint" style="margin-top:7px">Client contacts manage SMEs on the client side. They sign in with this email, see only the published brief of assigned projects, and exchange threads with your team.</div>' +
      '<div class="fldlabel" style="margin-top:18px">Client contacts &amp; project access</div>' + (rows || '<div class="hint">No client contacts yet.</div>');
  }
  return '<div class="modal-back" data-action="modalback"><div class="modal-card" role="dialog" aria-modal="true" style="max-width:560px" data-stop="1">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start"><h3>' + esc(APP.org || 'Organization') + '</h3><button class="modal-x" data-action="modalclose">' + ico(IC.close) + '</button></div>' +
    '<div class="seg" style="margin:14px 0 4px">' + tabBtn('members', 'Team') + tabBtn('partners', 'Client contacts') + '</div>' + body + '</div></div>';
}

/* ---------------- dashboard ---------------- */
export function viewProjects(APP) {
  const list = APP.projects || [];
  const stats = APP.projectStats || {};
  const agg = { unread: 0, open: 0, newExt: 0 };
  list.forEach((p) => { const s = stats[p.id]; if (s) { agg.unread += s.unread; agg.open += s.open; agg.newExt += (s.newExt || 0); } });
  const bits = [];
  if (agg.newExt) bits.push(agg.newExt + ' new repl' + (agg.newExt === 1 ? 'y' : 'ies') + ' from client contacts or SMEs');
  if (agg.open && APP.role === 'manager') bits.push(agg.open + ' item' + (agg.open === 1 ? '' : 's') + ' awaiting review');
  const banner = bits.length
    ? '<div class="card rise" style="padding:16px 18px;margin-bottom:18px;border:1px solid var(--sky-2);background:var(--sky);display:flex;align-items:center;gap:12px">' +
      '<div style="width:38px;height:38px;border-radius:11px;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto">' + ico(IC.msg) + '</div>' +
      '<div><div style="font-size:14px;font-weight:640">At a glance</div><div style="font-size:12.5px;color:var(--ink-3);margin-top:2px">' + esc(bits.join(' · ')) + '</div></div></div>' : '';

  // Personal action item: versions where a slot is assigned to me and pending.
  // This is the in-app "waiting on you" flag (no email is sent).
  const mine = APP.myApprovals || [];
  const apprBanner = mine.length
    ? '<div class="card rise" style="padding:16px 18px;margin-bottom:18px;background:var(--brand);color:#fff;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<div style="width:38px;height:38px;border-radius:11px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex:0 0 auto">' + ico(IC.check) + '</div>' +
      '<div style="flex:1;min-width:180px"><div style="font-size:14px;font-weight:660">Waiting on your approval</div>' +
      '<div style="font-size:12.5px;opacity:.9;margin-top:2px">' + mine.length + ' version' + (mine.length === 1 ? '' : 's') + ' assigned to you for sign-off.</div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      mine.map((m) => '<button data-action="openappr" data-id="' + escA(m.project_id) + '" style="background:#fff;color:var(--brand);border:none;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer">Review v' + esc(m.version_label) + ' · ' + esc(m.project_name || 'Project') + '</button>').join('') +
      '</div></div>' : '';

  const cards = list.length ? list.map((p, i) => {
    const s = stats[p.id] || {};
    const latest = s.latest;
    const cb = (s.newExt ? '<span class="pill pill-brand">' + s.newExt + ' new repl' + (s.newExt === 1 ? 'y' : 'ies') + '</span>' : '') +
      (s.open ? '<span class="pill">' + s.open + ' open</span>' : '');
    // One-click Approve straight from the card: a manager can clear "Draft"
    // without opening Version history. It walks Draft → In review → Approved in
    // a single action (see cardapprove). Hidden once the latest is approved.
    const canApprove = APP.role === 'manager' && latest && latest.status !== 'approved';
    const approveCtl = canApprove
      ? '<span style="flex-basis:100%;height:2px"></span>' +
        '<span data-action="cardapprove" data-id="' + escA(p.id) + '" title="Send for review, then approve. In one click" ' +
        'style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:580;color:var(--good);border:1px solid var(--good);border-radius:999px;padding:3px 11px;cursor:pointer;background:transparent">' +
        ico(IC.check, 'i-sm') + 'Approve v' + esc(latest.label) + '</span>' +
        (latest.status === 'draft'
          ? '<span style="font-size:10.5px;color:var(--ink-4);flex-basis:100%;margin-top:1px">Sends for review, then approves.</span>'
          : '')
      : '';
    return '<button class="pcard rise" style="animation-delay:' + (i * 40) + 'ms" data-action="open" data-id="' + escA(p.id) + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
      '<div style="min-width:0"><div style="font-weight:600;letter-spacing:-.01em;font-size:15.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.name) + '</div>' +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:3px">Updated ' + esc(relTime(p.updated_at)) + '</div></div>' +
      (APP.role === 'manager' ? '<span class="icobtn" data-action="del" data-id="' + escA(p.id) + '" title="Archive">' + ico(IC.trash, 'i-sm') + '</span>' : '') + '</div>' +
      '<div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
      (latest ? '<span class="pill"><span class="mono">v' + esc(latest.label) + '</span></span><span class="stchip ' + esc(latest.status) + '">' + esc(STATUS_LABEL[latest.status]) + '</span>' : '<span class="pill" style="color:var(--ink-3)">Draft, no version</span>') +
      // v2.55 the Book: signature counts and the sealed truth, from one
      // batched call. A missing fact renders nothing; the layout never bends.
      (() => { const f = (APP.acceptFacts || {})[p.id]; if (!f) return '';
        return (f.pending ? '<span class="pill">' + f.pending + ' awaiting signature</span>' : '') +
          (f.signed ? '<span class="pill">' + f.signed + ' signed</span>' : '') +
          (f.sealed ? '<span class="pill" title="At least one acceptance receipt is sealed on this record">Sealed</span>' : ''); })() +
      (p.practice ? '<span class="pill" style="color:var(--amber);border-color:var(--amber)" title="A rehearsal, never evidence: excluded from the Book, webhooks, and evidence packs">PRACTICE</span>' : '') +
      cb + approveCtl + '</div>' +
      '</button>';
  }).join('') : onboardBlock(APP);

  return shell(
    '<div class="topbar"><div style="display:flex;align-items:center;gap:11px">' + brandmark() +
    '<div><div style="font-weight:660;letter-spacing:-.02em;font-size:15px">ReqPub</div><div class="eyebrow" style="font-size:9.5px;letter-spacing:.18em;margin-top:1px">Discovery to Requirements</div></div>' +
    (APP.org ? '<div style="width:1px;height:26px;background:var(--line-2);margin:0 3px"></div><button class="acctchip" data-action="wsmenu" title="Switch workspace"><span class="acctdot">' + esc((APP.org || 'W').charAt(0).toUpperCase()) + '</span>' + esc(APP.org) +
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.55"><polyline points="6 9 12 15 18 9"/></svg></button>' : '') +
    '</div><div style="display:flex;align-items:center;gap:8px">' + saveChip(APP) + userMenu(APP) + '</div></div>' +
    '<div style="flex:1;overflow-y:auto"><div class="wrap">' +
    '<div class="rise" style="margin-bottom:40px"><h1 style="font-size:38px;line-height:1.08;letter-spacing:-.03em;font-weight:660;margin:0 0 12px">Discovery to Requirements.</h1>' +
    '<p style="color:var(--ink-3);max-width:760px;font-size:15.5px;line-height:1.6;margin:0">One shared workspace from workshop input to a versioned, approved requirements or engagement record.</p></div>' +
    (APP.role === 'manager'
      ? '<div class="card rise rp-newcard" style="padding:20px;margin-bottom:34px;animation-delay:60ms">' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        (APP.role === 'manager' ? '<button class="btn btn-sec" data-action="bookexport" title="Every signature across your records, the evidence.csv columns plus engagement value, practice excluded" style="height:46px">Export book</button>' : '') +
        '<input id="newName" class="input" style="flex:1;min-width:220px;height:46px" placeholder="Name a new product or project to specify" value="' + escA(APP.newName || '') + '"' + (APP.creating ? ' disabled' : '') + '>' +
        '<button class="btn btn-primary" style="height:46px' + (APP.creating ? ';opacity:.6;pointer-events:none' : '') + '" data-help-anchor="projects.new" data-action="new"' + (APP.creating ? ' disabled' : '') + '>' + ico(IC.plus) + (APP.creating ? 'Creating…' : 'New project') + '</button></div>' +
        // Start from a template: validated starter shapes loaded through the
        // same rev-checked RPCs as live editing (see app/js/templates.js).
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:12px">' +
        '<span class="eyebrow" style="font-size:9px;margin-right:2px">Start from</span>' +
        TEMPLATES.map((t) => {
          const on = (APP.newTpl || 'blank') === t.key;
          return '<button class="btn btn-sm" data-action="tplsel" data-val="' + escA(t.key) + '" style="height:30px;border-radius:999px;padding:0 12px;font-size:12px;' +
            (on ? 'background:var(--ink);color:var(--bg)' : 'border:1px solid var(--line);color:var(--ink-3)') + '">' + esc(t.label) + '</button>';
        }).join('') +
        (() => {
          const chip = (val2, label, title, on) => '<button class="btn btn-sm" data-action="tplsel" data-val="' + escA(val2) + '" title="' + escA(title || '') + '" style="height:30px;border-radius:999px;padding:0 12px;font-size:12px;' +
            (on ? 'background:var(--ink);color:var(--bg)' : 'border:1px solid var(--line);color:var(--ink-3)') + '">' + esc(label) + '</button>';
          const sel = APP.newTpl || 'blank';
          let out2 = chip('documents', 'Documents', 'Upload the PRD or client documents first. Preview shows where every section lands; nothing is written without approval.', sel === 'documents');
          out2 += ((APP.recordTemplates || []).map((rt) => chip('rt:' + rt.id, rt.name,
            'Firm template. Reviewed ' + (rt.reviewed_at ? new Date(rt.reviewed_at).toLocaleDateString() : 'never') + '.', sel === 'rt:' + rt.id)).join(''));
          const clonables = (APP.projects || []).filter((x) => !x.archived);
          if (clonables.length) {
            out2 += '<select class="input" data-role="clonesel" style="height:30px;padding:0 10px;font-size:12px;border-radius:999px;max-width:240px' +
              (String(sel).startsWith('clone:') ? ';border-color:var(--ink)' : '') + '">' +
              '<option value="">Clone a record\u2026</option>' +
              clonables.map((x) => '<option value="clone:' + escA(x.id) + '"' + (sel === 'clone:' + x.id ? ' selected' : '') + '>' +
                esc(x.name) + ' \u00b7 updated ' + esc(new Date(x.updated_at).toLocaleDateString()) + '</option>').join('') + '</select>';
          }
          return out2;
        })() + '</div>' +
        /* The template description belongs to the chips above it, so it sits
           directly beneath them. Putting the practice control in between split
           a label from the thing it labelled, and the description read as if
           it described practice mode. */
        '<div style="font-size:11.5px;color:var(--ink-4);line-height:1.5;margin-top:7px">' +
        esc((TEMPLATES.find((t) => t.key === (APP.newTpl || 'blank')) || TEMPLATES[0]).desc) + '</div>' +
        ((APP.newTpl || '') === 'documents' ? '<div class="hint" style="margin-top:8px">The project opens straight into Populate from documents. Structure copied: none. Content: whatever the preview approves.</div>' : '') +
        (String(APP.newTpl || '').startsWith('clone:') ? '<div class="hint" style="margin-top:8px">Clone copies the standing structure only: non-functional requirements and the glossary, plus organization and document type. No client content travels.</div>' : '') +
        /* A rule, because what follows is a different kind of decision. The
           chips choose a shape. This chooses whether the record is real. */
        '<div class="rp-new-rule"></div>' +
        '<label class="rp-practice" for="newPractice">' +
        '<input type="checkbox" id="newPractice"' + (APP.newPractice ? ' checked' : '') + (APP.creating ? ' disabled' : '') + '>' +
        '<span><span class="rp-practice-label">Practice record</span>' +
        '<span class="rp-practice-lede">A rehearsal. It can never become a real record.</span></span></label>' +
        /* Revealed by the checkbox itself, with no handler and no state, so the
           consequences arrive at the moment they start applying rather than
           sitting permanently above the control people use most. */
        '<div class="rp-practice-detail">You are about to create a practice record. This cannot be undone in either direction. ' +
        'It stays out of the Book and the evidence packs, it sends no webhooks, and every page it produces says PRACTICE on it.</div>'
      : '') +
    apprBanner + banner +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">' + cards + '</div>' +
    '</div></div>', APP);
}

/* One sentence per role, drawn from the record's own language, so the first
   session answers "what is this and why should I care" before the steps do.
   Exported pure for the view-contract tests. */
export function roleWelcome(role) {
  if (role === 'viewer') return 'You see everything the team writes, the live document, versions, approvals, and health, and you can reply in every thread. Managers author; you keep them honest.';
  return 'Client relay, structured discovery, promoted inputs, approved baseline: one record that defends itself under review.';
}

function onboardBlock(APP) {
  const step = (n, t, d) => '<div style="border:1px solid var(--line);border-radius:11px;padding:13px"><div style="width:24px;height:24px;border-radius:7px;background:var(--ink);color:var(--bg);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:680;margin-bottom:9px">' + n + '</div><div style="font-size:13px;font-weight:600;margin-bottom:3px">' + esc(t) + '</div><div style="font-size:11.5px;color:var(--ink-3);line-height:1.5">' + esc(d) + '</div></div>';
  return '<div class="card rise" style="grid-column:1/-1;padding:26px 24px">' +
    '<div style="font-size:16px;font-weight:640;margin-bottom:6px">How ' + esc(APP.org || 'this workspace') + ' works</div>' +
    '<div style="font-size:12.5px;color:var(--ink-3);line-height:1.55;margin-bottom:14px;max-width:640px">' + esc(roleWelcome(APP.role)) + '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">' +
    step(1, 'Answer the worksheet', 'The guided intake covers users, scope, requirements, data, and AI evaluation. Everyone edits together, live.') +
    step(2, 'Generate a version', 'A numbered, immutable baseline with a change summary and an approval workflow.') +
    step(3, 'Collect input', 'Share review briefs and request links with SMEs. No account needed on their side. Client contacts get a portal.') +
    step(4, 'Hand off', 'Export to Word, PDF, or Markdown with approvals and revision history on the cover.') +
    '</div></div>';
}

/* ---------------- workspace (worksheet + doc) ---------------- */
/* The pursuit header: capture, share, sign. A pure view over facts already in
   state. It reports what exists, never what should happen next and never how
   far along anything is: a record that scores itself has started deciding, and
   this one only reports. */
export function pursuitHeaderHTML(APP) {
  const a = assembleAnswers(APP.fields, APP.rows);
  if (!isPursuit(a)) return '';
  const vers = APP.versions || [];
  const hasBaseline = vers.length > 0;
  const shares = APP.shares || [];
  const hasShare = shares.some((x) => x && !x.revoked);
  const signs = Object.values(APP.signs || {}).flat();
  const signed = signs.filter((x) => x && x.status === 'signed' && !x.revoked);
  // Each step is a statement, not a control: the buttons that capture, share,
  // and sign are the ordinary ones already on this page, and duplicating them
  // here would mean two paths to one action.
  const step = (label, on, fact) =>
    '<span class="pill" style="gap:6px' + (on ? '' : ';color:var(--ink-3)') + '">' +
    '<span style="font-weight:640">' + esc(label) + '</span>' +
    '<span style="font-size:10px">' + esc(fact) + '</span></span>';
  return '<span class="pill" style="border-color:var(--line);font-weight:660;letter-spacing:.06em;font-size:9.5px">PURSUIT</span>' +
    step('Capture', hasBaseline, hasBaseline ? vers.length + (vers.length === 1 ? ' baseline' : ' baselines') : 'no baseline yet') +
    step('Share', hasShare, hasShare ? 'shared' : 'not shared') +
    step('Sign', signed.length > 0, signed.length ? signed.length + ' signed' : 'no signature yet');
}

export function viewWorkspace(APP) {
  const a = assembleAnswers(APP.fields, APP.rows);
  const lens = APP.lens || 'spec';
  const vq = visQL(a, lens);
  const ac = vq.filter((q) => isAnswered(q, a[q.id])).length;
  const latest = APP.versions.length ? APP.versions[APP.versions.length - 1] : null;
  const canEdit = APP.role === 'manager';

  const header = '<div class="topbar">' +
    '<div style="display:flex;align-items:center;gap:12px;min-width:0">' +
    '<button class="icobtn" data-action="home" title="All projects">' + ico(IC.arrow) + '</button>' +
    '<div style="width:1px;height:24px;background:var(--line)"></div>' + brandmark(24) +
    '<div style="min-width:0"><div style="font-weight:600;letter-spacing:-.01em;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.ctrl_product || (APP.project && APP.project.name) || 'Untitled') + '</div>' +
    '<div class="eyebrow" style="font-size:9.5px;margin-top:1px">Requirements document</div></div>' +
    (APP.project && APP.project.practice ? '<span class="pill" style="color:var(--amber);border-color:var(--amber);font-weight:660" title="A rehearsal, never evidence">PRACTICE RECORD</span>' : '') +
    // v2.56: the pursuit header. Three steps, each stating a fact the record
    // already holds: a baseline exists, a share exists, a signature exists.
    // Nothing is scored, nothing is predicted, and every control it names is
    // the ordinary one that has always done that job.
    pursuitHeaderHTML(APP) +
    (latest ? '<span class="pill"><span class="mono">v' + esc(latest.label) + '</span></span><span class="stchip ' + esc(latest.status) + '">' + esc(STATUS_LABEL[latest.status]) + '</span>' : '') +
    (/^https?:\/\//i.test(a.link_demo || '') ? '<a class="pill" href="' + escA(a.link_demo) + '" target="_blank" rel="noopener" title="Open the working demo in a new tab">' + ico(IC.link, 'i-sm') + 'Demo</a>' : '') +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:10px">' + presenceBar(APP) + saveChip(APP) + userMenu(APP) + '</div></div>';

  const doc = renderDoc(APP, a, ac, vq.length);
  const body = !canEdit
    ? '<div class="split" style="grid-template-columns:1fr"><div class="pane-doc" id="docPane" style="display:flex">' + doc + '</div></div>'
    : '<div class="split"><div class="pane-intake" id="intakePane">' + renderWorksheet(APP, a, ac, vq.length) + '</div>' +
      '<div class="pane-doc' + (APP.docShow ? ' show' : '') + '" id="docPane">' + doc + '</div></div>' +
      '<button class="fab" data-action="toggledoc">' + ico(APP.docShow ? IC.edit : IC.doc) + '</button>';

  return shell(header + body, APP) + (APP.present ? presentOverlay(APP, a) : '');
}

/* ---- worksheet (left pane) ---- */
function renderWorksheet(APP, a, ac, total) {
  const lens = APP.lens || 'spec';
  // v2.56: the pursuit trim is one more clause on the existing filter, so a
  // non-pursuit project renders byte-identically to before.
  const secs = SECTIONS.filter((s) => lensHasSec(lens, s.key) && qBySec(s.key).length && (!s.cond || s.cond(a))
    && (!isPursuit(a) || pursuitSection(s.key)));
  const editingBy = {};
  (APP.presence || []).forEach((p) => { if (p.f && !String(p.f).startsWith('row:')) (editingBy[p.f] = editingBy[p.f] || []).push(p.n); });

  const body = secs.map((s) => {
    const qs = qBySec(s.key).filter((q) => !q.cond || q.cond(a));
    const done = qs.filter((q) => isAnswered(q, a[q.id])).length;
    const open = APP.openSecs[s.key] !== false;
    const head = '<button data-action="secto" data-val="' + s.key + '" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:14px 2px">' +
      '<span class="dot ' + (done === qs.length ? 'done' : done ? 'some' : '') + '"></span>' +
      '<span style="flex:1;font-size:14px;font-weight:600;letter-spacing:-.01em">' + (docSecNum(a, s.key) != null ? '<span class="mono" style="font-size:11px;color:var(--ink-4);margin-right:7px">' + docSecNum(a, s.key) + '</span>' : '') + esc(docSecTitle(a, s.key)) + '</span>' +
      '<span style="font-size:11px;color:var(--ink-4)" class="mono">' + done + '/' + qs.length + '</span>' +
      '<span style="color:var(--ink-4);display:inline-flex;transition:transform .15s;' + (open ? 'transform:rotate(90deg)' : '') + '">' + ico(IC.fwd, 'i-sm') + '</span></button>';
    const items = open ? qs.map((q) => fieldHTML(APP, q, a, editingBy)).join('') : '';
    return '<div style="border-bottom:1px solid var(--line)" id="sec-' + s.key + '">' + head + (open ? '<div style="padding:2px 2px 22px;display:flex;flex-direction:column;gap:18px">' + items + '</div>' : '') + '</div>';
  }).join('');

  const tagBar = APP.phaseTag
    ? '<div class="card" style="display:flex;align-items:center;gap:10px;padding:11px 16px;margin-bottom:10px;border-color:var(--brand)">' +
      '<span style="font-size:12.5px;flex:1">Leaving <strong>' + esc(APP.phaseTag.from) + '</strong>: tag its ' + APP.phaseTag.n + ' done, untagged key result' + (APP.phaseTag.n === 1 ? '' : 's') + ' to that phase so they stay under its tab on every future update.</span>' +
      '<button class="btn btn-primary btn-sm" data-action="tagdone">Tag them</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="tagdismiss">Leave untagged</button></div>'
    : '';
  const lensBar = tagBar + '<div style="display:flex;gap:6px;margin-bottom:10px">' +
    [['spec', 'Specification'], ['delivery', 'Delivery board']].map(([k, l]) =>
      '<button' + (k === 'spec' ? ' data-help-anchor="ws.lens"' : '') + ' class="chip' + (lens === k ? ' on' : '') + '" data-action="lens" data-val="' + k + '" title="' +
      (k === 'delivery' ? 'Phase, Objectives and Key Results, and Risks and Issues. Everything that feeds the weekly update' : 'The full requirements record') + '">' + l + '</button>').join('') +
    '<span style="flex:1"></span></div>';
  return '<div style="padding:22px 26px 60px">' + lensBar +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">' +
    '<div style="flex:1"><div class="ptrack"><div class="pfill" style="width:' + Math.round(ac / Math.max(total, 1) * 100) + '%"></div></div></div>' +
    '<span class="mono" style="font-size:11px;color:var(--ink-4)">' + ac + '/' + total + '</span>' +
    genButton(APP) + '</div>' + body + '</div>';
}

function genButton(APP) {
  if (APP.role !== 'manager') return '';
  return '<button class="btn btn-primary btn-sm" data-help-anchor="ws.generate" data-action="genopen" title="Lock the worksheet into a numbered baseline">' + ico(IC.layers, 'i-sm') + 'Generate version</button>';
}

function editingChip(names) {
  if (!names || !names.length) return '';
  const label = names.length === 1 ? names[0] + ' is editing' : names.length + ' people are editing';
  return '<span class="editing-chip">' + esc(label) + '</span>';
}

export function fieldHTML(APP, q, a, editingBy) {
  const v = a[q.id];
  const conflict = APP.conflicts[q.id];
  const head = '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:7px">' +
    '<span style="font-size:13.5px;font-weight:600;letter-spacing:-.005em">' + esc(q.prompt) + (q.req ? ' <span style="color:var(--brand)">*</span>' : '') + '</span>' +
    (q.feed === 'update' ? '<span class="pill" style="height:18px;font-size:9.5px;padding:0 8px" title="This answer renders on the weekly update link exactly as written">Feeds the weekly update</span>' : '') +
    editingChip(editingBy && editingBy[q.id]) + '</div>' +
    (q.help ? '<div style="font-size:12px;color:var(--ink-4);line-height:1.5;margin:-3px 0 8px">' + esc(q.help) + '</div>' : '');
  const conflictNote = conflict ? '<div class="conflict-note">' + esc((conflict.by || 'A teammate') + ' edited this at the same time. Your text was kept. Check theirs in the document pane.') + '</div>' : '';

  let control = '';
  if (q.type === 'short') {
    control = '<input class="input" data-field="' + escA(q.id) + '" value="' + escA(v || '') + '" placeholder="' + escA(q.ph || '') + '">';
  } else if (q.type === 'long') {
    control = '<textarea class="input gta" data-field="' + escA(q.id) + '" rows="2" placeholder="' + escA(q.ph || '') + '">' + esc(v || '') + '</textarea>';
  } else if (q.type === 'choice') {
    control = '<div class="choice">' + (q.options || []).map((o) =>
      '<button class="chip' + (v === o ? ' on' : '') + '" data-action="choice" data-qid="' + escA(q.id) + '" data-val="' + escA(o) + '"' + (APP.role !== 'manager' ? ' disabled' : '') + '>' + esc(o) + '</button>').join('') + '</div>';
  } else if (q.type === 'list') {
    const rows = (APP.rows[q.id] || []);
    control = rows.map((r) =>
      '<div style="display:flex;gap:7px;margin-bottom:7px">' +
      '<input class="input" data-rowfield="' + escA(q.id) + '" data-rowid="' + escA(r.id) + '" data-colkey="text" value="' + escA((r.data && r.data.text) || '') + '" placeholder="' + escA(q.ph || '') + '">' +
      '<button class="icobtn" data-action="delrow" data-qid="' + escA(q.id) + '" data-rowid="' + escA(r.id) + '" title="Remove">' + ico(IC.close, 'i-sm') + '</button></div>').join('') +
      '<button class="btn btn-ghost btn-sm" data-action="addrow" data-qid="' + escA(q.id) + '">' + ico(IC.plus, 'i-sm') + esc(q.add || 'Add') + '</button>';
  } else if (q.type === 'rows') {
    const rows = (APP.rows[q.id] || []);
    const comps = (APP.rows.components || []).map((r) => (r.data && r.data.name) || '').filter(Boolean);
    control = rows.map((r) => {
      const cells = (q.cols || []).map((c) => {
        const val = (r.data && r.data[c.k]) || '';
        if (c.sel) {
          // A column may declare its blank-state default (c.def); the empty
          // option then says so, because the stored blank and the stored
          // default are the same fact everywhere the value renders.
          return '<div><div style="font-size:10.5px;color:var(--ink-4);font-weight:560;margin-bottom:3px">' + esc(c.l) + '</div>' +
            '<select class="input" data-rowfield="' + escA(q.id) + '" data-rowid="' + escA(r.id) + '" data-colkey="' + escA(c.k) + '" style="height:36px;padding:0 8px">' +
            '<option value="">' + (c.blank ? esc(c.blank) : c.def ? esc(c.def) + ' (default)' : '') + '</option>' + c.sel.map((o) => '<option' + (val === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></div>';
        }
        if (c.dyn === 'components') {
          return '<div><div style="font-size:10.5px;color:var(--ink-4);font-weight:560;margin-bottom:3px">' + esc(c.l) + '</div>' +
            '<select class="input" data-rowfield="' + escA(q.id) + '" data-rowid="' + escA(r.id) + '" data-colkey="' + escA(c.k) + '" style="height:36px;padding:0 8px">' +
            '<option value="">Unassigned</option>' + comps.map((o) => '<option' + (val === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></div>';
        }
        const wide = c.k === 'stmt' || c.k === 'fit' || c.k === 'desc' || c.k === 'obj' || c.k === 'needs' || c.k === 'req' || c.k === 'metric';
        return '<div' + (wide ? ' style="grid-column:1/-1"' : '') + '><div style="font-size:10.5px;color:var(--ink-4);font-weight:560;margin-bottom:3px">' + esc(c.l) + '</div>' +
          '<textarea class="input gta" rows="1" data-rowfield="' + escA(q.id) + '" data-rowid="' + escA(r.id) + '" data-colkey="' + escA(c.k) + '" placeholder="' + escA(c.ph || '') + '">' + esc(val) + '</textarea></div>';
      }).join('');
      const idtag = (q.id === 'fr' || q.id === 'nfr' || q.id === 'eval' || q.id === 'interfaces')
        ? '<span class="mono" style="font-size:10.5px;color:var(--brand);font-weight:620">' + esc((q.id === 'fr' ? 'FR' : q.id === 'nfr' ? 'NFR' : q.id === 'eval' ? 'EVAL' : 'IR') + '-' + String(r.k).padStart(3, '0')) + '</span>'
        // The Update Log's permanent phase-prefixed ID, stamped at creation
        // from the phase then current and never recomputed: deleting a row
        // cannot renumber the others and a number is never reused.
        : (q.id === 'updates' && r.data && r.data._uid)
        ? '<span class="mono" style="font-size:10.5px;color:var(--brand);font-weight:620">' + esc(r.data._uid) + '</span>' : '';
      const fitBtn = ((q.id === 'fr' || q.id === 'nfr') && !(r.data && r.data.fit))
        ? '<button class="btn btn-ghost btn-sm" data-action="suggestfit" data-qid="' + escA(q.id) + '" data-rowid="' + escA(r.id) + '" style="font-size:11.5px">' + ico(IC.spark, 'i-sm') + 'Draft fit criterion</button>' : '';
      return '<div class="row-card" style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' + (idtag || '<span></span>') +
        '<div style="display:flex;gap:4px;align-items:center">' + fitBtn +
        '<button class="icobtn" data-action="delrow" data-qid="' + escA(q.id) + '" data-rowid="' + escA(r.id) + '" title="Remove">' + ico(IC.close, 'i-sm') + '</button></div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">' + cells + '</div></div>';
    }).join('') +
      (q.retired ? '' : (q.id === 'updates' ? '<span style="display:inline-flex;align-items:center;gap:6px;margin-right:8px"><span style="font-size:11px;color:var(--ink-3)">for phase</span>' +
        '<select class="input" id="updates-addphase" style="height:28px;font-size:11.5px;width:auto;padding:0 8px">' +
        PHASES.map((ph) => '<option' + (ph === currentPhase(a) ? ' selected' : '') + '>' + ph + '</option>').join('') + '</select></span>' : '') +
      '<button class="btn btn-ghost btn-sm" data-action="addrow" data-qid="' + escA(q.id) + '">' + ico(IC.plus, 'i-sm') + esc(q.add || 'Add row') + '</button>') +
      '<button class="btn btn-ghost btn-sm" data-action="pasteopen" data-qid="' + escA(q.id) + '" title="Paste a list or a table copied from Word or Excel. Deterministic parsing, preview before anything is added.">' + ico(IC.doc, 'i-sm') + 'Paste rows</button>';
  }
  const ro = (APP.role !== 'manager' && (q.type === 'short' || q.type === 'long'))
    ? control.replace('<input ', '<input readonly ').replace('<textarea ', '<textarea readonly ') : control;
  return '<div class="card qcard" style="padding:20px" data-q="' + escA(q.id) + '"' + (q.id === 'ctrl_phase' ? ' data-help-anchor="ws.phase"' : '') + '>' + head + ro + conflictNote + '</div>';
}

/* ---- document (right pane) ---- */
export function currentDocMd(APP, a) {
  if (APP.viewSeq != null) {
    const snap = APP.snapshots[APP.viewSeq];
    if (snap) {
      const secs = snap.snapshot.sections || {};
      const parts = Object.keys(secs).length ? secs
        : buildSections(snap.snapshot.answers || {}, snap.label, APP.versions.filter((v) => v.seq <= snap.seq));
      return { md: assemble(parts, snap.snapshot.answers || {}), label: snap.label, status: snap.status };
    }
    return { md: '', label: '', status: 'draft', loading: true };
  }
  const label = APP.versions.length ? APP.versions[APP.versions.length - 1].label : null;
  const sections = buildSections(a, label ? label + ' (working)' : null, APP.versions);
  return { md: assemble(sections, a), label: label, status: 'draft', working: true };
}

/* The document tab body, exported so main.js can live-patch the pane while
   someone types in the worksheet without re-rendering (and unfocusing) it. */
/* ---------------- intake: populate a blank record from documents ----------
   Manager-only, working-draft-only. The entry appears while the record has
   no meaningful content; the card previews a deterministic mapping (see
   app/js/intake.js) before a single write happens, and hands control back
   the moment it lands. Intake never overwrites a non-empty field. */
const INTAKE_QLABEL = {}; Q.forEach((q) => { INTAKE_QLABEL[q.id] = q.prompt; });
const INTAKE_LONGS = Q.filter((q) => q.type === 'long').map((q) => [q.id, q.prompt]);

export function intakeMeaningful(APP) {
  const skip = (id) => id.startsWith('ctrl_') || id.startsWith('link_');
  const f = APP.fields || {};
  if (Object.keys(f).some((id) => !skip(id) && String((f[id] && f[id].value) || '').trim())) return true;
  const r = APP.rows || {};
  return Object.keys(r).some((id) => id !== 'ctrl_approvers' && (r[id] || []).length > 0);
}

export function intakeZone(APP) {
  if (APP.role !== 'manager' || APP.viewSeq != null) return '';
  const it = APP.intake;
  if (!it || !it.open) {
    if (intakeMeaningful(APP)) return '';
    return '<div class="page" style="padding-bottom:0"><div class="card" style="padding:16px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:220px"><div style="font-weight:620;font-size:14px">Starting from documents?</div>' +
      '<div style="font-size:12.5px;color:var(--ink-3);line-height:1.55;margin-top:2px">Paste or upload drafts and ReqPub places them into this framework, the right question, the right shape, source stamped, then hands the editor back to you.</div></div>' +
      '<button class="btn btn-primary btn-sm" data-action="intakeopen">' + ico(IC.plus, 'i-sm') + 'Populate from documents</button></div></div>';
  }
  const files = (it.files || []).map((f, i) =>
    '<span class="pill" style="display:inline-flex;align-items:center;gap:6px;margin:0 6px 6px 0"><span class="mono" style="font-size:11px">' + esc(f.name) + '</span>' +
    '<span style="color:var(--ink-4);font-size:10px">' + Math.max(1, Math.round((f.text || '').length / 1000)) + 'k chars</span>' +
    '<button class="icobtn" data-action="intakefiledel" data-i="' + i + '" style="width:18px;height:18px" title="Remove">' + ico(IC.close, 'i-sm') + '</button></span>').join('');
  let planHtml = '';
  if (it.plan) {
    const rows = it.plan.placements.map((p, i) => {
      const count = p.kind === 'long' ? (p.value.length + ' chars') : (p.rows.length + (p.kind === 'list' ? ' items' : ' rows'));
      const peek = p.kind === 'long' ? p.value : (p.rows[0] ? Object.values(p.rows[0]).filter(Boolean).join(' · ') : '');
      return '<label style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line);cursor:pointer">' +
        '<input type="checkbox" data-intaketog="' + i + '"' + (it.include[i] ? ' checked' : '') + ' style="margin-top:3px">' +
        '<span style="flex:1;min-width:0"><strong style="font-size:13px">' + esc(INTAKE_QLABEL[p.qid] || p.qid) + '</strong>' +
        '<span class="pill" style="margin-left:8px;font-size:10px;height:18px">' + esc(count) + '</span>' +
        '<span style="display:block;font-size:11.5px;color:var(--ink-4);margin-top:2px">' + esc(String(peek).slice(0, 110)) + (String(peek).length > 110 ? '\u2026' : '') +
        ' <span style="color:var(--ink-4)">· from ' + esc(p.sources.join(', ')) + '</span></span></span></label>';
    }).join('');
    const un = it.plan.unplaced.map((u, i) =>
      '<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)">' +
      '<span style="flex:1;min-width:0"><strong style="font-size:13px">' + esc(u.title) + '</strong>' +
      '<span style="display:block;font-size:11.5px;color:var(--ink-4);margin-top:2px">' + esc(u.body.slice(0, 110)) + (u.body.length > 110 ? '\u2026' : '') + ' <span>· from ' + esc(u.source) + '</span></span></span>' +
      '<select class="input" data-intaketgt="' + i + '" style="height:30px;font-size:12px;width:auto;max-width:220px">' +
      '<option value="">Skip</option>' + INTAKE_LONGS.map(([id, l]) => '<option value="' + escA(id) + '"' + (it.targets[i] === id ? ' selected' : '') + '>Append to ' + esc(l) + '</option>').join('') +
      '</select></div>').join('');
    planHtml =
      '<div style="margin-top:14px"><div class="eyebrow" style="font-size:9.5px;margin-bottom:2px">Mapped. Untick anything that should not land</div>' + (rows || '<div style="font-size:12.5px;color:var(--ink-3);padding:8px 0">No recognized sections yet.</div>') + '</div>' +
      (un ? '<div style="margin-top:14px"><div class="eyebrow" style="font-size:9.5px;margin-bottom:2px">Not recognized. Choose a home or skip</div>' + un + '</div>' : '') +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:14px">' +
      '<button class="btn btn-primary" data-action="intakeapply"' + (it.busy ? ' disabled' : '') + '>' + (it.busy ? 'Applying\u2026 ' + (it.done || 0) + '/' + (it.total || 0) : 'Apply to the record') + '</button>' +
      '<span style="font-size:11.5px;color:var(--ink-4)">Writes go through the same rev-checked path as typing. Filled answers are kept, never overwritten.</span></div>';
  }
  return '<div class="page" style="padding-bottom:0"><div class="card" style="padding:18px 20px">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="font-weight:640;font-size:15px;flex:1">Populate from documents</div>' +
    '<button class="icobtn" data-action="intakeclose" title="Close">' + ico(IC.close) + '</button></div>' +
    '<div style="font-size:12.5px;color:var(--ink-3);line-height:1.6;margin-bottom:12px">Paste text or add files. Preview shows exactly where each section lands before anything is written. Text and Markdown are read exactly; Word and PDF are read with their tables intact, so requirements tables land as rows with their IDs, fit criteria, and priorities; imported requirements carry their source.</div>' +
    '<textarea class="input" id="intakeText" rows="5" placeholder="Paste a draft here (Markdown headings map best)" style="width:100%;font-size:13px;line-height:1.5">' + esc(it.text || '') + '</textarea>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">' +
    '<label class="btn btn-sec btn-sm" style="cursor:pointer">' + ico(IC.plus, 'i-sm') + 'Add files<input type="file" id="intakeFiles" multiple accept=".txt,.md,.markdown,.docx,.pdf" style="display:none"></label>' +
    // The next step must be unmissable: the moment files or pasted text
    // exist and no plan does, the preview button is the primary action.
    ((((it.files || []).length || (it.text || '').trim()) && !it.plan)
      ? '<button class="btn btn-primary btn-sm" data-action="intakepreview">Preview mapping before applying</button>'
      : '<button class="btn btn-sec btn-sm" data-action="intakepreview">Preview mapping</button>') +
    '<span style="font-size:11px;color:var(--ink-4)">txt · md · docx · pdf</span></div>' +
    (files ? '<div style="margin-top:10px">' + files + '</div>' : '') +
    planHtml + '</div></div>';
}

export function documentTabHTML(APP, a) {
  const d = currentDocMd(APP, a);
  if (d.loading) return '<div class="empty"><div style="font-size:13px">Loading version…</div></div>';
  return intakeZone(APP) + (d.md
    ? lastChangeBanner(APP) + '<div class="page"><div class="doc-anim">' + mdToHtml(d.md) + '</div></div>' + walkthroughAppendixHTML(APP)
    : '<div class="empty">' + ico(IC.doc) + '<div style="font-size:14.5px;color:var(--ink-2);font-weight:560;margin-bottom:4px">The requirements document builds here as you answer</div><div style="font-size:13px;max-width:240px">Start with Overview on the left.</div></div>');
}

/* Full-screen presentation of the rendered document only. */
export function presentOverlay(APP, a) {
  const d = currentDocMd(APP, a);
  const label = d.label ? 'v' + d.label + (d.working ? ' · working draft' : '') : 'Working draft';
  return '<div class="present-back" role="dialog" aria-modal="true" aria-label="Presentation mode">' +
    '<div class="present-bar"><div style="display:flex;align-items:center;gap:10px;min-width:0">' + brandmark(24) +
    '<span style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.ctrl_product || (APP.project && APP.project.name) || 'Untitled') + '</span>' +
    '<span class="pill"><span class="mono">' + esc(label) + '</span></span></div>' +
    '<div style="display:flex;gap:6px;align-items:center">' +
    '<button class="btn btn-sec btn-sm" data-action="copypresent" title="Copy a read-only link to exactly this view">' + ico(IC.link, 'i-sm') + 'Copy read-only link</button>' +
    '<button class="icobtn" data-action="print" title="Save as PDF">' + ico(IC.print) + '</button>' +
    '<button class="icobtn" data-action="presentclose" title="Exit presentation (Esc)">' + ico(IC.close) + '</button></div></div>' +
    '<div class="present-scroll" id="presentScroll"><div class="page">' + (d.md ? mdToHtml(d.md) : '<div class="empty"><div style="font-size:13px">Nothing to present yet.</div></div>') + '</div>' + walkthroughAppendixHTML(APP) + '</div></div>';
}

function renderDoc(APP, a, ac, total) {
  // Four primary sections + a segmented sub-nav, replacing 11 flat tabs. The
  // underlying content still keys off APP.docTab, so every view is preserved -
  // just regrouped by job. Activity moves to a toolbar icon (see docActions).
  const NAV = [
    { key: 'document', label: 'Document', subs: [['document', 'Read'], ['walkthrough', 'Walkthrough'], ['summary', 'Summary'], ['changes', 'Changes'], ['versions', 'Versions'], ['health', 'Health'], ['updates', 'Updates']] },
    { key: 'inbox', label: 'Inbox', subs: [['inbox', 'Messages'], ['feedback', 'App'], ['notes', 'Notes']] },
    { key: 'discovery', label: 'Discovery', subs: [['discovery', 'Discovery']] },
    { key: 'share', label: 'Share', subs: [['access', 'Access'], ['people', 'People']] }
  ];
  const newRep = newReplyCount(APP);   // team-level: unseen external replies on this project
  // Ambient readiness: the same deterministic signals the Health tab shows,
  // as a count on every tab. Red when a hard gap exists, amber for warnings,
  // absent at zero. One click lands on Health.
  const sigs = healthSignals(a, { versions: APP.versions, approvalsByVersion: APP.approvals, shares: APP.shares, comms: APP.comms, discovery: APP.discovery });
  const hasGap = sigs.some((s) => s.level === 'gap');
  const gapsPill = sigs.length && APP.docTab !== 'health'
    ? '<button class="btn btn-sm" data-action="tab" data-val="health" title="Readiness signals. Deterministic, computed from the record, cleared the moment the record is fixed" style="color:' + (hasGap ? 'var(--bad)' : 'var(--amber)') + ';font-weight:620">' + healthPillLabel(sigs) + '</button>'
    : '';
  const activeSection = (NAV.find((g) => g.subs.some((s) => s[0] === APP.docTab)) || {}).key;
  const tabBtns = NAV.map((g) => {
    const on = g.key === activeSection;
    const badge = (g.key === 'inbox' && newRep)
      ? ' <span style="background:var(--brand);color:#fff;border-radius:999px;padding:0 5px;font-size:10px;font-weight:700;vertical-align:1px" title="New replies from client contacts or SMEs">' + newRep + '</span>' : '';
    return '<button class="btn btn-sm" data-action="tab" data-val="' + g.subs[0][0] + '" style="' +
      (on ? 'background:var(--ink);color:var(--bg)' : 'color:var(--ink-3)') + '">' + g.label + badge + '</button>';
  }).join('');
  const grp = NAV.find((g) => g.key === activeSection);
  const subNav = (grp && grp.subs.length > 1)
    ? '<div style="flex-basis:100%;display:flex;padding-top:9px"><div style="display:inline-flex;gap:2px;background:var(--bg-2);border:1px solid var(--line);border-radius:9px;padding:3px">' +
      grp.subs.map(([k, lbl]) => '<button' + (k === 'updates' ? ' data-help-anchor="doc.updates"' : '') + ' class="btn btn-sm" data-action="tab" data-val="' + k + '" style="height:28px;padding:0 12px;font-size:12px;border-radius:6px;' +
        (APP.docTab === k ? 'background:var(--bg);color:var(--ink);box-shadow:var(--shadow-sm)' : 'color:var(--ink-3)') + '">' + esc(lbl) + '</button>').join('') +
      '</div></div>'
    : '';

  const gateOfView = APP.viewSeq != null && APP.snapshots[APP.viewSeq] && APP.snapshots[APP.viewSeq].snapshot.gate;
  const gatePill = gateOfView ? '<span class="pill pill-solid" title="This baseline is a named stage gate" style="align-self:center">' + esc(gateOfView) + '</span>' : '';
  const verOptions = '<option value="">Working draft</option>' + APP.versions.slice().reverse().map((v) =>
    '<option value="' + v.seq + '"' + (APP.viewSeq === v.seq ? ' selected' : '') + '>v' + esc(v.label) + '</option>').join('');
  const docActions =
    (APP.role === 'manager' ? '<button class="icobtn" data-help-anchor="doc.share" data-action="shareopen" title="Share this project…">' + ico(IC.send) + '</button>' : '') +
    '<button class="icobtn" data-action="tab" data-val="activity" title="Activity. The append-only audit trail"' + (APP.docTab === 'activity' ? ' style="background:var(--ink);color:var(--bg)"' : '') + '>' + ico(IC.hist) + '</button>' +
    '<button class="icobtn" data-action="present" title="Presentation mode. Show only the document">' + ico(IC.expand) + '</button>' +
    ((APP.docTab === 'document' || APP.docTab === 'summary' || APP.docTab === 'changes')
      ? (APP.versions.length ? '<select class="input" data-action="versionsel" style="height:34px;padding:0 8px;width:auto;font-family:var(--mono);font-size:12px">' + verOptions + '</select>' + gatePill : '') +
        '<button class="icobtn" data-action="copymd" title="Copy Markdown">' + ico(IC.copy) + '</button>' +
        '<button class="icobtn" data-action="word" title="Download for Word (.doc)">' + ico(IC.word) + '</button>' +
        '<button class="icobtn" data-action="print" title="Save as PDF (print)">' + ico(IC.print) + '</button>' +
        '<button class="icobtn" data-action="downloadmd" title="Download Markdown (.md)">' + ico(IC.dl) + '</button>'
      : '');

  let content;
  if (APP.docTab === 'document') {
    content = documentTabHTML(APP, a);
  } else if (APP.docTab === 'summary') {
    const d = currentDocMd(APP, a);
    const ans = APP.viewSeq != null && APP.snapshots[APP.viewSeq] ? (APP.snapshots[APP.viewSeq].snapshot.answers || {}) : a;
    content = '<div class="page">' + execSummaryHTML(ans, { label: d.label }) +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
      '<button class="btn btn-sec btn-sm" data-action="execdl">' + ico(IC.dl, 'i-sm') + 'Download summary (.md)</button>' +
      '<button class="btn btn-sec btn-sm" data-action="clientprint" title="Executive summary + the client-safe brief content + revision record, behind a fingerprinted cover">' + ico(IC.shield, 'i-sm') + 'Client baseline report (PDF)</button>' +
      '<button class="btn btn-sec btn-sm" data-action="sowexhibit" title="The acceptance baseline formatted to attach to a statement of work: acceptance table, requirements with fit criteria, recorded sign-offs, the fingerprint and its recipe. Bracketed fields are for counsel.">' + ico(IC.shield, 'i-sm') + 'SOW exhibit (PDF)</button>' +
      '<button class="btn btn-sec btn-sm" data-action="implpkg" title="For the build team: requirements.json + acceptance checklist + per-column changes + full PRD, sealed to the same fingerprint as the client report">' + ico(IC.download, 'i-sm') + 'Implementation package (ZIP)</button>' +
      '<button class="btn btn-sec btn-sm" data-action="verbundle" title="The stored snapshot with its fingerprint in one JSON file. Anyone can recompute the SHA-256 with the verify page, the offline CLI, or from docs/VERIFY.md alone. No ReqPub required.">' + ico(IC.shield, 'i-sm') + 'Verification bundle (JSON)</button>' +
      '<button class="btn btn-sec btn-sm" data-action="gatepacket" title="The steering-committee artifact: gate name, criteria state at baseline, per-column changes since the prior baseline, approvals, fingerprint">' + ico(IC.check, 'i-sm') + 'Gate packet (PDF)</button></div></div>';
  } else if (APP.docTab === 'walkthrough') {
    content = walkthroughTabHTML(APP);
  } else if (APP.docTab === 'changes') {
    content = renderChanges(APP, a);
  } else {
    content = renderTab(APP, a);
  }
  return '<div class="doc-tools"><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">' + tabBtns + gapsPill + '</div>' +
    '<div style="display:flex;align-items:center;gap:6px">' + docActions + '</div>' + subNav + '</div>' +
    '<div class="doc-scroll" id="docScroll">' + content + '</div>';
}

/* The demo walkthrough: ordered screenshots, each with a caption bubble that
   states the action on screen. Working view is curated live by any teammate;
   a selected version renders the frozen set from its snapshot. */
/* The document appendix: the same shots, rendered inline under the PRD so the
   walkthrough reads as part of the record. Working draft shows the live set;
   a selected version shows its sealed set. */
export function docShotsOf(APP) {
  if (APP.viewSeq != null) {
    const snap = APP.snapshots[APP.viewSeq];
    return (snap && snap.snapshot && snap.snapshot.walkthrough) || [];
  }
  return (APP.walkthrough || []).map((s, i) => ({
    n: i + 1, caption: s.caption || '',
    file_name: (s.attachment && s.attachment.file_name) || '',
    attachment_id: s.attachment_id
  }));
}

export function walkthroughAppendixHTML(APP) {
  const shots = docShotsOf(APP);
  if (!shots.length) return '';
  const figs = shots.map((f, i) => {
    const url = APP.wtUrls && APP.wtUrls[f.attachment_id];
    const img = url
      ? '<img src="' + escA(url) + '" alt="' + escA(f.caption || f.file_name || ('Shot ' + (i + 1))) + '" loading="lazy" style="display:block;width:100%;border:1px solid var(--line);border-radius:10px">'
      : '<div style="display:flex;align-items:center;justify-content:center;height:110px;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;color:var(--ink-4);font-size:12px">' + esc(f.file_name || 'Image unavailable') + '</div>';
    const cap = f.caption
      ? '<div style="font-size:12.5px;line-height:1.55;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:8px 11px;margin-top:7px"><span class="mono" style="font-size:10.5px;color:var(--ink-4);margin-right:7px">' + (i + 1) + '</span>' + esc(f.caption) + '</div>'
      : '<div style="font-size:11px;color:var(--ink-4);margin-top:6px"><span class="mono">' + (i + 1) + '</span> · ' + esc(f.file_name) + '</div>';
    return '<figure style="margin:0 0 18px">' + img + cap + '</figure>';
  }).join('');
  return '<div class="page" style="padding-top:6px"><div class="doc-anim">' +
    '<div class="eyebrow" style="font-size:9.5px;margin-bottom:4px">Appendix</div>' +
    '<h2 style="font-size:19px;letter-spacing:-.02em;font-weight:640;margin:0 0 4px">Demo Walkthrough</h2>' +
    '<div style="font-size:12px;color:var(--ink-4);margin-bottom:14px">Each screenshot shows one action, in the order the build team should read them.' +
    (APP.viewSeq != null ? ' Sealed with this version.' : '') + '</div>' + figs + '</div></div>';
}

export function walkthroughTabHTML(APP) {
  const frozen = APP.viewSeq != null;
  const snap = frozen && APP.snapshots[APP.viewSeq] ? APP.snapshots[APP.viewSeq].snapshot : null;
  if (frozen && !snap) return '<div class="empty"><div style="font-size:13px">Loading version…</div></div>';
  const live = APP.walkthrough || [];
  const liveById = {};
  live.forEach((s2) => { liveById[s2.attachment_id] = s2; });
  // A frozen shot renders as long as the FILE exists, even if the shot was
  // later detached from the working walkthrough: resolve through the live
  // shot first, then the project's attachments list.
  const attById = {};
  (APP.attachments || []).forEach((a2) => { attById[a2.id] = a2; });
  const shots = frozen
    ? (snap.walkthrough || []).map((f) => ({ id: null, attachment_id: f.attachment_id, caption: f.caption || '', file_name: f.file_name || '', att: (liveById[f.attachment_id] || {}).attachment || attById[f.attachment_id] || null }))
    : live.map((s2) => ({ id: s2.id, attachment_id: s2.attachment_id, caption: s2.caption || '', file_name: (s2.attachment && s2.attachment.file_name) || '', att: s2.attachment || null }));
  const canEdit = !frozen && !!APP.user;
  const intro = frozen
    ? 'The walkthrough exactly as it stood when this version was generated. Captions and order are sealed under the version fingerprint.'
    : 'Screenshots in the order the build team should read them, each with the action it shows. Uploads are virus-scanned like every attachment and land on the Files list too. The next generated version seals this set.';
  const addTile = canEdit
    ? '<label class="btn btn-sec btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">' + ico(IC.clip, 'i-sm') + 'Add screenshot' +
      '<input type="file" data-attach="1" data-wt="1" data-project="' + escA(APP.pid || '') + '" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none"></label>'
    : '';
  const cards = shots.map((sh, i) => {
    const url = sh.att && APP.wtUrls && APP.wtUrls[sh.attachment_id];
    const img = url
      ? '<img src="' + escA(url) + '" alt="' + escA(sh.caption || sh.file_name || ('Shot ' + (i + 1))) + '" style="display:block;width:100%;border-radius:10px 10px 0 0;border-bottom:1px solid var(--line)">'
      : '<div style="display:flex;align-items:center;justify-content:center;height:120px;background:var(--bg-2);border-radius:10px 10px 0 0;border-bottom:1px solid var(--line);color:var(--ink-4);font-size:12px">' + (sh.att ? 'Loading image…' : 'File no longer available · ' + esc(sh.file_name || 'removed')) + '</div>';
    const bubble = canEdit
      ? '<textarea class="input" data-action="wtcap" data-id="' + escA(sh.id) + '" placeholder="What action does this shot show?" maxlength="500" style="min-height:52px;font-size:12.5px;line-height:1.5;resize:vertical">' + esc(sh.caption) + '</textarea>'
      : (sh.caption ? '<div style="font-size:12.5px;line-height:1.55;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:9px 11px">' + esc(sh.caption) + '</div>'
                    : '<div style="font-size:12px;color:var(--ink-4)">No caption.</div>');
    const tools = canEdit
      ? '<div style="display:flex;gap:4px">' +
        '<button class="icobtn" data-action="wtup" data-id="' + escA(sh.id) + '" title="Move earlier"' + (i === 0 ? ' disabled' : '') + ' style="transform:rotate(-90deg)">' + ico(IC.fwd, 'i-sm') + '</button>' +
        '<button class="icobtn" data-action="wtdown" data-id="' + escA(sh.id) + '" title="Move later"' + (i === shots.length - 1 ? ' disabled' : '') + ' style="transform:rotate(90deg)">' + ico(IC.fwd, 'i-sm') + '</button>' +
        '<button class="icobtn" data-action="wtdel" data-id="' + escA(sh.id) + '" title="Remove from the walkthrough (the file stays on Files)">' + ico(IC.close, 'i-sm') + '</button></div>'
      : '';
    return '<div style="border:1px solid var(--line);border-radius:11px;background:var(--bg)">' + img +
      '<div style="padding:10px 12px 12px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">' +
      '<span class="pill pill-solid"><span class="mono">' + (i + 1) + '</span></span>' +
      '<span style="flex:1;font-size:11.5px;color:var(--ink-4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(sh.file_name) + '</span>' + tools + '</div>' +
      bubble + '</div></div>';
  }).join('');
  const empty = frozen
    ? '<div class="empty">' + ico(IC.doc) + '<div style="font-size:13px">This version was generated without a walkthrough.</div></div>'
    : '<div class="empty">' + ico(IC.doc) + '<div style="font-size:14.5px;color:var(--ink-2);font-weight:560;margin-bottom:4px">Show the build team the product, one action at a time</div><div style="font-size:13px;max-width:280px">Add screenshots in order. Each gets a caption bubble that states the action on screen.</div></div>';
  return '<div class="page" style="max-width:640px">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">' +
    '<div><h2 style="font-size:20px;letter-spacing:-.02em;font-weight:620;margin:0">Demo walkthrough</h2>' +
    '<div style="font-size:11.5px;color:var(--ink-4);margin-top:2px;max-width:430px">' + intro + '</div></div>' + addTile + '</div>' +
    (shots.length ? '<div style="display:flex;flex-direction:column;gap:14px;margin-top:12px">' + cards + '</div>' : empty) + '</div>';
}

function lastChangeBanner(APP) {
  if (!APP.versions.length) return '';
  const shownSeq = APP.viewSeq != null ? APP.viewSeq : APP.versions[APP.versions.length - 1].seq;
  const meta = APP.versions.find((v) => v.seq === shownSeq);
  if (!meta) return '';
  const who = meta.author_name && meta.author_name.trim() ? meta.author_name : 'an unnamed editor';
  return '<div class="page" style="padding-top:16px;padding-bottom:0;max-width:660px"><div style="border:1px solid var(--line-2);border-radius:12px;background:var(--bg);padding:13px 15px">' +
    '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap"><span class="pill pill-solid"><span class="mono">v' + esc(meta.label) + '</span></span>' +
    '<span class="stchip ' + esc(meta.status) + '">' + esc(STATUS_LABEL[meta.status]) + '</span>' +
    '<span style="font-size:13.5px"><strong>Last baselined by ' + esc(who) + '</strong></span>' +
    '<span style="font-size:12px;color:var(--ink-3)">' + esc(relTime(meta.created_at)) + '</span></div>' +
    (meta.note ? '<div style="margin-top:9px"><span class="eyebrow" style="font-size:9.5px">What changed</span><div style="font-size:12.5px;color:var(--ink-2);line-height:1.55;margin-top:4px">' + esc(meta.note) + '</div></div>' : '') +
    '</div></div>';
}

function renderChanges(APP, a) {
  if (!APP.versions.length) return '<div class="empty">' + ico(IC.hist) + '<div style="font-size:13px">No versions yet. Generate v1.0.</div></div>';
  const seq = APP.viewSeq != null ? APP.viewSeq : APP.versions[APP.versions.length - 1].seq;
  const idx = APP.versions.findIndex((v) => v.seq === seq);
  const meta = APP.versions[idx];
  const cur = APP.snapshots[meta.seq];
  const prevMeta = idx > 0 ? APP.versions[idx - 1] : null;
  const prev = prevMeta ? APP.snapshots[prevMeta.seq] : null;
  if (!cur || (prevMeta && !prev)) return '<div class="empty"><div style="font-size:13px">Loading snapshots…</div></div>';
  const curS = (cur.snapshot && cur.snapshot.sections) || {};
  const prevS = (prev && prev.snapshot && prev.snapshot.sections) || {};
  const rows = SECTIONS.filter((s) => s.key !== 'control' && s.key !== 'revision' && (curS[s.key] || prevS[s.key])).map((s) => {
    let st = 'Unchanged';
    if (!prevMeta) st = 'New';
    else if (!prevS[s.key] && curS[s.key]) st = 'Added';
    else if (prevS[s.key] && !curS[s.key]) st = 'Removed';
    else if (curS[s.key] !== prevS[s.key]) st = 'Changed';
    const strong = st !== 'Unchanged';
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border:1px solid var(--line);border-radius:11px;background:' + (strong ? 'var(--bg)' : 'var(--bg-2)') + ';margin-bottom:7px">' +
      '<div style="display:flex;align-items:center;gap:10px"><span class="mono" style="font-size:11px;color:var(--ink-4);width:16px">' + (s.num == null ? '·' : s.num) + '</span><span style="font-size:14px;color:' + (strong ? 'var(--ink)' : 'var(--ink-3)') + '">' + esc(s.title) + '</span></div>' +
      '<span class="pill' + (strong ? ' pill-solid' : '') + '">' + st + '</span></div>';
  }).join('');
  const rd = reqDiff((prev && prev.snapshot && prev.snapshot.answers) || {}, (cur.snapshot && cur.snapshot.answers) || {});
  const detail = reqDiffDetail((prev && prev.snapshot && prev.snapshot.answers) || {}, (cur.snapshot && cur.snapshot.answers) || {});
  const chip = (label, ids, solid) => ids.length ? '<div style="margin-bottom:10px"><span class="eyebrow" style="font-size:9.5px">' + label + '</span><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' + ids.map((id) => '<span class="pill' + (solid ? ' pill-solid' : '') + '"><span class="mono">' + esc(id) + '</span></span>').join('') + '</div></div>' : '';
  // "FR-014 modified" is a changelog; the exact before and after is evidence.
  const clip = (t) => { const x = String(t || '').trim(); return x.length > 140 ? x.slice(0, 139) + '…' : (x || '(empty)'); };
  const detailBlock = detail.length
    ? '<div style="margin-bottom:2px"><span class="eyebrow" style="font-size:9.5px">What changed</span>' + detail.map((d) =>
        '<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--bg);margin-top:6px">' +
        '<span class="mono" style="font-size:11.5px;font-weight:620">' + esc(d.id) + '</span>' +
        d.changes.map((c) =>
          '<div style="font-size:12.5px;margin-top:5px;line-height:1.45"><span style="color:var(--ink-3)">' + esc(c.label) + ':</span> ' +
          '<span style="color:var(--ink-3);text-decoration:line-through">' + esc(clip(c.from)) + '</span> → <span>' + esc(clip(c.to)) + '</span></div>'
        ).join('') + '</div>').join('') + '</div>'
    : '';
  const reqBlock = (rd.added.length || rd.modified.length || rd.removed.length)
    ? '<div style="border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--bg-2);margin-bottom:18px"><div style="font-size:13px;font-weight:600;margin-bottom:10px">Requirement-level changes</div>' + chip('Added', rd.added, true) + chip('Modified', rd.modified, false) + chip('Removed', rd.removed, false) + detailBlock + '</div>' : '';
  return '<div class="page" style="max-width:560px"><h2 style="font-size:20px;letter-spacing:-.02em;font-weight:620;margin:0 0 4px">Changes in v' + esc(meta.label) + '</h2>' +
    '<p class="hint" style="margin:0 0 18px">' + (prevMeta ? 'Compared to v' + esc(prevMeta.label) + ', by ' + esc(meta.author_name || 'an unnamed editor') + '.' : 'Initial baseline. Every section is new.') + '</p>' +
    reqBlock + '<div class="eyebrow" style="font-size:9.5px;margin-bottom:8px">By section</div>' + rows + '</div>';
}
