/* ReqPub v2 - seal bundle zip integrity (node tests/seal-zip-integrity.test.mjs)
   Builds the exact receipt bundle the app downloads, with unicode-bearing
   snapshot content, writes the archive, and validates it with unzip -t.
   Pins the byte-encode-before-zip rule the bundle button relies on. */
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const { buildReceiptBundle } = await import('../app/js/verifybundle.js');
const { buildReceipt, canonicalHashOf, signReceiptHash } = await import('../supabase/functions/seal-receipt/seallib.mjs');
const { zipStore } = await import('../app/js/zipstore.js');
const { versionFingerprint } = await import('../app/js/core.js');
let n = 0; const ok = (name) => { n++; console.log('  \u2713 ' + name); };

const version = { label: '2.5', seq: 9, snapshot: { answers: { a: 'Curly \u201cquotes\u201d, caf\u00e9, em\u2011adjacent \u2192 unicode' }, sections: {} } };
const fp = await versionFingerprint(version);
const ctx = { receiptId: 'r1', projectId: 'p1', project: 'Fathering \u2014 no wait, plain', label: '2.5', seq: 9, snapshot: version.snapshot, fingerprint: fp, signRequestId: 'sr1', signedName: 'Micah D C', signedAt: '2026-08-03T15:17:00.000Z', signer: { role: 'Sponsor', emailDomain: 'fathers.com' }, evidence: { channel: 'link' } };
const receipt = await buildReceipt(ctx, { ok: true, head_seq: 40, head_hash: 'ab'.repeat(32) }, 'acc-1', '2026-08-03T15:20:00.000Z');
const hash = await canonicalHashOf(receipt);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const sig = await signReceiptHash(hash, privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
const files = await buildReceiptBundle({ receipt_json: receipt, signature_base64: sig, key_id: 'acc-1', tsa_status: 'pending', sealed_at: '2026-08-03T15:20:00.000Z' }, version, publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), {});
ok('bundle builds with unicode content in the sealed snapshot');

const enc = new TextEncoder();
const bytes = zipStore(files.map((f) => ({ name: f.name, data: typeof f.data === 'string' ? enc.encode(f.data) : f.data })), new Date('2026-08-03T15:20:00.000Z'));
const dir = mkdtempSync(join(tmpdir(), 'sealzip-'));
const zp = join(dir, 'receipt.zip');
writeFileSync(zp, Buffer.from(bytes));
const report = execFileSync('unzip', ['-t', zp], { encoding: 'utf8' });
assert.ok(report.includes('No errors detected'), report);
ok('unzip -t: the archive extracts clean, every entry verified');
assert.ok(report.includes('receipt.json') && report.includes('baseline-bundle.reqpub.json') && report.includes('VERIFY.txt'));
ok('all bundle members present in the archive');
{
  // The RPC returns the receipt under the key `receipt`; the bundle must
  // read that shape, and the written receipt.json must parse as JSON.
  const rpcShaped = { receipt: receipt, signature_base64: sig, key_id: 'acc-1', tsa_status: 'dual', sealed_at: '2026-08-03T15:20:00.000Z' };
  const files2 = await buildReceiptBundle(rpcShaped, version, publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), {});
  const rtext = files2.find((f) => f.name === 'receipt.json').data;
  const parsed = JSON.parse(rtext);
  assert.equal(parsed.format, 'reqpub-receipt');
  ok('the RPC-shaped row (key receipt) produces valid receipt.json');
  await assert.rejects(() => buildReceiptBundle({ signature_base64: sig, key_id: 'acc-1' }, version, 'x', {}), /receipt content missing/);
  ok('a row with no receipt refuses loudly instead of writing undefined');
}
const mainSrc = (await import('node:fs')).readFileSync(new URL('../app/js/main.js', import.meta.url), 'utf8');
assert.ok(mainSrc.includes("download('receipt-' + String(rc.canonical_hash || '').slice(0, 8) + '.zip', 'application/zip',"), 'the bundle download passes all three arguments with the zip mime');
ok('the call site carries name, mime, and body, pinned in source');
const core = await import('../app/js/core.js');
assert.throws(() => core.download('x.zip', bytes), /mime must be a string/);
ok('a two-argument download call throws before it can write a broken file');
const page = (await import('node:fs')).readFileSync(new URL('../receipt-verify.html', import.meta.url), 'utf8');
assert.ok(page.includes('const picked = {}') && page.includes('addFiles(') && page.includes('Start over') && page.includes('Still needed:'), 'the verify page accumulates picks with a checklist and reset');
ok('verify page pick-accumulation pinned in source');
console.log('\nseal-zip-integrity.test: ' + n + '/' + n + ' passed');
