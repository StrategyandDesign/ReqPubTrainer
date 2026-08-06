/* ReqPub v2.57 - the Record of Delivery. A client-facing close document
   assembled from the record and nothing else: the objective and success
   metrics as they were authored, the baseline sequence with its dates and
   authors, what changed between consecutive approved baselines exactly as
   reqDiffDetail reports it, the accepted thresholds with their named eval
   sets, every signature with what sealing proved about it, the Born from
   citation where one exists, and instructions for verifying all of it
   without ReqPub.

   What this document does not contain is the point. No summary judgment, no
   computed status, no health, no score, no sentence the record did not
   author. Where there is nothing to report, it says so plainly and moves on.
   A reader who wants to know whether the engagement went well must read the
   facts and decide, which is the only honest arrangement. */

import { esc, escA, APP_VERSION, fmtFingerprint } from './core.js';
import { reqDiffDetail } from './domain.js';

const NOTHING_ASSERTED =
  'Every line in this document was authored in the record or computed from it cryptographically. ' +
  'ReqPub asserts no judgment about the work: no status, no score, and no summary the record did not state.';

const fmtDay = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t) ? String(d) : t.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

/* Timestamp language, exactly as docs/VERIFY.md states it. A receipt says
   what it proves and no more. */
export function tsaLine(status) {
  if (status === 'dual') return 'sealed and timestamped by two independent authorities';
  if (status === 'primary') return 'sealed and timestamped by one authority';
  if (status === 'none' || !status) return 'sealed; no timestamp authority responded';
  return 'sealed; timestamp status ' + status;
}

const _row = (k, v) => '<tr><th scope="row">' + esc(k) + '</th><td>' + esc(v) + '</td></tr>';
const empty = (what) => '<p class="rd-empty">' + esc(what) + '</p>';

/* buildRecordOfDelivery(input) -> html string. Pure: every fact arrives in
   input, nothing is fetched, and two calls on one record produce identical
   bytes. input = { project, answers, versions, signatures, receipts,
   lineage, practice, brand } */
