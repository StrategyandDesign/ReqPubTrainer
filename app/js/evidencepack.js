/* ReqPub v2.52 - the evidence pack builder. Pure: one evidence_gather payload
   in, a deterministic list of files out, ready for zipStore. Runs unchanged in
   the browser and in Node's test runner; nothing here touches the network, the
   DOM outside esc(), or a clock except the injectable generatedAt.

   The pack is what a lawyer, an auditor, or a carrier holds: what was agreed,
   what changed, who signed, provable. Per-file bytes are deterministic for an
   unchanged record; generatedAt lives only in manifest.json, so two exports of
   the same state differ in exactly one file, and that file says why.

   No token, no email address, no activity meta appears in any file. The
   gather already enforces that at the source; the tests grep the built pack
   anyway, because the discipline is only real if it is asserted twice. */

import { esc, nowISO, APP_VERSION } from './core.js';
import { buildVerifyBundle, buildReceiptBundle } from './verifybundle.js';

/* CSV discipline, RFC 4180 plus the formula-injection rule: any cell whose
   first character could make a spreadsheet execute it (= + - @ tab CR) is
   prefixed with a single quote before quoting. Every csv in the pack goes
   through this one function. */
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
const csvLine = (cells) => cells.map(csvCell).join(',');
const csv = (header, rows) => [csvLine(header), ...rows.map(csvLine)].join('\r\n') + '\r\n';

/* SHA-256 over exact bytes, for the manifest: files include binary .tsr
   entries, so this hashes Uint8Array content, not text. */
async function sha256HexBytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const enc = new TextEncoder();
const toBytes = (d) => (typeof d === 'string' ? enc.encode(d) : d);

const README = (p) => [
  'REQPUB EVIDENCE PACK',
  '',
  'Project: ' + p.name + ' (' + p.id + ')',
  'Produced by ReqPub v' + APP_VERSION + '. Layout and manifest recipe:',
  'docs/VERIFY.md section 11. Verify the whole pack offline:',
  '',
  '  node tools/reqpub-verify.mjs --evidence <this folder>',
  '',
  'WHAT THIS PACK PROVES',
  'Content integrity: each baseline bundle reproduces its fingerprint under',
  'the published canonical recipe. Seal authenticity: each receipt verifies',
  'against its Ed25519 key in publickey.txt. Existence times: the .tsr files',
  'are RFC 3161 timestamps; the printed openssl commands check them. Trail',
  'sequence: chain-verification.json is the project chain result, recomputed',
  'per VERIFY.md section 8.',
  '',
  'WHAT THIS PACK DOES NOT DO',
  'No computed status. No summary judgment. No claim outside the record.',
  'Activity meta is omitted, and the omission is stated in chronology.json.',
  'Signer identity is name, role, and email domain; no address, no token,',
  'appears anywhere in this pack.',
  '',
  'Mapping to revenue recognition judgments belongs to the firm and its',
  'auditors; ReqPub asserts none.',
  '',
].join('\n');

const VERIFY_EXCERPT = [
  'VERIFY.md, the working excerpt. The full document ships with the',
  'repository and at reqpub.com; this is the part a verifier needs first.',
  '',
  'Canonical JSON (section 3): object keys sorted; arrays in order; strings,',
  'numbers, booleans, and null exactly as JSON.stringify emits them;',
  'undefined pinned to null; UTF-8 bytes hashed with SHA-256.',
  '',
  'A baseline fingerprint (sections 4 to 6) is SHA-256 over the canonical',
  'JSON of {label, seq, snapshot}. A receipt seal (section 9) is an Ed25519',
  'signature over the SHA-256 of the canonical receipt JSON; the .tsr files',
  'are RFC 3161 timestamps over that hash, checked with openssl ts.',
  '',
  'The pack manifest (section 11): manifest.json lists every other file with',
  'its SHA-256 over exact bytes. generatedAt lives only in the manifest, so',
  'per-file hashes are deterministic for an unchanged record. Verification',
  'is strict both ways: a listed file that is missing or changed fails, and',
  'a file present but unlisted fails.',
  '',
].join('\n');

