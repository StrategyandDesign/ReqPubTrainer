/* ReqPub C3.2 - the key rotation drill, executed
   (node tests/rotation-drill.test.mjs)

   The question a buyer asks and a runbook usually answers badly: when you
   rotate a signing key, does every receipt sealed under the old key still
   verify, years later, for someone who does not trust you.

   This drill answers it by doing it, with real Ed25519 keys. Seal under key A.
   Retire A and publish it as retired. Seal under key B. Then verify both
   receipts the way an outsider would: fetch the published key set, find the
   key each receipt names by its id, and check the signature over the canonical
   bytes. A retired key must remain published and must remain verifiable, or
   rotation silently destroys every record sealed before it.

   The failure this is built to catch is the tempting one: dropping a retired
   key from the published set because it is no longer in use. That single
   deletion invalidates history. */
import { webcrypto } from 'node:crypto';
globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const L = await import('../supabase/functions/seal-receipt/seallib.mjs');
const { canonicalJson, versionFingerprint } = await import('../app/js/core.js');

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const genKey = async (kid) => {
  const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', kp.publicKey)).toString('base64');
  return { kid, kp, publicKeySpkiBase64: spki };
};
const signReceipt = async (key, receipt) => {
  const bytes = new TextEncoder().encode(canonicalJson(receipt));
  return Buffer.from(await webcrypto.subtle.sign({ name: 'Ed25519' }, key.kp.privateKey, bytes)).toString('base64');
};
/* Exactly what an outsider does: no ReqPub code, only the published key set. */
const verifyAsOutsider = async (keySet, receipt, signatureB64) => {
  const entry = (keySet.keys || []).find((k) => k.kid === receipt.issuer.kid);
  if (!entry) return { ok: false, reason: 'key id not published' };
  const pub = await webcrypto.subtle.importKey('spki', Buffer.from(entry.publicKeySpkiBase64, 'base64'),
    { name: 'Ed25519' }, false, ['verify']);
  const ok = await webcrypto.subtle.verify({ name: 'Ed25519' }, pub,
    Buffer.from(signatureB64, 'base64'), new TextEncoder().encode(canonicalJson(receipt)));
  return { ok, reason: ok ? 'verified' : 'signature did not verify', status: entry.status || 'active' };
};

const version = { label: '1.0', seq: 1, snapshot: { answers: { obj: 'Ship the thing' }, sections: {} } };
const ctxOf = async (id) => ({
  receiptId: id, projectId: 'p-rot', project: 'Rotation Drill', label: '1.0', seq: 1,
  snapshot: version.snapshot, fingerprint: await versionFingerprint(version),
  signRequestId: 'sr-' + id, signedName: 'Kate Q', signedAt: '2026-08-01T10:00:00.000Z',
  signer: { role: 'Sponsor', emailDomain: 'clientco.example' }, evidence: { channel: 'link' },
});

/* ---- before rotation ---- */
const keyA = await genKey('acc-1');
const receiptA = await L.buildReceipt(await ctxOf('r-A'), { ok: true, head_seq: 3, head_hash: 'de'.repeat(32) }, keyA.kid, '2026-08-01T12:00:00.000Z');
const sigA = await signReceipt(keyA, receiptA);
let keySet = { keys: [{ kid: keyA.kid, publicKeySpkiBase64: keyA.publicKeySpkiBase64, status: 'active' }] };

check('a receipt sealed under the active key verifies against the published set',
  (await verifyAsOutsider(keySet, receiptA, sigA)).ok === true);
check('the receipt names the key that signed it, by id', receiptA.issuer.kid === keyA.kid);

/* ---- rotate: A retired but still published, B active ---- */
const keyB = await genKey('acc-2');
keySet = { keys: [
  { kid: keyA.kid, publicKeySpkiBase64: keyA.publicKeySpkiBase64, status: 'retired', retiredAt: '2026-08-02T00:00:00Z' },
  { kid: keyB.kid, publicKeySpkiBase64: keyB.publicKeySpkiBase64, status: 'active' },
] };
const receiptB = await L.buildReceipt(await ctxOf('r-B'), { ok: true, head_seq: 4, head_hash: 'ef'.repeat(32) }, keyB.kid, '2026-08-03T12:00:00.000Z');
const sigB = await signReceipt(keyB, receiptB);

const afterA = await verifyAsOutsider(keySet, receiptA, sigA);
check('after rotation the old receipt still verifies against the retired key',
  afterA.ok === true && afterA.status === 'retired', afterA);
check('the new receipt verifies against the new active key',
  (await verifyAsOutsider(keySet, receiptB, sigB)).ok === true);
check('the two receipts name different keys, so an auditor can tell them apart',
  receiptA.issuer.kid !== receiptB.issuer.kid);

/* ---- the failure the runbook must forbid ---- */
{
  const pruned = { keys: keySet.keys.filter((k) => k.status === 'active') };
  const lost = await verifyAsOutsider(pruned, receiptA, sigA);
  check('dropping the retired key from the published set destroys the old receipt',
    lost.ok === false && lost.reason === 'key id not published', lost);
  check('and the new receipt is unaffected, which is what makes the mistake easy to miss',
    (await verifyAsOutsider(pruned, receiptB, sigB)).ok === true);
}

/* ---- a substituted key of the same id does not verify ---- */
{
  const impostor = await genKey('acc-1');
  const swapped = { keys: [{ kid: 'acc-1', publicKeySpkiBase64: impostor.publicKeySpkiBase64, status: 'retired' }] };
  const r = await verifyAsOutsider(swapped, receiptA, sigA);
  check('a different key published under the same id does not verify: pinning is by material, not by name',
    r.ok === false, r);
}

/* ---- cross-signing is refused: a receipt is bound to its own bytes ---- */
{
  const tampered = JSON.parse(JSON.stringify(receiptA));
  tampered.signature.signedName = 'Someone Else';
  const r = await verifyAsOutsider(keySet, tampered, sigA);
  check('editing a receipt after sealing breaks its signature', r.ok === false, r);
}

/* ---- the runbook must say all of this ---- */
{
  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL('../SECURITY.md', import.meta.url));
  const runbook = existsSync(path) ? readFileSync(path, 'utf8') : '';
  check('the rotation runbook exists', runbook.length > 200);
  check('the runbook states that a retired key stays published',
    /retired/i.test(runbook) && /publish/i.test(runbook), runbook ? 'present but silent on retirement' : 'missing');
}

console.log(`rotation drill: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
