/* ============================================================================
   ReqPub v2 - application core: state, boot, routing, event delegation.
   Views are pure string builders; this file owns every state change.
   ============================================================================ */

import { esc, ico, IC, uid, themeInit, themeSet, copyText, debounce, presentUrl, pushUnique, upsertById, isDupKey, versionFingerprint, download } from './core.js';
import { assembleAnswers, buildSections, suggestFit, changeNote, qById, mdToHtml, defaultBriefSections, PHASES, PHASE_LETTER, currentPhase, phaseLetter, rowsFilled, tagDoneCandidates, ENGAGEMENT } from './domain.js';
import { sb, online, repo, buildSharePayload, sb as sbClient } from './data.js';
import { sync } from './sync.js';
import { viewProjects, viewWorkspace, currentDocMd, nextLabel, paletteItems, documentTabHTML, docShotsOf } from './views-app.js';
import { projectStatsOf } from './views-collab.js';
import { mapArtifacts, applyPlan, executeOps, pdfMarkdownFromItems, htmlToIntakeMd, pdfEmptyDiagnosis, pasteToRows } from './intake.js';
import { assembleUpdate } from './update.js';
import { positionHelpSpot, textToSteps, stepsToText, seedPlan } from './help.js';
import { HELP_LIBRARY } from './help-library.js';
import { renderLoading, renderBriefView, renderFeedbackForm, renderNoteIntake, renderPartnerHome, renderPartnerProject, renderNoOrg, renderPresentShare, renderSmeWorkspace, renderSignPage, renderUpdatePage, updateArtifactHTML, updateDashboardHTML, updKeyCardHTML } from './views-external.js';
import { copyMarkdown, downloadMarkdown, downloadWord, printDoc, downloadExecSummary, printClientDoc, printGatePacket, printSowExhibit, fileStem } from './exports.js';
import { landingTab, incorporatedRows, healthSignals } from './health.js';
import { buildImplementationFiles } from './implpkg.js';
import { buildVerifyBundle, buildReceiptBundle } from './verifybundle.js';
import { zipStore } from './zipstore.js';
import { buildEvidencePack, csvCell } from './evidencepack.js';
import { buildRecordOfDelivery, buildClosePackage } from './recordofdelivery.js';
import { buildInvoicePacket } from './invoicepacket.js';
const keyById = (rows) => { const o = {}; (rows || []).forEach((r) => { o[r.sign_request_id] = r; }); return o; };
import { templateByKey, applyTemplate, applyAnswerSet, buildTemplatePayload } from './templates.js';

/* ---------------- state ---------------- */
const APP = {
  view: 'loading', user: null, ctx: null, orgId: null, org: '', role: null,
  projects: [], projectStats: {},
  pid: null, project: null, fields: {}, rows: {}, versions: [], approvals: {},
  comms: [], msgs: {}, requests: [], discovery: [], activityLog: [], reads: {},
  snapshots: {}, shares: [], presence: [], walkthrough: [], wtUrls: {},
  saveState: 'idle', everSaved: false, conflicts: {}, activeField: null,
  docTab: 'document', viewSeq: null, docShow: false, openSecs: {}, openComms: {}, openDisc: {},
  drafts: {}, inboxFilter: { src: 'all', status: 'all', q: '' }, fbSeq: null,
  noteDraft: '', noteSrc: 'team', noteBy: '', reqDraft: {}, reqDel: null,
  discDraft: {}, discQ: '', discDel: null,
  menuOpen: false, profileOpen: false, orgOpen: false, orgData: null,
  present: false, shareOpen: false, access: { members: [], partners: [] }, activeQid: null,
  wsMenuOpen: false, wsCreating: false, briefPickOpen: false, briefPick: [],
  genOpen: false, gen: {}, palOpen: false, palQ: '', palSel: 0,
  delPending: null, delError: null, toast: null,
  share: null, shareKind: null, shareForm: {}, smeThread: null, request: null,
  partnerProjects: [], partnerThreads: {}, partnerPid: null, partnerSeen: {}, pprofOpen: false,
  authBusy: false, authError: null, bundleLoading: false
};
window.APP = APP; // aids debugging in the console; harmless in production

/* ---------------- rendering ---------------- */
const root = document.getElementById('root');
let renderQueued = false;

function render() {
  try {
    renderUnsafe();
  } catch (e) {
    // A render bug must never leave a blank page in front of nine editors.
    console.error('render failed:', e);
    root.innerHTML = '<div class="empty" style="height:100vh"><div style="font-size:15px;font-weight:600;color:var(--ink-2);margin-bottom:6px">Something went wrong drawing this view</div>' +
      '<div style="font-size:13px;max-width:320px;margin-bottom:16px">Your data is safe on the server. Reload to continue; if this repeats, the browser console has the detail to report.</div>' +
      '<a class="btn btn-primary" href="/app/">Reload</a></div>';
  }
}

function renderUnsafe() {
  const doc = document.getElementById('docScroll');
  const intake = document.getElementById('intakePane');
  const scrollDoc = doc ? doc.scrollTop : 0;
  const scrollIntake = intake ? intake.scrollTop : 0;

  let html;
  switch (APP.view) {
    case 'loading': html = renderLoading(); break;
    case 'brief': html = renderBriefView(APP); break;
    case 'fbshare': html = renderFeedbackForm(APP); break;
    case 'note': html = renderNoteIntake(APP); break;
    case 'present': html = renderPresentShare(APP); break;
    case 'sign': html = renderSignPage(APP); break;
    case 'update': html = renderUpdatePage(APP); break;
    case 'smeworkspace': html = renderSmeWorkspace(APP); break;
    case 'partner': html = renderPartnerHome(APP); break;
    case 'partnerview': html = renderPartnerProject(APP); break;
    case 'noorg': html = renderNoOrg(APP); break;
    case 'workspace': html = viewWorkspace(APP); break;
    case 'projects': default: html = viewProjects(APP); break;
  }
  root.innerHTML = html;

  const doc2 = document.getElementById('docScroll');
  const intake2 = document.getElementById('intakePane');
  if (doc2) doc2.scrollTop = scrollDoc;
  if (intake2) intake2.scrollTop = scrollIntake;
  renderToast();
}

function renderToast() {
  const ts = document.getElementById('toast-slot');
  if (ts) ts.innerHTML = APP.toast ? '<div class="toast">' + ico(IC.check, 'i-sm') + esc(APP.toast) + '</div>' : '';
}

let toastTimer = null;
function toast(t) {
  APP.toast = t; renderToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { APP.toast = null; renderToast(); }, 2200);
}

/* Re-render, but never yank the DOM out from under someone mid-keystroke.
   Deferred renders run when the field blurs (or on the trailing edge). The
   document pane is the exception: it lives in its own scroll container, so it
   is live-patched while you type - your words appear in the document as you
   write them, and so do your teammates'. */
const deferredRender = debounce(() => { if (!APP.activeField) render(); }, 900);
function scheduleRender(reason) {
  if (reason === 'savechip') { patchSaveChips(); return; }
  if (APP.activeField) {
    if (reason && (reason.startsWith('field:') || reason.startsWith('rows:'))) patchDocPane();
    deferredRender();
    return;
  }
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

/* ---- live edit-follow: patch the rendered document and reveal the section
   being edited, without touching the worksheet DOM ---- */
let lastRevealedSec = null;
const patchDocPane = debounce(() => {
  if (APP.view !== 'workspace' || APP.viewSeq != null) return;
  const a = assembleAnswers(APP.fields, APP.rows);
  if (APP.docTab === 'document') {
    const el = document.getElementById('docScroll');
    if (el) {
      const keep = el.scrollTop;
      el.innerHTML = documentTabHTML(APP, a);
      el.scrollTop = keep;
    }
  }
  if (APP.present) {
    const p = document.getElementById('presentScroll');
    if (p) {
      const d = currentDocMd(APP, a);
      const keep = p.scrollTop;
      p.innerHTML = '<div class="page">' + (d.md ? mdToHtml(d.md) : '') + '</div>';
      p.scrollTop = keep;
    }
  }
  revealActiveSection();
}, 300);

function revealActiveSection(force) {
  const qid = APP.activeQid;
  if (!qid || APP.viewSeq != null) return;
  const q = qById[qid];
  if (!q) return;
  if (!force && q.sec === lastRevealedSec) return;
  const container = APP.present ? document.getElementById('presentScroll')
    : (APP.docTab === 'document' ? document.getElementById('docScroll') : null);
  if (!container) return;
  const el = container.querySelector('#docsec-' + q.sec);
  if (!el) return;
  lastRevealedSec = q.sec;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('doc-flash');
  setTimeout(() => el.classList.add('fade'), 700);
  setTimeout(() => el.classList.remove('doc-flash', 'fade'), 2100);
}

async function loadAccessData() {
  if (!APP.orgId) return;
  const [members, partners, seats] = await Promise.all([
    repo.members(APP.orgId),
    APP.role === 'manager' ? repo.orgPartners(APP.orgId) : Promise.resolve(APP.access.partners || []),
    (APP.role === 'manager' && APP.pid) ? repo.smeSeats(APP.pid) : Promise.resolve({ data: [] })
  ]);
  APP.access = { members, partners };
  APP.smeSeats = (seats && Array.isArray(seats.data)) ? seats.data : [];
  scheduleRender('access');
}
function patchSaveChips() {
  // Surgical update so typing is never interrupted by chip changes.
  document.querySelectorAll('.savechip').forEach((el) => {
    const s = APP.saveState;
    if (s === 'idle') { el.style.display = 'none'; return; }
    el.style.display = '';
    el.className = 'savechip ' + s;
    el.innerHTML = s === 'saving' ? '<span class="spin"></span>Saving…'
      : s === 'saved' ? ico(IC.check, 'i-sm') + 'Saved'
      : s === 'offline' ? 'Offline, will retry' : 'Save failed, Retry';
    if (s === 'error') el.setAttribute('data-action', 'retrysave'); else el.removeAttribute('data-action');
    el.disabled = s !== 'error';
  });
}

/* ---------------- routing ---------------- */
function parseHash() {
  const h = (location.hash || '').replace(/^#/, '');
  let m = h.match(/^(brief|fb|present)\/([^/]+)\/(\d+)\/([^/]+)$/);
  if (m) return { mode: m[1], pid: m[2], seq: +m[3], token: m[4] };
  m = h.match(/^note\/([^/]+)\/([^/]+)$/);              // v2: #note/pid/token
  if (m) return { mode: 'note', pid: m[1], token: m[2] };
  m = h.match(/^note\/([^/]+)\/([^/]+)\/([^/]+)$/);     // v1 legacy: #note/pid/rid/token
  if (m) return { mode: 'note', pid: m[1], token: m[3] };
  m = h.match(/^sme\/([^/]+)$/);                        // durable SME workspace: #sme/replyToken
  if (m) return { mode: 'sme', token: m[1] };
  m = h.match(/^sign\/([^/]+)$/);                       // e-sign v1: #sign/token
  if (m) return { mode: 'sign', token: m[1] };
  m = h.match(/^update\/([^/]+)$/);                     // weekly update: #update/token
  if (m) return { mode: 'update', token: m[1] };
  return null;
}

/* Pull live dashboard inputs into state before a repaint (v2.35.0): the phase
   tabs and row expanders rerender the page, and a rerender must never eat
   half-typed notes, thread text, or replies. */
function captureUpdInputs() {
  const g = (id) => document.getElementById(id);
  if (g('updnotesbox')) (APP.updNotes = APP.updNotes || {}).body = g('updnotesbox').value;
  if (g('updthreadtitle')) (APP.updThread = APP.updThread || {}).title = g('updthreadtitle').value;
  if (g('updthreadbody')) (APP.updThread = APP.updThread || {}).body = g('updthreadbody').value;
  if (g('updthreadkind')) (APP.updThread = APP.updThread || {}).kind = g('updthreadkind').value;
  document.querySelectorAll('[data-updreply]').forEach((el) => {
    (APP.updDrafts = APP.updDrafts || {})[el.dataset.updreply] = el.value;
  });
}

async function routeShare(r) {
  APP.view = 'loading'; render();
  const fallback = r.mode === 'note' ? 'note' : r.mode === 'fb' ? 'fbshare' : r.mode === 'present' ? 'present' : 'brief';
  if (!online()) { APP.share = null; APP.view = fallback; render(); return; }
  APP.shareKind = r.mode;
  APP.shareToken = r.token;
  APP.shareRoute = r;
  APP.shareForm = {};
  if (r.mode === 'sign') {
    // E-sign: the token page fetches the request context (which carries the
    // exact stored snapshot), assembles the full document exactly like a
    // presentation link, and verifies the send-time fingerprint in the
    // signer's own browser before asking for a signature.
    const res = await repo.signContext(r.token);
    const c = res.data && res.data.ok ? res.data : null;
    APP.sign = c ? { ...c, token: r.token } : null;
    if (c && c.snapshot) {
      const answers = c.snapshot.answers || {};
      APP.share = { payload: buildSharePayload(        { name: c.project, brand_logo: c.logo || '', brand_label: c.brandLabel || '' },
        answers, c.label, c.seq, 'present', c.snapshot.build || '', null, (c.snapshot.walkthrough || [])) };
      try {
        const fp = await versionFingerprint({ label: c.label, seq: c.seq, snapshot: c.snapshot });
        APP.sign.computedFp = fp;
        APP.sign.verified = !!c.fingerprint && fp === c.fingerprint;
      } catch { APP.sign.computedFp = ''; APP.sign.verified = false; }
    }
    APP.view = 'sign';
    render();
    return;
  }
  if (r.mode === 'update') {
    // Weekly update: token-keyed, immutable at the row - the page renders
    // exactly what was published, or says plainly that it was withdrawn.
    const res = await repo.updateContext(r.token);
    APP.updatePage = res.data || null;
    // Dashboard view state (v2.35.0): the tab filter and open notes rows, plus
    // the recipient's saved note carried into the editor with its rev, so the
    // first save is rev-checked against what the server holds.
    APP.updUi = { open: {}, ex: {}, vphase: '' };
    APP.updDrafts = {};
    APP.updThread = {};
    const savedNote = (APP.updatePage && APP.updatePage.note) || null;
    APP.updNotes = savedNote ? { body: savedNote.body, rev: savedNote.rev } : { body: '', rev: 0 };
    APP.view = 'update';
    render();
    return;
  }
  if (r.mode === 'sme') {
    // Durable SME workspace: the token IS the persistent reply_token, so the
    // link resumes the same thread on any device with no localStorage needed.
    const res = await repo.smeThread(r.token);
    APP.smeThread = (res.data && res.data.ok) ? res.data : null;
    APP.smeReplyToken = APP.smeThread ? r.token : null;
    APP.view = 'smeworkspace';
    render();
    return;
  } else if (r.mode === 'note') {
    const res = await repo.requestView(r.token);
    APP.request = (res.data && res.data.ok) ? res.data : null;
    APP.view = 'note';
  } else if (r.mode === 'present') {
    // Pure read-only presentation: load the brief payload, show no form.
    const res = await repo.getShare(r.token);
    APP.share = res.data ? { payload: res.data } : null;
    APP.view = 'present';
    render();
    return;
  } else {
    const res = await repo.getShare(r.token);
    APP.share = res.data ? { payload: res.data } : null;
    APP.view = r.mode === 'fb' ? 'fbshare' : 'brief';
  }
  await loadSmeThread();
  render();
}

function smeTokenKey() { return 'rp:sme:' + APP.shareToken; }
async function loadSmeThread() {
  APP.smeThread = null;
  let replyToken = null;
  try { replyToken = localStorage.getItem(smeTokenKey()); } catch { /* private mode */ }
  if (!replyToken) return;
  const r = await repo.smeThread(replyToken);
  if (r.data && r.data.ok) { APP.smeThread = r.data; APP.smeReplyToken = replyToken; APP.shareForm.submitted = true; }
}

/* ---------------- boot ---------------- */
async function boot() {
  themeInit();
  const shareRoute = parseHash();
  if (shareRoute) { await routeShare(shareRoute); return; }

  if (!online()) { root.innerHTML = '<div class="empty" style="height:100vh"><div style="font-size:14px">Backend not configured. Set SB_CFG in /config.js.</div></div>'; return; }
  const session = await repo.session();
  if (!session) { location.replace('/login/'); return; }
  APP.user = session.user;

  // If the session ends while the app is open (expiry, revocation, sign-out
  // in another tab), return to the door instead of failing request by request.
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.replace('/login/');
  });

  // The invite defect: a fresh invitee landed in memberships[0], their
  // personal workspace, with no way into the org that invited them. The
  // claim now reports which orgs were just joined and the boot routes there
  // first. Tolerates the old int-returning function during deploy overlap.
  const claim = await repo.claimInvites();
  APP.claimedOrgIds = (claim && claim.org_ids) || [];
  APP.ctx = await repo.context();
  if (!APP.ctx) { toast('Could not load your workspace'); APP.view = 'noorg'; render(); return; }

  // First sign-in after signup: copy the display name from auth metadata
  // into user_profiles so teammates see a real name, not an email.
  const metaName = APP.user.user_metadata && APP.user.user_metadata.display_name;
  if (!APP.ctx.display_name && metaName) {
    await repo.saveDisplayName(APP.user.id, metaName);
    APP.ctx.display_name = metaName;
  }

  const memberships = APP.ctx.memberships || [];
  if (memberships.length) {
    let last = null;
    try { last = localStorage.getItem('rp:lastorg'); } catch { /* fine */ }
    const m = memberships.find((x) => (APP.claimedOrgIds || []).includes(x.org_id)) ||
      memberships.find((x) => x.org_id === last) || memberships[0];
    await enterOrg(m);
  } else if (APP.ctx.partner) {
    APP.role = 'partner';
    APP.view = 'partner';
    pseenLoad();
    render();
    loadPartner();
  } else {
    APP.view = 'noorg'; render();
  }
}

async function enterOrg(m) {
  APP.orgId = m.org_id; APP.org = m.org_name; APP.role = m.role;
  try { localStorage.setItem('rp:lastorg', m.org_id); } catch { /* fine */ }
  try {
    const hb = await repo.helpTopicsFor(m.org_id);
    APP.helpTopics = hb.topics; APP.helpSteps = hb.steps;
    APP.helpState = await repo.helpStateFor(APP.uid);
    APP.helpPrefs = await repo.helpPrefsFor(APP.uid);
    if (APP.role === 'manager') APP.helpStats = await repo.helpStats(m.org_id);
  } catch { APP.helpTopics = []; APP.helpSteps = []; APP.helpState = {}; APP.helpPrefs = { beacon_hidden: false }; }
  APP.help = { open: false, topic: null, showDismissed: false };
  try { APP.helpPathFold = localStorage.getItem('rp:pathfold') === '1'; } catch { APP.helpPathFold = false; }
  APP.helpSpot = null; APP.helpStudioOpen = false; APP.helpEdit = null;
  APP.view = 'projects'; APP.pid = null;
  sync.init(APP, { onChange: (tag) => {
    if (tag === 'walkthrough' && APP.pid) {
      // Never clobber a caption someone is typing: park the refresh and run
      // it when their edit commits (the wtcap change handler drains it).
      const el = document.activeElement;
      if (el && el.matches && el.matches('[data-action="wtcap"]')) { APP.wtStale = true; return; }
      repo.walkthroughFor(APP.pid).then((w) => { APP.walkthrough = w; ensureWtUrls(); scheduleRender('walkthrough'); });
      return;
    }
    scheduleRender(tag);
  }, onToast: toast });
  sync.initPresence(APP.user);
  sync.subscribeOrg(APP.orgId);
  APP.projects = await repo.projects(APP.orgId);
  // Firm templates ride along with the dashboard load; members read them,
  // managers write them. A failure here degrades to no chips, never an error.
  APP.recordTemplates = await repo.recordTemplatesList(APP.orgId);
  render();
  refreshDashboardStats();
  refreshMyApprovals();
}

// The "waiting on you" feed: approval slots assigned to the current user on
// in-review versions. Loaded for the dashboard flag; refreshed after any
// approval decision. Fire-and-forget so it never blocks the UI.
function refreshMyApprovals() {
  repo.myOpenApprovals().then((list) => { APP.myApprovals = list || []; render(); })
    .catch(() => { /* leave the last known value */ });
}