export function buildRecordOfDelivery(input) {
  const inp = input || {};
  const project = inp.project || { id: '', name: '' };
  const a = inp.answers || {};
  const versions = (inp.versions || []).slice().sort((x, y) => (x.seq || 0) - (y.seq || 0));
  const signatures = inp.signatures || [];
  const receipts = inp.receipts || [];
  const lineage = inp.lineage || null;
  const brand = inp.brand || {};
  const practice = inp.practice === true;
  const receiptFor = (signId) => receipts.find((r) => r && (r.sign_request_id === signId || r.signRequestId === signId)) || null;

  /* ---- what was agreed, as authored ---- */
  const objective = String(a.ctrl_objective || a.overview_objective || a.objective || '').trim();
  const metricRows = Array.isArray(a.metrics) ? a.metrics.filter((m) => m && Object.values(m).some((v) => String(v || '').trim())) : [];

  const objectiveHTML = objective
    ? '<p>' + esc(objective) + '</p>'
    : empty('The record states no objective.');
  const metricsHTML = metricRows.length
    ? '<table class="rd-t"><thead><tr><th>Metric</th><th>Target</th></tr></thead><tbody>' +
      metricRows.map((m) => '<tr><td>' + esc(m.metric || m.name || '') + '</td><td>' + esc(m.target || m.value || '') + '</td></tr>').join('') +
      '</tbody></table>'
    : empty('The record states no success metrics.');

  /* ---- the baseline sequence ---- */
  const approved = versions.filter((v) => v.status === 'approved');
  const baselineHTML = versions.length
    ? '<table class="rd-t"><thead><tr><th>Baseline</th><th>Seq</th><th>Status</th><th>Author</th><th>Created</th></tr></thead><tbody>' +
      versions.map((v) => '<tr><td class="mono">' + esc(v.label || '') + '</td><td>' + esc(String(v.seq == null ? '' : v.seq)) +
        '</td><td>' + esc(v.status || '') + '</td><td>' + esc(v.author_name || '') + '</td><td>' + esc(fmtDay(v.created_at)) + '</td></tr>').join('') +
      '</tbody></table>'
    : empty('No baseline was generated on this record.');

  /* ---- what changed between consecutive approved baselines ---- */
  let changesHTML;
  if (approved.length < 2) {
    changesHTML = empty(approved.length === 1
      ? 'One approved baseline: there is no prior approved baseline to compare it against.'
      : 'No approved baseline: there is nothing to compare.');
  } else {
    const blocks = [];
    for (let i = 1; i < approved.length; i++) {
      const prev = approved[i - 1], cur = approved[i];
      const det = reqDiffDetail((prev.snapshot && prev.snapshot.answers) || {}, (cur.snapshot && cur.snapshot.answers) || {});
      blocks.push('<h3>' + esc(prev.label || '') + ' to ' + esc(cur.label || '') + '</h3>' +
        (det.length
          ? '<ul class="rd-diff">' + det.map((d) =>
              '<li><span class="mono">' + esc(d.id) + '</span>: ' +
              d.changes.map((c) => esc(c.label || c.col) + ' changed').join(', ') + '</li>').join('') + '</ul>'
          : empty('No requirement changed between these baselines.')));
    }
    changesHTML = blocks.join('');
  }

  /* ---- accepted thresholds ---- */
  const evals = Array.isArray(a.eval) ? a.eval.filter((e) => e && String(e.thresh || '').trim()) : [];
  const thresholdHTML = evals.length
    ? '<table class="rd-t"><thead><tr><th>Quality dimension</th><th>Metric and method</th><th>Threshold</th><th>Eval set</th><th>Executed by</th></tr></thead><tbody>' +
      evals.map((e) => '<tr><td>' + esc(e.dim || '') + '</td><td>' + esc(e.metric || '') + '</td><td>' + esc(e.thresh || '') +
        '</td><td>' + esc(e.dataset || '') + '</td><td>' + esc(e.exec || '') + '</td></tr>').join('') +
      '</tbody></table>'
    : empty('The record states no evaluation thresholds.');

  /* ---- signatures, and what sealing proved ---- */
  const signed = signatures.filter((s) => s && s.status === 'signed' && !s.revoked);
  const signatureHTML = signed.length
    ? '<table class="rd-t"><thead><tr><th>Signer</th><th>Role</th><th>Baseline</th><th>Signed</th><th>Seal</th></tr></thead><tbody>' +
      signed.map((s) => {
        const r = receiptFor(s.id);
        const seal = r
          ? tsaLine(r.tsa_status) + ' \u00b7 receipt ' + String(r.canonical_hash || '').slice(0, 12)
          : 'not sealed';
        return '<tr><td>' + esc(s.signed_name || s.signer_name || '') + '</td><td>' + esc(s.signer_role || '') +
          '</td><td class="mono">' + esc(s.version_label || '') + '</td><td>' + esc(fmtDay(s.signed_at)) +
          '</td><td>' + esc(seal) + '</td></tr>';
      }).join('') + '</tbody></table>'
    : empty('No signature was captured on this record.');

  /* ---- the citation, where one exists ---- */
  const lineageHTML = (lineage && lineage.projectId && lineage.fingerprint)
    ? '<p>Born from ' + esc(lineage.projectId) + ' baseline ' + esc(String(lineage.seq)) +
      ' \u00b7 <span class="mono">' + esc(String(lineage.fingerprint).slice(0, 12)) + '</span></p>'
    : '';

  const fingerprints = versions.filter((v) => v.fingerprint).map((v) =>
    '<li><span class="mono">' + esc(v.label || '') + '</span> ' + esc(fmtFingerprint(v.fingerprint)) + '</li>').join('');

  const mark = practice
    ? '<div class="rd-practice">PRACTICE RECORD &middot; a rehearsal, never evidence</div>'
    : '';
  const logo = brand.logo && /^https:\/\//.test(String(brand.logo))
    ? '<img class="rd-logo" src="' + escA(brand.logo) + '" alt="' + escA(brand.brandLabel || 'Client') + '">'
    : '';

  return '<!doctype html>\n<html><head><meta charset="utf-8"><title>' + esc('Record of Delivery: ' + project.name) + '</title>' +
    '<style>' +
    'body{font:14px/1.55 Georgia,serif;color:#1a1a1a;max-width:760px;margin:44px auto;padding:0 26px}' +
    'h1{font-size:23px;margin:0 0 2px}h2{font-size:15px;margin:30px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}' +
    'h3{font-size:13px;margin:16px 0 5px;font-weight:640}.sub{color:#666;font-size:12px;margin:0 0 20px}' +
    '.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}' +
    '.rd-t{border-collapse:collapse;width:100%;font-size:12.5px;margin:6px 0}' +
    '.rd-t th,.rd-t td{border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top}' +
    '.rd-t thead th{background:#f6f6f4;font-weight:640}' +
    '.rd-empty{color:#666;font-size:12.5px;font-style:italic;margin:6px 0}' +
    '.rd-diff{margin:6px 0;padding-left:20px;font-size:12.5px}' +
    '.rd-practice{border:2px solid #b8860b;color:#b8860b;border-radius:10px;padding:9px 14px;margin:0 0 18px;font-weight:700;font-size:12px;letter-spacing:.14em;text-align:center}' +
    '.rd-logo{max-height:46px;max-width:190px;object-fit:contain;margin-bottom:12px;display:block}' +
    '.rd-foot{margin-top:28px;border-top:1px solid #ddd;padding-top:10px;color:#555;font-size:11.5px}' +
    '@media print{body{margin:0;max-width:none}h2{break-after:avoid}.rd-t{break-inside:avoid}}' +
    '</style></head><body>' +
    mark + logo +
    '<h1>Record of Delivery</h1>' +
    '<p class="sub">' + esc(project.name) + (brand.brandLabel ? ' &middot; ' + esc(brand.brandLabel) : '') + ' &middot; ReqPub v' + esc(APP_VERSION) + '</p>' +
    lineageHTML +
    '<h2>Objective</h2>' + objectiveHTML +
    '<h2>Success metrics</h2>' + metricsHTML +
    '<h2>Baselines</h2>' + baselineHTML +
    '<h2>What changed between approved baselines</h2>' + changesHTML +
    '<h2>Accepted thresholds</h2>' + thresholdHTML +
    '<h2>Signatures</h2>' + signatureHTML +
    '<h2>Verifying this record</h2>' +
    '<p>Each baseline below carries the SHA-256 fingerprint of its exact snapshot. Recompute it from the ' +
    'baseline bundle with the recipe published in docs/SPEC.md, or check a sealed receipt and its RFC 3161 ' +
    'timestamps with the standalone checker described in docs/VERIFY.md. Neither requires an account, and ' +
    'neither requires ReqPub to still exist.</p>' +
    (fingerprints ? '<ul class="rd-diff">' + fingerprints + '</ul>' : empty('No baseline fingerprint is recorded.')) +
    '<div class="rd-foot">' + esc(NOTHING_ASSERTED) + '</div>' +
    '</body></html>\n';
}

