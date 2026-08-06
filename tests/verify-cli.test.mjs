/* ReqPub v2 - independent verifier tests (node tests/verify-cli.test.mjs)
   The whole claim of docs/VERIFY.md is that a third party can verify a
   baseline without ReqPub. tools/reqpub-verify.mjs imports nothing from the
   app; these tests build a bundle with the app's own export code and assert
   the standalone tool agrees byte for byte - the canonical stream is
   identical, a good bundle verifies with exit 0, a single flipped character
   fails with exit 1, and unusable input exits 2 without pretending to have
   checked anything. CI runs this file as the no-drift gate: if the spec and
   the implementation ever part ways, the release does not ship. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, writeFileSync as wf } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVerifyBundle, verifyBundleText, buildReceiptBundle } from '../app/js/verifybundle.js';
import { buildReceipt, canonicalHashOf, signReceiptHash } from '../supabase/functions/seal-receipt/seallib.mjs';
import { generateKeyPairSync } from 'node:crypto';
import { canonicalJson } from '../app/js/core.js';

let n = 0;
const _test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const awaitTest = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };

const CLI = new URL('../tools/reqpub-verify.mjs', import.meta.url).pathname;
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

const dir = mkdtempSync(join(tmpdir(), 'reqpub-verify-'));
const fileOf = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

/* A version row shaped like the store's: label, seq, snapshot. The snapshot
   exercises key-order independence, nested rows, meta keys, unicode, and
   characters that need JSON escaping. */
const VERSION = {
  label: '2.1', seq: 7,
  snapshot: {
    answers: {
      pname: 'Quote "engine" · naïve\n line',
      fr: [{ _k: 2, stmt: 'B', fit: 'F2', pri: 'Must', exec: 'Agent' }, { _k: 1, stmt: 'A', fit: 'F1', pri: 'Must' }],
      zeta: null, alpha: 3.5,
    },
  },
};

const bundleText = await buildVerifyBundle(VERSION, { product: 'Parity Product' });
const goodPath = fileOf('good.json', bundleText);

await awaitTest('the CLI verifies a bundle produced by the current export code: exit 0, VERIFIED', async () => {
  const r = run([goodPath]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(r.stdout.includes('VERIFIED'));
});

await awaitTest('the CLI and the app compute the identical canonical byte stream', async () => {
  const r = run(['--print-canonical', goodPath]);
  assert.equal(r.status, 0);
  const bundle = JSON.parse(bundleText);
  const appCanonical = canonicalJson({ label: bundle.label, seq: bundle.seq, snapshot: bundle.snapshot });
  assert.equal(r.stdout, appCanonical, 'byte-for-byte equality, no trailing newline');
});

await awaitTest('the app-side checker agrees with itself and with the CLI on the same text', async () => {
  const v = await verifyBundleText(bundleText);
  assert.equal(v.ok, true);
  assert.equal(v.match, true);
  assert.equal(v.computed, v.embedded);
});

await awaitTest('one flipped character in the snapshot is a MISMATCH with exit 1', async () => {
  const tampered = JSON.parse(bundleText);
  tampered.snapshot.answers.fr[0].stmt = 'B changed';
  const r = run([fileOf('tampered.json', JSON.stringify(tampered, null, 2))]);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('MISMATCH'));
});

await awaitTest('an expected hex on the command line overrides the embedded value', async () => {
  const bundle = JSON.parse(bundleText);
  const good = run([goodPath, bundle.fingerprint.value]);
  assert.equal(good.status, 0);
  const bad = run([goodPath, 'a'.repeat(64)]);
  assert.equal(bad.status, 1);
  assert.ok(bad.stdout.includes('MISMATCH'));
});

await awaitTest('a bundle with no fingerprint and no expected value exits 2 and claims nothing', async () => {
  const bare = JSON.parse(bundleText);
  delete bare.fingerprint;
  const r = run([fileOf('bare.json', JSON.stringify(bare))]);
  assert.equal(r.status, 2);
  assert.ok(r.stdout.includes('NOTHING TO COMPARE'));
  assert.ok(!r.stdout.includes('VERIFIED'));
});

await awaitTest('malformed input exits 2: bad JSON, a non-object, and missing fields', async () => {
  assert.equal(run([fileOf('bad.json', '{ not json')]).status, 2);
  assert.equal(run([fileOf('arr.json', '[1,2]')]).status, 2);
  assert.equal(run([fileOf('missing.json', '{"label":"1.0","seq":1}')]).status, 2);
  assert.equal(run([join(dir, 'no-such-file.json')]).status, 2);
});