function coverHtml(p, counts) {
  const row = (k, v) => '<tr><td class="k">' + esc(k) + '</td><td>' + esc(v) + '</td></tr>';
  return '<!doctype html>\n<html><head><meta charset="utf-8"><title>' + esc('Evidence pack: ' + p.name) + '</title>' +
    '<style>body{font:14px/1.5 Georgia,serif;color:#1a1a1a;max-width:680px;margin:48px auto;padding:0 24px}' +
    'h1{font-size:22px;margin:0 0 4px}.sub{color:#666;font-size:12px;margin:0 0 28px}' +
    'table{border-collapse:collapse;width:100%;margin:16px 0}td{border-top:1px solid #ddd;padding:7px 10px;vertical-align:top}' +
    'td.k{color:#666;width:200px}p.note{font-size:12px;color:#444;border-top:1px solid #ddd;padding-top:14px;margin-top:26px}' +
    '@media print{body{margin:16px auto}}</style></head><body>' +
    '<h1>Evidence pack</h1><p class="sub">' + esc(p.name) + ' &middot; ReqPub v' + esc(APP_VERSION) + ' &middot; produced at the moment recorded in manifest.json</p>' +
    '<table>' +
    row('Project id', p.id) +
    row('Baselines', counts.versions) +
    row('Signatures', counts.signatures) +
    row('Sealed receipts', counts.receipts) +
    row('Attachments', counts.attachments) +
    row('Chain', counts.chain) +
    '</table>' +
    '<p class="note">This pack proves content integrity per fingerprint, seal authenticity per Ed25519, ' +
    'existence times per the RFC 3161 timestamps, and trail sequence per the chain. It carries no computed ' +
    'status, no summary judgment, and no claim outside the record. Verify offline: ' +
    'node tools/reqpub-verify.mjs --evidence &lt;folder&gt;. Layout: docs/VERIFY.md section 11.</p>' +
    '</body></html>\n';
}

/* The builder. gather is evidence_gather's payload (ok already true; the
   caller handles refusals). Returns { files, manifest } where files is the
   full list including manifest.json, in pack order. */
