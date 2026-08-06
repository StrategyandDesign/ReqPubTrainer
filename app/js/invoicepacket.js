/* ReqPub v2.55 - the invoice packet. Acceptance evidence for one signature,
   suitable for attachment to an invoice: the receipt, its Ed25519 signature
   line, the RFC 3161 timestamps present, one evidence row in the frozen
   columns, and a printable cover that says exactly what this is and how to
   verify it. Built on demand, stored nowhere, deterministic except the
   moment recorded in its manifest. The chain columns carry the receipt's
   own at-seal snapshot: recorded facts, never a fresh verdict. */

import { esc, sha256Hex, APP_VERSION, canonicalJson } from './core.js';
import { csvCell } from './evidencepack.js';

const enc = new TextEncoder();
const toBytes = (d) => (typeof d === 'string' ? enc.encode(d) : d);
async function sha256HexBytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const COLS = ['project_id', 'project_name', 'version_label', 'seq', 'doc_fingerprint',
  'signer_name', 'signer_role', 'signer_email_domain', 'signed_at', 'receipt_id',
  'canonical_hash', 'tsa_status', 'sealed_at', 'chain_head_seq', 'chain_head_hash'];

function cover(project, rj, practice) {
  const mark = practice
    ? '<div style="border:2px solid #b8860b;color:#b8860b;border-radius:10px;padding:8px 14px;margin:0 0 18px;font-weight:700;font-size:12px;letter-spacing:.14em;text-align:center">PRACTICE RECORD &middot; a rehearsal, never evidence</div>'
    : '';
  return '<!doctype html>\n<html><head><meta charset="utf-8"><title>' + esc('Invoice packet: ' + project.name) + '</title>' +
    '<style>body{font:14px/1.5 Georgia,serif;color:#1a1a1a;max-width:640px;margin:48px auto;padding:0 24px}' +
    'h1{font-size:20px;margin:0 0 4px}.sub{color:#666;font-size:12px;margin:0 0 22px}p{margin:0 0 12px}</style></head><body>' +
    mark +
    '<h1>Invoice packet</h1><p class="sub">' + esc(project.name) + ' &middot; ReqPub v' + esc(APP_VERSION) + '</p>' +
    '<p>This packet is acceptance evidence for one signature, suitable for attachment to an invoice: ' +
    'the sealed receipt, its Ed25519 signature, the RFC 3161 timestamps present at seal time, and one ' +
    'evidence row in the standard columns. It carries no computed status and no claim outside the record.</p>' +
    '<p>Signed by ' + esc((rj.signature && rj.signature.signedName) || '') +
    (rj.signature && rj.signature.signerRole ? ', ' + esc(rj.signature.signerRole) : '') +
    ' on baseline ' + esc((rj.baseline && rj.baseline.label) || '') + '.</p>' +
    '<p>Verify offline: recompute the receipt hash and check the signature per docs/VERIFY.md section 9; ' +
    'check each .tsr with the printed openssl ts command. The manifest lists every file with its SHA-256.</p>' +
    '</body></html>\n';
}

/* buildInvoicePacket({receipt, sign, version, project, generatedAt}) ->
   { files } ready for zipStore. receipt is the stored row (receipt_json,
   signature_base64, key_id, canonical_hash, tsa_*_der, sealed_at). */
export async function buildInvoicePacket(input) {
  const rc = input.receipt || {};
  const sg = input.sign || {};
  const ver = input.version || {};
  const project = input.project || { id: '', name: '' };
  const generatedAt = input.generatedAt || new Date().toISOString();
  const rj = (typeof rc.receipt_json === 'string' ? JSON.parse(rc.receipt_json) : rc.receipt_json) || {};
  const practice = project.practice === true || rj.practice === true;

  const files = [];
  const receiptText = JSON.stringify(rj, null, 2) + '\n';
  files.push({ name: 'receipt.json', data: receiptText });
  files.push({ name: 'signature.txt', data: 'kid: ' + (rc.key_id || '') + '\nsignature_base64: ' + (rc.signature_base64 || '') + '\n' });
  if (rc.tsa_primary_der) files.push({ name: 'tsa_primary.tsr', data: b64ToBytes(rc.tsa_primary_der) });
  if (rc.tsa_secondary_der) files.push({ name: 'tsa_secondary.tsr', data: b64ToBytes(rc.tsa_secondary_der) });

  const row = {
    project_id: project.id, project_name: project.name,
    version_label: (rj.baseline && rj.baseline.label) || ver.label || '',
    seq: (rj.baseline && rj.baseline.seq) != null ? rj.baseline.seq : (ver.seq != null ? ver.seq : ''),
    doc_fingerprint: (rj.baseline && rj.baseline.docFingerprint) || (sg && sg.doc_fingerprint) || '',
    signer_name: (rj.signature && rj.signature.signedName) || (sg && sg.signed_name) || '',
    signer_role: (rj.signature && rj.signature.signerRole) || (sg && sg.signer_role) || '',
    signer_email_domain: (rj.signature && rj.signature.signerEmailDomain) || '',
    signed_at: (rj.signature && rj.signature.signedAt) || (sg && sg.signed_at) || '',
    receipt_id: rc.id || rj.receiptId || '',
    canonical_hash: rc.canonical_hash || '',
    tsa_status: rc.tsa_status || '',
    sealed_at: rc.sealed_at || rj.sealedAt || '',
    chain_head_seq: rj.chain && rj.chain.headSeq != null ? rj.chain.headSeq : '',
    chain_head_hash: (rj.chain && rj.chain.headHash) || '',
  };
  files.push({ name: 'evidence-row.csv',
    data: [COLS.map(csvCell).join(','), COLS.map((c) => csvCell(row[c])).join(',')].join('\r\n') + '\r\n' });

  files.push({ name: 'cover.html', data: cover(project, rj, practice) });

  const listed = [];
  for (const f of files) listed.push({ name: f.name, sha256: await sha256HexBytes(toBytes(f.data)) });
  const manifest = {
    format: 'reqpub-invoice-packet-manifest', formatVersion: 1,
    project: { id: project.id, name: project.name },
    receiptId: row.receipt_id, generatedAt,
    files: listed,
  };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const manifestCanonicalSha256 = await sha256Hex(canonicalJson(manifest));
  files.push({ name: 'packet-manifest.json',
    data: manifestText.replace('\n}', ',\n  "manifestCanonicalSha256": "' + manifestCanonicalSha256 + '"\n}') });
  return { files, manifest };
}
