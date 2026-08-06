#!/usr/bin/env node
/* ============================================================================
   reqpub-verify - independent baseline fingerprint checker.

   Single file. Node built-ins only. Deliberately imports NOTHING from
   ReqPub: everything below is reimplemented from docs/VERIFY.md, so this
   tool is proof that the published recipe is sufficient to verify a
   baseline without the platform. CI asserts this tool and the app's own
   code agree byte for byte on a bundle the current export code produced;
   if the spec and the implementation ever drift, that gate fails and the
   release does not ship.

   Usage:
     node tools/reqpub-verify.mjs <bundle.json>
     node tools/reqpub-verify.mjs <bundle.json> <expected-sha256-hex>
     node tools/reqpub-verify.mjs --print-canonical <bundle.json>

   A bundle is the JSON file ReqPub exports for a baseline: an object
   carrying label, seq, and snapshot, usually with the recorded fingerprint
   embedded under fingerprint.value. This tool recomputes SHA-256 over the
   canonical JSON of {label, seq, snapshot} and compares it to the embedded
   value, or to the expected hex you pass (say, copied from a printed
   export). --print-canonical writes the exact canonical byte stream to
   stdout instead, for anyone reimplementing the recipe themselves.

   Exit codes: 0 verified. 1 mismatch. 2 unusable input or nothing to
   compare against.

   What a match proves: the snapshot in this file is byte-identical, under
   the canonical form, to the one the fingerprint was computed from. What it
   does not prove: who produced it or when. The fingerprint is not a
   signature and not a trusted timestamp; cryptographic sealing is the
   e-signature phase of ReqPub and no sealing claim is made before it ships.
   ============================================================================ */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, verify as edVerify, createPublicKey } from 'node:crypto';

/* Canonical JSON, restated from docs/VERIFY.md section 3:
   - null, booleans, numbers, and strings serialize exactly as ECMAScript
     JSON.stringify serializes them.
   - undefined (unreachable after JSON.parse, but pinned for completeness)
     serializes as the four bytes `null` in array position and is dropped
     from objects.
   - Arrays keep their order: `[` + elements joined by `,` + `]`.
   - Objects drop undefined-valued keys, sort the remaining keys by UTF-16
     code units (the ECMAScript default string sort), and serialize as
     `{` + `"key":value` pairs joined by `,` + `}` with keys JSON-escaped.
   - No whitespace anywhere.
   The hash is SHA-256 over the UTF-8 bytes of that string, reported as 64
   lowercase hex characters. */
function canonical(v) {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'undefined') return 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return 'null';
}

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const hexToBytes = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

/* Receipt-bundle mode, restated from docs/VERIFY.md section 9. Steps 1 and 2
   are performed here on node builtins; step 3 (RFC 3161) is delegated to the
   printed openssl commands, as the doc says. Imports nothing from ReqPub. */
