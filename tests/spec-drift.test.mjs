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
import { compare } from '../tools/spec-drift-gate.mjs';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const CLI = new URL('../tools/spec-drift-gate.mjs', import.meta.url).pathname;
const FP = 'ab'.repeat(32), OTHER = 'cd'.repeat(32);
const dir = mkdtempSync(join(tmpdir(), 'reqpub-drift-'));

/* The stub: a baseline answer per project id, the propose doctrine's shape. */
const seen = [];
const answers = {
  p1: { ok: true, projectId: 'p1', label: '2.0', seq: 2, status: 'approved', snapshot: {}, fingerprint: FP, sealed: true, sealedBy: [{ signerName: 'Jane Roe', signerRole: 'CTO' }] },
  p2: { ok: true, projectId: 'p2', label: '1.0', seq: 1, status: 'approved', snapshot: {}, fingerprint: OTHER, sealed: false, sealedBy: [] },
  p3: { ok: false, error: 'unsealed', message: 'This project hands off only from a sealed baseline. Baseline v1.0 carries no sealed acceptance receipt.' },
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
    const pid = msg.params.arguments.projectId;
    const out = answers[pid] || { ok: false, error: 'not_in_scope' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: out.ok ? { content: [{ type: 'text', text: JSON.stringify(out) }] } : { content: [{ type: 'text', text: out.error + (out.message ? ': ' + out.message : '') }], isError: true } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/functions/v1/mcp';
/* The stub lives in this process, so the CLI runs asynchronously: a
   synchronous spawn would block the event loop the stub answers from. */
const run = (args, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, REQPUB_MCP_URL: url, REQPUB_MCP_KEY: 'rqp_live_' + 'k'.repeat(32), ...env } });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => resolve({ status, stdout, stderr }));
});
const file = (name, fingerprint, label) => { const f = join(dir, name); writeFileSync(f, JSON.stringify({ version: { label }, fingerprint: { algorithm: 'SHA-256', value: fingerprint } })); return f; };

await test('a committed file at the baseline fingerprint passes, naming the baseline and its signers', async () => {
  const r = await run(['--project', 'p1', '--file', file('ok.json', FP, '2.0')]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.stdout.includes('OK  committed requirements.json is baseline v2.0 seq 2'));
  assert.ok(r.stdout.includes('sealed by Jane Roe'));
  assert.equal(seen.at(-1).body.params.name, 'reqpub_get_baseline');
});

await test('a committed file behind the baseline is DRIFT, exit 1, with the remedy', async () => {
  const r = await run(['--project', 'p1', '--file', file('old.json', OTHER, '1.0')]);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('DRIFT  committed cdcdcdcdcdcdcdcd'));
  assert.ok(r.stdout.includes('regenerate the implementation package'));
});

await test('--require-sealed refuses an unsealed baseline even when the fingerprints match', async () => {
  const ok = await run(['--project', 'p2', '--file', file('p2.json', OTHER, '1.0')]);
  assert.equal(ok.status, 0);
  assert.ok(ok.stdout.includes('not yet sealed'));
  const r = await run(['--project', 'p2', '--file', file('p2b.json', OTHER, '1.0'), '--require-sealed']);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('UNSEALED  baseline v1.0'));
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
});

server.close();
rmSync(dir, { recursive: true, force: true });
console.log('\nspec-drift.test: ' + n + '/' + n + ' passed');
