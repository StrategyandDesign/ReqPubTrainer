/* ReqPub v3.1 - the timestamp token check (node tests/tsa-token.test.mjs)

   docs/VERIFY.md section 9 step 3 says the verify CLI reads each RFC 3161
   token: status granted, message imprint equal to the receipt's canonical
   hash, and the CMS signature valid against a certificate carried in the
   token. Until v3.1 the CLI printed an openssl command instead, so a
   receipt's timestamp status was a stored claim nobody checked.

   The public authorities are not reachable from a test runner, and a
   recorded response would pin one authority's encoding. So this suite
   builds a TimeStampResp from scratch, byte by byte, with an ephemeral RSA
   key and a self-signed certificate, signs it, and feeds it to the CLI
   beside a real sealed receipt. Then it breaks the token four ways. The
   builder is deliberately independent of the CLI's reader: two
   implementations of the same RFC, meeting in the middle. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { syntheticAuthority } from './fixtures/rfc3161-synthetic.mjs';
import { buildReceiptBundle } from '../app/js/verifybundle.js';
import { buildReceipt, canonicalHashOf, signReceiptHash } from '../supabase/functions/seal-receipt/seallib.mjs';
import { versionFingerprint } from '../app/js/core.js';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const CLI = new URL('../tools/reqpub-verify.mjs', import.meta.url).pathname;
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

const dir = mkdtempSync(join(tmpdir(), 'reqpub-tsa-'));
const tsa = syntheticAuthority('Synthetic Test TSA', 77);

/* A real sealed receipt folder, as the app exports it. */
const ed = generateKeyPairSync('ed25519');
const pub = ed.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const priv = ed.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const version = { label: '1.0', seq: 1, snapshot: { answers: { a: 'x' }, sections: {} } };
const fp = await versionFingerprint(version);
const ctx = { receiptId: 'r1', projectId: 'p1', project: 'Acme', label: '1.0', seq: 1, snapshot: version.snapshot, fingerprint: fp, signRequestId: 'sr1', signedName: 'Jane Roe', signedAt: '2026-08-01T10:00:00.000Z', signer: { role: 'CTO', emailDomain: 'acme.com' }, evidence: { channel: 'link' } };
const receipt = await buildReceipt(ctx, { ok: true, head_seq: 3, head_hash: 'de'.repeat(32) }, 'acc-1', '2026-08-01T12:00:00.000Z');
const hash = await canonicalHashOf(receipt);
const sig = await signReceiptHash(hash, priv);
const files = await buildReceiptBundle({ receipt_json: receipt, signature_base64: sig, key_id: 'acc-1', tsa_status: 'pending' }, version, pub, {});
const fresh = (suffix) => {
  const d = join(dir, 'rcpt-' + suffix); mkdirSync(d, { recursive: true });
  for (const f of files) writeFileSync(join(d, f.name), typeof f.data === 'string' ? f.data : Buffer.from(f.data));
  return d;
};

await test('a receipt with no token still seals-verifies and says so', async () => {
  const r = run([fresh('none')]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('no timestamp token present'));
});

await test('a granted token for this receipt verifies: status, imprint, time, signer, signature', async () => {
  const d = fresh('good');
  writeFileSync(join(d, 'tsa_primary.tsr'), tsa.response(hash));
  writeFileSync(join(d, 'tsa_secondary.tsr'), tsa.response(hash, { status: 1, genTime: '2026-08-05T12:35:01Z' }));
  const r = run([d]);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(r.stdout.includes('tsa_primary.tsr: granted, imprint is this receipt, existed at 2026-08-05T12:34:56Z per Synthetic Test TSA'));
  assert.ok(r.stdout.includes('tsa_secondary.tsr: granted, imprint is this receipt, existed at 2026-08-05T12:35:01Z'));
  assert.ok(r.stdout.includes('signature valid against the certificate in the token'));
  assert.ok(r.stdout.includes('2 timestamp tokens checked (granted, imprint, signature)'));
  assert.ok(r.stdout.includes('openssl ts -verify -digest ' + hash), 'the chain-to-root command is still printed, for the trust decision the tool does not make');
});

await test('a token whose imprint is a different receipt is a MISMATCH, exit 1', async () => {
  const d = fresh('imprint');
  writeFileSync(join(d, 'tsa_primary.tsr'), tsa.response(hash, { imprintHex: 'ab'.repeat(32) }));
  const r = run([d]);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('MISMATCH  tsa_primary.tsr does not cover this receipt: message imprint'));
  assert.ok(!r.stdout.includes('SEALED-VERIFIED'));
});

await test('a token whose signature was altered by one byte is a MISMATCH', async () => {
  const d = fresh('sig');
  writeFileSync(join(d, 'tsa_primary.tsr'), tsa.response(hash, { flipSignature: true }));
  const r = run([d]);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('verifies against none of the certificates'));
});

await test('a token whose message-digest attribute does not match its TSTInfo is a MISMATCH', async () => {
  const d = fresh('digest');
  writeFileSync(join(d, 'tsa_primary.tsr'), tsa.response(hash, { wrongDigest: true }));
  const r = run([d]);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('message-digest attribute does not match'));
});

await test('a rejected response, a response with no token, and random bytes are each named, never a crash', async () => {
  const d = fresh('rejected');
  writeFileSync(join(d, 'tsa_primary.tsr'), tsa.response(hash, { status: 2 }));
  const r1 = run([d]);
  assert.equal(r1.status, 1); assert.ok(r1.stdout.includes('status 2 is not granted'));
  writeFileSync(join(d, 'tsa_primary.tsr'), tsa.response(hash, { noToken: true }));
  const r2 = run([d]);
  assert.equal(r2.status, 1); assert.ok(r2.stdout.includes('carries no token'));
  writeFileSync(join(d, 'tsa_primary.tsr'), Buffer.from('PRIMARYder, as the old test used to store'));
  const r3 = run([d]);
  assert.equal(r3.status, 1); assert.ok(r3.stdout.includes('does not cover this receipt'));
});

await test('a token signed by a key whose certificate is not in the token is a MISMATCH', async () => {
  const d = fresh('nocert');
  writeFileSync(join(d, 'tsa_primary.tsr'), tsa.response(hash, { noCert: true }));
  const r = run([d]);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('no certificate to verify against'));
});

await test('a token this reader cannot check is reported as not checked, with the openssl line, and the receipt still seals-verifies', async () => {
  const d = fresh('unsupported');
  writeFileSync(join(d, 'tsa_primary.tsr'), tsa.response(hash, { signerDigestOid: '1.3.14.3.2.26' }));   // SHA-1 signer digest
  writeFileSync(join(d, 'tsa_secondary.tsr'), tsa.response(hash));
  const r = run([d]);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(r.stdout.includes('tsa_primary.tsr: not checked here (digest algorithm sha1 is not read by this tool); verify it with: openssl ts -verify -digest ' + hash));
  assert.ok(r.stdout.includes('1 timestamp token checked (granted, imprint, signature), 1 not checked here'));
  assert.ok(!r.stdout.includes('MISMATCH'), 'a limitation of the reader is never a verification failure');
});

rmSync(dir, { recursive: true, force: true });
console.log('\ntsa-token.test: ' + n + '/' + n + ' passed');