async function refreshDashboardStats() {
  // One org-wide pass: unread/open per project for the dashboard chips.
  const r = await Promise.all([
    (async () => { const x = await sbLite('comms', 'id,project_id,origin,status,last_ext_at,team_seen_at', APP.orgId); return x; })(),
    (async () => { const x = await repoReads(); return x; })()
  ]);
  const comms = r[0], reads = r[1];
  const byProj = {};
  comms.forEach((c) => { (byProj[c.project_id] = byProj[c.project_id] || []).push(c); });
  const stats = {};
  APP.projects.forEach((p) => {
    stats[p.id] = projectStatsOf(byProj[p.id] || [], reads);
    stats[p.id].latest = null;
  });
  const vr = await sbLite('versions', 'id,project_id,seq,label,status', APP.orgId, false);
  vr.forEach((v) => {
    const s = stats[v.project_id];
    if (s && (!s.latest || v.seq > s.latest.seq)) s.latest = v;
  });
  APP.projectStats = stats;
  // v2.55 the Book: one batched call for signature counts and the sealed
  // truth; a failed fetch drops the facts, never the layout.
  try { APP.acceptFacts = await repo.acceptanceFacts(); } catch { APP.acceptFacts = {}; }
  scheduleRender('stats');
}
async function sbLite(table, cols, orgId, hasOrg = true) {
  let q = sb.from(table).select(cols);
  if (hasOrg) q = q.eq('org_id', orgId);
  const r = await q;
  return r.data || [];
}
async function repoReads() {
  const r = await sb.from('read_marks').select('comm_id');
  const m = {};
  (r.data || []).forEach((x) => { m[x.comm_id] = true; });
  return m;
}

/* ---------------- project open / close ---------------- */
async function openProject(id, tab) {
  APP.pid = id;
  APP.project = APP.projects.find((p) => p.id === id) || null;
  APP.view = 'workspace';
  APP.docTab = tab || 'document'; APP.landingAuto = !tab; APP.viewSeq = null; APP.fbSeq = null;
  APP.fields = {}; APP.rows = {}; APP.versions = []; APP.comms = []; APP.msgs = {};
  APP.requests = []; APP.discovery = []; APP.reads = {}; APP.snapshots = {}; APP.shares = [];
  APP.approvals = {}; APP.signs = {}; APP.conflicts = {}; APP.openComms = {}; APP.openDisc = {}; APP.openSecs = {};
  // Document-first creation lands with the intake panel already open.
  APP.intake = APP.openWithIntake ? { open: true, text: '', files: [], plan: null } : null;
  APP.openWithIntake = false;
  APP.present = false; APP.activeQid = null; lastRevealedSec = null;
  APP.access = { members: [], partners: [] };
  APP.smeSeats = [];
  APP.attachments = [];
  APP.whEndpoints = []; APP.whDeliveries = []; APP.mcpKeys = []; APP.mcpNewKey = null;
  APP.walkthrough = []; APP.wtUrls = {};
  APP.fingers = {};
  APP.bundleLoading = true;
  render();

  const b = await repo.projectBundle(id);
  if (APP.pid !== id) return;
  Object.assign(APP, {
    fields: b.fields, rows: b.rows, versions: b.versions, comms: b.comms,
    requests: b.requests, discovery: b.discovery, reads: b.reads, bundleLoading: false
  });
  // Land on Health once a baseline exists, on the document before one does -
  // and only when the caller did not ask for a specific tab.
  if (APP.landingAuto) { APP.docTab = landingTab(APP.versions); APP.landingAuto = false; }
  const parentIds = [...b.comms.map((c) => c.id), ...b.requests.map((r) => r.id)];
  const [msgs, approvals, shares, attachments, signs, members, walkthrough, whEndpoints, whDelivR, mcpKeysR] = await Promise.all([
    repo.messagesFor(parentIds),
    repo.approvals(b.versions.map((v) => v.id)),
    repo.sharesFor(id),
    repo.attachmentsFor(id),
    repo.signsFor(id),
    APP.role === 'manager' ? repo.orgMembersNamed(APP.orgId) : Promise.resolve(APP.members || []),
    repo.walkthroughFor(id),
    APP.role === 'manager' ? repo.whEndpoints(id) : Promise.resolve([]),
    APP.role === 'manager' ? repo.whDeliveries(id) : Promise.resolve({ data: { rows: [] } }),
    APP.role === 'manager' ? repo.mcpKeysList(APP.orgId) : Promise.resolve(null),
  ]);
  if (APP.pid !== id) return;
  APP.msgs = msgs; APP.approvals = approvals; APP.shares = shares; APP.attachments = attachments; APP.signs = signs;
  APP.receipts = keyById(await repo.receiptsFor(APP.pid));
  APP.members = members; APP.walkthrough = walkthrough;
  APP.whEndpoints = whEndpoints || []; APP.whDeliveries = (whDelivR && whDelivR.data && whDelivR.data.rows) || [];
  APP.mcpKeys = (mcpKeysR && mcpKeysR.data && mcpKeysR.data.rows) || [];
  ensureWtUrls();
  sync.subscribeProject(id, APP.user);
  render();
}

function goHome() {
  sync.flushNow();
  sync.unsubscribeProject();
  APP.pid = null; APP.project = null; APP.view = 'projects'; APP.activeField = null;
  APP.present = false; APP.activeQid = null;
  render();
  refreshDashboardStats();
}

async function ensureSnapshot(seq) {
  if (seq == null || APP.snapshots[seq]) return;
  const s = await repo.versionSnapshot(APP.pid, seq);
  if (s) { APP.snapshots[seq] = s; scheduleRender('snapshot'); }
}

/* The baseline a note or discovery entry is being written against: the newest
   version that exists right now, or null before the first one. Stamped at
   creation and never recomputed, so "what was said around v1.3" stays true
   after v1.4 exists. This is metadata ABOUT the note. It puts nothing inside
   the snapshot, and it promotes nothing into the agreement. */
function baselineSeq() {
  const vs = APP.versions || [];
  return vs.length ? vs.reduce((m, v) => (v.seq > m ? v.seq : m), vs[0].seq) : null;
}

/* ---------------- generate version ---------------- */
async function generateVersion() {
  const g = APP.gen;
  g.busy = true; g.error = null; render();
  sync.flushNow();
  for (let i = 0; i < 40 && sync.dirtyCount() > 0; i++) await new Promise((r) => setTimeout(r, 150));
  if (sync.dirtyCount() > 0) { g.busy = false; g.error = 'Some edits have not saved yet. Check the save indicator, then try again.'; render(); return; }

  const answers = assembleAnswers(APP.fields, APP.rows);
  const label = nextLabel(APP.versions, !!g.major);
  const sections = buildSections(answers, label, APP.versions.concat([{ seq: 1e9, label, created_at: new Date().toISOString(), author_name: '' }]));
  const prevMeta = APP.versions[APP.versions.length - 1];
  if (prevMeta) await ensureSnapshot(prevMeta.seq);
  const auto = changeNote(prevMeta ? (APP.snapshots[prevMeta.seq] || {}).snapshot : null, answers, !prevMeta);
  const note = [g.note && g.note.trim(), auto].filter(Boolean).join(' - ');

  // The gate name and the record's state ride INSIDE the snapshot: a gate is
  // a named decision on a fixed artifact, and snapshot.health is the evidence
  // of what was true when the artifact was fixed. create_version stores the
  // jsonb exactly as sent; no schema change, and the fingerprint covers both.
  const gate = (g.gate || '').trim().slice(0, 80);
  const snapHealth = healthSignals(answers, { versions: APP.versions, approvalsByVersion: APP.approvals, shares: APP.shares, comms: APP.comms, discovery: APP.discovery });
  // The walkthrough freezes with the baseline: order, captions, and file
  // references ride the snapshot, sealed under the same fingerprint.
  const wt = (APP.walkthrough || []).map((s, i) => ({
    n: i + 1, caption: s.caption || '',
    file_name: (s.attachment && s.attachment.file_name) || '',
    attachment_id: s.attachment_id
  }));
  const r = await repo.createVersion(APP.pid, !!g.major, note, { answers, sections, ...(gate ? { gate } : {}), ...(wt.length ? { walkthrough: wt } : {}), health: snapHealth });
  const out = r.data;
  if (r.error || !out || !out.ok) {
    g.busy = false; g.error = (out && out.error === 'forbidden') ? 'Your role cannot generate versions.' : 'Could not generate. Try again.';
    render(); return;
  }
  // Publish the SME-safe payloads for this baseline (brief + app testing).
  // The brief carries the project's remembered section selection.
  await Promise.all([
    repo.sharePut(APP.pid, 'brief', out.seq, buildSharePayload(APP.project || { name: answers.ctrl_product }, answers, out.label, out.seq, 'brief', '', briefSecsSaved(APP.pid), wt)),
    repo.sharePut(APP.pid, 'pilot', out.seq, buildSharePayload(APP.project || { name: answers.ctrl_product }, answers, out.label, out.seq, 'pilot'))
  ]);
  APP.shares = await repo.sharesFor(APP.pid);
  if (!APP.versions.some((v) => v.id === out.id)) {
    APP.versions.push({ id: out.id, seq: out.seq, label: out.label, status: 'draft', note, author_name: (APP.ctx && APP.ctx.display_name) || '', build: '', created_at: new Date().toISOString() });
  }
  APP.genOpen = false; APP.gen = {};
  toast('Version v' + out.label + ' generated');
  render();
}

/* ---------------- share submission (SME pages) ---------------- */
async function submitShare() {
  const f = APP.shareForm;
  f.error = null;
  if (!f.name || !f.name.trim()) { f.error = 'Please add your name.'; render(); return; }
  if (APP.shareKind !== 'brief' && (!f.note || !f.note.trim())) { f.error = 'Please add your input.'; render(); return; }
  if (APP.shareKind === 'fb' && (!f.title || !f.title.trim())) { f.error = 'Please add a title.'; render(); return; }
  f.busy = true; render();

  let r;
  if (APP.shareKind === 'note') {
    r = await repo.requestSubmit(APP.shareToken, f.name.trim(), (f.note || '').trim());
  } else {
    r = await repo.submitShare(APP.shareToken, {
      name: f.name.trim(), email: (f.email || '').trim(),
      title: APP.shareKind === 'brief' ? 'PRD review' + (f.verdict ? ': ' + f.verdict : '') : f.title.trim(),
      body: (f.note || '').trim(), steps: (f.steps || '').trim(),
      type: APP.shareKind === 'brief' ? 'Review' : (f.type || 'Bug'),
      severity: (f.type || 'Bug') === 'Bug' ? (f.severity || 'Minor') : '',
      verdict: f.verdict || ''
    });
  }
  const out = r.data;
  f.busy = false;
  if (r.error || !out || !out.ok) {
    const why = out && out.error;
    f.error = why === 'invalid_link' ? 'This link is no longer active. Ask your contact for a current one.'
      : why === 'rate_limited' ? 'This link reached its hourly submission limit. Please try again in a little while.'
      : why === 'too_long' ? 'Your message is too long for one submission. Please shorten it.'
      : why === 'empty' ? 'Please add your input before sending.'
      : 'Could not send. Check your connection and try again; if it keeps failing, tell your contact.';
    render(); return;
  }
  f.submitted = true;
  if (out.reply_token) {
    try { localStorage.setItem(smeTokenKey(), out.reply_token); } catch { /* private mode */ }
    APP.smeReplyToken = out.reply_token;
    await loadSmeThread();
  }
  render();
}

/* ---------------- partner ---------------- */
let lastPartnerRefresh = 0;
async function loadPartner() {
  lastPartnerRefresh = Date.now();
  const r = await repo.partnerProjects();
  APP.partnerProjects = (r.data && Array.isArray(r.data)) ? r.data : [];
  await Promise.all(APP.partnerProjects.map(async (p) => {
    const t = await repo.partnerThread(p.project_id);
    APP.partnerThreads[p.project_id] = (t.data && Array.isArray(t.data)) ? t.data : [];
  }));
  if (APP.view === 'partnerview' && APP.partnerPid) pseenMark(APP.partnerPid);
  render();
}

function pseenLoad() {
  try { APP.partnerSeen = JSON.parse(localStorage.getItem('rp:pseen') || '{}') || {}; }
  catch { APP.partnerSeen = {}; }
}
function pseenMark(pid) {
  const p = (APP.partnerProjects || []).find((x) => x.project_id === pid);
  const label = p && p.payload && p.payload.label;
  if (!label) return;
  APP.partnerSeen[pid] = label;
  try { localStorage.setItem('rp:pseen', JSON.stringify(APP.partnerSeen)); } catch { /* private mode */ }
}

/* The portal refreshes itself when the partner comes back to the tab, so what
   they see is always current without a reload button. */
window.addEventListener('focus', () => {
  if ((APP.view === 'partner' || APP.view === 'partnerview') && Date.now() - lastPartnerRefresh > 1500) {
    loadPartner();
  }
});

/* ---------------- org modal ---------------- */
async function loadOrgData(tab) {
  APP.orgData = APP.orgData || { tab: tab || 'members' };
  if (tab) APP.orgData.tab = tab;
  const [members, invites, partners] = await Promise.all([
    repo.members(APP.orgId), repo.invites(APP.orgId), repo.orgPartners(APP.orgId)
  ]);
  Object.assign(APP.orgData, { members, invites, partners });
  render();
}

/* Ensure a guest link exists for the latest version, then return it. */
async function ensureShareLink(kind) {
  const latest = APP.versions.length ? APP.versions[APP.versions.length - 1] : null;
  if (!latest) return null;
  let share = (APP.shares || []).find((s) => s.kind === kind && s.version_seq === latest.seq && !s.revoked);
  if (!share) {
    const answers = assembleAnswers(APP.fields, APP.rows);
    await ensureSnapshot(latest.seq);
    const snapAns = APP.snapshots[latest.seq] ? (APP.snapshots[latest.seq].snapshot.answers || answers) : answers;
    const r = await repo.sharePut(APP.pid, kind, latest.seq,
      buildSharePayload(APP.project || {}, snapAns, latest.label, latest.seq, kind, latest.build,
        kind === 'brief' ? briefSecsSaved(APP.pid) : null), (APP.snapshots[latest.seq] && APP.snapshots[latest.seq].snapshot.walkthrough) || []);
    if (r.error || !r.data) return null;
    APP.shares = await repo.sharesFor(APP.pid);
    share = (APP.shares || []).find((s) => s.kind === kind && s.version_seq === latest.seq && !s.revoked);
  }
  if (!share) return null;
  return location.origin + location.pathname + '#' + (kind === 'brief' ? 'brief' : 'fb') + '/' + APP.pid + '/' + latest.seq + '/' + share.token;
}

/* The read-only presentation URL for this project's latest published brief.
   Managers publish one if none exists; viewers use whatever is already public. */
async function ensurePresentLink() {
  const latest = APP.versions.length ? APP.versions[APP.versions.length - 1] : null;
  if (!latest) return null;
  let share = (APP.shares || []).find((s) => s.kind === 'brief' && s.version_seq === latest.seq && !s.revoked);
  if (!share && APP.role === 'manager') {
    await ensureShareLink('brief');
    share = (APP.shares || []).find((s) => s.kind === 'brief' && s.version_seq === latest.seq && !s.revoked);
  }
  if (!share) return null;
  return presentUrl(APP.pid, latest.seq, share.token);
}

/* ---------------- event delegation ---------------- */
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

/* Intake file ingestion: txt and md are read exactly; docx converts to
   HTML through mammoth and then to the segmenter's markdown
   (htmlToIntakeMd) because mammoth's own markdown writer flattens tables
   into bare paragraphs - and a consulting-grade PRD is mostly tables. pdf
   extracts text items WITH their coordinates and the geometry engine
   (pdfMarkdownFromItems) rebuilds each table deterministically from the
   recurring column positions, so requirements arrive as pipe tables the
   mapper reads natively instead of shredded cell fragments. Both
   libraries load once from the pinned CDN the CSP already allows; the
   pdf.js worker is served from THIS origin (app/vendor/pdf.worker.min.js,
   the same 3.11.174 build as the library) because the browser will not
   start a cross-origin worker script. A parse failure degrades to a toast
   asking for pasted text - it never produces a silent partial plan. */
let mammothLoading = null;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (!mammothLoading) {
    mammothLoading = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
      sc.onload = () => res(window.mammoth);
      sc.onerror = () => { mammothLoading = null; rej(new Error('mammoth load failed')); };
      document.head.appendChild(sc);
    });
  }
  return mammothLoading;
}
let pdfjsLoading = null;
function loadPdfjs() {
  if (!pdfjsLoading) {
    pdfjsLoading = window.pdfjsLib ? Promise.resolve(window.pdfjsLib) : new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      sc.onload = () => res(window.pdfjsLib);
      sc.onerror = () => { pdfjsLoading = null; rej(new Error('pdf.js load failed')); };
      document.head.appendChild(sc);
    });
  }
  return pdfjsLoading.then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = '/app/vendor/pdf.worker.min.js';
    return lib;
  });
}
async function pdfToText(buf) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      // str + exact position per fragment: transform[4]/[5] are x and y.
      // The geometry is what lets a table be a table again.
      pages.push(tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], hasEOL: it.hasEOL })));
    }
    const text = pdfMarkdownFromItems(pages);
    if (text) return { text, why: '' };
    // Nothing extracted: read the first pages' operator lists to say WHY,
    // because the advice differs. A scan needs OCR; outlined text (fonts
    // converted to curves on export) cannot be copied from any viewer and
    // must be fixed at the source. Pure classification in intake.js.
    const ops = [];
    for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
      const ol = await (await doc.getPage(i)).getOperatorList();
      const c = { images: 0, paths: 0, text: 0 };
      for (const fn of ol.fnArray) {
        if (fn === lib.OPS.paintImageXObject || fn === lib.OPS.paintInlineImageXObject
            || fn === lib.OPS.paintImageMaskXObject) c.images++;
        else if (fn === lib.OPS.constructPath) c.paths++;
        else if (fn === lib.OPS.showText || fn === lib.OPS.showSpacedText) c.text++;
      }
      ops.push(c);
    }
    return { text: '', why: pdfEmptyDiagnosis(ops) };
  } finally { doc.destroy(); }
}
async function intakeAddFiles(files) {
  if (!APP.intake) return;
  for (const f of files) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    try {
      if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
        APP.intake.files.push({ name: f.name, text: await f.text() });
      } else if (ext === 'docx') {
        const m = await loadMammoth();
        const r = await m.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
        // HTML keeps Word's tables; htmlToIntakeMd hands the segmenter
        // real pipe tables plus the headings and bullets it already read.
        APP.intake.files.push({ name: f.name, text: htmlToIntakeMd((r && r.value) || '') });
      } else if (ext === 'pdf') {
        const r = await pdfToText(await f.arrayBuffer());
        if (r.text) APP.intake.files.push({ name: f.name, text: r.text });
        else if (r.why === 'outlined') toast('No text layer in ' + f.name + '. Its text was converted to outlines (drawn shapes) when it was exported, so nothing is copyable from it in any viewer. Re-export it from the source tool with selectable text, or upload the .docx instead');
        else if (r.why === 'scanned') toast('No text layer in ' + f.name + '. The pages are images (a scan). Run OCR on it first, or paste the text');
        else toast('No selectable text in ' + f.name + '. Paste its text instead');
      } else {
        toast('Could not read ' + f.name + '. Txt, md, docx, and pdf are supported; paste anything else as text');
      }
    } catch {
      toast('Could not read ' + f.name + '. Paste its text instead');
    }
  }
  APP.intake.plan = null;   // a changed artifact set always re-previews
  render();
}

/* Signed webhooks (v2.50): lazy dispatch. A ping attempts one delivery; it
   must never block or break the flow that created it. */
async function pingDeliveries(ids) {
  let sent = 0;
  for (const did of (ids || []).slice(0, 20)) {
    try { const r = await repo.whPing(did); if (r.data && r.data.ok) sent++; } catch { /* never blocks */ }
  }
  return sent;
}
async function sweepWebhooks() {
  if (APP.role !== 'manager' || !APP.pid) return;
  try {
    const d = await repo.whDue(APP.pid);
    await pingDeliveries((d.data && d.data.ids) || []);
    const l = await repo.whDeliveries(APP.pid);
    APP.whDeliveries = (l.data && l.data.rows) || [];
    render();
  } catch { /* the panel refresh is best-effort */ }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (e.target.closest('[data-stop]') && !t) return;
  if (!t) return;
  // Any unexpected data shape (a null field on an externally-authored record,
  // say) must surface as a toast, never a silently dead button or a broken app.
  Promise.resolve(handleAction(t.dataset.action, t.dataset.id, t, e)).catch((err) => {
    console.error('action failed:', t.dataset.action, err);
    toast('That did not work: ' + String((err && err.message) || err).slice(0, 120));
  });
});

