/* ReqPub v2 - exports: Markdown, Word (.doc), print/PDF, executive summary. */

import { esc, escA, download, copyText, fmtFingerprint } from './core.js';
import { healthStateLine } from './health.js';
import { mdToHtml, execSummaryData, bBrief, defaultBriefSections, revisionBody, mdTable, reqDiff, reqDiffDetail } from './domain.js';

const STATUS_LABEL = { draft: 'Draft', in_review: 'In review', approved: 'Approved', changes_requested: 'Changes requested' };
const ok = (u) => typeof u === 'string' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u);

/* A full-page cover: the assigned collaborator logo leads, ReqPub co-signs in
   the corner, the title and a metadata rail sit on a baseline, and approvals
   render as a signed-off list. Designed to be the first printed page. */
export function coverHTML(meta) {
  const logo = ok(meta.logo)
    ? '<img class="rp-logo" src="' + escA(meta.logo) + '" alt="' + escA(meta.brandLabel || 'Client') + '">'
    : '';
  const label = meta.brandLabel ? '<div class="rp-client">' + esc(meta.brandLabel) + '</div>' : '';
  const statusCls = meta.status || 'draft';
  const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  // Evidence dates: a baseline document carries the date the baseline was
  // created and, when signed off, the date of the last approval decision. Two
  // prints of the same approved version must read the same. The print date is
  // footer metadata, not cover evidence.
  const rail = [
    ['Version', meta.label ? 'v' + meta.label : 'Working draft'],
    ['Status', STATUS_LABEL[meta.status] || 'Draft'],
    meta.org ? ['Prepared by', meta.org] : null,
    [meta.baselined ? 'Baselined' : 'Date', fmtDay(meta.baselined || new Date())],
    meta.approvedAt ? ['Approved', fmtDay(meta.approvedAt)] : null,
    // The record's state when it was fixed. Stored inside the snapshot at
    // generation, so two prints of one baseline carry the same evidence.
    Array.isArray(meta.snapHealth) ? ['Record state', healthStateLine(meta.snapHealth)] : null,
    // The baseline fingerprint identifies the exact snapshot this document was
    // produced from (full value + recipe in the Verification section).
    meta.fingerprint ? ['Fingerprint', fmtFingerprint(meta.fingerprint)] : null,
    // v2.56: a lineage is a citation, not a pipeline. One quiet line naming
    // the record this one was born from, with enough of the fingerprint to
    // check the claim against that baseline offline.
    meta.bornFrom && meta.bornFrom.projectId && meta.bornFrom.fingerprint
      ? ['Born from', meta.bornFrom.projectId + ' baseline ' + meta.bornFrom.seq + ' \u00b7 ' + String(meta.bornFrom.fingerprint).slice(0, 12)]
      : null
  ].filter(Boolean).map(([k, v]) =>
    '<div class="rp-rail-item"><div class="rp-rail-k">' + esc(k) + '</div><div class="rp-rail-v">' + esc(v) + '</div></div>').join('');
  const approvals = (meta.approvals || []).length
    ? '<div class="rp-appr"><div class="rp-appr-h">Approvals</div>' + meta.approvals.map((a) => {
        const decided = a.status === 'approved';
        return '<div class="rp-appr-row"><span class="rp-appr-mark ' + (decided ? 'yes' : '') + '">' +
          (decided ? '&#10003;' : '&middot;') + '</span>' +
          '<span class="rp-appr-role">' + esc(a.approver_role || 'Approver') + (a.approver_name ? ' - ' + esc(a.approver_name) : '') + (a.sign_request_id ? ' <span style="color:#777">(e-signed)</span>' : '') + '</span>' +
          '<span class="rp-appr-state ' + esc(a.status) + '">' + esc(STATUS_LABEL[a.status] || a.status) + '</span></div>';
      }).join('') + '</div>'
    : '';
  return (meta.practice ? '<div style="border:2px solid #b8860b;color:#b8860b;border-radius:10px;padding:10px 14px;margin:0 0 18px;font-weight:700;font-size:12px;letter-spacing:.14em;text-align:center">PRACTICE RECORD \u00b7 a rehearsal, never evidence</div>' : '') +
    '<section class="rp-cover">' +
    '<div class="rp-cover-top">' +
      '<div class="rp-lockup">' + (logo || '<div class="rp-nologo"></div>') + label + '</div>' +
      '<div class="rp-by"><span class="rp-by-t">Published with</span>' +
        '<span class="rp-by-brand"><span class="rp-mk"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>ReqPub</span></div>' +
    '</div>' +
    '<div class="rp-cover-mid">' +
      '<div class="rp-eyebrow">' + esc(meta.eyebrow || 'Requirements Baseline') + '</div>' +
      '<h1 class="rp-title">' + esc(meta.product || 'Untitled') + '</h1>' +
      '<span class="rp-status ' + esc(statusCls) + '">' + esc(STATUS_LABEL[meta.status] || 'Draft') + '</span>' +
    '</div>' +
    '<div class="rp-cover-foot"><div class="rp-rail">' + rail + '</div>' + approvals + '</div>' +
  '</section>';
}

