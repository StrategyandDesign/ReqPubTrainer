/* ReqPub v2 - seal library unit gate (node tests/seal-fixture.test.mjs)
   Pins receipt determinism, the fingerprint-divergence abort, the RFC 3161
   request bytes, and the vendored-core no-drift: the seal edge function's
   copy of core.js must be byte-identical to app/js/core.js. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const L = await import('../supabase/functions/seal-receipt/seallib.mjs');
const { versionFingerprint } = await import('../app/js/core.js');
let n = 0; const test = (name, fn) => { const p = fn(); if (p && p.then) return p.then(() => { n++; console.log('  \u2713 ' + name); }); n++; console.log('  \u2713 ' + name); };

const version = { label: '1.0', seq: 1, snapshot: { answers: { a: 'x' }, sections: {} } };
const ctxOf = async () => ({ receiptId: 'r1', projectId: 'p1', project: 'Acme', label: '1.0', seq: 1, snapshot: version.snapshot, fingerprint: await versionFingerprint(version), signRequestId: 'sr1', signedName: 'Jane Roe', signedAt: '2026-08-01T10:00:00.000Z', signer: { role: 'CTO', emailDomain: 'acme.com' }, evidence: { channel: 'link' } });

await test('the vendored core.js is byte-identical to app/js/core.js', () => {
  const a = readFileSync(new URL('../app/js/core.js', import.meta.url));
  const b = readFileSync(new URL('../supabase/functions/seal-receipt/core.js', import.meta.url));
  assert.ok(a.equals(b), 'the edge seal function must not drift from the app canonicalizer');
});
await test('a receipt is deterministic: same context, byte-identical canonical hash', async () => {
  const c = await ctxOf();
  const r1 = await L.buildReceipt(c, { ok: true, head_seq: 3, head_hash: 'de'.repeat(32) }, 'acc-1', '2026-08-01T12:00:00.000Z');
  const r2 = await L.buildReceipt(c, { ok: true, head_seq: 3, head_hash: 'de'.repeat(32) }, 'acc-1', '2026-08-01T12:00:00.000Z');
  assert.equal(await L.canonicalHashOf(r1), await L.canonicalHashOf(r2));
});
await test('the receipt carries the email domain, never an address, and no token', async () => {
  const r = await L.buildReceipt(await ctxOf(), null, 'acc-1', 't');
  const s = JSON.stringify(r);
  assert.ok(s.includes('acme.com') && !s.includes('@acme.com') && !s.includes('tok'));
});
await test('fingerprint divergence aborts with the divergence flag', async () => {
  const c = await ctxOf(); c.fingerprint = '00'.repeat(32);
  await assert.rejects(() => L.buildReceipt(c, null, 'acc-1', 't'), (e) => e.divergence === true);
});
await test('the seal is a valid Ed25519 signature over the canonical hash', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const r = await L.buildReceipt(await ctxOf(), null, 'acc-1', 't');
  const h = await L.canonicalHashOf(r);
  assert.equal(await L.verifyReceiptHash(h, await L.signReceiptHash(h, priv), pub), true);
});
await test('an absent captured fingerprint seals honestly with a note; a real mismatch still aborts', async () => {
  const c = await ctxOf(); c.fingerprint = '';
  await assert.rejects(() => L.buildReceipt(c, null, 'acc-1', 't'), (e) => e.divergence === true);
  c.legacyNoFingerprint = true;
  const r = await L.buildReceipt(c, null, 'acc-1', 't');
  assert.equal(r.baseline.docFingerprint, '');
  assert.ok(r.baseline.fingerprintNote.includes('absent'));
  assert.equal(r.baseline.recomputedFingerprint.length, 64);
  const bad = await ctxOf(); bad.fingerprint = '00'.repeat(32);
  await assert.rejects(() => L.buildReceipt(bad, null, 'acc-1', 't'), (e) => e.divergence === true);
});
await test('the RFC 3161 request is well-formed DER over a 32-byte hash', () => {
  const der = L.tsaRequestDer('ab'.repeat(32));
  assert.equal(der[0], 0x30);
  assert.ok(der.length > 50 && der.length < 70);
  assert.throws(() => L.tsaRequestDer('abcd'));
});
/* C2-001. The only receipt in production before the published standard carries
   project.nameSha256 as {} rather than a hash: an older build did not await the
   digest, and an unawaited promise serialises to an empty object. Nothing about
   the signature, fingerprint, chain, or timestamps was affected, but the
   artifact does not validate against the schema ReqPub publishes.

   The specific field is pinned below, and so is the whole class: no value
   anywhere in a built receipt may be an empty object, because that is what a
   forgotten await looks like after JSON.stringify. */
await test('no field in a built receipt is an empty object, and nameSha256 is a real digest', async () => {
  const walk = (v, path = '$') => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (Object.keys(v).length === 0) return path;
      for (const [k, val] of Object.entries(v)) { const hit = walk(val, path + '.' + k); if (hit) return hit; }
    }
    if (Array.isArray(v)) for (let i = 0; i < v.length; i++) { const hit = walk(v[i], path + '[' + i + ']'); if (hit) return hit; }
    return null;
  };
  const rc = await L.buildReceipt(await ctxOf(), { ok: true, head_seq: 3, head_hash: 'de'.repeat(32) }, 'acc-1', '2026-08-01T12:00:00.000Z');
  assert.equal(walk(rc), null, 'an empty object is what a forgotten await leaves behind');
  assert.match(String(rc.project.nameSha256), /^[0-9a-f]{64}$/);
});

console.log('\nseal-fixture.test: ' + n + '/' + n + ' passed');
