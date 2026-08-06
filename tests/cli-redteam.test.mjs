/* CLI + seallib red team: can a forged bundle pass offline verification? */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const L = await import('../supabase/functions/seal-receipt/seallib.mjs');
const VB = await import('../app/js/verifybundle.js');
const { versionFingerprint } = await import('../app/js/core.js');
let blocked = 0, vuln = 0;
const attack = (n, isBlocked, x) => { if (isBlocked) { blocked++; console.log('  OK BLOCKED: ' + n); } else { vuln++; console.log('  !! VULN: ' + n + (x ? ' -> ' + x : '')); } };
const run = (args) => spawnSync('node', [new URL('../tools/reqpub-verify.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8' });
const dir = mkdtempSync(join(tmpdir(), 'clired-'));

const version = { label: '1.0', seq: 1, snapshot: { answers: { a: 'x' }, sections: {} } };
const fp = await versionFingerprint(version);
const good = generateKeyPairSync('ed25519');
const goodPub = good.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const goodPriv = good.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const ctx = { receiptId: 'r1', projectId: 'p1', project: 'Acme', label: '1.0', seq: 1, snapshot: version.snapshot, fingerprint: fp, signRequestId: 'sr1', signedName: 'Jane', signedAt: '2026-08-01T10:00:00.000Z', signer: { role: 'CTO', emailDomain: 'acme.com' }, evidence: {} };
const receipt = await L.buildReceipt(ctx, { ok: true, head_seq: 3, head_hash: 'de'.repeat(32) }, 'acc-1', '2026-08-01T12:00:00.000Z');
const hash = await L.canonicalHashOf(receipt);
const sig = await L.signReceiptHash(hash, goodPriv);

async function writeBundle(sub, r, signature, pub, baselineVer) {
  const d = join(dir, sub); mkdirSync(d, { recursive: true });
  const files = await VB.buildReceiptBundle({ receipt_json: r, signature_base64: signature, key_id: 'acc-1', tsa_status: 'pending' }, baselineVer, pub, {});
  for (const f of files) writeFileSync(join(d, f.name), typeof f.data === 'string' ? f.data : Buffer.from(f.data));
  return d;
}

// ATTACK 1: attacker re-signs a modified receipt with THEIR OWN key but
// publishes their own public key in the bundle. Must fail unless the key
// matches the trusted registry, which the CLI checks structurally: the
// signature verifies against the embedded key, so this is a known limit.
// The defense is the PUBLISHED registry, not the bundle. Document + test that
// swapping the public key to a self-consistent attacker pair still verifies
// STRUCTURALLY but the kid mismatch is the tell.
const evil = generateKeyPairSync('ed25519');
const evilPub = evil.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const evilPriv = evil.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const tampered = JSON.parse(JSON.stringify(receipt));
tampered.signature.signedName = 'Attacker Forged';
const tHash = await L.canonicalHashOf(tampered);
const tSig = await L.signReceiptHash(tHash, evilPriv);
const d1 = await writeBundle('selfconsistent', tampered, tSig, evilPub, version);
const r1 = run([d1]);
// This SHOULD verify structurally (self-consistent) - the protection is that
// evilPub is not acc-1 in the real registry. We assert the CLI still runs and
// the operator must check the key. This is a documented trust boundary.
attack('a self-signed forgery is NOT presented as trusted: the CLI demands registry confirmation', r1.stdout.includes('CONFIRM this key is genuine') && r1.stdout.includes('only proves the holder'), 'the verdict must warn, not bless');

// ATTACK 2: keep the REAL signature but swap the baseline to a different doc.
const d2 = await writeBundle('swapbaseline', receipt, sig, goodPub, version);
writeFileSync(join(d2, 'baseline-bundle.reqpub.json'), await VB.buildVerifyBundle({ label: '1.0', seq: 1, snapshot: { answers: { a: 'EVIL' }, sections: {} } }, {}));
const r2 = run([d2]);
attack('swap the sealed baseline for a different document', r2.status === 1 && r2.stdout.includes('MISMATCH'));

// ATTACK 3: strip the signature file entirely.
const d3 = await writeBundle('nosig', receipt, sig, goodPub, version);
writeFileSync(join(d3, 'signature.txt'), 'kid: acc-1\n');
const r3 = run([d3]);
attack('strip the signature to skip the check', r3.status === 1 && r3.stdout.includes('MISMATCH'));

// ATTACK 4: replace the public key with a random one, keep real signature.
const d4 = await writeBundle('wrongkey', receipt, sig, evilPub, version);
const r4 = run([d4]);
attack('present a different public key against the real signature', r4.status === 1 && r4.stdout.includes('MISMATCH'));

// ATTACK 5: malformed receipt.json (not JSON).
const d5 = join(dir, 'malformed'); mkdirSync(d5, { recursive: true });
writeFileSync(join(d5, 'receipt.json'), '{ corrupt');
const r5 = run([d5]);
attack('feed malformed receipt json to crash or bypass the verifier', r5.status !== 0 && !r5.stdout.includes('SEALED-VERIFIED'));

// ATTACK 6: buildReceipt with a null/missing fingerprint (empty string).
try {
  await L.buildReceipt({ ...ctx, fingerprint: '' }, null, 'acc-1', 't');
  attack('seal a receipt with an empty fingerprint', false, 'built anyway');
} catch (e) { attack('seal a receipt with an empty fingerprint', e.divergence === true); }

// ATTACK 7: tsaGranted on garbage bytes must not throw or return true.
attack('tsaGranted returns true on random non-DER bytes', L.tsaGranted(Uint8Array.from([1,2,3,4,5])) === false);
attack('tsaGranted returns true on empty bytes', L.tsaGranted(new Uint8Array(0)) === false);

rmSync(dir, { recursive: true, force: true });
console.log(`\ncli-redteam: ${blocked} blocked, ${vuln} vulnerabilities`);
process.exit(vuln ? 1 : 0);