async function handleAction(a, id, t, e) {
  switch (a) {
    /* chrome */
    case 'usermenu': APP.menuOpen = !APP.menuOpen; render(); break;
    case 'menuclose': APP.menuOpen = false; APP.wsMenuOpen = false; APP.wsCreating = false; render(); break;
    case 'modalback': if (e.target === t) { closeModals(); render(); } break;
    case 'modalclose': closeModals(); render(); break;
    case 'themeset': themeSet(t.dataset.val); render(); break;
    case 'themetoggle': themeSet(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); closeModals(); render(); break;
    case 'signout': await repo.signOut(); location.replace('/login/'); break;
    case 'retrysave': sync.retry(); break;
    case 'profileopen': APP.menuOpen = false; APP.profileOpen = true; render(); break;
    case 'profilesave': {
      const name = val('pfName').trim();
      await repo.saveDisplayName(APP.user.id, name);
      if (APP.ctx) APP.ctx.display_name = name;
      APP.profileOpen = false; toast('Profile saved'); render();
      if (sync.trackPresence) sync.trackPresence();
      break;
    }
    case 'orgswitch': {
      const m = (APP.ctx.memberships || []).find((x) => x.org_id === id);
      if (m) { APP.menuOpen = false; sync.unsubscribeProject(); await enterOrg(m); }
      break;
    }
    case 'orgopen': APP.menuOpen = false; APP.orgOpen = true; render(); loadOrgData(); break;
    case 'orgtab': loadOrgData(t.dataset.val); break;

    /* org admin */
    case 'invsend': {
      const email = val('invEmail').trim().toLowerCase(), role = val('invRole') || 'viewer';
      if (!email || !email.includes('@')) { toast('Enter a valid email'); break; }
      const r = await repo.invite(APP.orgId, email, role);
      if (r.error) { toast('Invite failed: ' + r.error.message); break; }
      repo.sendInviteEmail(email, role, APP.org, APP.user.email);
      toast('Invited ' + email);
      loadOrgData();
      break;
    }
    case 'invrevoke': await repo.revokeInvite(APP.orgId, id); loadOrgData(); break;
    case 'mremove': await repo.removeMember(APP.orgId, id); loadOrgData(); break;
    case 'paddnew': {
      const name = val('pName').trim(), email = val('pEmail').trim().toLowerCase();
      if (!email || !email.includes('@')) { toast('Enter a valid email'); break; }
      const r = await repo.addPartner(APP.orgId, email, name);
      if (r.error) { toast('Could not add client contact'); break; }
      repo.sendInviteEmail(email, 'partner', APP.org, APP.user.email);
      loadOrgData('partners');
      break;
    }
    case 'premove': await repo.removePartner(id); loadOrgData('partners'); break;
    case 'paccess': {
      const pidp = t.dataset.pid;
      const partner = (APP.orgData.partners || []).find((p) => p.id === id);
      if (!partner) break;
      if (partner.acc[pidp]) await repo.revokePartner(id, pidp); else await repo.grantPartner(id, pidp);
      loadOrgData('partners');
      break;
    }

    /* dashboard */
    case 'tplsel': {
      // Keep the typed name across the re-render (the input is rebuilt).
      APP.newName = val('newName');
      APP.newTpl = t.dataset.val;
      render();
      break;
    }
    case 'new': {
      // One click, one project. The insert is a network round trip and the
      // dashboard stays live while it runs, so without a guard a double-click
      // (or a second click after no visible feedback) fired this handler twice
      // and two distinct uid()s produced two identical-looking projects. The
      // flag closes re-entry; the view renders the button disabled as
      // "Creating…" so the second click has nothing to land on. Present since
      // 2.14; surfaced in production 2026-07-13.
      if (APP.creating) break;
      const name = val('newName').trim();
      if (!name) { toast('Name the product or project first'); break; }
      APP.newName = name; APP.creating = true; render();
      const idNew = uid();
      // v2.55: practice is decided here, once. The template can force it
      // (the Practice engagement start) and the checkbox offers it; the
      // trigger makes the choice immutable in both directions.
      const tplDef0 = templateByKey(APP.newTpl || 'blank');
      const practice = !!((tplDef0 && tplDef0.practice) || (document.getElementById('newPractice') || {}).checked);
      const r = await repo.createProject(APP.orgId, idNew, name, practice);
      // A duplicate-key error means a retried attempt already landed this very
      // id - the project exists. Failing here made people click again and mint
      // a real second project.
      if (r.error && !isDupKey(r.error)) { APP.creating = false; toast('Could not create project'); render(); break; }
      // Reconcile, never blind-unshift: the org-channel insert echo can arrive
      // while the insert above is still awaited, and the engine adds the row
      // to this same array. Two unshifts of one id rendered as two identical
      // cards (2026-07-13, worst on templates, which hold the dashboard open
      // for seconds of update echoes).
      upsertById(APP.projects, { id: idNew, org_id: APP.orgId, name, practice, archived: false, disc_export: false, updated_at: new Date().toISOString() }, 'updated_at');
      // Apply the chosen starter through the same rev-checked RPCs as live
      // editing, BEFORE the project opens, so the bundle loads it complete.
      const tplKey = APP.newTpl || 'blank';
      if (tplKey === 'documents') {
        // Document-first creation: the project opens straight into the
        // intake panel. Same deterministic mapper, same preview, nothing
        // written without approval - the panel just meets the PM at the
        // start instead of hiding behind it.
        APP.openWithIntake = true;
      } else if (tplKey.startsWith('rt:')) {
        const rt = (APP.recordTemplates || []).find((x) => 'rt:' + x.id === tplKey);
        toast('Starting from ' + ((rt && rt.name) || 'firm template') + '…');
        const g = await repo.recordTemplateGet(tplKey.slice(3));
        if (g.error || !g.data) toast('Could not load that template. The project is blank');
        else {
          const applied = await applyAnswerSet(repo, idNew, g.data.payload || {}, name);
          if (!applied.ok) toast('Template partially applied (' + applied.failed + ' write' + (applied.failed === 1 ? '' : 's') + ' failed). Check the worksheet');
        }
      } else if (tplKey.startsWith('clone:')) {
        const srcId = tplKey.slice(6);
        const src = APP.projects.find((x) => x.id === srcId);
        toast('Cloning the standing structure of ' + ((src && src.name) || 'the record') + '…');
        const g = await repo.answersSubset(srcId, ['ctrl_org', 'ctrl_doctype', 'nfr', 'glossary']);
        if (g.error) toast('Could not read the source record. The project is blank');
        else {
          const applied = await applyAnswerSet(repo, idNew, buildTemplatePayload(g.data || { fields: {}, rows: {} }), name);
          if (!applied.ok) toast('Clone partially applied (' + applied.failed + ' write' + (applied.failed === 1 ? '' : 's') + ' failed). Check the worksheet');
        }
      } else if (tplKey !== 'blank') {
        const tpl = templateByKey(tplKey);
        if (tpl && tpl.openDoc) APP.openWithIntake = true;   // the practice start opens on the Document tab
        toast('Starting from ' + ((tpl && tpl.label) || 'template') + '…');
        const applied = await applyTemplate(repo, idNew, (tpl && tpl.base) || tplKey, name);
        if (!applied.ok) toast('Template partially applied (' + applied.failed + ' write' + (applied.failed === 1 ? '' : 's') + ' failed). Check the worksheet');
      }
      APP.newName = ''; APP.newTpl = 'blank'; APP.creating = false;
      openProject(idNew);
      break;
    }
    case 'open': e.stopPropagation(); openProject(t.dataset.id); break;
    case 'openappr': e.stopPropagation(); openProject(t.dataset.id, 'versions'); break;
    case 'del': {
      e.stopPropagation();
      const p = APP.projects.find((x) => x.id === t.dataset.id);
      if (p) { APP.delPending = { id: p.id, name: p.name }; APP.delError = null; render(); }
      break;
    }
    case 'delcancel': APP.delPending = null; APP.delError = null; render(); break;
    case 'delconfirm': {
      const want = (APP.delPending && APP.delPending.name) || '';
      if (val('delCode').trim() !== want.trim()) { APP.delError = 'Type the exact project name to confirm'; render(); break; }
      const idDel = APP.delPending.id;
      APP.delPending = null;
      await repo.archiveProject(idDel);
      APP.projects = APP.projects.filter((x) => x.id !== idDel);
      if (APP.pid === idDel) goHome(); else render();
      break;
    }

    /* workspace chrome */
    case 'home': goHome(); break;
    case 'toggledoc': APP.docShow = !APP.docShow; render(); break;
    case 'secto': APP.openSecs[t.dataset.val] = APP.openSecs[t.dataset.val] === false; render(); break;
    case 'tab': {
      APP.docTab = t.dataset.val; APP.docShow = true;
      if (APP.docTab === 'activity') APP.activityLog = await repo.activity(APP.pid);
      if (APP.docTab === 'updates') { APP.updatesList = await repo.updatesFor(APP.pid); render(); }
      if (APP.docTab === 'access') loadAccessData();
      if (APP.docTab === 'walkthrough' || APP.docTab === 'document') ensureWtUrls();
      if (APP.docTab === 'changes' || APP.docTab === 'document' || APP.docTab === 'summary') {
        const seq = APP.viewSeq != null ? APP.viewSeq : (APP.versions.length ? APP.versions[APP.versions.length - 1].seq : null);
        if (APP.docTab === 'changes' && seq != null) {
          const i = APP.versions.findIndex((v) => v.seq === seq);
          await ensureSnapshot(seq);
          if (i > 0) await ensureSnapshot(APP.versions[i - 1].seq);
        }
      }
      render();
      break;
    }
    case 'viewver': APP.viewSeq = +t.dataset.seq; APP.docTab = 'document'; await ensureSnapshot(APP.viewSeq); render(); break;
    case 'genopen': APP.genOpen = true; APP.gen = { major: false, note: '' }; render(); break;
    case 'genkind': APP.gen.major = t.dataset.val === 'major'; APP.gen.note = val('genNote'); render(); break;
    case 'genconfirm': APP.gen.note = val('genNote'); APP.gen.gate = val('genGate'); await generateVersion(); break;

    /* presentation mode */
    case 'present': APP.present = true; lastRevealedSec = null; await ensureWtUrls(); render(); break;
    case 'presentclose': APP.present = false; render(); break;

    /* share hub */
    case 'shareopen': closeModals(); APP.shareOpen = true; render(); break;
    case 'shr-team': closeModals(); APP.orgOpen = true; render(); loadOrgData('members'); break;
    case 'shr-partner': closeModals(); APP.docTab = 'access'; render(); loadAccessData(); break;
    case 'shr-pilot': {
      const link = await ensureShareLink('pilot');
      closeModals();
      if (!link) { toast('Could not create the link. Try again'); render(); break; }
      APP.docTab = 'access';
      render();
      loadAccessData();
      if (await copyText(link)) toast('Testing link copied. Send it to your tester');
      break;
    }

    /* brief sharing goes through the section picker */
    case 'shr-brief': case 'briefpickopen': {
      if (APP.role !== 'manager' || !APP.versions.length) break;
      closeModals();
      const latest = APP.versions[APP.versions.length - 1];
      const live = (APP.shares || []).find((s) => s.kind === 'brief' && s.version_seq === latest.seq && !s.revoked);
      APP.briefPick = (live && Array.isArray(live.sections) && live.sections.length)
        ? live.sections.slice() : briefSecsSaved(APP.pid);
      APP.briefPickOpen = true;
      render();
      break;
    }
    case 'briefpicktoggle': {
      const k = t.dataset.val;
      APP.briefPick = APP.briefPick.includes(k)
        ? APP.briefPick.filter((x) => x !== k) : APP.briefPick.concat([k]);
      render();
      break;
    }
    case 'briefpickconfirm': {
      const latest = APP.versions[APP.versions.length - 1];
      if (!latest || !APP.briefPick.length) break;
      const secs = APP.briefPick.slice();
      await ensureSnapshot(latest.seq);
      const answers = APP.snapshots[latest.seq]
        ? (APP.snapshots[latest.seq].snapshot.answers || assembleAnswers(APP.fields, APP.rows))
        : assembleAnswers(APP.fields, APP.rows);
      const live = (APP.shares || []).find((s) => s.kind === 'brief' && s.version_seq === latest.seq && !s.revoked);
      const r = await repo.sharePut(APP.pid, 'brief', latest.seq,
        buildSharePayload(APP.project || {}, answers, latest.label, latest.seq, 'brief', latest.build, secs,
          (APP.snapshots[latest.seq] && APP.snapshots[latest.seq].snapshot.walkthrough) || []),
        live ? live.token : null);
      if (r.error || !r.data) { toast('Could not publish. Try again'); break; }
      briefSecsStore(APP.pid, secs);
      APP.shares = await repo.sharesFor(APP.pid);
      closeModals();
      APP.docTab = 'access';
      render();
      loadAccessData();
      const link = location.origin + location.pathname + '#brief/' + APP.pid + '/' + latest.seq + '/' + r.data;
      if (await copyText(link)) toast('Review link copied - ' + secs.length + ' section' + (secs.length === 1 ? '' : 's') + ' shared');
      break;
    }

    /* workspace switcher */
    case 'wsmenu': closeModals(); APP.wsMenuOpen = true; render(); break;
    case 'wscreate': APP.wsCreating = true; render(); setTimeout(() => { const el = document.getElementById('wsName'); if (el) el.focus(); }, 30); break;
    case 'wscreatego': {
      const name = val('wsName').trim();
      if (!name) { toast('Name the workspace first'); break; }
      const r = await repo.createOrg(name);
      if (r.error) { toast('Could not create workspace'); break; }
      closeModals();
      APP.ctx = await repo.context();
      const m = (APP.ctx.memberships || []).find((x) => x.org_name === name) || (APP.ctx.memberships || [])[0];
      if (m) { sync.unsubscribeProject(); await enterOrg(m); toast('Workspace created. You are its first manager'); }
      break;
    }
    case 'shr-request': case 'accnewreq': closeModals(); APP.docTab = 'notes'; APP.reqDraft = { open: true }; render(); break;

    /* PRD brand logo (manager) */
    case 'brandpick': { const el = document.getElementById('brandFile'); if (el) el.click(); break; }
    case 'brandremove': {
      const r = await repo.setBrand(APP.pid, '', '');
      if (r.error) { toast('Could not remove the logo'); break; }
      if (APP.project) { APP.project.brand_logo = ''; APP.project.brand_label = ''; }
      await republishBrandedBriefs();
      toast('Logo removed');
      render();
      break;
    }
    case 'brandlabelsave': {
      const label = val('brandLabel').trim();
      const r = await repo.setBrand(APP.pid, (APP.project && APP.project.brand_logo) || '', label);
      if (r.error) { toast('Could not save'); break; }
      if (APP.project) APP.project.brand_label = label;
      await republishBrandedBriefs();
      toast('Saved');
      render();
      break;
    }

    /* read-only presentation link - copy handlers per role */
    case 'copypresent': {   // manager or viewer, from the app
      const link = await ensurePresentLink();
      if (!link) { toast(APP.role === 'manager' ? 'Generate a version first' : 'No public link yet. Ask a manager to share this PRD'); break; }
      if (await copyText(link)) toast('Read-only link copied. Anyone with it can view, not edit');
      break;
    }
    case 'smepresent': {   // SME, from their brief page. Reuse their own token
      const rt = APP.shareRoute;
      if (!rt || !rt.pid) { toast('Link unavailable'); break; }
      const link = presentUrl(rt.pid, rt.seq, rt.token);
      if (await copyText(link)) toast('Read-only link copied. Share it with anyone');
      break;
    }
    case 'ppresent': {   // partner, from the portal
      const r = await repo.partnerPresentToken(t.dataset.id);
      const out = r.data;
      if (!out || !out.ok) { toast('No shareable link yet. The team has not published a brief'); break; }
      const link = presentUrl(t.dataset.id, out.seq, out.token);
      if (await copyText(link)) toast('Read-only link copied. Share it with anyone');
      break;
    }

    /* print from an SME / partner / presentation page - uses the branded payload */
    case 'brandprint': {
      const pay = (APP.share && APP.share.payload) ||
        (APP.partnerProjects || []).find((x) => x.project_id === APP.partnerPid)?.payload;
      if (!pay) { toast('Nothing to print yet'); break; }
      const { bBrief } = await import('./domain.js');
      printDoc(bBrief(pay.answers || {}, pay.sections), {
        product: pay.product || 'Requirements', label: pay.label || '', status: 'approved',
        org: '', approvals: [], logo: pay.logo || '', brandLabel: pay.brandLabel || ''
      });
      break;
    }

    /* access hub: partners on this project */
    case 'accgrant': {
      if (APP.role !== 'manager') break;
      const had = t.dataset.has === '1';
      const r = had ? await repo.revokePartner(id, APP.pid) : await repo.grantPartner(id, APP.pid);
      if (r.error) { toast('Could not update access'); break; }
      toast(had ? 'Access revoked' : 'Access granted. They see the latest published brief');
      loadAccessData();
      break;
    }
    case 'accpadd': {
      const name = val('accPName').trim(), email = val('accPEmail').trim().toLowerCase();
      if (!email || !email.includes('@')) { toast('Enter a valid email'); break; }
      const r = await repo.addPartner(APP.orgId, email, name);
      if (r.error || !r.data) { toast('Could not add client contact'); break; }
      await repo.grantPartner(r.data.id, APP.pid);
      repo.sendInviteEmail(email, 'partner', APP.org, APP.user.email);
      toast('Client contact added with access to this project');
      loadAccessData();
      break;
    }
    case 'smeseat': {
      const name = val('smeName').trim(), email = val('smeEmail').trim().toLowerCase();
      if (!email || !email.includes('@')) { toast('Enter a valid email'); break; }
      const r = await repo.smeSeat(APP.pid, name, email);
      const out = r.data;
      if (r.error || !out || !out.ok) { toast('Could not create the SME workspace'); break; }
      const link = location.origin + location.pathname + '#sme/' + out.reply_token;
      await loadAccessData();
      if (await copyText(link)) toast(out.existed ? 'Existing link copied, same workspace as before' : 'SME workspace link copied, send it to ' + (out.name || email));
      else toast(out.existed ? 'Link ready below (already existed)' : 'SME workspace created. Copy the link below');
      break;
    }

    /* palette */
    case 'palette': openPalette(); break;
    case 'palclose': if (e.target === t) { APP.palOpen = false; render(); } break;
    case 'palgo': execPalette(+t.dataset.ix); break;
    case 'palnew': APP.palOpen = false; APP.view = 'projects'; render(); setTimeout(() => { const el = document.getElementById('newName'); if (el) el.focus(); }, 50); break;

    /* worksheet */
    case 'choice': {
      if (APP.role !== 'manager') break;
      const q = t.dataset.qid;
      const cur = APP.fields[q] && APP.fields[q].value;
      // Advancing the engagement phase offers, never performs, the authored
      // carryover: tag the done, untagged key results to the phase being
      // left, so they keep rendering under that tab. One click, all yours.
      if (q === 'ctrl_phase' && cur && t.dataset.val && cur !== t.dataset.val) {
        const n = tagDoneCandidates(APP.rows.okrs || []).length;
        APP.phaseTag = n ? { from: cur, n } : null;
      }
      sync.editField(q, cur === t.dataset.val ? '' : t.dataset.val);
      sync.flushNow();
      APP.activeQid = q;
      render();
      revealActiveSection(true);
      break;
    }
    case 'pasteopen': APP.pasteQ = { qid: t.dataset.qid, text: '', preview: null }; render(); break;
    case 'pastecancel': APP.pasteQ = null; render(); break;
    case 'pastepreview': {
      if (!APP.pasteQ) break;
      APP.pasteQ.text = val('pasteText');
      APP.pasteQ.preview = pasteToRows(APP.pasteQ.qid, APP.pasteQ.text);
      render();
      break;
    }
    case 'pasteapply': {
      const pq = APP.pasteQ;
      if (!pq || !pq.preview || !pq.preview.length) break;
      APP.pasteQ = null; render();
      let added = 0;
      for (const row of pq.preview) {
        const { ...data } = row;
        const r = await sync.addRow(pq.qid, data);
        if (r) added++;
      }
      noteRecent(pq.qid);
      toast(added === pq.preview.length ? 'Added ' + added + ' row' + (added === 1 ? '' : 's')
        : 'Added ' + added + ' of ' + pq.preview.length + ' rows. Check the section');
      break;
    }
    case 'kbclose': APP.kbHelp = false; render(); break;
    case 'jumpq': {
      closeModals();
      // The jump lands in whichever lens holds the question, and opens its
      // section, so a source-map click always arrives somewhere visible.
      const jq = qById[t.dataset.id];
      if (jq) {
        const need = (jq.sec === 'okrs' || jq.sec === 'updates') ? 'delivery' : jq.sec === 'control' ? (APP.lens || 'spec') : 'spec';
        APP.lens = need;
        (APP.openSecs = APP.openSecs || {})[jq.sec] = true;
      }
      render();
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-q="' + CSS.escape(t.dataset.id) + '"]');
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('kb-focus'); setTimeout(() => el.classList.remove('kb-focus'), 1200); }
      });
      break;
    }
    case 'tplsaveopen': APP.tplSave = { name: '' }; render(); break;
    case 'tplsavecancel': APP.tplSave = null; render(); break;
    case 'tplsaveconfirm': {
      const name = val('tplName').trim();
      if (!name) { APP.tplSave.error = 'Name the template'; render(); break; }
      const payload = buildTemplatePayload({ fields: APP.fields, rows: APP.rows });
      const r = await repo.recordTemplateSave(APP.orgId, name, payload);
      if (r.error || !r.data || !r.data.ok) { APP.tplSave.error = 'Could not save the template'; render(); break; }
      APP.tplSave = null;
      toast('Template saved. It appears on the New project screen with today as its reviewed date');
      render();
      break;
    }
    case 'addrow': {
      if (APP.role !== 'manager') break;
      if (t.dataset.qid === 'updates') {
        const chosen = val('updates-addphase');
        const letter = PHASE_LETTER[chosen] || phaseLetter(assembleAnswers(APP.fields, APP.rows));
        const r = await repo.updatesNextId(APP.pid, letter);
        if (r.error || !r.data || !r.data.ok || !r.data.id) { toast('Could not allocate a row ID. Try again'); break; }
        await sync.addRow('updates', { _uid: r.data.id });
        break;
      }
      await sync.addRow(t.dataset.qid, {});
      break;
    }
    case 'delrow': {
      if (APP.role !== 'manager') break;
      await sync.removeRow(t.dataset.qid, t.dataset.rowid);
      break;
    }
    case 'suggestfit': {
      const rows = APP.rows[t.dataset.qid] || [];
      const row = rows.find((r) => r.id === t.dataset.rowid);
      if (row && row.data.stmt) { sync.editRow(t.dataset.qid, row.id, { fit: suggestFit(row.data.stmt) }); sync.flushNow(); render(); }
      break;
    }

    /* exports */
    case 'copymd': { const d = docNow(); if (await copyMarkdown(d.md)) toast('Markdown copied'); break; }
    case 'downloadmd': { const d = docNow(); downloadMarkdown(d.md, docMeta(d)); break; }
    case 'word': {
      const d = docNow();
      const meta = docMeta(d);
      const shots = docShotsOf(APP);
      if (shots.length) {
        toast('Preparing walkthrough images…');
        await ensureWtUrls();
        meta.walkthrough = await Promise.all(shots.map(async (f) => ({
          n: f.n, caption: f.caption || '', file_name: f.file_name || '',
          dataUrl: await wtEmbedDataUrl(APP.wtUrls[f.attachment_id])
        })));
      }
      downloadWord(d.md, meta);
      break;
    }
    case 'print': { const d = docNow(); printDoc(d.md, docMeta(d)); break; }
    case 'execdl': {
      const a = APP.viewSeq != null && APP.snapshots[APP.viewSeq] ? (APP.snapshots[APP.viewSeq].snapshot.answers || {}) : assembleAnswers(APP.fields, APP.rows);
      downloadExecSummary(a, { label: docNow().label });
      break;
    }
    /* Client baseline report: produced only from a stored baseline, never the
       working draft, because the fingerprint on its cover must identify an
       exact immutable snapshot. Client-safe content comes through the SAME
       payload builder the share system uses, so the share-scoping boundary is
       the content boundary: fit criteria, schedules, and internal notes are
       absent, not hidden. */
    case 'gatepacket': {
      // The SteerCo artifact: gate name, criteria state at baseline, per-column
      // changes since the prior baseline, approvals, fingerprint. When the
      // committee decides on this, the gate decision lives in the record.
      if (!APP.versions.length) { toast('Generate a version first. The gate packet is produced from a baseline'); break; }
      const seq = APP.viewSeq != null ? APP.viewSeq : APP.versions[APP.versions.length - 1].seq;
      await ensureSnapshot(seq);
      const snap = APP.snapshots[seq];
      if (!snap) { toast('Could not load that baseline. Try again'); break; }
      const idx = APP.versions.findIndex((x) => x.seq === seq);
      const prevMeta = idx > 0 ? APP.versions[idx - 1] : null;
      if (prevMeta) await ensureSnapshot(prevMeta.seq);
      const prevSnap = prevMeta ? APP.snapshots[prevMeta.seq] : null;
      const v = APP.versions[idx];
      const fingerprint = await versionFingerprint(snap);
      const ap = v ? (APP.approvals[v.id] || []) : [];
      const answers = snap.snapshot.answers || {};
      printGatePacket({
        product: answers.ctrl_product || (APP.project && APP.project.name) || 'Untitled',
        org: answers.ctrl_org || '', label: snap.label, status: v ? v.status : snap.status,
        eyebrow: snap.snapshot.gate || undefined,
        snapHealth: Array.isArray(snap.snapshot.health) ? snap.snapshot.health : undefined,
        baselined: (v && v.created_at) || snap.created_at || '',
        approvedAt: (v && v.status === 'approved') ? (ap.filter((x) => x.status === 'approved' && x.decided_at).map((x) => x.decided_at).sort().pop() || '') : '',
        approvals: ap, fingerprint,
        logo: (APP.project && APP.project.brand_logo) || '',
        brandLabel: (APP.project && APP.project.brand_label) || ''
      }, answers, prevSnap ? (prevSnap.snapshot.answers || null) : null, prevMeta ? prevMeta.label : '');
      break;
    }
    case 'implpkg': {
      // The builders' counterpart to the client baseline report: one click on
      // a stored baseline produces the spec bundle, sealed to the SAME
      // fingerprint the client report carries - the document the client
      // signed and the package the builders received are provably the same
      // baseline. STORE-only zip, zero dependencies, deterministic bytes.
      if (!APP.versions.length) { toast('Generate a version first. The implementation package is produced from a baseline'); break; }
      const seq = APP.viewSeq != null ? APP.viewSeq : APP.versions[APP.versions.length - 1].seq;
      await ensureSnapshot(seq);
      const snap = APP.snapshots[seq];
      if (!snap) { toast('Could not load that baseline. Try again'); break; }
      const idx = APP.versions.findIndex((x) => x.seq === seq);
      const prevMeta = idx > 0 ? APP.versions[idx - 1] : null;
      if (prevMeta) await ensureSnapshot(prevMeta.seq);
      const prevSnap = prevMeta ? APP.snapshots[prevMeta.seq] : null;
      const v = APP.versions[idx];
      const fingerprint = await versionFingerprint(snap);
      const ap = v ? (APP.approvals[v.id] || []) : [];
      const answers = snap.snapshot.answers || {};
      const product = answers.ctrl_product || (APP.project && APP.project.name) || 'Untitled';
      const files = buildImplementationFiles({
        product, label: snap.label, seq, status: v ? v.status : snap.status, gate: snap.snapshot.gate || undefined,
        note: (v && v.note) || snap.note || '', author: (v && v.author_name) || snap.author_name || '',
        baselined: (v && v.created_at) || snap.created_at || '',
        approvedAt: (v && v.status === 'approved') ? (ap.filter((x) => x.status === 'approved' && x.decided_at).map((x) => x.decided_at).sort().pop() || '') : '',
        fingerprint, answers, approvals: ap,
        prevAnswers: prevSnap ? (prevSnap.snapshot.answers || null) : null,
        prevLabel: prevMeta ? prevMeta.label : '',
        versions: APP.versions.filter((x) => x.seq <= seq)
      });
      download(fileStem({ product, label: snap.label }) + '-implementation.zip', 'application/zip',
        zipStore(files.map((f) => ({ name: f.name, data: f.text })), (v && v.created_at) || snap.created_at || new Date()));
      toast('Implementation package downloaded. Same fingerprint as the client report');
      break;
    }
    /* The verification bundle: {label, seq, snapshot} plus the fingerprint,
       one self-verifying JSON file. The verify page, the offline CLI, and
       docs/VERIFY.md all check it independently of this app. */
    case 'verbundle': {
      if (!APP.versions.length) { toast('Generate a version first. The bundle is produced from a baseline'); break; }
      const seq = APP.viewSeq != null ? APP.viewSeq : APP.versions[APP.versions.length - 1].seq;
      await ensureSnapshot(seq);
      const snap = APP.snapshots[seq];
      if (!snap) { toast('Could not load that baseline. Try again'); break; }
      const answers = snap.snapshot.answers || {};
      const product = answers.ctrl_product || (APP.project && APP.project.name) || 'Untitled';
      const text = await buildVerifyBundle(snap, { product });
      download(fileStem({ product, label: snap.label }) + '-baseline.reqpub.json', 'application/json', text);
      toast('Verification bundle downloaded. Check it at /verify.html or with tools/reqpub-verify.mjs');
      break;
    }
    case 'sowexhibit': {
      if (!APP.versions.length) { toast('Generate a version first. The exhibit is produced from a baseline'); break; }
      const seq = APP.viewSeq != null ? APP.viewSeq : APP.versions[APP.versions.length - 1].seq;
      await ensureSnapshot(seq);
      const snap = APP.snapshots[seq];
      if (!snap) { toast('Could not load that baseline. Try again'); break; }
      const answers = snap.snapshot.answers || {};
      const fingerprint = await versionFingerprint(snap);
      const v = APP.versions.find((x) => x.seq === seq);
      printSowExhibit({
        product: answers.ctrl_product || (APP.project && APP.project.name) || 'Untitled',
        org: answers.ctrl_org || '', label: snap.label, status: v ? v.status : snap.status,
        baselined: (v && v.created_at) || snap.created_at || '',
        approvals: v ? (APP.approvals[v.id] || []) : [],
        logo: (APP.project && APP.project.brand_logo) || '',
        brandLabel: (APP.project && APP.project.brand_label) || '',
        fingerprint
      }, answers);
      break;
    }
    case 'clientprint': {
      if (!APP.versions.length) { toast('Generate a version first. The client report is produced from a baseline'); break; }
      const seq = APP.viewSeq != null ? APP.viewSeq : APP.versions[APP.versions.length - 1].seq;
      await ensureSnapshot(seq);
      const snap = APP.snapshots[seq];
      if (!snap) { toast('Could not load that baseline. Try again'); break; }
      const answers = snap.snapshot.answers || {};
      const fingerprint = await versionFingerprint(snap);
      const v = APP.versions.find((x) => x.seq === seq);
      const pay = buildSharePayload(APP.project || {}, answers, snap.label, seq, 'brief', v ? v.build : '', defaultBriefSections(), (snap.snapshot && snap.snapshot.walkthrough) || []);
      const present = (APP.shares || []).find((s) => s.kind === 'present' && !s.revoked && s.version_seq === seq);
      printClientDoc(answers, {
        product: answers.ctrl_product || (APP.project && APP.project.name) || 'Untitled',
        org: answers.ctrl_org || '', label: snap.label, status: v ? v.status : snap.status,
        eyebrow: snap.snapshot.gate || undefined,
        snapHealth: Array.isArray(snap.snapshot.health) ? snap.snapshot.health : undefined,
        baselined: (v && v.created_at) || snap.created_at || '',
        approvedAt: (() => { const ap = v ? (APP.approvals[v.id] || []) : []; return (v && v.status === 'approved') ? (ap.filter((x) => x.status === 'approved' && x.decided_at).map((x) => x.decided_at).sort().pop() || '') : ''; })(),
        record: (() => {
          const upTo = APP.versions.filter((x) => x.seq <= seq);
          let signoffs = 0;
          upTo.forEach((x) => { signoffs += (APP.approvals[x.id] || []).filter((d) => d.status === 'approved').length; });
          return { versions: upTo.length, signoffs, incorporated: incorporatedRows(answers) };
        })(),
        approvals: v ? (APP.approvals[v.id] || []) : [],
        logo: (APP.project && APP.project.brand_logo) || '',
        brandLabel: (APP.project && APP.project.brand_label) || '',
        fingerprint, presentLink: present ? presentUrl(APP.pid, seq, present.token) : ''
      }, pay.answers, pay.sections, APP.versions.filter((x) => x.seq <= seq));
      break;
    }
    /* Compute, copy, and display a baseline fingerprint from its stored
       snapshot: SHA-256 over canonical JSON of {label, seq, snapshot}. */
    case 'vfinger': {
      const seq = +t.dataset.seq;
      await ensureSnapshot(seq);
      const snap = APP.snapshots[seq];
      if (!snap) { toast('Could not load that baseline. Try again'); break; }
      const hex = await versionFingerprint(snap);
      (APP.fingers = APP.fingers || {})[t.dataset.id] = hex;
      if (await copyText(hex)) toast('Fingerprint copied');
      render();
      break;
    }

    /* inbox / comms */
    case 'commtoggle': {
      APP.openComms[id] = !APP.openComms[id];
      const comm = APP.comms.find((c) => c.id === id);
      if (APP.openComms[id] && comm) {
        // Opening a thread clears both my personal unread and the team-level
        // "new reply" flag (team_seen_at), for everyone.
        APP.reads[id] = true;
        comm.team_seen_at = new Date().toISOString();
        repo.commSeen(id);
      }
      render();
      break;
    }
    case 'ibreadall': {
      const now = new Date().toISOString();
      APP.comms.forEach((c) => {
        const unseen = c.last_ext_at && (!c.team_seen_at || new Date(c.team_seen_at) < new Date(c.last_ext_at));
        if (!APP.reads[c.id] || unseen) {
          APP.reads[c.id] = true;
          if (unseen) c.team_seen_at = now;
          repo.commSeen(c.id);
        }
      });
      render();
      break;
    }
    case 'ibsrc': APP.inboxFilter.src = t.dataset.val; render(); break;
    case 'ibstatus': APP.inboxFilter.status = t.dataset.val; render(); break;
    case 'reply': {
      const body = (APP.drafts[id] || '').trim();
      if (!body) break;
      const r = await repo.addMessage(APP.orgId, 'comm', id, body, (APP.ctx && APP.ctx.display_name) || 'Team', APP.user.id);
      if (r.error) { toast('Reply failed. Try again'); break; }
      delete APP.drafts[id];
      // Idempotent: the realtime echo of this insert can arrive before this
      // await resolves. Push only if not already present (same dedup as sync.js)
      // so the reply cannot appear twice in the thread.
      pushUnique(APP.msgs[id] = APP.msgs[id] || [], r.data);
      render();
      break;
    }
    case 'wtup':
    case 'wtdown': {
      const r = await repo.wtMove(id, a === 'wtup' ? -1 : 1);
      if (r.error || !(r.data && r.data.ok)) { toast('Could not reorder. Try again'); break; }
      APP.walkthrough = await repo.walkthroughFor(APP.pid);
      render();
      break;
    }
    case 'wtdel': {
      const r = await repo.wtRemove(id);
      if (r.error || !(r.data && r.data.ok)) { toast('Could not remove that shot. Try again'); break; }
      APP.walkthrough = await repo.walkthroughFor(APP.pid);
      toast('Removed. The file itself stays on the Files list');
      render();
      break;
    }
    case 'dlattach': {
      // C1-006: a file is served only when the scan says clean. The interface
      // already marked an infected file as blocked, but marking is not
      // refusing, and this handler used to mint a signed URL for whatever path
      // the markup carried. The status is checked here, and again against the
      // loaded attachment record rather than the markup alone, because markup
      // is the one input a person can edit.
      const path = t.dataset.path;
      const known = Object.values(APP.attach || {}).flat().find((a) => a && a.storage_path === path);
      const scan = (known && known.scan_status) || t.dataset.scan || 'unscanned';
      if (scan === 'infected') { toast('That file was flagged by the scanner and cannot be opened'); break; }
      if (scan === 'error') { toast('The scanner could not check that file, so it stays closed'); break; }
      if (scan !== 'clean') { toast('That file is still being scanned. Try again shortly'); break; }
      const url = await repo.signedUrl(path);
      if (url) window.open(url, '_blank', 'noopener'); else toast('Could not open that file. Try again');
      break;
    }
    case 'attverify': {
      // Re-download, re-hash server-side, compare to the stored digest.
      const r = await repo.verifyAttachment(t.dataset.id);
      if (r.error || !(r.data && r.data.ok)) { toast(r.error && r.error.message ? r.error.message : 'Could not verify. Try again'); break; }
      toast(r.data.match
        ? 'Verified. The stored bytes match the recorded digest'
        : 'MISMATCH. The stored bytes do not match the recorded digest. Stored ' + String(r.data.stored).slice(0, 10) + '…, computed ' + String(r.data.computed).slice(0, 10) + '…');
      break;
    }
    case 'atthashall': {
      // Page through files that predate hashing until none remain. Stops
      // honestly when a page makes no progress (e.g. missing objects).
      let hashed = 0, failed = 0, guard = 0;
      toast('Hashing existing files…');
      for (;;) {
        const r = await repo.backfillAttachmentHashes(APP.pid);
        if (r.error || !(r.data && r.data.ok)) { toast(r.error && r.error.message ? r.error.message : 'Backfill failed. Try again'); break; }
        hashed += r.data.hashed || 0; failed += r.data.failed || 0;
        if (!r.data.remaining || r.data.hashed === 0 || ++guard > 40) break;
      }
      APP.attachments = await repo.attachmentsFor(APP.pid);
      render();
      toast(failed
        ? 'Hashed ' + hashed + ', could not read ' + failed + '. Those rows keep an empty digest'
        : 'Hashed ' + hashed + ' file' + (hashed === 1 ? '' : 's') + '. Each marked hashed-after-upload');
      break;
    }
    case 'mcpissue': {
      const label = (document.getElementById('mcpLabel') || {}).value || '';
      const propose = !!((document.getElementById('mcpPropose') || {}).checked);
      if (!label.trim()) { toast('A key needs a label.'); break; }
      const r = await repo.mcpKeyIssue(APP.orgId, label.trim(), propose);
      if (!(r.data && r.data.ok)) { toast('Could not issue the key: ' + ((r.data && r.data.error) || 'request failed')); break; }
      APP.mcpNewKey = { key: r.data.key, label: label.trim() };
      const list = await repo.mcpKeysList(APP.orgId);
      APP.mcpKeys = (list.data && list.data.rows) || APP.mcpKeys;
      render(); toast('Key issued. Copy it now; it is shown once.');
      break;
    }
    case 'mcpcopykey': {
      if (APP.mcpNewKey) { try { await navigator.clipboard.writeText(APP.mcpNewKey.key); toast('Key copied.'); } catch { toast('Copy failed; select the key text and copy it.'); } }
      break;
    }
    case 'mcprevoke': {
      const r = await repo.mcpKeyRevoke(t.dataset.id);
      if (!(r.data && r.data.ok)) { toast('Could not revoke: ' + ((r.data && r.data.error) || 'request failed')); break; }
      const list = await repo.mcpKeysList(APP.orgId);
      APP.mcpKeys = (list.data && list.data.rows) || APP.mcpKeys;
      render(); toast('Key revoked. Calls with it now fail.');
      break;
    }
    case 'mcpproposetoggle': {
      const cur = APP.fields && APP.fields.ctrl_mcp_propose;
      const next = cur && cur.value === 'on' ? 'off' : 'on';
      const r = await repo.saveField(APP.pid, 'ctrl_mcp_propose', next, cur ? cur.rev : 0);
      if (!(r.data && r.data.ok)) { toast('Could not change the setting: ' + ((r.data && r.data.error) || 'request failed')); break; }
      APP.fields.ctrl_mcp_propose = { value: next, rev: (r.data.rev || ((cur ? cur.rev : 0) + 1)) };
      render(); toast(next === 'on' ? 'Agent proposals are on for this project.' : 'Agent proposals are off for this project.');
      break;
    }
    case 'mcpcheck': {
      const r = await repo.mcpPing();
      toast(r.reachable ? 'The MCP endpoint is deployed and answering.' : 'No answer from the MCP endpoint. Deploy the mcp function per DEPLOY.md.');
      break;
    }
        case 'whadd': {
      const url = val('whUrl').trim(); const desc = val('whDesc').trim();
      if (!/^https:\/\/\S+$/.test(url)) { toast('Endpoint URLs must be https'); break; }
      const r = await repo.whCreate(APP.pid, url, desc);
      if (!(r.data && r.data.ok)) { toast('Could not add: ' + ((r.data && r.data.error) || (r.error && r.error.message) || 'failed')); break; }
      APP.whEndpoints = await repo.whEndpoints(APP.pid);
      render(); toast('Endpoint added. Deliveries start with the next configured event');
      break;
    }
    case 'whtoggle': {
      const on = t.dataset.val === '1';
      const r = await repo.whSetActive(id, on);
      if (!(r.data && r.data.ok)) { toast('Could not update the endpoint'); break; }
      APP.whEndpoints = await repo.whEndpoints(APP.pid);
      render(); toast(on ? 'Endpoint resumed' : 'Endpoint paused. Queued deliveries wait');
      break;
    }
    case 'whredeliver': {
      const r = await repo.whRedeliver(id);
      if (!(r.data && r.data.ok)) { toast('Not redeliverable'); break; }
      toast('Redelivering\u2026');
      await pingDeliveries([id]);
      const l = await repo.whDeliveries(APP.pid);
      APP.whDeliveries = (l.data && l.data.rows) || [];
      render();
      break;
    }
    case 'whdeliver': {
      const d = await repo.whDue(APP.pid);
      const ids = (d.data && d.data.ids) || [];
      if (!ids.length) { toast('Nothing is due'); break; }
      toast('Attempting ' + ids.length + ' deliver' + (ids.length === 1 ? 'y' : 'ies') + '\u2026');
      const sent = await pingDeliveries(ids);
      const l = await repo.whDeliveries(APP.pid);
      APP.whDeliveries = (l.data && l.data.rows) || [];
      render();
      toast(sent === ids.length ? 'Delivered ' + sent + ' of ' + ids.length
        : sent + ' of ' + ids.length + ' delivered. The rest wait on the retry ladder');
      break;
    }
    case 'commstatus': break; // handled on change event
    case 'promdisc': {
      const c = APP.comms.find((x) => x.id === id);
      if (!c) break;
      const cbody = c.body || '';
      await repo.addDiscovery({
        org_id: APP.orgId, project_id: APP.pid, takeaway: c.title || cbody.slice(0, 120) || '(no text)',
        notes: cbody, who: c.author_name, source: 'Promoted from ' + c.origin, author_name: (APP.ctx && APP.ctx.display_name) || '',
        version_seq: c.version_seq != null ? c.version_seq : baselineSeq()
      });
      await repo.setCommFields(id, { promoted_to: 'discovery' });
      c.promoted_to = 'discovery';
      toast('Added to discovery');
      render();
      break;
    }
    case 'promreq': {
      const c = APP.comms.find((x) => x.id === id);
      if (!c) break;
      // `src` travels in the row data (never in share payloads, which map FR
      // rows to {stmt, comp} only) so the next version note can attribute the
      // addition to the input that caused it. See changeNote in domain.js.
      const from = ({ team: 'Notes', meeting: 'Notes' })[c.origin] || 'Inbox';
      const row = await sync.addRow('fr', {
        stmt: (c.body || c.title || '').slice(0, 500), fit: '', pri: 'Should', comp: '',
        src: from + (c.author_name ? ' · ' + c.author_name : '')
      });
      if (row) {
        const rid = 'FR-' + String(row.k).padStart(3, '0');
        await repo.setCommFields(id, { promoted_to: rid });
        c.promoted_to = rid;
        toast('Created ' + rid + '. Refine it in Section 7');
        render();
      }
      break;
    }
    /* discovery: one-click promotion into the numbered record. Same pattern
       as the inbox (back-link on the source, src on the created row), so the
       relay loop - input, discovery, requirement or decision - stays on the
       record end to end. */
    case 'discfr': {
      const e = APP.discovery.find((x) => x.id === id);
      if (!e) break;
      const row = await sync.addRow('fr', {
        stmt: (e.takeaway || e.notes || '').slice(0, 500), fit: '', pri: 'Should', comp: '',
        src: 'Discovery' + (e.who ? ' · ' + e.who : '')
      });
      if (row) {
        const rid = 'FR-' + String(row.k).padStart(3, '0');
        await repo.updateDiscovery(id, { promoted_to: rid });
        e.promoted_to = rid;
        toast('Created ' + rid + '. Refine it in Section 7');
        render();
      }
      break;
    }
    case 'discdec': {
      const e = APP.discovery.find((x) => x.id === id);
      if (!e) break;
      const row = await sync.addRow('decisions', {
        decision: (e.takeaway || '').slice(0, 500), options: '', rationale: e.notes || '',
        owner: e.who || '', date: new Date().toISOString().slice(0, 7), supersedes: '',
        src: 'Discovery' + (e.who ? ' · ' + e.who : '')
      });
      if (row) {
        const did = 'DEC-' + String(row.k).padStart(3, '0');
        await repo.updateDiscovery(id, { promoted_to: did });
        e.promoted_to = did;
        toast('Created ' + did + '. Refine it under Decisions and Rationale');
        render();
      }
      break;
    }

    /* feedback tab */
    case 'copylink': if (await copyText(t.dataset.link)) toast('Link copied'); break;
    case 'sharepub': {
      const kind = t.dataset.kind, seq = +t.dataset.seq;
      const answers = assembleAnswers(APP.fields, APP.rows);
      const v = APP.versions.find((x) => x.seq === seq);
      await ensureSnapshot(seq);
      const snapAns = APP.snapshots[seq] ? (APP.snapshots[seq].snapshot.answers || answers) : answers;
      const r = await repo.sharePut(APP.pid, kind, seq, buildSharePayload(APP.project || {}, snapAns, v ? v.label : '', seq, kind, v ? v.build : ''));
      if (r.error || !r.data) { toast('Could not create link'); break; }
      APP.shares = await repo.sharesFor(APP.pid);
      toast('Link created');
      render();
      break;
    }
    case 'sharerevoke': {
      await repo.shareRevoke(t.dataset.token);
      APP.shares = await repo.sharesFor(APP.pid);
      toast('Link revoked');
      render();
      break;
    }

    /* notes & requests */
    case 'noteadd': {
      const body = (APP.noteDraft || '').trim();
      if (!body) break;
      const origin = APP.noteSrc;
      const r = await repo.addComm({
        org_id: APP.orgId, project_id: APP.pid, origin,
        author_name: origin === 'team' ? ((APP.ctx && APP.ctx.display_name) || 'Team') : (APP.noteBy || (origin === 'sme' ? 'SME' : 'Meeting')),
        author_user: APP.user.id, title: origin === 'team' ? 'Note' : origin === 'sme' ? 'SME note' : 'Meeting note',
        body, status: 'new', version_seq: baselineSeq()
      });
      if (r.error) { toast('Could not save note'); break; }
      if (!APP.comms.some((c) => c.id === r.data.id)) APP.comms.unshift(r.data);
      APP.noteDraft = '';
      render();
      break;
    }
    case 'notesrc': APP.noteSrc = t.dataset.val; render(); break;
    case 'nropen': APP.reqDraft = { open: true }; render(); break;
    case 'nrcancel': APP.reqDraft = {}; render(); break;
    case 'nrtpl': {
      const NRTPL = [
        'Before we spec this, what are the must-haves, the non-negotiables, and the landmines you have seen in your domain?',
        'Please review the summary and tell us what is missing, what is wrong, and what you would add.',
        'What edge cases, risks, or failure modes should the requirements be sure to cover?'];
      APP.reqDraft.prompt = NRTPL[+t.dataset.ix] || '';
      render();
      break;
    }
    case 'nrsave': {
      const d = APP.reqDraft;
      if (!d.title || !d.title.trim()) { d.error = 'Add a title'; render(); break; }
      const r = await repo.addRequest({
        org_id: APP.orgId, project_id: APP.pid, title: d.title.trim(),
        prompt: (d.prompt || '').trim(), author_name: (APP.ctx && APP.ctx.display_name) || '',
        due: d.due || null
      });
      if (r.error) { d.error = 'Could not create'; render(); break; }
      if (!APP.requests.some((x) => x.id === r.data.id)) APP.requests.unshift(r.data);
      APP.reqDraft = {};
      toast('Request created. Copy its link below');
      render();
      break;
    }
    case 'nrclose': {
      const req = APP.requests.find((x) => x.id === id);
      if (!req) break;
      const status = req.status === 'closed' ? 'open' : 'closed';
      await repo.setRequestStatus(id, status);
      req.status = status;
      render();
      break;
    }
    case 'nrdelete': {
      if (APP.reqDel !== id) { APP.reqDel = id; render(); break; }
      await repo.deleteRequest(id);
      APP.requests = APP.requests.filter((x) => x.id !== id);
      APP.reqDel = null;
      render();
      break;
    }

    /* discovery */
    case 'discadd': {
      const d = APP.discDraft;
      if (!d.takeaway || !d.takeaway.trim()) { toast('Add the takeaway first'); break; }
      const r = await repo.addDiscovery({
        org_id: APP.orgId, project_id: APP.pid, takeaway: d.takeaway.trim(),
        notes: (d.notes || '').trim(), who: (d.who || '').trim(), source: (d.source || '').trim(),
        tags: (d.tags || '').trim(), author_name: (APP.ctx && APP.ctx.display_name) || '',
        version_seq: baselineSeq()
      });
      if (r.error) { toast('Could not add entry'); break; }
      if (!APP.discovery.some((x) => x.id === r.data.id)) APP.discovery.unshift(r.data);
      APP.discDraft = {};
      render();
      break;
    }
    case 'disctoggle': APP.openDisc[id] = !APP.openDisc[id]; render(); break;
    case 'discdel': {
      if (APP.discDel !== id) { APP.discDel = id; render(); break; }
      await repo.deleteDiscovery(id);
      APP.discovery = APP.discovery.filter((x) => x.id !== id);
      APP.discDel = null;
      render();
      break;
    }
    case 'peoplejump': APP.docTab = 'inbox'; APP.inboxFilter = { src: 'all', status: 'all', q: t.dataset.q }; render(); break;

    /* versions & approvals */
    case 'cardapprove': {
      // One-click Approve from the dashboard card. Drives the latest version all
      // the way to Approved, stepping through In review as needed, so a manager
      // never has to open Version history just to clear "Draft".
      e.stopPropagation();
      const s = APP.projectStats && APP.projectStats[id];
      const v = s && s.latest;
      if (!v || !v.id) { toast('Generate a version first, then approve it'); break; }
      const path = ({ draft: ['in_review', 'approved'], changes_requested: ['in_review', 'approved'], in_review: ['approved'] })[v.status] || [];
      if (!path.length) break;
      for (const next of path) {
        const rr = await repo.setVersionStatus(v.id, next);
        const out = rr && rr.data;
        if (!(out && out.ok)) {
          toast(out && out.error === 'approvals_pending'
            ? 'Named approvers are still pending. Open the PRD’s Version history to decide them'
            : 'Could not approve this version');
          break;
        }
        v.status = next;
      }
      if (v.status === 'approved') toast('Approved. V' + v.label + ' is now the approved baseline');
      scheduleRender('stats');
      break;
    }
    case 'vstatus': {
      const r = await repo.setVersionStatus(id, t.dataset.val);
      const out = r.data;
      if (out && out.ok) {
        const v = APP.versions.find((x) => x.id === id);
        if (v) v.status = t.dataset.val;
        toast('Status updated');
      } else toast(out && out.error === 'approvals_pending' ? 'Approvals are still pending. Decide them first' : 'Could not change status');
      render();
      break;
    }
    /* ---- intake: populate a blank record from documents ---- */
    case 'intakeopen': APP.intake = { open: true, files: [], text: '', plan: null, include: [], targets: [] }; render(); break;
    case 'intakeclose': APP.intake = null; render(); break;
    case 'intakefiledel': {
      if (!APP.intake) break;
      APP.intake.files.splice(+t.dataset.i, 1);
      APP.intake.plan = null;   // a changed artifact set always re-previews
      render();
      break;
    }
    case 'intakepreview': {
      const it = APP.intake; if (!it) break;
      const arts = [...it.files];
      if ((it.text || '').trim()) arts.push({ name: 'pasted text', text: it.text });
      if (!arts.length) { toast('Paste some text or add a file first'); break; }
      it.plan = mapArtifacts(arts);
      it.include = it.plan.placements.map(() => true);
      it.targets = it.plan.unplaced.map(() => '');
      if (!it.plan.placements.length && !it.plan.unplaced.length) toast('Nothing readable found in those documents');
      render();
      break;
    }
    case 'intakeapply': {
      const it = APP.intake; if (!it || !it.plan || it.busy) break;
      const sel = it.plan.placements.filter((p, i) => it.include[i]);
      const a = assembleAnswers(APP.fields, APP.rows);
      const { ops, kept } = applyPlan(sel, a);
      // Unplaced items the user assigned: append to the chosen long field,
      // chaining when several land in the same target - appending, never
      // replacing, so the never-overwrite rule holds here too.
      const acc = {};
      it.plan.unplaced.forEach((u, i) => {
        const tgt = it.targets[i]; if (!tgt) return;
        const base = acc[tgt] != null ? acc[tgt] : String(a[tgt] || '').trim();
        acc[tgt] = base ? base + '\n\n' + u.body : u.body;
      });
      Object.entries(acc).forEach(([qid, value]) => ops.push({ kind: 'field', qid, value }));
      ops.forEach((op) => { if (op.kind === 'field') op.baseRev = (APP.fields[op.qid] && APP.fields[op.qid].rev) || 0; });
      if (!ops.length) {
        toast(kept.length ? 'Nothing to apply. The matched fields already have content, which intake never overwrites' : 'Nothing selected to apply');
        break;
      }
      it.busy = true; it.done = 0; it.total = ops.length; render();
      const out = await executeOps(repo, APP.pid, ops, (d) => { it.done = d; render(); });
      const parts = [];
      if (out.fields) parts.push(out.fields + (out.fields === 1 ? ' answer' : ' answers'));
      if (out.rows) parts.push(out.rows + (out.rows === 1 ? ' row' : ' rows'));
      let msg = 'Populated ' + (parts.join(' and ') || 'nothing');
      if (kept.length) msg += ' · kept ' + kept.length + ' existing answer' + (kept.length === 1 ? '' : 's') + ' untouched';
      if (out.failed) msg += ' · ' + out.failed + ' write' + (out.failed === 1 ? '' : 's') + ' failed';
      toast(msg);
      await openProject(APP.pid, 'document');
      break;
    }
    /* ---- e-sign v1: team side ---- */
    case 'signsend': {
      if (APP.signSendBusy) break;
      const vid = t.dataset.id, seq = +t.dataset.seq;
      const email = val('sig-email-' + vid).trim();
      const name = val('sig-name-' + vid).trim();
      const role = val('sig-role-' + vid).trim();
      if (!email) { toast('Enter the signer\u2019s email'); break; }
      APP.signSendBusy = true; render();
      try {
        await ensureSnapshot(seq);
        const snap = APP.snapshots[seq];
        const fp = snap ? await versionFingerprint(snap) : '';
        const r = await repo.signCreate(vid, email, name, role, fp);
        const out = r.data;
        if (!out || !out.ok) { toast(out && out.error === 'forbidden' ? 'Only a manager can request signatures' : 'Could not create the signature request'); break; }
        const link = location.origin + location.pathname + '#sign/' + out.token;
        let mailed = false;
        try { const m = await repo.sendSignEmail(out.id); mailed = !(m && m.error); } catch { mailed = false; }
        try { await copyText(link); } catch { /* clipboard denied */ }
        toast(mailed ? 'Signature request emailed, link also copied' : 'Request created and link copied, email delivery is not configured, send the link yourself');
        APP.signs = await repo.signsFor(APP.pid); APP.receipts = keyById(await repo.receiptsFor(APP.pid));
      } finally { APP.signSendBusy = false; render(); }
      break;
    }
    case 'signcopy': {
      const link = location.origin + location.pathname + '#sign/' + t.dataset.token;
      try { await copyText(link); toast('Signature link copied'); } catch { toast(link); }
      break;
    }
    case 'signmail': {
      try {
        const m = await repo.sendSignEmail(t.dataset.id);
        toast(m && m.error ? 'Email delivery failed. Copy the link instead' : 'Signature request emailed again');
      } catch { toast('Email delivery failed. Copy the link instead'); }
      break;
    }
    case 'sealnow': {
      if (APP.sealBusy) break;
      APP.sealBusy = id; render();
      try {
        const res = await repo.sealReceipt(id);
        if (res && res.error) { toast('Seal failed: ' + String(res.error.message || res.error).slice(0, 80)); }
        else { APP.receipts = keyById(await repo.receiptsFor(APP.pid)); toast('Receipt sealed'); sweepWebhooks(); }
      } catch (e) { toast('Seal failed: ' + String((e && e.message) || e).slice(0, 80)); }
      APP.sealBusy = null; render(); break;
    }
    case 'sealhealth': {
      toast('Checking sealing setup\u2026');
      try {
        const res = await repo.sealHealth();
        const h = (res && res.data) || {};
        if (h.ok === true) toast('Sealing is ready: secret valid, key pair matches.');
        else if (h.signingKey === 'missing') toast('Not ready: the RECEIPT_SIGNING_KEY secret is missing. Runbook step 4.');
        else if (typeof h.signingKey === 'string' && h.signingKey !== 'valid') toast('Not ready: ' + h.signingKey);
        else if (h.pairOk !== true) toast('Not ready: ' + (typeof h.pairOk === 'string' ? h.pairOk : 'the registered public key does not match the secret. Runbook step 5.'));
        else toast('Not ready: the function did not answer as expected. Is seal-receipt deployed?');
      } catch { toast('Not ready: the seal-receipt function is not reachable. Runbook step 6.'); }
      break;
    }
    case 'sealretrytsa': {
      if (APP.sealBusy) break;
      APP.sealBusy = id; render();
      try {
        const res = await repo.retryTimestamps(id);
        const err = res && (res.error || (res.data && res.data.error));
        if (err) toast('Retry failed: ' + String(err.message || err).slice(0, 80));
        else { APP.receipts = keyById(await repo.receiptsFor(APP.pid)); toast('Timestamps: ' + (res.data && res.data.tsa_status)); sweepWebhooks(); }
      } catch (e) { toast('Retry failed: ' + String((e && e.message) || e).slice(0, 80)); }
      APP.sealBusy = null; render(); break;
    }
    case 'engvalsave': {
      const cur = APP.fields && APP.fields.ctrl_engagement_value;
      const next = val('engval').trim();
      const r = await repo.saveField(APP.pid, 'ctrl_engagement_value', next, cur ? cur.rev : 0);
      if (r && r.data) { (APP.fields = APP.fields || {}).ctrl_engagement_value = { value: next, rev: (r.data.rev || ((cur ? cur.rev : 0) + 1)) }; toast('Engagement value saved'); }
      else toast('Could not save; reload and try again');
      render(); break;
    }
    case 'promote': {
      // Promote a signed pursuit baseline into an engagement. The content is
      // applied through the same rev-checked, additive, sequential discipline
      // every template start uses, and the lineage is written as a citation:
      // the parent, the signed sequence, and a fingerprint recomputed here and
      // asserted equal to what the signer actually signed. A mismatch aborts.
      if (APP.promoting) break;
      const signs = Object.values(APP.signs || {}).flat();
      const sg = signs.filter((x) => x && x.status === 'signed' && !x.revoked)
        .sort((a2, b2) => String(b2.signed_at || '').localeCompare(String(a2.signed_at || '')))[0];
      if (!sg) { toast('Promote needs a signed baseline'); break; }
      const ver = (APP.versions || []).find((x) => x.id === sg.version_id);
      if (!ver) { toast('The signed baseline is not loaded; reload and try again'); break; }
      APP.promoting = true; render();
      try {
        const fp = await versionFingerprint(ver);
        if (fp !== sg.doc_fingerprint) {
          toast('Promote aborted: this baseline no longer matches what was signed');
          APP.promoting = false; render(); break;
        }
        const childId = uid();
        const childName = (APP.pname || 'Engagement') + ' engagement';
        const practice = !!(APP.project && APP.project.practice);   // a rehearsal's child is a rehearsal
        const r = await repo.createProject(APP.orgId, childId, childName, practice);
        if (r.error) { toast('Could not create the engagement'); APP.promoting = false; render(); break; }
        upsertById(APP.projects, { id: childId, org_id: APP.orgId, name: childName, practice,
          born_from_project_id: APP.pid, born_from_seq: ver.seq, born_from_fingerprint: fp,
          archived: false, disc_export: false, updated_at: new Date().toISOString() }, 'updated_at');
        const snap = (ver.snapshot && ver.snapshot.answers) || {};
        let wrote = 0, failed = 0;
        for (const [id2, value] of Object.entries(snap)) {
          if (id2 === 'ctrl_pursuit') continue;                       // the child is not a pursuit
          if (typeof value !== 'string' || !value.trim()) continue;   // scalars only; lists stay with the pursuit
          const rr = await repo.saveField(childId, id2, id2 === 'ctrl_type' ? ENGAGEMENT : value, 0);
          if (rr && rr.data && rr.data.ok) wrote++; else failed++;
          APP.promoteWrote = wrote; render();
        }
        if (!snap.ctrl_type) { await repo.saveField(childId, 'ctrl_type', ENGAGEMENT, 0); wrote++; }
        const lin = await repo.setLineage(childId, APP.pid, ver.seq, fp);
        const linOk = lin && lin.data && lin.data.ok;
        toast('Engagement created' + (wrote ? ', ' + wrote + ' field' + (wrote === 1 ? '' : 's') + ' carried' : '') +
          (linOk ? ', lineage recorded' : ', lineage not recorded') + (failed ? ', ' + failed + ' failed' : ''));
        APP.promoting = false; APP.promoteWrote = 0;
        openProject(childId);
      } catch (e) {
        APP.promoting = false; APP.promoteWrote = 0;
        toast('Promote failed: ' + String((e && e.message) || e).slice(0, 80));
        render();
      }
      break;
    }
    case 'bookexport': {
      // The Book: facts listed, never scored. Practice excluded at the RPC;
      // the client only turns rows into disciplined CSV.
      try {
        const rows = await repo.bookExport();
        const cols = ['project_id', 'project_name', 'version_label', 'seq', 'doc_fingerprint',
          'signer_name', 'signer_role', 'signer_email_domain', 'signed_at', 'receipt_id',
          'canonical_hash', 'tsa_status', 'sealed_at', 'chain_head_seq', 'chain_head_hash', 'engagement_value'];
        const csvText = [cols.map(csvCell).join(','),
          ...rows.map((r0) => cols.map((c) => csvCell(r0[c] == null ? '' : r0[c])).join(','))].join('\r\n') + '\r\n';
        download('book-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv', csvText);
        toast(rows.length + ' signature row' + (rows.length === 1 ? '' : 's') + ' exported');
      } catch (e) { toast('Book export failed: ' + String((e && e.message) || e).slice(0, 80)); }
      break;
    }
    case 'invoicepacket': {
      // Acceptance evidence for one signature, suitable for attachment to an
      // invoice. On demand, stored nowhere, deterministic but for the moment
      // in its manifest.
      try {
        const rc = await repo.receiptRow(id);
        if (!rc) { toast('No receipt yet'); break; }
        const sg = Object.values(APP.signs || {}).flat().find((x) => x.id === id);
        const ver = (APP.versions || []).find((x) => x.id === (sg && sg.version_id));
        const { files } = await buildInvoicePacket({ receipt: rc, sign: sg, version: ver,
          project: { id: APP.pid, name: APP.pname, practice: !!(APP.project && APP.project.practice) } });
        const enc3 = new TextEncoder();
        download('invoice-packet-' + String(rc.canonical_hash || '').slice(0, 8) + '.zip', 'application/zip',
          zipStore(files.map((f) => ({ name: f.name, data: typeof f.data === 'string' ? enc3.encode(f.data) : f.data })), new Date(rc.sealed_at || Date.now())));
      } catch (e) { toast('Packet failed: ' + String((e && e.message) || e).slice(0, 80)); }
      break;
    }
    case 'recordofdelivery': {
      // The close document. Built from what the record already holds; nothing
      // is fetched that a reader could not check for themselves.
      try {
        const html = rodFromState();
        download('record-of-delivery-' + (APP.pid || 'record') + '.html', 'text/html', html);
      } catch (e) { toast('Could not build the record: ' + String((e && e.message) || e).slice(0, 70)); }
      break;
    }
    case 'closepackage': {
      // One archive: the Record of Delivery and the whole evidence pack,
      // flattened, under a single manifest.
      if (APP.closeBusy) break;
      APP.closeBusy = true; render();
      try {
        const g = await repo.evidenceGather(APP.pid);
        if (!g || g.ok === false) { toast('Evidence gather refused: ' + ((g && g.error) || 'unknown')); APP.closeBusy = false; render(); break; }
        const { files } = await buildClosePackage({ gather: g, rod: rodFromState(), product: APP.pname });
        const enc4 = new TextEncoder();
        download('close-package-' + (APP.pid || 'record') + '.zip', 'application/zip',
          zipStore(files.map((f) => ({ name: f.name, data: typeof f.data === 'string' ? enc4.encode(f.data) : f.data })), new Date()));
      } catch (e) { toast('Close package failed: ' + String((e && e.message) || e).slice(0, 70)); }
      APP.closeBusy = false; render();
      break;
    }
    case 'evidencepack': {
      // The whole pack from one gather: the RPC is the single throat the
      // leak tests cover, so the client adds nothing to it but zip bytes.
      if (APP.evidenceBusy) break;
      APP.evidenceBusy = true; render();
      try {
        const g = await repo.evidenceGather(APP.pid);
        if (!g || g.ok !== true) {
          toast(g && g.error === 'practice_project'
            ? 'Practice records are non-evidence by construction. No pack is produced.'
            : 'Pack refused: ' + String((g && g.error) || 'no response'));
          break;
        }
        const { files } = await buildEvidencePack(g, { product: APP.pname });
        const enc2 = new TextEncoder();
        download('evidence-pack-' + APP.pid + '.zip', 'application/zip',
          zipStore(files.map((f) => ({ name: f.name, data: typeof f.data === 'string' ? enc2.encode(f.data) : f.data })), new Date()));
        await repo.evidenceLogExport(APP.pid);
        toast('Evidence pack exported');
      } catch (e) { toast('Pack failed: ' + String((e && e.message) || e).slice(0, 80)); }
      APP.evidenceBusy = false; render(); break;
    }
    case 'sealbundle': {
      try {
        const rc = await repo.receiptRow(id);
        if (!rc) { toast('No receipt yet'); break; }
        const sg = Object.values(APP.signs || {}).flat().find((x) => x.id === id);
        const ver = (APP.versions || []).find((x) => x.id === (sg && sg.version_id));
        const key = await repo.sealKey(rc.key_id);
        if (!key || !key.public_key_spki_base64 || key.public_key_spki_base64.startsWith('SET-AT-DEPLOY')) {
          toast('Public key ' + rc.key_id + ' is not registered yet. Finish runbook step 5, then download again.'); break;
        }
        const files = await buildReceiptBundle(rc, ver, key.public_key_spki_base64, { product: APP.pname });
        const enc = new TextEncoder();
        download('receipt-' + String(rc.canonical_hash || '').slice(0, 8) + '.zip', 'application/zip',
          zipStore(files.map((f) => ({ name: f.name, data: typeof f.data === 'string' ? enc.encode(f.data) : f.data })), new Date(rc.sealed_at || Date.now())));
      } catch (e) { toast('Bundle failed: ' + String((e && e.message) || e).slice(0, 80)); }
      break;
    }
    case 'signrevoke': {
      const ok = await repo.signRevoke(t.dataset.id);
      if (ok.data === true) { APP.signs = await repo.signsFor(APP.pid); toast('Signature link revoked'); render(); }
      else toast('Only pending requests can be revoked');
      break;
    }
    /* ---- weekly updates (v2.27.0) ---- */
    case 'updcompose': {
      // Assemble the draft from record truth: activity in the window since
      // the last live update, plus the derived asks and open items. The
      // whole transformation is pure (update.js); this handler only feeds it.
      const acts = await repo.activity(APP.pid, 200);
      const prev = (APP.updatesList || []).find((u) => !u.revoked);
      const draft = assembleUpdate({
        answers: assembleAnswers(APP.fields, APP.rows),
        versions: APP.versions || [], approvalsByVersion: APP.approvals || {},
        signsByVersion: APP.signs || (APP.signs = await repo.signsFor(APP.pid)),
        activity: acts,
        prevPayload: prev ? prev.payload : null,
        windowFrom: prev ? prev.window_to : null,
        windowTo: new Date().toISOString(), now: new Date(),
      });
      // Prefill the authored boxes from the derivation: what moved seeds Key
      // updates, the open asks seed Key questions. Suggestions only; the
      // published lines are exactly what sits in the boxes at publish.
      draft.keyu = (draft.moved || []).map((x) => x.text).filter(Boolean).slice(0, 8).join('\n');
      draft.keyq = (draft.asks || []).map((x) => x.text).filter(Boolean).slice(0, 8).join('\n');
      APP.upd = { draft, busy: false };
      render();
      break;
    }
    case 'updcancel': APP.upd = null; render(); break;
    case 'updwx': APP.updWx = !APP.updWx; render(); break;
    case 'lens': APP.lens = t.dataset.val; render(); break;
    case 'tagdone': {
      const tag = APP.phaseTag; APP.phaseTag = null;
      if (!tag) break;
      const cands = tagDoneCandidates(APP.rows.okrs || []);
      for (const r of cands) sync.editRow('okrs', r.id, { phase: tag.from });
      sync.flushNow();
      toast('Tagged ' + cands.length + ' key result' + (cands.length === 1 ? '' : 's') + ' to ' + tag.from);
      render(); break;
    }
    case 'tagdismiss': APP.phaseTag = null; render(); break;
    case 'helpopen': APP.help = { ...(APP.help || {}), open: true }; render(); focusHelp('#help-panel'); break;
    case 'helpclose': APP.help = { ...(APP.help || {}), open: false, topic: null, showDismissed: false }; render(); focusHelp('[data-help-anchor="help.beacon"]'); break;
    case 'helptopic': {
      APP.help = { ...(APP.help || {}), topic: t.dataset.id };
      const stq = (APP.helpState || {})[t.dataset.id];
      if (!stq || !stq.seen) { (APP.helpState = APP.helpState || {})[t.dataset.id] = { ...(stq || {}), seen: true }; repo.helpStateSet(APP.uid, t.dataset.id, { seen: true }); }
      repo.helpEvent(t.dataset.id, APP.uid, 'view');
      render(); break;
    }
    case 'helpback': APP.help = { ...(APP.help || {}), topic: null }; render(); break;
    case 'helpdismiss': (APP.helpState = APP.helpState || {})[t.dataset.id] = { ...((APP.helpState || {})[t.dataset.id] || {}), dismissed: true }; repo.helpStateSet(APP.uid, t.dataset.id, { dismissed: true }); APP.help.topic = null; render(); break;
    case 'helprestore': (APP.helpState = APP.helpState || {})[t.dataset.id] = { ...((APP.helpState || {})[t.dataset.id] || {}), dismissed: false }; repo.helpStateSet(APP.uid, t.dataset.id, { dismissed: false }); render(); break;
    case 'helppathfold': {
      APP.helpPathFold = !APP.helpPathFold;
      try { localStorage.setItem('rp:pathfold', APP.helpPathFold ? '1' : ''); } catch {}
      render(); break;
    }
    case 'helpshowdismissed': APP.help = { ...(APP.help || {}), showDismissed: true }; render(); break;
    case 'helphide': APP.helpPrefs = { ...(APP.helpPrefs || {}), beacon_hidden: true }; repo.helpPrefsSet(APP.uid, { beacon_hidden: true }); APP.help = { open: false, topic: null, showDismissed: false }; toast('Help hidden. Press ? to bring it back.'); render(); break;
    case 'helpcaps': APP.help = { ...(APP.help || {}), open: true, caps: true, topic: null }; render(); focusHelp('#help-panel'); break;
    case 'helpcapsback': APP.help = { ...(APP.help || {}), caps: false }; render(); focusHelp('#help-panel'); break;
    case 'capshow': {
      // A capability's Show me: a one-step inline spotlight on the real
      // control, through the same machinery every walkthrough uses.
      APP.help = { ...(APP.help || {}), open: false };
      APP.helpSpot = { inline: { anchor_key: t.dataset.anchor, title: t.dataset.title, body_md: 'The control is lit on this page.' }, topic: null, ix: 0 };
      render(); positionHelpSpot(APP, document); focusHelp('#help-spot'); break;
    }
    case 'helptour': {
      APP.help = { ...(APP.help || {}), open: false };
      APP.helpSpot = { topic: t.dataset.id, ix: 0 };
      render(); positionHelpSpot(APP, document); focusHelp('#help-spot'); break;
    }
    case 'helptournext': APP.helpSpot.ix++; render(); positionHelpSpot(APP, document); focusHelp('#help-spot'); break;
    case 'helptourprev': APP.helpSpot.ix--; render(); positionHelpSpot(APP, document); focusHelp('#help-spot'); break;
    case 'helptourdone': {
      const tid = APP.helpSpot.topic; APP.helpSpot = null;
      (APP.helpState = APP.helpState || {})[tid] = { ...((APP.helpState || {})[tid] || {}), completed: true };
      repo.helpStateSet(APP.uid, tid, { completed: true }); repo.helpEvent(tid, APP.uid, 'complete');
      document.querySelectorAll('.help-lit').forEach((el) => el.classList.remove('help-lit'));
      toast('Walkthrough complete'); render(); break;
    }
    case 'helptourend': APP.helpSpot = null; document.querySelectorAll('.help-lit').forEach((el) => el.classList.remove('help-lit')); render(); break;
    case 'helpstudio': {
      APP.help = { ...(APP.help || {}), open: false }; APP.helpStudioOpen = true;
      if (APP.role === 'manager') repo.helpStats(APP.orgId).then((r) => { APP.helpStats = r; render(); });
      render(); break;
    }
    case 'helpseed': {
      if (APP.helpSeeding) break;
      APP.helpSeeding = true; render();
      try {
        // Fresh truth, never the cache: the guard that failed read stale state.
        const fresh = await repo.helpTopicsFor(APP.orgId);
        const plan = seedPlan(fresh.topics, HELP_LIBRARY);
        for (const id of plan.toDelete) await repo.helpTopicDelete(id);
        for (const t of plan.toInsert) {
          const { steps, ...row } = t;
          const saved = await repo.helpTopicSave({ ...row, org_id: APP.orgId, is_published: true });
          if (steps && steps.length) await repo.helpStepsReplace(saved.id, steps.map((x, i) => ({ ...x, step_order: i + 1 })));
        }
        const hb = await repo.helpTopicsFor(APP.orgId);
        APP.helpTopics = hb.topics; APP.helpSteps = hb.steps;
        toast(plan.toDelete.length || plan.toInsert.length
          ? (plan.toDelete.length ? 'Removed ' + plan.toDelete.length + ' duplicate' + (plan.toDelete.length === 1 ? '' : 's') + ' \u00b7 ' : '') +
            (plan.toInsert.length ? 'added ' + plan.toInsert.length + ' topic' + (plan.toInsert.length === 1 ? '' : 's') : 'library complete')
          : 'The library is complete, nothing to do');
      } catch (e) { toast('Seeding failed: ' + String((e && e.message) || e).slice(0, 80)); }
      APP.helpSeeding = false;
      render(); break;
    }
    case 'helpstudioclose': APP.helpStudioOpen = false; APP.helpEdit = null; render(); break;
    case 'helpnew': APP.helpEdit = { org_id: APP.orgId, title: '', body_md: '', routes: ['*'], audience: 'all', is_published: false, stepsText: '' }; render(); break;
    case 'helpedit': {
      const tp = (APP.helpTopics || []).find((x) => x.id === t.dataset.id);
      if (tp) APP.helpEdit = { ...tp, stepsText: stepsToText((APP.helpSteps || []).filter((x) => x.topic_id === tp.id)) };
      render(); break;
    }
    case 'helpsave': case 'helppub': {
      const ed = APP.helpEdit; if (!ed) break;
      if (a === 'helppub') ed.is_published = !ed.is_published;
      if (!String(ed.title || '').trim()) { toast('A topic needs a title'); render(); break; }
      const { stepsText, ...row } = ed;
      try {
        const saved = await repo.helpTopicSave(row);
        await repo.helpStepsReplace(saved.id, textToSteps(stepsText));
        const hb = await repo.helpTopicsFor(APP.orgId);
        APP.helpTopics = hb.topics; APP.helpSteps = hb.steps;
        APP.helpEdit = { ...saved, stepsText: stepsToText(hb.steps.filter((x) => x.topic_id === saved.id)) };
        toast(a === 'helppub' ? (saved.is_published ? 'Published' : 'Unpublished') : 'Saved');
      } catch { toast('Save failed'); }
      render(); break;
    }
    case 'helpdelete': {
      if (!confirm('Delete this topic and its steps? Readers lose it immediately.')) break;
      try { await repo.helpTopicDelete(t.dataset.id); } catch { toast('Delete failed'); break; }
      APP.helpTopics = (APP.helpTopics || []).filter((x) => x.id !== t.dataset.id);
      APP.helpSteps = (APP.helpSteps || []).filter((x) => x.topic_id !== t.dataset.id);
      APP.helpEdit = null; render(); break;
    }
    case 'updphase': {
      captureUpdInputs();
      const ui = (APP.updUi = APP.updUi || { open: {}, ex: {}, vphase: '' });
      ui.vphase = t.dataset.val;
      render(); break;
    }
    case 'updsecx': {
      captureUpdInputs();
      const ui = (APP.updUi = APP.updUi || { open: {}, ex: {} });
      ui.ex = ui.ex || {};
      ui.ex[t.dataset.k] = !ui.ex[t.dataset.k];
      render(); break;
    }
    case 'updpublish': {
      if (!APP.upd || APP.upd.busy) break;
      const d = APP.upd.draft;
      // Read every free-typed field NOW, before the first await or render.
      // The composer's recipient inputs are rebuilt from the previous
      // update on every render, so a read after the busy render (or after a
      // realtime repaint during ensureSnapshot) published the OLD recipient:
      // usually nobody. That was the v2.35.0 lost-recipient defect.
      const draftRecip = APP.updRecipDraft || {};
      const pubPrep = (val('updprep') || draftRecip.prep || '').trim();
      const pubRecipName = (val('updrecip') || draftRecip.name || '').trim();
      const pubRecipEmail = (val('updrecipemail') || draftRecip.email || '').trim();
      const pubRecipRole = val('updreciprole') || draftRecip.role || 'Client';
      // Read the authored boxes NOW, before any await or repaint (the
      // lost-recipient discipline). One line each becomes one published line;
      // blanks drop; eight lines and 240 characters are the ceilings.
      const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8).map((x) => x.slice(0, 240));
      const pubKeyU = lines(val('updkeyu') || d.keyu);
      const pubKeyQ = lines(val('updkeyq') || d.keyq);
      const payload = {
        window: d.window,
        key: { updates: pubKeyU, questions: pubKeyQ },
      };
      // The dashboard's content is frozen into the payload at the moment of
      // publish, exactly as authored. Phase, OKRs, and the update log travel
      // with the link; later edits to the worksheet never reach a sent link.
      {
        const a = assembleAnswers(APP.fields, APP.rows);
        payload.board = {
          phase: currentPhase(a),
          phases: PHASES.slice(),
          okrs: rowsFilled(a.okrs).map((r) => ({ objective: r.objective || '', kr: r.kr || '', done: r.done || '', phase: r.phase || '' })),
          items: rowsFilled(a.updates).map((r) => ({
            id: r._uid || '', type: r.type || '', title: r.title || '', desc: r.desc || '',
            action: r.action || '', owner: r.owner || '', delivery: r.delivery || '', status: r.status || '', notes: r.notes || '',
          })),
        };
      }
      const latest = (APP.versions || []).slice().sort((x, y) => y.seq - x.seq)[0];
      if (latest) {
        try {
          await ensureSnapshot(latest.seq);
          const snap = APP.snapshots[latest.seq];
          payload.baseline = { label: latest.label, fp: snap ? await versionFingerprint(snap) : '' };
        } catch { payload.baseline = { label: latest.label, fp: '' }; }
      }
      APP.upd.busy = true; render();
      try {
        const r = await repo.updatePublish(APP.pid, payload, d.window.from, pubPrep,
          pubRecipName, pubRecipEmail, pubRecipRole);
        const out = r.data;
        if (!out || !out.ok) { toast(out && out.error === 'forbidden' ? 'Only a manager can publish an update' : 'Could not publish. Try again'); break; }
        APP.upd = null;
        APP.updRecipDraft = null;
        APP.updatesList = await repo.updatesFor(APP.pid);
        const link = location.origin + location.pathname + '#update/' + out.token;
        try { await copyText(link); } catch { /* clipboard denied */ }
        toast('Update no. ' + out.seq + ' published. Link copied');
        render();
      } finally { if (APP.upd) { APP.upd.busy = false; render(); } }
      break;
    }
    case 'updcopy': {
      const link = location.origin + location.pathname + '#update/' + t.dataset.token;
      try { await copyText(link); toast('Update link copied'); } catch { toast(link); }
      break;
    }
    case 'updrevoke': {
      const ok = await repo.updateRevoke(t.dataset.id);
      if (ok.data === true) { APP.updatesList = await repo.updatesFor(APP.pid); toast('Update withdrawn. Its link says so now'); render(); }
      else toast('Could not withdraw the update');
      break;
    }
    case 'updprint': {
      const g = APP.updatePage;
      if (!g || !g.ok || g.revoked) { toast('Nothing to print'); break; }
      const area = document.getElementById('printArea');
      if (!area) break;
      const board = g.update && g.update.payload && g.update.payload.board;
      const hasStrip = g.update && g.update.payload && g.update.payload.strip;
      const hasKey = g.update && g.update.payload && g.update.payload.key;
      area.innerHTML = board
        ? updateDashboardHTML(g, { phase: '', open: {}, print: true }) + (hasKey ? updKeyCardHTML(g) : hasStrip ? updateArtifactHTML(g) : '')
        : updateArtifactHTML(g);
      window.print();
      break;
    }
    /* ---- update panel: the one write the token page performs ---- */
    case 'updcommentsend': {
      const f = APP.shareForm || (APP.shareForm = {});
      if (f.commentBusy) break;
      const body = val('updcommentbox').trim();
      if (!body) { toast('Write something first'); break; }
      f.comment = body; f.commentBusy = true; render();
      try {
        const r = await repo.updateComment(APP.shareToken, body);
        const out = r.data;
        if (out && out.ok) {
          f.commentSent = true; f.commentRef = out.ref; f.comment = '';
          toast('Comment sent to the team');
        } else {
          // no_recipient means the link was issued without a name, so there is
          // nobody to attribute the comment to. The box should not have
          // rendered; say so plainly rather than filing it anonymously.
          toast(out && out.error === 'no_recipient'
            ? 'This link cannot take comments. Ask your contact to reissue it'
            : 'Could not send. Try again');
        }
      } finally { f.commentBusy = false; render(); }
      break;
    }
    /* ---- the update dashboard (v2.35.0): view state, notes, threads ---- */
    /* Tabs and expanders repaint the page, so live input values are pulled
       into state first; a rerender must never eat half-typed text. */
    case 'updrowtoggle': {
      captureUpdInputs();
      const ui = (APP.updUi = APP.updUi || { phase: '', open: {} });
      ui.open[t.dataset.uid] = !ui.open[t.dataset.uid];
      render();
      break;
    }
    case 'updnotesave': {
      const n = (APP.updNotes = APP.updNotes || {});
      if (n.busy) break;
      n.body = val('updnotesbox');
      n.busy = true; render();
      try {
        const r = await repo.updateNoteSave(APP.shareToken, n.body, n.rev || 0);
        const out = r.data;
        if (out && out.ok) {
          n.rev = out.rev; n.savedAt = new Date().toISOString();
          toast('Notes saved to this link');
        } else if (out && out.error === 'conflict') {
          // Another tab on this same link saved first. Their save is real and
          // rev-checked; take it, keep the base rev honest, and say so.
          n.body = out.body; n.rev = out.rev;
          toast('These notes were saved from another tab. Showing that version');
        } else {
          toast(out && out.error === 'no_recipient'
            ? 'This link cannot save notes. Ask your contact to reissue it with a name'
            : out && out.error === 'too_long' ? 'Notes are capped at 20,000 characters'
            : 'Could not save. Try again');
        }
      } finally { n.busy = false; render(); }
      break;
    }
    case 'updthreadsend': {
      const f = (APP.updThread = APP.updThread || {});
      if (f.busy) break;
      f.kind = val('updthreadkind') || 'Question';
      f.title = val('updthreadtitle').trim();
      f.body = val('updthreadbody').trim();
      if (!f.body) { toast('Write what you need first'); break; }
      f.busy = true; render();
      try {
        const r = await repo.updateThreadCreate(APP.shareToken, f.kind, f.title, f.body);
        const out = r.data;
        if (out && out.ok) {
          f.sent = true; f.sentRef = out.ref; f.title = ''; f.body = '';
          const ctx = await repo.updateContext(APP.shareToken);
          if (ctx.data && ctx.data.ok) APP.updatePage = ctx.data;
          toast('Sent. The team sees it in their inbox');
        } else {
          toast(out && out.error === 'no_recipient'
            ? 'This link cannot open threads. Ask your contact to reissue it with a name'
            : out && out.error === 'rate_limited' ? 'Too many posts this hour. Try again later'
            : 'Could not send. Try again');
        }
      } finally { f.busy = false; render(); }
      break;
    }
    case 'updthreadreply': {
      const drafts = (APP.updDrafts = APP.updDrafts || {});
      const body = (drafts[id] || '').trim();
      if (!body) { toast('Write a reply first'); break; }
      const r = await repo.updateThreadReply(APP.shareToken, id, body);
      const out = r.data;
      if (out && out.ok) {
        delete drafts[id];
        const ctx = await repo.updateContext(APP.shareToken);
        if (ctx.data && ctx.data.ok) APP.updatePage = ctx.data;
        render();
      } else {
        toast(out && out.error === 'rate_limited'
          ? 'Too many replies this hour. Try again later'
          : 'Could not send the reply. Try again');
      }
      break;
    }
    /* ---- e-sign v1: the signer's page ---- */
    case 'signdeclineopen': { APP.signDeclineOpen = true; render(); break; }
    case 'signsubmit': {
      if (!APP.sign || APP.signBusy) break;
      const name = val('signName').trim();
      const consent = !!(document.getElementById('signConsent') || {}).checked;
      APP.signName = name; APP.signConsent = consent;
      if (!name) { APP.signError = 'Type your full name to sign.'; render(); break; }
      if (!consent) { APP.signError = 'Tick the consent box to sign electronically.'; render(); break; }
      APP.signError = null; APP.signBusy = true; render();
      try {
        const r = await repo.signSign(APP.sign.token, name, (navigator && navigator.userAgent) || '');
        const out = r.data;
        if (out && out.ok) {
          APP.sign.status = 'signed';
          APP.sign.signedName = out.already ? out.signedName : name;
          APP.sign.signedAt = out.signedAt || new Date().toISOString();
          pingDeliveries(out.pendingDeliveries).catch(() => { /* never blocks the signer */ });
        } else {
          APP.signError = out && out.error === 'declined'
            ? 'This request was declined earlier and can no longer be signed.'
            : 'Could not record the signature. Reload the page and try again.';
        }
      } finally { APP.signBusy = false; render(); }
      break;
    }
    case 'signdeclinego': {
      if (!APP.sign || APP.signBusy) break;
      APP.signBusy = true; render();
      try {
        const r = await repo.signDecline(APP.sign.token, val('signWhy').trim());
        if (r.data && r.data.ok) { APP.sign.status = 'declined'; APP.sign.declineReason = val('signWhy').trim(); pingDeliveries(r.data.pendingDeliveries).catch(() => {}); }
        else APP.signError = 'Could not record the decline. Reload and try again.';
      } finally { APP.signBusy = false; APP.signDeclineOpen = false; render(); }
      break;
    }
    case 'signreceipt': {
      // functions.invoke resolves with {data, error} on an HTTP failure - it
      // does not throw - so this handler used to render "Receipt sent" over
      // an email the mailer had just refused. Success is only what the
      // function itself says: no error, and ok on the body.
      try {
        const r = await repo.sendSignReceipt(APP.sign.token);
        APP.signReceiptSent = !(r && r.error) && !!(r && r.data && r.data.ok === true);
      } catch { APP.signReceiptSent = false; }
      if (!APP.signReceiptSent) toast('Could not send the receipt email. Print this page instead');
      render();
      break;
    }
    case 'apprrecord': {
      // A sign-off recorded on an already-approved baseline: insert the slot
      // (the trigger forces it pending), then decide it approved. Provenance
      // stamps decided_by/decided_at to the recorder - honest evidence, and
      // the approved_no_signoff warning clears with it. The busy flag keeps a
      // double-click from recording the same signer twice.
      if (APP.apprBusy) break;
      const role = val('apr-role-' + id).trim();
      const name = val('apr-name-' + id).trim();
      if (!name) { toast('Type the signer\u2019s name. A sign-off needs one'); break; }
      APP.apprBusy = true;
      try {
        const r = await repo.addApprover(id, role, name, null);
        const slotId = r.data && r.data[0] && r.data[0].id;
        if (r.error || !slotId) { toast('Could not record the sign-off'); break; }
        const d = await repo.decideApproval(slotId, 'approved', 'Recorded on the approved baseline');
        if (d.error || d.data !== true) { toast('Slot added but not decided. Approve it on the row'); }
        const list = await repo.approvals([id]);
        APP.approvals[id] = list[id] || [];
        toast('Sign-off recorded');
        render();
      } finally { APP.apprBusy = false; }
      break;
    }
    case 'appradd': {
      if (APP.apprBusy) break;
      const sel = document.getElementById('apr-user-' + id);
      const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
      const userId = (sel && sel.value) || '';
      const role = val('apr-role-' + id).trim();
      const typed = val('apr-name-' + id).trim();
      // When a teammate is chosen, the name comes from the roster; otherwise it is free text.
      const name = userId ? ((opt && (opt.dataset.name || opt.textContent.trim())) || typed) : typed;
      if (!role && !name) { toast('Pick a teammate or type a name'); break; }
      APP.apprBusy = true;
      try {
        const r = await repo.addApprover(id, role, name, userId || null);
        if (r.error) { toast('Could not add approver'); break; }
        const list = await repo.approvals([id]);
        APP.approvals[id] = list[id] || [];
        render();
      } finally { APP.apprBusy = false; }
      break;
    }
    case 'apprdecide': {
      const r = await repo.decideApproval(id, t.dataset.val, '');
      if (r && r.error) { toast('Could not record that decision'); break; }
      if (!r || !r.data || r.data.ok !== true) {
        toast(r && r.data && r.data.error === 'forbidden' ? 'You are not an approver on this version' : 'Could not record that decision');
        break;
      }
      // The decision advances the version server-side; the returned status
      // updates the pill without a refetch, so the row and the version can
      // never contradict each other on screen.
      for (const vid of Object.keys(APP.approvals)) {
        const ap = APP.approvals[vid].find((x) => x.id === id);
        if (!ap) continue;
        ap.status = t.dataset.val;
        const v = APP.versions.find((x) => x.id === vid);
        if (v && r.data.version_status && v.status !== r.data.version_status) {
          v.status = r.data.version_status;
          if (v.status === 'approved') toast('All sign-offs in. V' + v.label + ' is approved');
          else if (v.status === 'in_review') toast('v' + v.label + ' is now in review');
          else if (v.status === 'changes_requested') toast('Changes requested on v' + v.label);
        }
      }
      refreshMyApprovals();
      render();
      break;
    }
    case 'apprdel': {
      await repo.removeApprover(id);
      for (const vid of Object.keys(APP.approvals)) {
        APP.approvals[vid] = APP.approvals[vid].filter((x) => x.id !== id);
      }
      render();
      break;
    }

    /* SME share pages */
    case 'shareset': APP.shareForm[t.dataset.key] = APP.shareForm[t.dataset.key] === t.dataset.val ? '' : t.dataset.val; render(); break;
    case 'sharesubmit': await submitShare(); break;
    case 'shareagain': APP.shareForm = { submitted: false }; render(); break;
    case 'smereply': {
      const el = document.getElementById('smeReplyBody');
      const body = el ? el.value.trim() : '';
      if (!body || !APP.smeReplyToken) break;
      const r = await repo.smeReply(APP.smeReplyToken, body);
      // Reload straight from the token (works for the durable #sme/ workspace,
      // which has no localStorage entry, as well as the brief-submission thread).
      if (r.data === true) {
        const rr = await repo.smeThread(APP.smeReplyToken);
        if (rr.data && rr.data.ok) APP.smeThread = rr.data;
        render();
      } else toast('Could not send');
      break;
    }

    /* partner */
    case 'popen': APP.partnerPid = t.dataset.id; APP.view = 'partnerview'; pseenMark(t.dataset.id); render(); break;
    case 'phome': APP.view = 'partner'; render(); loadPartner(); break;
    case 'pprofopen': closeModals(); APP.pprofOpen = true; render(); break;
    case 'pprofsave': {
      const name = val('ppName').trim(), title = val('ppTitle').trim(), company = val('ppCompany').trim();
      const r = await repo.partnerUpdateProfile(name, title, company);
      if (r.error || r.data !== true) { toast('Could not save profile'); break; }
      if (APP.ctx && APP.ctx.partner) Object.assign(APP.ctx.partner, { name, title, company });
      APP.pprofOpen = false;
      toast('Profile saved');
      render();
      break;
    }
    case 'ppost': {
      const el = document.getElementById('pPostBody');
      const body = el ? el.value.trim() : '';
      if (!body) break;
      const r = await repo.partnerPost(t.dataset.id, body);
      if (r.data === true) { toast('Sent to the team'); await loadPartner(); if (APP.view === 'partnerview') render(); }
      else toast('Could not send');
      break;
    }
    case 'preply': {
      const ta = document.querySelector('[data-preplydraft="' + CSS.escape(id) + '"]');
      const body = ta ? ta.value.trim() : '';
      if (!body) break;
      const r = await repo.partnerReply(id, body);
      if (r.data === true) { await loadPartner(); render(); } else toast('Could not send');
      break;
    }

    /* no-org */
    case 'createorg': {
      APP.authBusy = true; APP.authError = null; render();
      const r = await repo.createOrg(val('woName').trim() || 'My workspace');
      APP.authBusy = false;
      if (r.error) { APP.authError = 'Could not create workspace: ' + r.error.message; render(); break; }
      APP.ctx = await repo.context();
      const m = (APP.ctx.memberships || [])[0];
      if (m) await enterOrg(m); else { APP.view = 'noorg'; render(); }
      break;
    }
    default:
  }
}

