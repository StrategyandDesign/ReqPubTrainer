/* ReqPub v2 - the evidence pack CLI gate (node tests/evidence-cli.test.mjs)
   Pins v2.52: a real pack, real Ed25519, written to disk, verified by the
   published CLI following only docs/VERIFY.md. PACK-VERIFIED untouched;
   MISMATCH after a single flipped byte; MISMATCH after a manifest entry is
   removed (the file becomes unlisted); MISMATCH when a stray file appears.
   The CLI imports nothing from ReqPub; this gate proves the doc suffices. */
import { buildEvidencePack } from '../app/js/evidencepack.js';
import { sha256Hex, canonicalJson } from '../app/js/core.js';
import { mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };
const cli = fileURLToPath(new URL('../tools/reqpub-verify.mjs', import.meta.url));
const runCli = (dir) => {
  try { return { code: 0, out: execFileSync(process.execPath, [cli, '--evidence', dir], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
};

/* A sealed record with real cryptography: one baseline, one receipt whose
   Ed25519 signature verifies against the key riding in the gather. */
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const snapshot = { answers: { obj: 'Ship it' }, sections: {} };
const fp = await sha256Hex(canonicalJson({ label: '1.0', seq: 1, snapshot }));
const receiptJson = { format: 'reqpub-acceptance-receipt', formatVersion: 1, baseline: { docFingerprint: fp }, signer: { name: 'Kate', role: 'Sponsor' } };
const canonHash = await sha256Hex(canonicalJson(receiptJson));
const sig = edSign(null, Buffer.from(canonHash.match(/.{2}/g).map((b) => parseInt(b, 16))), privateKey).toString('base64');

const gather = {
  ok: true,
  project: { id: 'p-cli', name: 'CLI Gate' },
  metaOmitted: true, metaNote: 'stated',
  chronology: [{ at: '2026-08-01T10:00:00Z', action: 'version.created', kind: 'version', ref: 'v1', actor: 'Micah', message: 'created' }],
  versions: [{ label: '1.0', seq: 1, status: 'approved', note: '', authorName: 'Micah', createdAt: '2026-08-01T10:00:00Z', snapshot }],
  signatures: [{ signerName: 'Kate', signerRole: 'Sponsor', signerEmailDomain: 'clientco.com', status: 'signed',
    sentAt: '2026-08-01T12:00:00Z', signedAt: '2026-08-01T13:00:00Z', docFingerprint: fp, versionSeq: 1, versionLabel: '1.0', receiptId: 'r-1' }],
  receipts: [{ receiptId: 'r-1', canonicalHash: canonHash, keyId: 'rk-cli', tsaStatus: 'single', sealedAt: '2026-08-01T13:01:00Z',
    receiptJson, signatureBase64: sig, tsaPrimaryDer: 'AAECAwQFBgc=', tsaSecondaryDer: null, versionSeq: 1 }],
  attachments: [], keys: [{ kid: 'rk-cli', publicKeySpkiBase64: spki }],
  chain: { ok: true, head_seq: 3, head_hash: 'ab'.repeat(32), unchained: 0 },
};

const { files } = await buildEvidencePack(gather, { generatedAt: '2026-08-03T00:00:00Z' });
const base = join(tmpdir(), 'reqpub-evpack-' + process.pid);
rmSync(base, { recursive: true, force: true });
const writePack = (dir) => {
  for (const f of files) {
    const p = join(dir, f.name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof f.data === 'string' ? f.data : Buffer.from(f.data));
  }
};

const clean = join(base, 'clean'); writePack(clean);
{
  const r = runCli(clean);
  check('an untouched pack answers PACK-VERIFIED, exit 0', r.code === 0 && r.out.includes('PACK-VERIFIED'), r.out.split('\n').slice(-3));
  check('the receipt inside verified through the section 9 path', r.out.includes('SEALED-VERIFIED'));
  check('the openssl ts command is printed for the .tsr', r.out.includes('openssl ts -verify -digest ' + canonHash));
}

{
  const dir = join(base, 'flip'); cpSync(clean, dir, { recursive: true });
  const p = join(dir, 'chronology.csv');
  const b = Buffer.from(readFileSync(p)); b[b.length - 3] ^= 1; writeFileSync(p, b);
  const r = runCli(dir);
  check('one flipped byte answers MISMATCH, exit 1', r.code === 1 && r.out.includes('MISMATCH') && r.out.includes('chronology.csv'));
}

{
  const dir = join(base, 'drop'); cpSync(clean, dir, { recursive: true });
  const mp = join(dir, 'manifest.json');
  const m = JSON.parse(readFileSync(mp, 'utf8'));
  m.files = m.files.filter((f) => f.name !== 'evidence.csv');
  writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
  const r = runCli(dir);
  check('a removed manifest entry answers MISMATCH: the file is present but unlisted',
    r.code === 1 && r.out.includes('MISMATCH') && r.out.includes('evidence.csv'));
}

{
  const dir = join(base, 'stray'); cpSync(clean, dir, { recursive: true });
  writeFileSync(join(dir, 'stray.txt'), 'not part of the record\n');
  const r = runCli(dir);
  check('a stray file answers MISMATCH: strict both ways', r.code === 1 && r.out.includes('stray.txt'));
}

rmSync(base, { recursive: true, force: true });
console.log(`evidence cli: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