export function fileStem(meta) {
  return ((meta.product || 'requirements').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'requirements') +
    (meta.label ? '-v' + meta.label : '-draft');
}

export async function copyMarkdown(md) { return copyText(md); }

export function downloadMarkdown(md, meta) {
  download(fileStem(meta) + '.md', 'text/markdown;charset=utf-8', md);
}

/* Word opens well-formed HTML saved as .doc; this keeps the export dependency-free. */
/* The walkthrough appendix inside the .doc: images embedded as downscaled
   data URLs (a Word file cannot chase expiring signed links), each with its
   numbered caption. Absent silently when the document has no walkthrough. */
function wordWalkthrough(meta) {
  const shots = (meta && meta.walkthrough) || [];
  if (!shots.length) return '';
  const figs = shots.map((f, i) => {
    const img = f.dataUrl ? '<p style="margin:10pt 0 4pt"><img src="' + escA(f.dataUrl) + '" style="max-width:100%;border:1pt solid #ddd"></p>' : '';
    const cap = '<p style="font-size:10pt;margin:0 0 12pt"><span class="idc">' + (i + 1) + '.</span> ' + esc(f.caption || f.file_name || '') + '</p>';
    return img + cap;
  }).join('');
  return '<h2>Appendix · Demo Walkthrough</h2><p style="font-size:9.5pt;color:#555">Each screenshot shows one action, in the order the build team should read them.</p>' + figs;
}

export function downloadWord(md, meta) {
  const logo = ok(meta.logo)
    ? '<p style="margin:0 0 6pt"><img src="' + escA(meta.logo) + '" style="max-height:54pt;max-width:220pt"></p>' : '';
  const label = meta.brandLabel ? '<div style="font-size:12pt;font-weight:bold;color:#222">' + esc(meta.brandLabel) + '</div>' : '';
  const rail = [meta.label ? 'Version v' + meta.label : 'Working draft', STATUS_LABEL[meta.status] || 'Draft',
    meta.org ? 'Prepared by ' + meta.org : null,
    (meta.baselined ? 'Baselined ' + new Date(meta.baselined).toLocaleDateString() : new Date().toLocaleDateString()) + (meta.approvedAt ? ' · Approved ' + new Date(meta.approvedAt).toLocaleDateString() : '')]
    .filter(Boolean).join('  ·  ');
  const approvals = (meta.approvals || []).length
    ? '<div style="font-family:Consolas,monospace;font-size:9pt;color:#333;margin-top:8pt">Approvals: ' +
      meta.approvals.map((a) => esc((a.approver_role || 'Approver') + (a.approver_name ? ' - ' + a.approver_name : '') +
        (a.sign_request_id ? ', e-signed' : '') + ' (' + (STATUS_LABEL[a.status] || a.status) + ')')).join('; ') + '</div>' : '';
  const cover = '<div class="rp-cover">' + logo + label +
    '<div style="font-family:Consolas,monospace;font-size:8.5pt;letter-spacing:1.5pt;text-transform:uppercase;color:#2563FF;margin-top:10pt">Requirements Baseline</div>' +
    '<div class="rp-title">' + esc(meta.product || 'Untitled') + '</div>' +
    '<div class="rp-meta">' + esc(rail) + '</div>' + approvals +
    '<div style="font-size:8.5pt;color:#888;margin-top:8pt">Published with ReqPub</div></div>';
  const doc = '<!DOCTYPE html><html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">' +
    '<title>' + esc(meta.product || 'Requirements') + '</title><style>' +
    'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111;line-height:1.5;max-width:760px}' +
    'h1{font-size:20pt;margin:0 0 4pt} h2{font-size:14pt;margin:16pt 0 6pt} h3{font-size:12pt;margin:12pt 0 4pt}' +
    '.doc-meta,.part{font-family:Consolas,monospace;font-size:9pt;color:#333;border-top:1pt solid #ddd;border-bottom:1pt solid #ddd;padding:6pt 0;margin:8pt 0}' +
    '.part{border:none;letter-spacing:2pt;text-transform:uppercase;color:#555}' +
    'table{border-collapse:collapse;width:100%;margin:8pt 0;font-size:10pt}' +
    'th,td{border:1pt solid #cfcfcf;padding:4pt 6pt;text-align:left;vertical-align:top}' +
    'th{background:#f1f5ff} .idc{font-family:Consolas,monospace;white-space:nowrap}' +
    '.rp-cover{border-bottom:2.5pt solid #2563FF;padding-bottom:12pt;margin-bottom:18pt}' +
    '.rp-title{font-size:24pt;font-weight:bold;margin:2pt 0;color:#0a0a0a}' +
    '.rp-meta{font-family:Consolas,monospace;font-size:9pt;color:#444;margin-top:8pt}' +
    '</style></head><body>' + cover + mdToHtml(md) + wordWalkthrough(meta) + '</body></html>';
  download(fileStem(meta) + '.doc', 'application/msword', doc);
}

