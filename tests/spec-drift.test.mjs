/* ReqPub v3.2 - the spec drift gate (node tests/spec-drift.test.mjs)
   The pod's pipeline step: the committed requirements.json must be the
   signed baseline. A stub MCP server answers like the real one, the CLI
   runs against it as a child process, and the verdicts are pinned: match,
   drift, unsealed, refused, unreachable. Node only, no network. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { compare } from '../tools/spec-drift-gate.mjs';
import { canonical, sha256Hex } from '../tools/reqpub-verify-lib.mjs';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const CLI = new URL('../tools/spec-drift-gate.mjs', import.meta.url).pathname;
const FP = 'ab'.repeat(32), OTHER = 'cd'.repeat(32);
const dir = mkdtempSync(join(tmpdir(), 'reqpub-drift-'));
/* An ephemeral key. The suite never uses a published ReqPub key. */
const ed = generateKeyPairSync('ed25519');
const KID = 'test-kid';
const keysPath = join(dir, 'keys.json');
writeFileSync(keysPath, JSON.stringify({ keys: [{ kid: KID, alg: 'Ed25519', publicKeySpkiBase64: ed.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), createdAt: '2026-01-01T00:00:00Z' }] }));
const seal = (receipt) => sign(null, Buffer.from(sha256Hex(canonical(receipt)), 'hex'), ed.privateKey).toString('base64');
const p1Receipt = {
  format: 'reqpub-receipt', formatVersion: 1, receiptId: 'r-p1', sealedAt: '2026-08-01T12:00:00.000Z',
  project: { id: 'p1', nameSha256: '11'.repeat(32) },
  baseline: { label: '2.0', seq: 2, docFingerprint: FP, recomputedFingerprint: FP },
  signature: { signRequestId: 'sr1', signedName: 'Jane Roe', signerRole: 'CTO', signerEmailDomain: 'example.com', signedAt: '2026-08-01T10:00:00.000Z', channel: 'link' },
  chain: { headSeq: 1, headHash: '22'.repeat(32) },
  issuer: { name: 'ReqPub', kid: KID },
};

/* The stub: a baseline answer per project id, the propose doctrine's shape.
   reqpub_get_receipt returns the seal and the timestamp status, and no .tsr. */
const seen = [];
const answers = {
  p1: { ok: true, projectId: 'p1', label: '2.0', seq: 2, status: 'approved', snapshot: {}, fingerprint: FP, sealed: true, sealedBy: [{ signerName: 'Jane Roe', signerRole: 'CTO', receiptId: 'r-p1', tsaStatus: 'pending' }] },
  p2: { ok: true, projectId: 'p2', label: '1.0', seq: 1, status: 'approved', snapshot: {}, fingerprint: OTHER, sealed: false, sealedBy: [] },
  p3: { ok: false, error: 'unsealed', message: 'This project hands off only from a sealed baseline. Baseline v1.0 carries no sealed acceptance receipt.' },
};
const receipts = {
  'r-p1': { ok: true, receiptId: 'r-p1', keyId: KID, tsaStatus: 'pending', signatureBase64: seal(p1Receipt), receiptJson: p1Receipt },
};
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ auth: req.headers.authorization, body: JSON.parse(body) });
    if (req.headers.authorization !== 'Bearer rqp_live_' + 'k'.repeat(32)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'invalid or revoked key' } }));
    }
    const msg = JSON.parse(body);
    const name = msg.params && msg.params.name;
    const toolArgs = (msg.params && msg.params.arguments) || {};
    const out = name === 'reqpub_get_receipt'
      ? (receipts[toolArgs.receiptId] || { ok: false, error: 'not_in_scope' })
      : (answers[toolArgs.projectId] || { ok: false, error: 'not_in_scope' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: out.ok ? { content: [{ type: 'text', text: JSON.stringify(out) }] } : { content: [{ type: 'text', text: out.error + (out.message ? ': ' + out.message : '') }], isError: true } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/functions/v1/mcp';
/* The stub lives in this process, so the CLI runs asynchronously: a
   synchronous spawn would block the event loop the stub answers from. */
const run = (args, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, '--keys', keysPath, '--trust-local-keys', ...args], { env: { ...process.env, REQPUB_MCP_URL: url, REQPUB_MCP_KEY: 'rqp_live_' + 'k'.repeat(32), ...env } });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => resolve({ status, stdout, stderr }));
});
const file = (name, fingerprint, label) => { const f = join(dir, name); writeFileSync(f, JSON.stringify({ version: { label }, fingerprint: { algorithm: 'SHA-256', value: fingerprint } })); return f; };

