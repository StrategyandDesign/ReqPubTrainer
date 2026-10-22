/* ReqPub - the spec drift gate checks the receipt locally (node:test).
   A stub MCP server answers reqpub_get_baseline and reqpub_get_receipt.
   Signatures use an ephemeral Ed25519 key generated in this process.
   No published ReqPub key is used, and no network call leaves the machine. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { canonical, sha256Hex } from '../tools/reqpub-verify-lib.mjs';
import { fetchPublishedKeys, PUBLISHED_KEYS_SHA256, PUBLISHED_KEYS_URL, TRUST_LOCAL_KEYS_WARNING } from '../tools/spec-drift-gate.mjs';
import { syntheticAuthority } from './fixtures/rfc3161-synthetic.mjs';

const CLI = new URL('../tools/spec-drift-gate.mjs', import.meta.url).pathname;
const FP = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const dir = mkdtempSync(join(tmpdir(), 'reqpub-drift-receipt-'));
const ed = generateKeyPairSync('ed25519');
const KID = 'test-kid';
const spki = ed.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const keysPath = join(dir, 'keys.json');
writeFileSync(keysPath, JSON.stringify({
  keys: [{ kid: KID, alg: 'Ed25519', publicKeySpkiBase64: spki, createdAt: '2026-01-01T00:00:00Z' }],
}));
const published = JSON.parse(readFileSync(new URL('../reqpub-keys.json', import.meta.url), 'utf8'));
const publishedMaterial = published.keys.flatMap((k) => [k.kid, k.publicKeySpkiBase64]);
const tsa = syntheticAuthority('Synthetic Test TSA', 77);

const sealOf = (receipt) => sign(null, Buffer.from(sha256Hex(canonical(receipt)), 'hex'), ed.privateKey).toString('base64');
function receiptFor(fingerprint, id = 'r-1') {
  return {
    format: 'reqpub-receipt', formatVersion: 1, receiptId: id, sealedAt: '2026-08-01T12:00:00.000Z',
    project: { id: 'p1', nameSha256: '11'.repeat(32) },
    baseline: { label: '2.0', seq: 2, docFingerprint: fingerprint, recomputedFingerprint: fingerprint },
    signature: { signRequestId: 'sr1', signedName: 'Jane Roe', signerRole: 'CTO', signerEmailDomain: 'example.com', signedAt: '2026-08-01T10:00:00.000Z', channel: 'link' },
    chain: { headSeq: 1, headHash: '22'.repeat(32) },
    issuer: { name: 'ReqPub', kid: KID },
  };
}
const committed = (fingerprint, label = '2.0') => {
  const f = join(dir, 'req-' + fingerprint.slice(0, 8) + '-' + Math.random().toString(16).slice(2) + '.json');
  writeFileSync(f, JSON.stringify({ version: { label }, fingerprint: { algorithm: 'SHA-256', value: fingerprint } }));
  return f;
};

function listen(handler) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-bearer') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'invalid or revoked key' } }));
      }
      const msg = JSON.parse(body);
      const out = handler(msg.params.name, msg.params.arguments || {});
      res.writeHead(200, { 'content-type': 'application/json' });
      const result = out && out.ok
        ? { content: [{ type: 'text', text: JSON.stringify(out) }] }
        : { content: [{ type: 'text', text: (out && out.error || 'denied') + (out && out.message ? ': ' + out.message : '') }], isError: true };
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function spawnGate(server, args) {
  const url = 'http://127.0.0.1:' + server.address().port + '/functions/v1/mcp';
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, REQPUB_MCP_URL: url, REQPUB_MCP_KEY: 'test-bearer' },
    });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr, host: new URL(url).host }));
  });
}
function run(server, args) {
  return spawnGate(server, ['--keys', keysPath, '--trust-local-keys', ...args]);
}
async function withServer(handler, args) {
  const server = await listen(handler);
  try { return await run(server, args); }
  finally { server.close(); }
}
function baseline({ sealed = true, fingerprint = FP, receiptId = 'r-1' } = {}) {
  return {
    ok: true, projectId: 'p1', label: '2.0', seq: 2, status: 'approved', snapshot: {}, fingerprint, sealed,
    sealedBy: sealed ? [{ signerName: 'Jane Roe', signerRole: 'CTO', receiptId, tsaStatus: 'pending' }] : [],
  };
}
function receiptAnswer(receipt, { signature, tokens } = {}) {
  const answer = {
    ok: true, receiptId: receipt.receiptId, keyId: KID, tsaStatus: tokens ? 'dual' : 'pending',
    signatureBase64: signature || sealOf(receipt), receiptJson: receipt,
  };
  if (tokens) answer.tsaPrimaryDer = tokens.primary;
  if (tokens && tokens.secondary) answer.tsaSecondaryDer = tokens.secondary;
  return answer;
}
function handlerFor(base, receipt) {
  return (name, toolArgs) => {
    if (name === 'reqpub_get_baseline') return base;
    if (name === 'reqpub_get_receipt') return receipt || { ok: false, error: 'not_in_scope', message: 'no receipt' };
    return { ok: false, error: 'unknown' };
  };
}
function assertNoPublishedKey(r) {
  const blob = r.stdout + r.stderr;
  for (const bit of publishedMaterial) assert.equal(blob.includes(bit), false);
}

test('a signed receipt whose fingerprint matches the baseline passes, including a present timestamp token', async () => {
  const receipt = receiptFor(FP);
  const token = tsa.response(sha256Hex(canonical(receipt))).toString('base64');
  const r = await withServer(handlerFor(baseline(), receiptAnswer(receipt, { tokens: { primary: token } })), ['--project', 'p1', '--file', committed(FP)]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const line of ['fingerprint: pass', 'label: pass', 'sealed: pass', 'receipt signature: pass', 'receipt fingerprint: pass', 'timestamps: pass']) {
    assert.ok(r.stdout.includes(line), line + '\n' + r.stdout);
  }
  assert.ok(r.stdout.includes('OK  committed requirements.json is baseline v2.0'));
  assert.equal(r.stdout.includes('timestamps: not verifiable over MCP (status only)'), false);
  assertNoPublishedKey(r);
});

test('a signed receipt whose fingerprint was tampered fails closed', async () => {
  const receipt = receiptFor(OTHER);
  const r = await withServer(handlerFor(baseline(), receiptAnswer(receipt)), ['--project', 'p1', '--file', committed(FP)]);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('receipt signature: pass'));
  assert.ok(r.stdout.includes('receipt fingerprint: fail'));
  assert.equal(r.stdout.includes('OK  committed'), false);
  assertNoPublishedKey(r);
});

test('a receipt with a bad signature fails closed', async () => {
  const receipt = receiptFor(FP);
  const good = Buffer.from(sealOf(receipt), 'base64');
  good[0] ^= 0xff;
  const r = await withServer(handlerFor(baseline(), receiptAnswer(receipt, { signature: good.toString('base64') })), ['--project', 'p1', '--file', committed(FP)]);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('receipt signature: fail'));
  assert.ok(r.stdout.includes('Ed25519 signature does not verify'));
  assert.equal(r.stdout.includes('OK  committed'), false);
  assertNoPublishedKey(r);
});

test('an unsealed baseline fails by default, and --require-sealed changes nothing', async () => {
  const file = committed(FP);
  const refused = await withServer(handlerFor(baseline({ sealed: false, receiptId: null })), ['--project', 'p1', '--file', file]);
  assert.equal(refused.status, 1, refused.stdout);
  assert.ok(refused.stdout.includes('UNSEALED  baseline v2.0'));
  assert.ok(refused.stdout.includes('sealed: fail'));
  const still = await withServer(handlerFor(baseline({ sealed: false })), ['--project', 'p1', '--file', file, '--require-sealed']);
  assert.equal(still.status, 1);
  assert.ok(still.stdout.includes('UNSEALED  baseline v2.0'));
  assert.ok(still.stdout.includes('sealed: fail'));
});

test('an unsealed baseline with --allow-unsealed passes and prints a warning', async () => {
  const r = await withServer(handlerFor(baseline({ sealed: false })), ['--project', 'p1', '--file', committed(FP), '--allow-unsealed']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.stdout.includes('WARNING'));
  assert.ok(r.stdout.includes('--allow-unsealed'));
  assert.ok(r.stderr.includes('WARNING'));
  assert.ok(r.stderr.includes('NOT required'));
  assert.ok(r.stdout.includes('sealed: warning (--allow-unsealed)'));
  assert.ok(r.stdout.includes('not yet sealed'));
  assert.ok(r.stdout.includes('receipt signature: skipped (--allow-unsealed; baseline is not sealed)'));
});

test('missing timestamp tokens are reported and do not fail the gate', async () => {
  const receipt = receiptFor(FP);
  const answer = receiptAnswer(receipt);
  assert.equal(answer.tsaPrimaryDer, undefined);
  assert.equal(answer.tsaStatus, 'pending');
  const r = await withServer(handlerFor(baseline(), answer), ['--project', 'p1', '--file', committed(FP)]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.stdout.includes('timestamps: not verifiable over MCP (status only)'));
  assert.equal(r.stdout.includes('timestamps: fail'), false);
  assert.ok(r.stdout.includes('receipt signature: pass'));
  assert.ok(r.stdout.includes('receipt fingerprint: pass'));
  assertNoPublishedKey(r);
});

test('a timestamp token that is present and invalid fails the gate', async () => {
  const receipt = receiptFor(FP);
  const bogus = Buffer.from('this is not a timestamp token').toString('base64');
  const r = await withServer(handlerFor(baseline(), receiptAnswer(receipt, { tokens: { primary: bogus } })), ['--project', 'p1', '--file', committed(FP)]);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('timestamps: fail'));
  assert.equal(r.stdout.includes('OK  committed'), false);
});

test('a local --keys file without --trust-local-keys is refused', async () => {
  const server = await listen(handlerFor(baseline(), receiptAnswer(receiptFor(FP))));
  try {
    const r = await spawnGate(server, ['--keys', keysPath, '--project', 'p1', '--file', committed(FP)]);
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.ok(r.stdout.includes('REFUSED  --keys'));
    assert.ok(r.stdout.includes('--trust-local-keys'));
    assert.ok(r.stdout.includes(PUBLISHED_KEYS_URL));
    assert.ok(r.stderr.includes('REFUSED  --keys'));
    assert.ok(r.stdout.includes('mcp host: ' + r.host), r.stdout);
    assert.equal(r.stdout.includes('receipt signature: pass'), false);
    assert.equal(r.stdout.includes('OK  committed'), false);
    assertNoPublishedKey(r);
  } finally { server.close(); }
});

test('a local --keys file with --trust-local-keys passes and the warning is in the verdict', async () => {
  const receipt = receiptFor(FP);
  const r = await withServer(handlerFor(baseline(), receiptAnswer(receipt)), ['--project', 'p1', '--file', committed(FP)]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.stdout.includes(TRUST_LOCAL_KEYS_WARNING), r.stdout);
  assert.ok(r.stderr.includes(TRUST_LOCAL_KEYS_WARNING), r.stderr);
  assert.ok(r.stdout.includes('mcp host: ' + r.host), r.stdout);
  assert.ok(r.stdout.includes('receipt signature: pass'));
  assert.ok(r.stdout.includes('OK  committed requirements.json is baseline v2.0'));
  assertNoPublishedKey(r);
});

test('the published key fetch is mocked and a body that misses the pin is not used', async () => {
  const body = readFileSync(new URL('../reqpub-keys.json', import.meta.url));
  assert.equal(createHash('sha256').update(body).digest('hex'), PUBLISHED_KEYS_SHA256);
  let seen;
  const keys = await fetchPublishedKeys({
    fetchFn: async (url) => {
      seen = url;
      return { ok: true, text: async () => body.toString('utf8') };
    },
  });
  assert.equal(seen, 'https://reqpub.com/reqpub-keys.json');
  assert.equal(seen, PUBLISHED_KEYS_URL);
  assert.deepEqual(keys.map((k) => k.kid), ['acc-1', 'whk-1']);
  let used = false;
  await assert.rejects(
    () => fetchPublishedKeys({
      fetchFn: async () => ({
        ok: true,
        text: async () => {
          used = true;
          return '{"keys":[{"kid":"forged","alg":"Ed25519","publicKeySpkiBase64":"aa"}]}';
        },
      }),
    }),
    (err) => err && err.code === 1 && /does not match the pinned/.test(err.message) && /were not used/.test(err.message),
  );
  assert.equal(used, true);
  await assert.rejects(
    () => fetchPublishedKeys({ fetchFn: async () => { throw new Error('offline'); } }),
    (err) => err && err.code === 2 && /cannot fetch published keys/.test(err.message),
  );
});

test('a sealed baseline whose receipt cannot be fetched exits 2', async () => {
  const r = await withServer(handlerFor(baseline(), { ok: false, error: 'not_in_scope', message: 'no such receipt' }), ['--project', 'p1', '--file', committed(FP)]);
  assert.equal(r.status, 2, r.stderr + r.stdout);
  assert.ok(r.stdout.includes('receipt signature: not run'));
  assert.ok(r.stdout.includes('cannot fetch receipt'));
  assert.equal(r.stdout.includes('OK  committed'), false);
});

after(() => rmSync(dir, { recursive: true, force: true }));