export function printedDocHTML(md, meta) {
  const running = '<div class="rp-runhead"><span>' + esc(meta.product || 'Requirements') + '</span>' +
    '<span>' + esc((meta.label ? 'v' + meta.label + '  ·  ' : '') + (STATUS_LABEL[meta.status] || 'Draft')) + '</span></div>';
  return running + coverHTML(meta) +
    '<div class="rp-body"><div class="md">' + mdToHtml(md).replace(/^<div class="md">|<\/div>$/g, '') + '</div></div>';
}

export function printDoc(md, meta) {
  const area = document.getElementById('printArea');
  if (!area) return;
  area.innerHTML = printedDocHTML(md, meta);
// Give an embedded logo a beat to decode before the print dialog captures it.
  const go = () => window.print();
  const img = area.querySelector('.rp-logo');
  if (img && !img.complete) { img.onload = go; img.onerror = go; setTimeout(go, 400); }
  else go();
}

/* ---- Executive summary ---- */
export function execSummaryHTML(answers, meta) {
  const d = execSummaryData(answers);
  const chip = (n, l) => '<div style="text-align:center;padding:0 18px"><div style="font-size:24px;font-weight:680;letter-spacing:-.02em">' + n + '</div><div class="eyebrow" style="font-size:9px;margin-top:2px">' + esc(l) + '</div></div>';
  const stat = '<div class="card" style="padding:18px;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;margin:18px 0">' +
    chip(d.counts.fr, 'Functional') + chip(d.counts.nfr, 'Non-functional') +
    (d.counts.eval ? chip(d.counts.eval, 'AI eval') : '') + chip(d.counts.ir, 'Interfaces') + chip(d.counts.musts, 'Musts') + '</div>';
  const list = (items, fmt) => items.length ? '<ul>' + items.map((x) => '<li>' + fmt(x) + '</li>').join('') + '</ul>' : '<p style="color:var(--ink-4)">None recorded.</p>';
  return '<div class="md doc-anim">' +
    '<h1>' + esc(d.product) + ' - Executive Summary</h1>' +
    '<div class="doc-meta">' + esc([d.org, meta.label ? 'v' + meta.label : 'Working draft', meta.baselined ? 'Baselined ' + new Date(meta.baselined).toLocaleDateString() : null, 'Printed ' + new Date().toLocaleDateString()].filter(Boolean).join('  ·  ')) + '</div>' +
    (d.vision ? '<h2>Vision</h2><p>' + esc(d.vision) + '</p>' : '') +
    (d.problem ? '<h2>Problem</h2><p>' + esc(d.problem) + '</p>' : '') +
    '<h2>Goals</h2>' + list(d.goals, (g) => esc(g)) +
    '<h2>Success metrics</h2>' + list(d.metrics, (m) => '<strong>' + esc(m.metric || '') + '</strong>' + (m.target ? ': ' + esc(m.target) : '') + (m.method ? ' <span style="color:var(--ink-4)">(' + esc(m.method) + ')</span>' : '')) +
    '<h2>Scale of the specification</h2>' + stat +
    (d.components.length ? '<h2>Components</h2>' + list(d.components, (c) => '<strong>' + esc(c.name || '') + '</strong>' + (c.owner ? ' - ' + esc(c.owner) : '') + (c.status ? ' <span style="color:var(--ink-4)">(' + esc(c.status) + ')</span>' : '')) : '') +
    (d.outOfScope.length ? '<h2>Explicitly out of scope</h2>' + list(d.outOfScope, (x) => esc(x)) : '') +
    '</div>';
}