export async function buildEvidencePack(gather, opts = {}) {
  const g = gather || {};
  const p = g.project || { id: '', name: '' };
  const generatedAt = opts.generatedAt || nowISO();
  const product = opts.product || p.name || 'ReqPub';
  const files = [];

  const chron = Array.isArray(g.chronology) ? g.chronology : [];
  const versions = Array.isArray(g.versions) ? g.versions : [];
  const signatures = Array.isArray(g.signatures) ? g.signatures : [];
  const receipts = Array.isArray(g.receipts) ? g.receipts : [];
  const attachments = Array.isArray(g.attachments) ? g.attachments : [];
  const keys = Array.isArray(g.keys) ? g.keys : [];
  const chain = g.chain || {};

  files.push({ name: 'README.txt', data: README(p) });

  files.push({ name: 'chronology.json', data: JSON.stringify({
    metaOmitted: g.metaOmitted === true,
    metaNote: g.metaNote || '',
    entries: chron,
  }, null, 2) + '\n' });
  files.push({ name: 'chronology.csv', data: csv(
    ['at', 'action', 'kind', 'ref', 'actor', 'message'],
    chron.map((a) => [a.at, a.action, a.kind, a.ref, a.actor, a.message])) });

  const headSeq = chain.ok === true ? chain.head_seq : '';
  const headHash = chain.ok === true ? chain.head_hash : '';
  files.push({ name: 'evidence.csv', data: csv(
    ['project_id', 'project_name', 'version_label', 'seq', 'doc_fingerprint',
     'signer_name', 'signer_role', 'signer_email_domain', 'signed_at',
     'receipt_id', 'canonical_hash', 'tsa_status', 'sealed_at',
     'chain_head_seq', 'chain_head_hash'],
    signatures.map((s) => {
      const r = receipts.find((x) => x.receiptId === s.receiptId) || {};
      return [p.id, p.name, s.versionLabel, s.versionSeq, s.docFingerprint,
        s.signerName, s.signerRole, s.signerEmailDomain || '', s.signedAt || '',
        s.receiptId || '', r.canonicalHash || '', r.tsaStatus || '', r.sealedAt || '',
        headSeq, headHash];
    })) });

  files.push({ name: 'attachments-manifest.csv', data: csv(
    ['file_name', 'mime', 'size_bytes', 'sha256_hex', 'scan_status', 'created_at'],
    attachments.map((a) => [a.fileName, a.mime, a.sizeBytes, a.sha256Hex, a.scanStatus, a.createdAt])) });

  files.push({ name: 'chain-verification.json', data: JSON.stringify({
    pointer: 'Recompute per docs/VERIFY.md section 8; this object is verify_project_chain output verbatim.',
    result: chain,
  }, null, 2) + '\n' });

  for (const v of versions) {
    files.push({ name: 'versions/baseline-' + v.seq + '.reqpub.json',
      data: await buildVerifyBundle({ label: v.label, seq: v.seq, snapshot: v.snapshot }, { product }) });
  }

  for (const r of receipts) {
    const ver = versions.find((v) => v.seq === r.versionSeq);
    const key = keys.find((k) => k.kid === r.keyId) || {};
    const row = { receipt_json: r.receiptJson, signature_base64: r.signatureBase64,
      key_id: r.keyId, canonical_hash: r.canonicalHash,
      tsa_primary_der: r.tsaPrimaryDer, tsa_secondary_der: r.tsaSecondaryDer };
    const dir = 'receipts/' + String(r.canonicalHash || r.receiptId).slice(0, 8) + '/';
    const bundle = await buildReceiptBundle(row,
      ver ? { label: ver.label, seq: ver.seq, snapshot: ver.snapshot } : null,
      key.publicKeySpkiBase64 || '', { product });
    for (const f of bundle) files.push({ name: dir + f.name, data: f.data });
  }

  files.push({ name: 'VERIFY-excerpt.txt', data: VERIFY_EXCERPT });
  files.push({ name: 'cover.html', data: coverHtml(p, {
    versions: versions.length, signatures: signatures.length,
    receipts: receipts.length, attachments: attachments.length,
    chain: chain.ok === true
      ? 'ok, head seq ' + chain.head_seq
      : (chain.ok === false ? 'divergence at seq ' + chain.divergence_seq : 'not computed'),
  }) });

  const manifestFiles = [];
  for (const f of files) {
    manifestFiles.push({ name: f.name, sha256: await sha256HexBytes(toBytes(f.data)) });
  }
  const manifest = {
    format: 'reqpub-evidence-manifest', formatVersion: 1,
    project: { id: p.id, name: p.name },
    generatedAt,
    recipe: 'sha256 over the exact bytes of each listed file; verification is strict both ways per docs/VERIFY.md section 11',
    files: manifestFiles,
  };
  files.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) + '\n' });
  return { files, manifest };
}

/* Strict CSV reader for the round-trip test and any tooling that wants it:
   parses exactly what csv() above emits, rejecting anything malformed. */
export function parseCsvStrict(text) {
  const rows = []; let row = []; let cell = ''; let i = 0; let inQ = false;
  const s = String(text);
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"') { if (cell !== '') throw new Error('quote inside bare cell'); inQ = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 2; continue; }
    if (c === '\n') throw new Error('bare LF; the pack emits CRLF');
    cell += c; i++;
  }
  if (inQ) throw new Error('unterminated quote');
  if (cell !== '' || row.length) throw new Error('missing trailing CRLF');
  return rows;
}
