#!/usr/bin/env node
/* ============================================================================
   reqpub-verify - independent baseline fingerprint checker.

   Node built-ins only. The recipe lives in tools/reqpub-verify-lib.mjs,
   which this command imports. Neither file imports the ReqPub application:
   both are reimplemented from docs/VERIFY.md, so the published recipe is
   sufficient to verify a baseline without the platform. The spec drift
   gate imports that same module. CI asserts this tool and the app's own
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
import { createHash } from 'node:crypto';
import { canonical, sha256Hex, verifyTimestampToken, verifySeal, claimedBaselineFingerprint } from './reqpub-verify-lib.mjs';

/* Receipt-bundle mode, restated from docs/VERIFY.md section 9. Steps 1 and 2
   are performed here on node builtins; step 3 (RFC 3161) reads each token
   and checks status, imprint and signature, and prints the openssl command
   that chains the token's certificate to a root. The seal and the token
   reader are tools/reqpub-verify-lib.mjs. Nothing here imports the app. */
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
    const { claimed, legacy } = claimedBaselineFingerprint(receipt);
    baselineOk = bHash === claimed;
    out('baseline  computed sha256:' + bHash);
    out('baseline  receipt claims sha256:' + claimed + (legacy ? '  (recomputed at seal; capture at send was absent)' : ''));
    if (!baselineOk) { out('MISMATCH  the sealed baseline does not match the receipt'); return { ok: false }; }
  }
  // Step 2: Ed25519 over the canonical receipt hash. verifySeal is the
  // same function the spec drift gate calls.
  const pubText = rd('publickey.txt');
  const spki = (pubText.match(/publicKeySpkiBase64:\s*(\S+)/) || [])[1] || '';
  const sigText = rd('signature.txt');
  const sig = (sigText.match(/signature_base64:\s*(\S+)/) || [])[1] || '';
  if (missing) return { ok: false };
  if (!spki || !sig) { out('MISMATCH  signature.txt or publickey.txt is incomplete'); return { ok: false }; }
  if (spki.startsWith('SET-AT-DEPLOY')) { out('MISMATCH  publickey.txt is the deploy placeholder; register the real key (runbook step 5) and re-download the bundle'); return { ok: false }; }
  const seal = verifySeal(receipt, sig, spki);
  if (seal.reason === 'invalid-spki') { out('MISMATCH  publickey.txt does not contain a valid Ed25519 SPKI key'); return { ok: false }; }
  const canonHash = seal.canonHash;
  const sealOk = seal.ok;
  const kid = (pubText.match(/kid:\s*(\S+)/) || [])[1] || '(none)';
  out('seal      canonical sha256:' + canonHash);
  out('seal      kid ' + kid + ', Ed25519 ' + (sealOk ? 'valid against the key in this bundle' : 'INVALID'));
  if (!sealOk) { out('MISMATCH  the Ed25519 seal does not verify against the key in publickey.txt'); return { ok: false }; }
  out('trust     CONFIRM this key is genuine: fetch https://reqpub.com/reqpub-keys.json');
  out('trust     and check the publicKeySpkiBase64 for kid ' + kid + ' matches publickey.txt.');
  out('trust     A valid signature only proves the holder of THIS key signed it.');
  // Step 3: each timestamp token is read and checked against this receipt;
  // the chain to a trusted root is the reader's decision, by openssl.
  let tokens = 0, unchecked = 0;
  for (const t of ['tsa_primary.tsr', 'tsa_secondary.tsr']) {
    if (!existsSync(join(dir, t))) continue;
    const res = verifyTimestampToken(readFileSync(join(dir, t)), canonHash);
    if (!res.ok && res.unsupported) {
      unchecked++;
      out('time      ' + t + ': not checked here (' + res.reason + '); verify it with: openssl ts -verify -digest ' + canonHash + ' -in ' + t + ' -CAfile <tsa-ca.pem>');
      continue;
    }
    if (!res.ok) { out('MISMATCH  ' + t + ' does not cover this receipt: ' + res.reason); return { ok: false }; }
    tokens++;
    out('time      ' + t + ': granted, imprint is this receipt, existed at ' + res.genTime + ' per ' + res.signer + ' (' + res.alg + ', signature valid against the certificate in the token)');
    out('time      chain that certificate to a root you trust: openssl ts -verify -digest ' + canonHash + ' -in ' + t + ' -CAfile <tsa-ca.pem>');
  }
  const tokenLine = (tokens === 0 && unchecked === 0) ? 'no timestamp token present'
    : (tokens ? tokens + ' timestamp ' + (tokens === 1 ? 'token' : 'tokens') + ' checked (granted, imprint, signature)' : '') +
      (tokens && unchecked ? ', ' : '') + (unchecked ? unchecked + ' not checked here (see the openssl line)' : '');
  out('SEALED-VERIFIED  baseline' + (baselineOk === false ? ' FAILED' : baselineOk === null ? ' not included' : ' matches') + ', Ed25519 seal valid against the bundled key (kid ' + kid + '), ' + tokenLine +
    '; confirm the key against reqpub-keys.json per the trust lines above, and chain each token\u2019s certificate with the printed openssl command');
  return { ok: true, tokens, unchecked };
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
  out('PACK-VERIFIED  ' + listed.length + ' files against the manifest, ' + baselines + ' baseline ' + (baselines === 1 ? 'bundle' : 'bundles') + ' reproduced, ' + receipts + ' ' + (receipts === 1 ? 'receipt' : 'receipts') + ' sealed-verified with their timestamp tokens checked; chain each token\u2019s certificate with the printed openssl commands');
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