/* The executive summary as Markdown; shared by the .md download and the
   client baseline report so the two can never drift. */
export function execSummaryMd(answers, meta) {
  const d = execSummaryData(answers);
  return ['# ' + d.product + ' - Executive Summary', '',
    [d.org, meta.label ? 'v' + meta.label : 'Working draft', meta.baselined ? 'Baselined ' + new Date(meta.baselined).toLocaleDateString() : null, 'Printed ' + new Date().toLocaleDateString()].filter(Boolean).join(' · '), '',
    d.vision ? '## Vision\n\n' + d.vision : '', d.problem ? '## Problem\n\n' + d.problem : '',
    '## Goals', ...d.goals.map((g) => '- ' + g), '',
    '## Success metrics', ...d.metrics.map((m) => '- **' + (m.metric || '') + '**' + (m.target ? ': ' + m.target : '')), '',
    '## Requirements', '- Functional: ' + d.counts.fr, '- Non-functional: ' + d.counts.nfr,
    '- AI evaluation: ' + d.counts.eval, '- Interfaces: ' + d.counts.ir, '- Must-priority: ' + d.counts.musts
  ].filter((x) => x !== '').join('\n');
}

export function downloadExecSummary(answers, meta) {
  const d = execSummaryData(answers);
  download(fileStem({ product: d.product + '-summary', label: meta.label }) + '.md', 'text/markdown;charset=utf-8', execSummaryMd(answers, meta));
}

/* ---- Client baseline report ----
   One client-grade document: executive summary, then EXACTLY what a published
   brief may contain (the client-safe sections, built through buildSharePayload
   upstream so the share-scoping boundary is the content boundary - internal
   fields are absent, not hidden), then the revision record, then a
   Verification section carrying the full baseline fingerprint and the recipe
   to recompute it. `briefAnswers` MUST be a payload's answers (already
   scoped + stripped); passing raw worksheet answers here would bypass the
   boundary, so main.js builds the payload first. */