/* change events (selects) */
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-attach]')) {
    const file = t.files && t.files[0];
    const wt = t.dataset.wt === '1';
    const proj = t.dataset.project || null;
    t.value = '';
    if (!file) return;
    if (wt && proj) {
      const d = await doUpload(file, { projectId: proj });
      if (d && d.id) {
        const r = await repo.wtAdd(proj, d.id, '');
        const out = r.data;
        if (r.error || !out || !out.ok) {
          toast(out && out.error === 'not_an_image' ? 'Only image files can join the walkthrough'
            : out && out.error === 'duplicate' ? 'That screenshot is already in the walkthrough'
            : 'Uploaded, but could not add it to the walkthrough');
        } else {
          toast('Shot ' + out.position + ' added to the walkthrough');
        }
        APP.walkthrough = await repo.walkthroughFor(proj);
        await ensureWtUrls();
        render();
      }
      return;
    }
    await doUpload(file, { commId: t.dataset.comm || null, replyToken: t.dataset.token || null });
    return;
  }
  if (t.matches('[data-action="commstatus"]')) {
    const id = t.dataset.id;
    await repo.setCommStatus(id, t.value);
    const c = APP.comms.find((x) => x.id === id);
    if (c) c.status = t.value;
    render();
  } else if (t.id === 'intakeFiles') {
    const files = [...(t.files || [])];
    t.value = '';
    await intakeAddFiles(files);
  } else if (t.matches && t.matches('[data-role="clonesel"]')) {
    APP.newTpl = t.value || 'blank';
    render();
  } else if (t.id === 'intakeText') {
    // Re-render so the preview button arms the moment pasted text lands.
    if (APP.intake) { APP.intake.text = t.value; render(); }
  } else if (t.matches('[data-intaketog]')) {
    if (APP.intake && APP.intake.plan) APP.intake.include[+t.dataset.intaketog] = t.checked;
  } else if (t.matches('[data-intaketgt]')) {
    if (APP.intake) APP.intake.targets[+t.dataset.intaketgt] = t.value;
  } else if (t.matches('[data-action="versionsel"]')) {
    APP.viewSeq = t.value === '' ? null : +t.value;
    if (APP.viewSeq != null) await ensureSnapshot(APP.viewSeq);
    if (APP.docTab === 'walkthrough' || APP.docTab === 'document') await ensureWtUrls();
    render();
  } else if (t.matches('[data-action="fbverfilter"]')) {
    APP.fbSeq = t.value === 'all' ? 'all' : +t.value;
    render();
  } else if (t.matches('[data-action="mrole"]')) {
    await repo.setMemberRole(APP.orgId, t.dataset.id, t.value);
    loadOrgData();
  } else if (t.matches('[data-action="discexport"]')) {
    await repo.setDiscExport(APP.pid, t.checked);
    if (APP.project) APP.project.disc_export = t.checked;
  } else if (t.matches('[data-action="wtcap"]')) {
    const shot = (APP.walkthrough || []).find((w) => w.id === t.dataset.id);
    const val = (t.value || '').slice(0, 500);
    if (shot) shot.caption = val;
    const r = await repo.wtCaption(t.dataset.id, val);
    if (r.error || !(r.data && r.data.ok)) toast('Could not save that caption. Try again');
    if (APP.wtStale) {
      APP.wtStale = false;
      APP.walkthrough = await repo.walkthroughFor(APP.pid);
      if (shot) { const mine = APP.walkthrough.find((w) => w.id === shot.id); if (mine) mine.caption = val; }
      await ensureWtUrls();
      render();
    }
  } else if (t.id === 'brandFile') {
    const file = t.files && t.files[0];
    t.value = '';
    if (!file) return;
    toast('Processing logo…');
    let logo;
    try { logo = await downscaleLogo(file); }
    catch { toast('That image could not be read. Try a PNG, JPG, or SVG'); return; }
    if (!logo) { toast('That image is too large even after resizing. Try a simpler logo'); return; }
    const r = await repo.setBrand(APP.pid, logo, (APP.project && APP.project.brand_label) || '');
    if (r.error) { toast(/violates|constraint/i.test(r.error.message || '') ? 'That logo is too large' : 'Could not save the logo'); return; }
    if (APP.project) APP.project.brand_logo = logo;
    await republishBrandedBriefs();
    toast('Logo added. It now appears on the shared PRD and exports');
    render();
  } else if (t.matches('[data-action="buildset"]')) {
    const verId = t.dataset.verid;
    const r = await repo.setBuild(verId, t.value.trim());
    if (r.error) toast('Could not save build tag');
    else {
      const v = APP.versions.find((x) => x.id === verId);
      if (v) v.build = t.value.trim();
      toast('Build tag saved');
    }
  } else if (t.matches('select[data-rowfield]')) {
    sync.editRow(t.dataset.rowfield, t.dataset.rowid, { [t.dataset.colkey]: t.value });
    noteRecent(t.dataset.rowfield);
    sync.flushNow();
    deferredRender();
  }
});