export { NOTHING_ASSERTED };

/* buildClosePackage({gather, rod, product, generatedAt}) -> { files }
   The Record of Delivery plus the evidence pack's contents, flattened into
   one zip under a single manifest. The pack's own manifest is replaced, not
   duplicated: two manifests describing one archive is an invitation to check
   the wrong one. Deterministic except the moment recorded in the manifest. */
export async function buildClosePackage(input) {
  const { buildEvidencePack } = await import('./evidencepack.js');
  const inp = input || {};
  const generatedAt = inp.generatedAt || new Date().toISOString();
  const pack = await buildEvidencePack(inp.gather || {}, { product: inp.product, generatedAt });
  const files = [{ name: 'record-of-delivery.html', data: inp.rod }];
  for (const f of pack.files) {
    if (f.name === 'manifest.json') continue;          // one manifest per archive
    files.push({ name: f.name, data: f.data });
  }
  const enc = new TextEncoder();
  const listed = [];
  for (const f of files) {
    const bytes = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    listed.push({ name: f.name, sha256: [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('') });
  }
  const manifest = {
    format: 'reqpub-close-package-manifest', formatVersion: 1,
    project: { id: (inp.gather && inp.gather.project && inp.gather.project.id) || '', name: inp.product || '' },
    generatedAt, files: listed,
  };
  files.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) + '\n' });
  return { files, manifest };
}