export function clientDocMd(answers, meta, briefAnswers, briefSections, versions) {
  const parts = [execSummaryMd(answers, meta)];
  // Record of engagement: counts only, every number points at rows, and the
  // incorporated list names the client's own inputs by permanent id - "your
  // input became FR-012 and it is in the baseline you signed". Ids and
  // sources only; statements stay behind the share-scoping boundary.
  if (meta.record) {
    const r = meta.record;
    const inc = r.incorporated || [];
    const lines = [[r.versions + ' version' + (r.versions === 1 ? '' : 's'),
      r.signoffs + ' named sign-off' + (r.signoffs === 1 ? '' : 's'),
      inc.length + ' of your inputs incorporated in this baseline'].join(' · ')];
    if (inc.length) lines.push(inc.slice(0, 12).map((x) => '- **' + x.id + '**. From ' + x.src).join('\n') +
      (inc.length > 12 ? '\n- …and ' + (inc.length - 12) + ' more' : ''));
    parts.push('## Record of engagement\n\n' + lines.join('\n\n'));
  }
  const brief = briefAnswers ? bBrief(briefAnswers, briefSections || defaultBriefSections()) : '';
  if (brief) parts.push('## The plan in plain language\n\n_The sections below are exactly what a published review brief contains: the client-safe view of this baseline._\n\n' + brief.replace(/^## /gm, '### '));
  parts.push('## Revision record\n\n' + revisionBody(versions || []));
  if (meta.fingerprint) {
    parts.push('## Verification\n\n' +
      mdTable(['Field', 'Value'], [
        ['Baseline', meta.label ? 'v' + meta.label : 'Working draft'],
        ['Fingerprint (SHA-256)', '`' + meta.fingerprint + '`'],
        ['Recipe', 'SHA-256 over the canonical JSON (object keys sorted, arrays in order, UTF-8) of {label, seq, snapshot} for this version, as stored.']
      ]) +
      (Array.isArray(meta.snapHealth)
        ? '\n\n**Record state at baseline.** ' + healthStateLine(meta.snapHealth) +
          (meta.snapHealth.length ? '\n\n' + meta.snapHealth.map((x) => '- ' + (x.level === 'gap' ? 'Gap' : 'Warning') + (x.count > 1 ? ' ×' + x.count : '') + ': ' + x.label).join('\n') : '')
        : '') +
      '\n\nTwo exports carrying the same fingerprint were produced from byte-identical baselines. ' +
      'The fingerprint identifies the exact snapshot; it is not a signature or a trusted timestamp.' +
      (meta.presentLink ? '\n\nRead-only record: ' + meta.presentLink : ''));
  }
  return parts.join('\n\n');
}

/* Print the client baseline report through the same designed cover/print path
   as the full document; only the eyebrow changes. */
/* The gate packet: the artifact that walks into a steering committee. A gate
   is a named decision, by named deciders, against stated criteria, on a fixed
   artifact - this composes all four from what already exists: the gate name
   (cover eyebrow), the record's state when it was fixed (snapshot.health),
   the per-column evidence diff since the prior baseline (reqDiffDetail), the
   named approvals (cover rail), and the fingerprint with its recipe. When the
   committee decides on this packet, the gate decision has moved to the
   record. Pure composition; the tracker keeps its dashboards. */
export function gatePacketMd(meta, curAnswers, prevAnswers, prevLabel) {
  const P = [];
  P.push('## The decision on the table\n\n' +
    (meta.eyebrow ? '**' + meta.eyebrow + '**. A named decision on baseline v' + meta.label + '.'
                  : 'A gate decision on baseline v' + meta.label + '. (This baseline carries no gate name; name the gate when generating to put it on the cover.)') +
    ' The named deciders and their sign-off state are on the cover; the fingerprint below identifies the exact artifact being decided on.');
  if (Array.isArray(meta.snapHealth)) {
    P.push('## Criteria state at this baseline\n\n' + healthStateLine(meta.snapHealth) +
      (meta.snapHealth.length
        ? '\n\n' + meta.snapHealth.map((x) => '- ' + (x.level === 'gap' ? 'Gap' : 'Warning') + (x.count > 1 ? ' ×' + x.count : '') + ': ' + x.label).join('\n')
        : '\n\nNo readiness gaps or warnings were present when this baseline was fixed.'));
  } else {
    P.push('## Criteria state at this baseline\n\n_No readiness evidence stored. This baseline predates evidence capture. Regenerate to carry it._');
  }
  if (prevAnswers) {
    const rd = reqDiff(prevAnswers, curAnswers || {});
    const det = reqDiffDetail(prevAnswers, curAnswers || {});
    const parts = ['## Changes since v' + prevLabel,
      rd.added.length + ' added · ' + rd.modified.length + ' modified · ' + rd.removed.length + ' removed, by permanent id.'];
    if (rd.added.length) parts.push('**Added.** ' + rd.added.join(', '));
    if (det.length) parts.push(det.map((d) => '**' + d.id + '**\n' + d.changes.map((c) => '- ' + c.label + ': ~~' + (c.from || '(empty)') + '~~ → ' + (c.to || '(empty)')).join('\n')).join('\n\n'));
    if (rd.removed.length) parts.push('**Removed.** ' + rd.removed.join(', '));
    if (!rd.added.length && !det.length && !rd.removed.length) parts.push('No requirement-level changes since the prior baseline.');
    P.push(parts.join('\n\n'));
  } else {
    P.push('## Changes\n\nInitial baseline. There is no prior gate to diff against.');
  }
  if (meta.fingerprint) {
    P.push('## Verification\n\n' + mdTable(['Field', 'Value'], [
      ['Baseline', 'v' + meta.label + (meta.eyebrow ? ' (' + meta.eyebrow + ')' : '')],
      ['Fingerprint (SHA-256)', '`' + meta.fingerprint + '`'],
      ['Recipe', 'SHA-256 over the canonical JSON (object keys sorted, arrays in order, UTF-8) of {label, seq, snapshot} for this version, as stored.']
    ]) + '\n\nThe fingerprint identifies the exact snapshot; it is not a signature or a trusted timestamp.');
  }
  return P.join('\n\n');
}
/* ---- SOW exhibit ----
   The acceptance baseline formatted to attach to a statement of work. Every
   line derives from the record: the signed acceptance table, the
   requirements with fit criteria, the recorded sign-offs, the fingerprint
   with its recipe. Bracketed fields are for counsel; the record supplies
   everything else. This is an artifact of the record, not legal advice, and
   it makes no claim beyond what the record contains. */
export function sowExhibitMd(meta, answers) {
  const a = answers || {};
  const rows = (k) => Array.isArray(a[k]) ? a[k].filter((r) => r && Object.values(r).some((v) => String(v || '').trim())) : [];
  const P = [];
  P.push('## Incorporation\n\nExhibit [letter] to the Statement of Work dated [date] between [client legal name] (Client) and [consultant legal name] (Consultant). This exhibit is the acceptance baseline for the work described in that statement. Bracketed fields are for counsel. Every other line derives from ReqPub record v' + meta.label + '.');
  const ev = rows('eval');
  if (ev.length) P.push('## Acceptance criteria\n\nThe Client accepts the work when each row below meets its threshold. Executed by records who performs the work each criterion accepts, as authored on the baseline.\n\n' +
    mdTable(['Dimension', 'Metric', 'Threshold', 'Eval set', 'Executed by'], ev.map((r) => [r.dim || '', r.metric || '', r.thresh || '', r.dataset || '', r.exec || 'Human'])));
  const fr = rows('fr');
  if (fr.length) P.push('## Functional requirements\n\n' +
    mdTable(['Requirement', 'Fit criterion', 'Priority'], fr.map((r) => [r.stmt || '', r.fit || '', r.pri || ''])));
  const nfr = rows('nfr');
  if (nfr.length) P.push('## Non-functional requirements\n\n' +
    mdTable(['Requirement', 'Fit criterion', 'Priority'], nfr.map((r) => [r.stmt || '', r.fit || '', r.pri || ''])));
  const ap = (meta.approvals || []).filter((x) => x && (x.approver_role || x.approver_name));
  P.push('## Recorded sign-offs\n\n' + (ap.length
    ? mdTable(['Role', 'Name', 'Status', 'Decided'], ap.map((x) => [x.approver_role || '', x.approver_name || '', x.status || '', x.decided_at ? new Date(x.decided_at).toLocaleDateString() : '']))
    : 'No sign-offs are recorded on this baseline yet.'));
  P.push('## Signatures for the agreement\n\n' + mdTable([' ', 'Client', 'Consultant'], [
    ['Signature', ' ', ' '], ['Name', ' ', ' '], ['Title', ' ', ' '], ['Date', ' ', ' ']]));
  if (meta.fingerprint) P.push('## Verification\n\n' + mdTable(['Field', 'Value'], [
    ['Baseline', 'v' + meta.label],
    ['Fingerprint (SHA-256)', '`' + meta.fingerprint + '`'],
    ['Recipe', 'SHA-256 over the canonical JSON (object keys sorted, arrays in order, UTF-8) of {label, seq, snapshot} for this version, as stored.']
  ]) + '\n\nThe client baseline report and the implementation package for this version carry the same fingerprint. The fingerprint identifies the exact snapshot; it is not a signature or a trusted timestamp.');
  return P.join('\n\n');
}
export function printSowExhibit(meta, answers) {
  printDoc(sowExhibitMd(meta, answers), { ...meta, eyebrow: 'SOW Exhibit · Acceptance Baseline' });
}

export function printGatePacket(meta, curAnswers, prevAnswers, prevLabel) {
  printDoc(gatePacketMd(meta, curAnswers, prevAnswers, prevLabel),
    { ...meta, eyebrow: meta.eyebrow || 'Gate Decision' });
}

export function printClientDoc(answers, meta, briefAnswers, briefSections, versions) {
  printDoc(clientDocMd(answers, meta, briefAnswers, briefSections, versions),
    { ...meta, eyebrow: 'Client Baseline Report' });
}