/* input events (typing) - save without re-rendering the worksheet; the
   document pane follows the keystrokes live */
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('[data-field]')) { sync.editField(t.dataset.field, t.value); APP.activeQid = t.dataset.field; patchDocPane(); }
  else if (t.matches('input[data-rowfield], textarea[data-rowfield]')) { sync.editRow(t.dataset.rowfield, t.dataset.rowid, { [t.dataset.colkey]: t.value }); APP.activeQid = t.dataset.rowfield; noteRecent(t.dataset.rowfield); patchDocPane(); }
  else if (t.matches('[data-draft]')) APP.drafts[t.dataset.draft] = t.value;
  else if (t.matches('[data-updreply]')) (APP.updDrafts = APP.updDrafts || {})[t.dataset.updreply] = t.value;
  else if (t.id === 'updrecip') (APP.updRecipDraft = APP.updRecipDraft || {}).name = t.value;
  else if (t.id === 'updrecipemail') (APP.updRecipDraft = APP.updRecipDraft || {}).email = t.value;
  else if (t.id === 'updreciprole') (APP.updRecipDraft = APP.updRecipDraft || {}).role = t.value;
  else if (t.id === 'updprep') (APP.updRecipDraft = APP.updRecipDraft || {}).prep = t.value;
  else if (t.id === 'updkeyu' && APP.upd && APP.upd.draft) APP.upd.draft.keyu = t.value;
  else if (t.id === 'updkeyq' && APP.upd && APP.upd.draft) APP.upd.draft.keyq = t.value;
  else if (t.matches('[data-hf]') && APP.helpEdit) APP.helpEdit[t.dataset.hf] = t.value;
  else if (t.matches('[data-hroute]') && APP.helpEdit) {
    const rset = new Set(APP.helpEdit.routes || []);
    if (t.checked) rset.add(t.dataset.hroute); else rset.delete(t.dataset.hroute);
    APP.helpEdit.routes = rset.size ? [...rset] : ['*'];
  }
  else if (t.id === 'updnotesbox') (APP.updNotes = APP.updNotes || {}).body = t.value;
  else if (t.id === 'updthreadbody') (APP.updThread = APP.updThread || {}).body = t.value;
  else if (t.id === 'updthreadtitle') (APP.updThread = APP.updThread || {}).title = t.value;
  else if (t.matches('[data-ibsearch]')) { APP.inboxFilter.q = t.value; deferredRender(); }
  else if (t.matches('[data-discsearch]')) { APP.discQ = t.value; deferredRender(); }
  else if (t.matches('[data-notedraft]')) APP.noteDraft = t.value;
  else if (t.matches('[data-noteby]')) APP.noteBy = t.value;
  else if (t.matches('[data-nr]')) APP.reqDraft[t.dataset.nr] = t.value;
  else if (t.matches('[data-disc]')) APP.discDraft[t.dataset.disc] = t.value;
  else if (t.matches('[data-share]')) APP.shareForm[t.dataset.share] = t.value;
  else if (t.id === 'palInput') { APP.palQ = t.value; APP.palSel = 0; repaintPalette(); }
});