function verifyReceiptDir(dir) {
  let missing = null;
  const rd = (n) => {
    try { return readFileSync(join(dir, n), 'utf8'); }
    catch { out('MISMATCH  ' + n + ' is missing from the bundle folder'); missing = n; return ''; }
  };
  let receipt;
  try { receipt = JSON.parse(rd('receipt.json')); if (missing) return { ok: false }; }
  catch { if (!missing) out('MISMATCH  receipt.json is not valid JSON'); return { ok: false }; }
  // Step 1: baseline fingerprint.
  let baselineOk = null;
  if (existsSync(join(dir, 'baseline-bundle.reqpub.json'))) {
    const b = JSON.parse(rd('baseline-bundle.reqpub.json'));
    const bHash = sha256Hex(canonical({ label: b.label, seq: b.seq, snapshot: b.snapshot }));
    const b0 = receipt.baseline || {};
    const claimed = b0.docFingerprint || b0.recomputedFingerprint || '';
    const legacy = !b0.docFingerprint && !!b0.recomputedFingerprint;
    baselineOk = bHash === claimed;
    out('baseline  computed sha256:' + bHash);
    out('baseline  receipt claims sha256:' + claimed + (legacy ? '  (recomputed at seal; capture at send was absent)' : ''));
    if (!baselineOk) { out('MISMATCH  the sealed baseline does not match the receipt'); return { ok: false }; }
  }
  // Step 2: Ed25519 over the canonical receipt hash.
  const canonHash = sha256Hex(canonical(receipt));
  const pubText = rd('publickey.txt');
  const spki = (pubText.match(/publicKeySpkiBase64:\s*(\S+)/) || [])[1] || '';
  const sigText = rd('signature.txt');
  const sig = (sigText.match(/signature_base64:\s*(\S+)/) || [])[1] || '';
  if (missing) return { ok: false };
  if (!spki || !sig) { out('MISMATCH  signature.txt or publickey.txt is incomplete'); return { ok: false }; }
  if (spki.startsWith('SET-AT-DEPLOY')) { out('MISMATCH  publickey.txt is the deploy placeholder; register the real key (runbook step 5) and re-download the bundle'); return { ok: false }; }
  let key;
  try { key = createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' }); }
  catch { out('MISMATCH  publickey.txt does not contain a valid Ed25519 SPKI key'); return { ok: false }; }
  const sealOk = edVerify(null, hexToBytes(canonHash), key, Buffer.from(sig, 'base64'));
  const kid = (pubText.match(/kid:\s*(\S+)/) || [])[1] || '(none)';
  out('seal      canonical sha256:' + canonHash);
  out('seal      kid ' + kid + ', Ed25519 ' + (sealOk ? 'valid against the key in this bundle' : 'INVALID'));
  if (!sealOk) { out('MISMATCH  the Ed25519 seal does not verify against the key in publickey.txt'); return { ok: false }; }
  out('trust     CONFIRM this key is genuine: fetch https://reqpub.com/reqpub-keys.json');
  out('trust     and check the publicKeySpkiBase64 for kid ' + kid + ' matches publickey.txt.');
  out('trust     A valid signature only proves the holder of THIS key signed it.');
  // Step 3: printed openssl commands for any .tsr present.
  for (const t of ['tsa_primary.tsr', 'tsa_secondary.tsr']) {
    if (existsSync(join(dir, t))) {
      out('time      to verify ' + t + ', run:');
      out('            openssl ts -verify -digest ' + canonHash + ' -in ' + t + ' -CAfile <tsa-ca.pem>');
    }
  }
  out('SEALED-VERIFIED  baseline' + (baselineOk === false ? ' FAILED' : baselineOk === null ? ' not included' : ' matches') + ', Ed25519 seal valid against the bundled key (kid ' + kid + '); confirm that key against reqpub-keys.json per the trust lines above, and verify any .tsr with the printed openssl commands');
  return { ok: true };
}

const out = (s) => process.stdout.write(s + '\n');

/* Evidence-pack mode, restated from docs/VERIFY.md section 11. Strict both
   ways: every manifest entry must exist with its exact byte hash, and every
   file on disk must be listed. Then every baseline bundle and every receipt
   folder is verified through the existing modes, and the openssl commands
   for each .tsr are printed. Imports nothing from ReqPub. */
function walkFiles(root, rel = '') {
  const acc = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) acc.push(...walkFiles(root, r));
    else acc.push(r);
  }
  return acc;
}
function verifyEvidencePack(dir) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')); }
  catch { out('MISMATCH  manifest.json is missing or not valid JSON'); process.exit(1); }
  const listed = Array.isArray(manifest.files) ? manifest.files : [];
  let bad = 0;
  for (const f of listed) {
    let bytes;
    try { bytes = readFileSync(join(dir, f.name)); }
    catch { out('MISMATCH  ' + f.name + ' is listed in the manifest but missing'); bad++; continue; }
    const h = createHash('sha256').update(bytes).digest('hex');
    if (h !== f.sha256) { out('MISMATCH  ' + f.name + ' does not match its manifest hash'); bad++; }
  }
  const names = new Set(listed.map((f) => f.name));
  for (const f of walkFiles(dir)) {
    if (f === 'manifest.json') continue;
    if (!names.has(f)) { out('MISMATCH  ' + f + ' is present but not listed in the manifest'); bad++; }
  }
  if (bad) { out('MISMATCH  ' + bad + ' manifest ' + (bad === 1 ? 'check' : 'checks') + ' failed; the pack is not the one the manifest describes'); process.exit(1); }
  out('manifest  ' + listed.length + ' files, every hash matches, nothing unlisted');
  let baselines = 0;
  for (const f of [...names].filter((n) => /^versions\/.*\.reqpub\.json$/.test(n)).sort()) {
    let b;
    try { b = JSON.parse(readFileSync(join(dir, f), 'utf8')); }
    catch { out('MISMATCH  ' + f + ' is not valid JSON'); process.exit(1); }
    const h = sha256Hex(canonical({ label: b.label, seq: b.seq, snapshot: b.snapshot }));
    const embedded = String((b.fingerprint && b.fingerprint.value) || '').toLowerCase();
    if (h !== embedded) { out('MISMATCH  ' + f + ' does not reproduce its fingerprint'); process.exit(1); }
    out('baseline  ' + f + '  sha256:' + h.slice(0, 16) + '  reproduces its fingerprint');
    baselines++;
  }
  let receipts = 0;
  const rdirs = [...new Set([...names].filter((n) => n.startsWith('receipts/')).map((n) => n.split('/').slice(0, 2).join('/')))].sort();
  for (const rd of rdirs) {
    out('receipt   ' + rd + '/');
    const res = verifyReceiptDir(join(dir, rd));
    if (!res.ok) { out('MISMATCH  ' + rd + ' failed verification'); process.exit(1); }
    receipts++;
  }
  out('PACK-VERIFIED  ' + listed.length + ' files against the manifest, ' + baselines + ' baseline ' + (baselines === 1 ? 'bundle' : 'bundles') + ' reproduced, ' + receipts + ' ' + (receipts === 1 ? 'receipt' : 'receipts') + ' sealed-verified; check each printed openssl ts command for the timestamps');
  process.exit(0);
}

