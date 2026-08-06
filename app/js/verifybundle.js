/* ReqPub v2 - the baseline verification bundle.
   One JSON file holding exactly what the fingerprint covers - {label, seq,
   snapshot} - plus the fingerprint the record captured, so anyone can
   recompute the SHA-256 and compare, with or without ReqPub. Three
   consumers, one code path: the app's export action builds the bundle here,
   the public verify page checks it HERE (same canonicalJson and sha256Hex
   from core.js the fingerprint was born from, so the page can never drift
   from the app), and the CI test asserts the standalone CLI - a
   from-the-spec reimplementation with zero ReqPub imports - agrees with
   this module byte for byte. docs/VERIFY.md is the spec; if this file and
   that document ever disagree, the CI gate is the arbiter and the release
   does not ship. The fingerprint identifies the exact snapshot; it is not a
   signature or a trusted timestamp - cryptographic sealing is the
   e-signature phase and no sealing claim is made before it ships. */

import { canonicalJson, sha256Hex, versionFingerprint } from './core.js';

export const BUNDLE_FORMAT = 'reqpub-baseline-bundle';
export const BUNDLE_RECIPE = 'SHA-256 over the canonical JSON (object keys sorted, arrays in order, UTF-8) of {label, seq, snapshot} for this version, as stored.';
export const NOT_A_SIGNATURE = 'The fingerprint identifies the exact snapshot; it is not a signature or a trusted timestamp.';

/* Build the downloadable bundle text for one stored version row. The
   fingerprint is computed from the same object the bundle carries, so the
   file is self-verifying by construction. Pretty-printed for reading;
   verification parses it back, so the formatting carries no meaning. */
export async function buildVerifyBundle(v, extra) {
  const value = await versionFingerprint(v);
  const e = extra || {};
  const bundle = {
    format: BUNDLE_FORMAT,
    formatVersion: 1,
    ...(e.product ? { product: e.product } : {}),
    ...(e.practice === true ? { practice: true } : {}),   // v2.55: a rehearsal's bundle says so; absent means evidence
    label: v.label,
    seq: v.seq,
    snapshot: v.snapshot,
    fingerprint: { algorithm: 'SHA-256', value, recipe: BUNDLE_RECIPE },
    note: NOT_A_SIGNATURE + ' See docs/VERIFY.md in the ReqPub repository, or reqpub.com/verify.html, for the exact recipe and an independent checker.'
  };
  return JSON.stringify(bundle, null, 2) + '\n';
}

/* Check a bundle's text. Returns:
   { ok:false, error }                        - unusable input
   { ok:true, computed, embedded, match }     - match is true/false against the
     embedded fingerprint (or the caller-supplied expected hex), or null when
     there is nothing to compare against, in which case only computed stands. */
export async function verifyBundleText(text, expectedHex) {
  let obj;
  try { obj = JSON.parse(String(text || '')); }
  catch { return { ok: false, error: 'That is not valid JSON.' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'A bundle is a JSON object.' };
  }
  if (!('label' in obj) || !('seq' in obj) || !('snapshot' in obj)) {
    return { ok: false, error: 'A bundle carries label, seq, and snapshot. One or more are missing.' };
  }
  const canonical = canonicalJson({ label: obj.label, seq: obj.seq, snapshot: obj.snapshot });
  const computed = await sha256Hex(canonical);
  const embedded = String(expectedHex || (obj.fingerprint && obj.fingerprint.value) || '')
    .trim().toLowerCase().replace(/^sha256:/, '').replace(/\s+/g, '');
  return { ok: true, computed, embedded, match: embedded ? computed === embedded : null };
}
/* ---- v2.48: the receipt bundle. A sealed receipt plus everything needed
   to verify it offline: the receipt bytes, the Ed25519 signature and kid,
   the RFC 3161 timestamp replies when present, the published public key,
   and the baseline bundle the receipt seals. docs/VERIFY.md section 9. */
export async function buildReceiptBundle(receiptRow, versionRow, publicKeySpkiBase64, extra) {
  const files = [];
  const rj = receiptRow.receipt_json !== undefined ? receiptRow.receipt_json : receiptRow.receipt;
  if (rj === undefined || rj === null) throw new Error('receipt content missing from the receipt row; expected receipt or receipt_json');
  const receiptText = typeof rj === 'string' ? rj : JSON.stringify(rj, null, 2) + '\n';
  files.push({ name: 'receipt.json', data: receiptText });
  files.push({ name: 'signature.txt', data: 'kid: ' + receiptRow.key_id + '\nsignature_base64: ' + receiptRow.signature_base64 + '\n' });
  files.push({ name: 'publickey.txt', data: 'kid: ' + receiptRow.key_id + '\nalg: Ed25519\npublicKeySpkiBase64: ' + (publicKeySpkiBase64 || '') + '\n' });
  if (receiptRow.tsa_primary_der) files.push({ name: 'tsa_primary.tsr', data: b64ToBytes(receiptRow.tsa_primary_der) });
  if (receiptRow.tsa_secondary_der) files.push({ name: 'tsa_secondary.tsr', data: b64ToBytes(receiptRow.tsa_secondary_der) });
  if (versionRow) files.push({ name: 'baseline-bundle.reqpub.json', data: await buildVerifyBundle(versionRow, extra) });
  files.push({ name: 'VERIFY.txt', data: RECEIPT_VERIFY_STEPS });
  return files;
}

function b64ToBytes(b64) {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const RECEIPT_VERIFY_STEPS = [
  'Verify this receipt offline in three steps. See docs/VERIFY.md section 9.',
  '',
  '1. Baseline. Recompute the fingerprint of baseline-bundle.reqpub.json per',
  '   sections 3 to 5 and confirm it equals receipt.json baseline.docFingerprint.',
  '2. Seal. Canonicalize receipt.json per section 3, take its SHA-256, and',
  '   verify the Ed25519 signature in signature.txt against the key in',
  '   publickey.txt. Node: crypto.verify(null, hashBytes, publicKey, sigBytes).',
  '3. Time. For each .tsr, run the openssl command printed by',
  '   tools/reqpub-verify.mjs against the receipt canonical hash.',
  '',
  'The seal proves this receipt content was signed by the holder of the ReqPub',
  'key and existed at the timestamp authority times. Who typed the name is',
  'evidenced by the signing record, not by the seal.',
].join('\n');