/* focus tracking → presence + render deferral */
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t.matches('[data-field]')) {
    sync.setActiveField(t.dataset.field);
    APP.activeQid = t.dataset.field;
    revealActiveSection(true);
  } else if (t.matches('[data-rowfield]')) {
    sync.setActiveField('row:' + t.dataset.rowid + ':' + t.dataset.colkey);
    APP.activeQid = t.dataset.rowfield;
    revealActiveSection(true);
  }
});
document.addEventListener('focusout', (e) => {
  const t = e.target;
  if (t.matches('[data-field],[data-rowfield]')) {
    sync.setActiveField(null);
    sync.flushNow();
    deferredRender();
  }
});

/* keyboard */
const isEditable = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
// The current question card: the one whose top sits nearest the reading
// line. Stateless on purpose - scroll position is the state.
function currentQCard() {
  const cards = [...document.querySelectorAll('.qcard[data-q]')];
  if (!cards.length) return { cards, idx: -1 };
  const line = 120;
  let idx = 0;
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].getBoundingClientRect().top <= line + 1) idx = i; else break;
  }
  return { cards, idx };
}
function kbGo(delta) {
  const { cards, idx } = currentQCard();
  if (!cards.length) return;
  const next = Math.min(Math.max(idx + delta, 0), cards.length - 1);
  cards[next].scrollIntoView({ block: 'start' });
  window.scrollBy(0, -96);
  cards.forEach((c) => c.classList.remove('kb-focus'));
  cards[next].classList.add('kb-focus');
  setTimeout(() => cards[next].classList.remove('kb-focus'), 1200);
}
function focusHelp(sel) {
  requestAnimationFrame(() => { const el = document.querySelector(sel); if (el) el.focus(); });
}
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '') || (e.target && e.target.isContentEditable);
  if (e.key === '?' && !typing && (APP.view === 'projects' || APP.view === 'workspace')) {
    e.preventDefault();
    if (APP.helpPrefs && APP.helpPrefs.beacon_hidden) { APP.helpPrefs.beacon_hidden = false; repo.helpPrefsSet(APP.uid, { beacon_hidden: false }); }
    APP.help = { ...(APP.help || {}), open: true }; render(); focusHelp('#help-panel'); return;
  }
  if (e.key === 'Escape' && APP.helpSpot) { APP.helpSpot = null; document.querySelectorAll('.help-lit').forEach((el) => el.classList.remove('help-lit')); render(); return; }
  if (e.key === 'Escape' && APP.help && APP.help.open) { APP.help = { ...APP.help, open: false, topic: null }; render(); focusHelp('[data-help-anchor="help.beacon"]'); return; }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  // Alt+Enter inside any row cell adds a row to that question. Works in
  // inputs, textareas, and selects alike, and never collides with typing.
  if (e.altKey && e.key === 'Enter' && e.target && e.target.matches && e.target.matches('[data-rowfield]')) {
    e.preventDefault();
    const btn2 = document.querySelector('[data-action="addrow"][data-qid="' + CSS.escape(e.target.dataset.rowfield) + '"]');
    if (btn2) btn2.click();
    return;
  }
  // Expert accelerators live outside editable fields, so typing is never
  // hijacked: j and k walk the worksheet, Enter opens the current card,
  // ? shows the sheet.
  if (!isEditable(e.target) && !APP.palOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'j' || e.key === 'k') { e.preventDefault(); kbGo(e.key === 'j' ? 1 : -1); return; }
    if (e.key === 'Enter' && APP.pid && !APP.pasteQ && !APP.kbHelp && !APP.tplSave) {
      const { cards, idx } = currentQCard();
      const f = idx >= 0 && cards[idx] ? cards[idx].querySelector('input, textarea, select') : null;
      if (f) { e.preventDefault(); f.focus(); }
      return;
    }
    if (e.key === '?') { e.preventDefault(); APP.kbHelp = true; render(); return; }
  }
  // Enter in the new-project name field creates the project. It routes through
  // the same guarded 'new' handler, so key auto-repeat and an Enter-then-click
  // pair collapse to one creation (part of the one-click-one-project fix).
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.target && e.target.id === 'newName') {
    e.preventDefault();
    const btn = document.querySelector('[data-action="new"]');
    if (btn && !btn.disabled) btn.click();
    return;
  }
  // Cmd/Ctrl+Enter sends the message you are writing, wherever you are.
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const t = e.target;
    let btn = null;
    if (t.matches && t.matches('[data-draft]')) btn = document.querySelector('[data-action="reply"][data-id="' + CSS.escape(t.dataset.draft) + '"]');
    else if (t.id === 'pPostBody') btn = document.querySelector('[data-action="ppost"]');
    else if (t.matches && t.matches('[data-preplydraft]')) btn = document.querySelector('[data-action="preply"][data-id="' + CSS.escape(t.dataset.preplydraft) + '"]');
    else if (t.matches && t.matches('[data-notedraft]')) btn = document.querySelector('[data-action="noteadd"]');
    else if (t.id === 'smeReplyBody') btn = document.querySelector('[data-action="smereply"]');
    if (btn) { e.preventDefault(); btn.click(); }
    return;
  }
  if (e.key === 'Escape') {
    if (APP.present) { APP.present = false; render(); return; }
    if (APP.palOpen || APP.menuOpen || APP.profileOpen || APP.orgOpen || APP.genOpen || APP.delPending || APP.shareOpen || APP.pasteQ || APP.kbHelp || APP.tplSave) {
      closeModals(); render();
    }
    return;
  }
  if (APP.palOpen) {
    const items = paletteItems(APP);
    if (e.key === 'ArrowDown') { e.preventDefault(); APP.palSel = Math.min((APP.palSel || 0) + 1, items.length - 1); repaintPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); APP.palSel = Math.max((APP.palSel || 0) - 1, 0); repaintPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); execPalette(APP.palSel || 0); }
  }
});