const err = (s) => process.stderr.write(s + '\n');
const usage = () => {
  err('Usage: node tools/reqpub-verify.mjs [--print-canonical] <bundle.json> [expected-sha256-hex]');
  err('       node tools/reqpub-verify.mjs --receipt <receipt-folder>   |   --evidence <evidence-pack-folder>');
  process.exit(2);
};

const args = process.argv.slice(2);
if (args[0] === '--evidence') { const d = args[1]; if (!d) usage(); verifyEvidencePack(d); }
if (args[0] === '--receipt') { const d = args[1]; if (!d) usage(); process.exit(verifyReceiptDir(d).ok ? 0 : 1); }
if (args[0] && existsSync(args[0]) && statSync(args[0]).isDirectory()) {
  if (existsSync(join(args[0], 'manifest.json'))) verifyEvidencePack(args[0]);
  process.exit(verifyReceiptDir(args[0]).ok ? 0 : 1);
}
const printCanonical = args[0] === '--print-canonical';
if (printCanonical) args.shift();
const file = args[0];
const expectedArg = args[1];
if (!file || args.length > 2) usage();

let text;
try { text = readFileSync(file, 'utf8'); }
catch (e) { err('Cannot read ' + file + ': ' + e.message); process.exit(2); }

let bundle;
try { bundle = JSON.parse(text); }
catch (e) { err('Not valid JSON: ' + e.message); process.exit(2); }
if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
  err('A bundle is a JSON object.'); process.exit(2);
}
for (const k of ['label', 'seq', 'snapshot']) {
  if (!(k in bundle)) { err('The bundle is missing "' + k + '".'); process.exit(2); }
}

const canon = canonical({ label: bundle.label, seq: bundle.seq, snapshot: bundle.snapshot });
if (printCanonical) { process.stdout.write(canon); process.exit(0); }

const computed = sha256Hex(canon);
const embedded = String(
  expectedArg || (bundle.fingerprint && bundle.fingerprint.value) || ''
).trim().toLowerCase().replace(/^sha256:/, '').replace(/\s+/g, '');

out('computed  sha256:' + computed);
if (!embedded) {
  out('embedded  none, and no expected value was given');
  out('NOTHING TO COMPARE  the computed fingerprint is printed above; check it against the value on your exported document');
  process.exit(2);
}
out((expectedArg ? 'expected  ' : 'embedded  ') + 'sha256:' + embedded);
if (computed === embedded) {
  out('VERIFIED  this snapshot reproduces the fingerprint exactly');
  process.exit(0);
}
out('MISMATCH  this snapshot does NOT produce that fingerprint; the file differs from the baseline the fingerprint was recorded for');
process.exit(1);