await awaitTest('key order in the file does not change the verdict', async () => {
  const bundle = JSON.parse(bundleText);
  const reordered = { snapshot: bundle.snapshot, fingerprint: bundle.fingerprint, seq: bundle.seq, label: bundle.label, format: bundle.format, formatVersion: bundle.formatVersion };
  const r = run([fileOf('reordered.json', JSON.stringify(reordered))]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('VERIFIED'));
});

await awaitTest('the worked example in docs/VERIFY.md is the hash the tools compute', async () => {
  const example = { label: '1.1', seq: 2, snapshot: { answers: { ov_vision: 'The vision' } } };
  const expected = 'd681043efd35679b213072b1724b7f5031b6c39f167ec5fb8b6abcdc89ef9edb';
  const r = run([fileOf('example.json', JSON.stringify(example)), expected]);
  assert.equal(r.status, 0, 'the CLI reproduces the documented hash');
  const v = await verifyBundleText(JSON.stringify(example), expected);
  assert.equal(v.match, true, 'the app reproduces the documented hash');
});


await awaitTest('a sealed receipt bundle verifies through the CLI, untouched, ReqPub-free', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const version = { label: '1.0', seq: 1, snapshot: { answers: { a: 'x' }, sections: {} } };
  const { versionFingerprint } = await import('../app/js/core.js');
  const fp = await versionFingerprint(version);
  const ctx = { receiptId: 'r1', projectId: 'p1', project: 'Acme', label: '1.0', seq: 1, snapshot: version.snapshot, fingerprint: fp, signRequestId: 'sr1', signedName: 'Jane Roe', signedAt: '2026-08-01T10:00:00.000Z', signer: { role: 'CTO', emailDomain: 'acme.com' }, evidence: { channel: 'link' } };
  const receipt = await buildReceipt(ctx, { ok: true, head_seq: 3, head_hash: 'de'.repeat(32) }, 'acc-1', '2026-08-01T12:00:00.000Z');
  const hash = await canonicalHashOf(receipt);
  const sig = await signReceiptHash(hash, priv);
  const files = await buildReceiptBundle({ receipt_json: receipt, signature_base64: sig, key_id: 'acc-1', tsa_status: 'pending' }, version, pub, {});
  const rdir = join(dir, 'rcpt'); mkdirSync(rdir, { recursive: true });
  for (const f of files) wf(join(rdir, f.name), typeof f.data === 'string' ? f.data : Buffer.from(f.data));
  const okRun = run([rdir]);
  assert.equal(okRun.status, 0, 'sealed bundle verifies');
  assert.ok(okRun.stdout.includes('SEALED-VERIFIED'));
  // Tamper the receipt: the seal must fail.
  const tampered = JSON.parse(JSON.stringify(receipt)); tampered.signature.signedName = 'Someone Else';
  wf(join(rdir, 'receipt.json'), JSON.stringify(tampered, null, 2) + '\n');
  const badRun = run([rdir]);
  assert.equal(badRun.status, 1, 'a tampered receipt fails');
  assert.ok(badRun.stdout.includes('MISMATCH'));
  // Restore, then swap the baseline snapshot: baseline mismatch must fail.
  wf(join(rdir, 'receipt.json'), (typeof files[0].data === 'string' ? files[0].data : ''));
  const swapped = { label: '1.0', seq: 1, snapshot: { answers: { a: 'DIFFERENT' }, sections: {} } };
  wf(join(rdir, 'baseline-bundle.reqpub.json'), await buildVerifyBundle(swapped, {}));
  const swapRun = run([rdir]);
  assert.equal(swapRun.status, 1, 'a swapped baseline fails');
});

await awaitTest('a broken receipt folder fails with named causes, never a crash', async () => {
  const bdir = join(dir, 'broken'); mkdirSync(bdir, { recursive: true });
  wf(join(bdir, 'receipt.json'), '{"format":"reqpub-receipt","baseline":{},"signature":{}}');
  const miss = run([bdir]);
  assert.equal(miss.status, 1);
  assert.ok(miss.stdout.includes('missing from the bundle folder'));
  wf(join(bdir, 'publickey.txt'), 'kid: acc-1\npublicKeySpkiBase64: SET-AT-DEPLOY-VIA-x\n');
  wf(join(bdir, 'signature.txt'), 'kid: acc-1\nsignature_base64: QUJD\n');
  const ph = run([bdir]);
  assert.equal(ph.status, 1);
  assert.ok(ph.stdout.includes('deploy placeholder'));
});

rmSync(dir, { recursive: true, force: true });
console.log('\nverify-cli.test: ' + n + '/' + n + ' passed');