// Recent-edits jump list for the palette: the last eight questions touched,
// most recent first, session memory only.
function noteRecent(qid) {
  if (!qid) return;
  APP.recentQ = [qid, ...(APP.recentQ || []).filter((x) => x !== qid)].slice(0, 8);
}
function closeModals() {
  APP.palOpen = false; APP.menuOpen = false; APP.profileOpen = false;
  APP.orgOpen = false; APP.genOpen = false; APP.delPending = null; APP.delError = null;
  APP.shareOpen = false; APP.pprofOpen = false;
  APP.wsMenuOpen = false; APP.wsCreating = false; APP.briefPickOpen = false;
  APP.pasteQ = null; APP.kbHelp = false; APP.tplSave = null;  APP.helpStudioOpen = false; APP.helpEdit = null;
}

/* Per-project memory of which brief sections the team last shared. */
function briefSecsSaved(pid) {
  try {
    const v = JSON.parse(localStorage.getItem('rp:briefsecs:' + pid) || 'null');
    if (Array.isArray(v) && v.length) return v;
  } catch { /* fall through */ }
  return defaultBriefSections();
}
function briefSecsStore(pid, secs) {
  try { localStorage.setItem('rp:briefsecs:' + pid, JSON.stringify(secs)); } catch { /* private mode */ }
}
function openPalette() {
  closeModals(); APP.palOpen = true; APP.palQ = ''; APP.palSel = 0; render();
  setTimeout(() => { const el = document.getElementById('palInput'); if (el) el.focus(); }, 30);
}
function repaintPalette() {
  // Palette repaint keeps the input's focus by only replacing the list.
  const back = document.querySelector('.pal-list');
  if (!back) { render(); return; }
  const items = paletteItems(APP);
  const sel = Math.min(APP.palSel || 0, Math.max(items.length - 1, 0));
  back.innerHTML = items.length ? items.map((it, i) =>
    '<button class="pal-item' + (i === sel ? ' on' : '') + '" data-action="palgo" data-ix="' + i + '">' + ico(it.ico || IC.fwd, 'i-sm') +
    '<span>' + esc(it.label) + '</span><span class="k">' + esc(it.hint || '') + '</span></button>').join('')
    : '<div style="padding:18px;text-align:center;color:var(--ink-4);font-size:13px">No matches.</div>';
}
async function execPalette(ix) {
  const items = paletteItems(APP);
  const it = items[ix];
  if (!it) return;
  APP.palOpen = false;
  if (it.action === 'open') { openProject(it.id); return; }
  if (it.action === 'tab') { APP.docTab = it.id; render(); return; }
  render();
  const btn = document.createElement('button');
  btn.dataset.action = it.action;
  document.body.appendChild(btn); btn.click(); btn.remove();
}