await test('a committed file at the baseline fingerprint passes, naming the baseline and its signers', async () => {
  const before = seen.length;
  const r = await run(['--project', 'p1', '--file', file('ok.json', FP, '2.0')]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.stdout.includes('OK  committed requirements.json is baseline v2.0 seq 2'));
  assert.ok(r.stdout.includes('sealed by Jane Roe'));
  assert.ok(r.stdout.includes('fingerprint: pass'));
  assert.ok(r.stdout.includes('receipt signature: pass'));
  assert.ok(r.stdout.includes('timestamps: not verifiable over MCP (status only)'));
  const names = seen.slice(before).map((s) => s.body.params.name);
  assert.deepEqual(names, ['reqpub_get_baseline', 'reqpub_get_receipt']);
});

await test('a committed file behind the baseline is DRIFT, exit 1, with the remedy', async () => {
  const r = await run(['--project', 'p1', '--file', file('old.json', OTHER, '1.0')]);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('DRIFT  committed cdcdcdcdcdcdcdcd'));
  assert.ok(r.stdout.includes('regenerate the implementation package'));
});

await test('an unsealed baseline is refused by default; --require-sealed changes nothing; --allow-unsealed warns and passes', async () => {
  const f = file('p2.json', OTHER, '1.0');
  const refused = await run(['--project', 'p2', '--file', f]);
  assert.equal(refused.status, 1);
  assert.ok(refused.stdout.includes('UNSEALED  baseline v1.0'));
  assert.ok(refused.stdout.includes('sealed: fail'));
  const still = await run(['--project', 'p2', '--file', f, '--require-sealed']);
  assert.equal(still.status, 1);
  assert.ok(still.stdout.includes('UNSEALED  baseline v1.0'));
  const allowed = await run(['--project', 'p2', '--file', f, '--allow-unsealed']);
  assert.equal(allowed.status, 0, allowed.stderr + allowed.stdout);
  assert.ok(allowed.stdout.includes('WARNING'));
  assert.ok(allowed.stdout.includes('--allow-unsealed'));
  assert.ok(allowed.stderr.includes('WARNING'));
  assert.ok(allowed.stdout.includes('not yet sealed'));
});

await test('a project that hands off only from sealed baselines refuses the read: exit 1, the reason printed', async () => {
  const r = await run(['--project', 'p3', '--file', file('p3.json', FP, '1.0')]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('REFUSED  unsealed'));
  assert.ok(r.stderr.includes('carries no sealed acceptance receipt'));
});

await test('a bad key, a missing file or a missing argument cannot pass: exit 2 and the gate says why', async () => {
  const bad = await run(['--project', 'p1', '--file', file('k.json', FP, '2.0')], { REQPUB_MCP_KEY: 'rqp_live_' + 'x'.repeat(32) });
  assert.equal(bad.status, 2); assert.ok(bad.stderr.includes('invalid or revoked key'));
  const nofile = await run(['--project', 'p1', '--file', join(dir, 'missing.json')]);
  assert.equal(nofile.status, 2); assert.ok(nofile.stderr.includes('cannot read'));
  const noarg = await run(['--file', file('n.json', FP, '2.0')]);
  assert.equal(noarg.status, 2); assert.ok(noarg.stderr.includes('--project'));
});

await test('an unreachable endpoint and a non-integer --seq are exit 2 with one line each, never a stack trace', async () => {
  const down = await run(['--project', 'p1', '--file', file('d.json', FP, '2.0')], { REQPUB_MCP_URL: 'http://127.0.0.1:9/functions/v1/mcp' });
  assert.equal(down.status, 2, down.stderr);
  assert.ok(down.stderr.includes('cannot reach the MCP endpoint'));
  assert.ok(!down.stderr.includes('    at '), 'no stack trace');
  const seq = await run(['--project', 'p1', '--file', file('s.json', FP, '2.0'), '--seq', 'abc']);
  assert.equal(seq.status, 2); assert.ok(seq.stderr.includes('--seq must be an integer'));
});

await test('the pure comparison never passes a file without a fingerprint, and reports a label mismatch under one fingerprint', async () => {
  assert.equal(compare({}, answers.p1).ok, false);
  const v = compare({ version: { label: '3.0' }, fingerprint: { value: FP } }, answers.p1);
  assert.equal(v.ok, false);
  assert.ok(v.lines[0].includes('committed label v3.0 is not the baseline label v2.0'));
  assert.equal(compare({ fingerprint: { value: FP.toUpperCase() } }, answers.p1).ok, true, 'case does not matter in hex');
  assert.equal(compare({ version: { label: '1.0' }, fingerprint: { value: OTHER } }, answers.p2).ok, false, 'sealed is required unless the caller opts out');
  assert.equal(compare({ version: { label: '1.0' }, fingerprint: { value: OTHER } }, answers.p2, { requireSealed: false }).ok, true);
});

server.close();
rmSync(dir, { recursive: true, force: true });
console.log('\nspec-drift.test: ' + n + '/' + n + ' passed');