/* current doc + meta for exports */
function docNow() {
  return currentDocMd(APP, assembleAnswers(APP.fields, APP.rows));
}
/* Assemble the Record of Delivery from state. One place, so the standalone
   download and the close package can never disagree about what the record
   says. */
function rodFromState() {
  const answers = assembleAnswers(APP.fields, APP.rows);
  const signs = Object.values(APP.signs || {}).flat().map((s) => {
    const v = (APP.versions || []).find((x) => x.id === s.version_id);
    return { ...s, version_label: (v && v.label) || '' };
  });
  return buildRecordOfDelivery({
    project: { id: APP.pid, name: APP.pname },
    answers,
    versions: (APP.versions || []).map((v) => ({ ...v, fingerprint: (APP.fingers || {})[v.id] })),
    signatures: signs,
    receipts: Object.values(APP.receipts || {}).flat(),
    lineage: (APP.project && APP.project.born_from_project_id)
      ? { projectId: APP.project.born_from_project_id, seq: APP.project.born_from_seq, fingerprint: APP.project.born_from_fingerprint }
      : null,
    practice: !!(APP.project && APP.project.practice),
    brand: { logo: APP.project && APP.project.brand_logo, brandLabel: APP.project && APP.project.brand_label },
  });
}

function docMeta(d) {
  const a = APP.viewSeq != null && APP.snapshots[APP.viewSeq] ? (APP.snapshots[APP.viewSeq].snapshot.answers || {}) : assembleAnswers(APP.fields, APP.rows);
  const v = APP.viewSeq != null ? APP.versions.find((x) => x.seq === APP.viewSeq) : APP.versions[APP.versions.length - 1];
  const appr = v ? (APP.approvals[v.id] || []) : [];
  const lastDecided = appr.filter((x) => x.status === 'approved' && x.decided_at).map((x) => x.decided_at).sort().pop() || '';
  const snap = APP.viewSeq != null ? APP.snapshots[APP.viewSeq] : null;
  return {
    product: a.ctrl_product || (APP.project && APP.project.name) || 'Untitled',
    practice: !!(APP.project && APP.project.practice),
    bornFrom: (APP.project && APP.project.born_from_project_id)
      ? { projectId: APP.project.born_from_project_id, seq: APP.project.born_from_seq, fingerprint: APP.project.born_from_fingerprint }
      : null,
    org: a.ctrl_org || '', label: d.label || '', status: v ? v.status : 'draft',
    eyebrow: (snap && snap.snapshot.gate) || undefined,
    snapHealth: (snap && Array.isArray(snap.snapshot.health)) ? snap.snapshot.health : undefined,
    // Evidence dates: printing a stored baseline carries the baseline's own
    // date, and the last sign-off date when fully approved.
    baselined: (APP.viewSeq != null && v) ? v.created_at : '',
    approvedAt: (v && v.status === 'approved') ? lastDecided : '',
    approvals: appr,
    logo: (APP.project && APP.project.brand_logo) || '',
    brandLabel: (APP.project && APP.project.brand_label) || ''
  };
}

/* Downscale any uploaded image to a print-safe logo (max 320px, PNG data URL)
   entirely in the browser - no upload service, no new storage bucket. */
function downscaleLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('not an image')); return; }
    if (file.size > 8 * 1024 * 1024) { reject(new Error('too large')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const src = reader.result;
      // SVGs are already vector and tiny; keep as-is if small enough.
      if (file.type === 'image/svg+xml') { resolve(String(src).length < 400000 ? src : null); return; }
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const max = 320;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let out = c.toDataURL('image/png');
        if (out.length > 550000) out = c.toDataURL('image/jpeg', 0.85);  // photos: fall back to JPEG
        resolve(out.length <= 590000 ? out : null);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/* Upload a file through the scanning edge function. The team refreshes the
   authoritative attachments list (it can read the table); partners and SMEs,
   who cannot read it, get an immediate optimistic chip from the response so
   they see their file was accepted and how it was scanned. */
async function doUpload(file, target) {
  if (file.size > 26214400) { toast('That file is over the 25 MB limit'); return; }
  toast('Uploading ' + file.name + '…');
  const r = await repo.uploadAttachment(file, target);
  if (r.error) {
    const m = r.error.message || '';
    toast(/flagged by the virus scanner/i.test(m) ? m
      : /too large|type not allowed|Too many/i.test(m) ? m
      : 'Upload failed. Please try again');
    return;
  }
  const d = r.data || {};
  toast(d.scan_status === 'error' ? 'Uploaded. Scanner unavailable, flagged for the team'
    : d.scan_status === 'clean' ? 'Uploaded. Scanned clean'
    : 'Uploaded ' + (d.file_name || 'file'));
  // Refresh authoritative data so the file persists across reloads: the team
  // reads the attachments table; partners and SMEs re-read their thread (which
  // now carries its own files), each scoped exactly as before.
  if (APP.view === 'workspace') {
    APP.attachments = await repo.attachmentsFor(APP.pid);
  } else if (APP.view === 'smeworkspace') {
    const rr = await repo.smeThread(APP.smeReplyToken);
    if (rr.data && rr.data.ok) APP.smeThread = rr.data;
  } else {
    await loadPartner();
  }
  render();
  return d;
}

/* Fetch display URLs for walkthrough images that lack a live one. Signed URLs
   run an hour; refetch happens lazily on the next call after expiry. */
async function ensureWtUrls() {
  const now = Date.now();
  APP.wtExp = APP.wtExp || {};
  // Wanted set: every live shot, plus the frozen shots of the version on
  // screen. A frozen shot's path resolves through the attachments list, so
  // the sealed record keeps rendering after a shot is detached.
  const wants = {};
  (APP.walkthrough || []).forEach((s) => {
    if (s.attachment && s.attachment.storage_path) wants[s.attachment_id] = s.attachment.storage_path;
  });
  if (APP.viewSeq != null && APP.snapshots[APP.viewSeq]) {
    const frozen = APP.snapshots[APP.viewSeq].snapshot.walkthrough || [];
    if (frozen.length) {
      const attById = {};
      (APP.attachments || []).forEach((a) => { attById[a.id] = a; });
      frozen.forEach((f) => {
        const a = attById[f.attachment_id];
        if (!wants[f.attachment_id] && a && a.storage_path) wants[f.attachment_id] = a.storage_path;
      });
    }
  }
  const need = Object.entries(wants).filter(([id]) =>
    !APP.wtUrls[id] || (APP.wtExp[id] || 0) < now);
  if (!need.length) return;
  await Promise.all(need.map(async ([id, path]) => {
    const u = await repo.wtSignedUrl(path);
    if (u) { APP.wtUrls[id] = u; APP.wtExp[id] = now + 55 * 60 * 1000; }
  }));
  scheduleRender('wturls');
}

/* One shot, downscaled for embedding in the .doc export: capped at 1300px
   wide, JPEG, so a twenty-shot walkthrough stays a sane file size. Returns ''
   when the image cannot be read; the caption still lands. */
function wtEmbedDataUrl(url) {
  return new Promise((res) => {
    if (!url) return res('');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = Math.min(img.naturalWidth || 1300, 1300);
        const h = Math.round(w * (img.naturalHeight || 1) / (img.naturalWidth || 1));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        res(c.toDataURL('image/jpeg', 0.85));
      } catch { res(''); }
    };
    img.onerror = () => res('');
    img.src = url;
  });
}

/* After the brand changes, re-publish live brief shares so external viewers
   (SMEs, partners) pick up the new logo without the team re-sharing. */
async function republishBrandedBriefs() {
  const live = (APP.shares || []).filter((s) => s.kind === 'brief' && !s.revoked);
  for (const s of live) {
    await ensureSnapshot(s.version_seq);
    const answers = APP.snapshots[s.version_seq] ? (APP.snapshots[s.version_seq].snapshot.answers || {}) : assembleAnswers(APP.fields, APP.rows);
    const v = APP.versions.find((x) => x.seq === s.version_seq);
    await repo.sharePut(APP.pid, 'brief', s.version_seq,
      buildSharePayload(APP.project || {}, answers, v ? v.label : '', s.version_seq, 'brief', v ? v.build : '',
        Array.isArray(s.sections) && s.sections.length ? s.sections : briefSecsSaved(APP.pid),
        (APP.snapshots[s.version_seq] && APP.snapshots[s.version_seq].snapshot.walkthrough) || []),
      s.token);
  }
  APP.shares = await repo.sharesFor(APP.pid);
}

/* hash routing (SME links opened while the app is loaded) */
window.addEventListener('hashchange', () => {
  const r = parseHash();
  if (r) routeShare(r);
});

boot();

// Deploy-check handle: lets the runbook health step run one line in the
// browser console. Read-only, same client the app already uses.
try { window.RP = { sb: sbClient }; } catch { /* non-browser */ }
