/* ReqPub v2 - the MCP function scheme (node tests/mcp-scheme.test.mjs)
   Imports the shipped supabase/functions/mcp/index.ts directly and pins:
   the initialize envelope; tools/list with and without the doubly gated
   propose; the JSON-RPC error codes for bad requests, unknown methods,
   unknown tools, and bad params; the canonical params hash, order
   insensitive; the gate refusal at 429 with no double audit; the denied
   and error audit rows; the bearer format; the fingerprint on
   get_baseline computed with the one recipe; the no-token no-email
   assertion on serialized outputs; the CORS surface; and the drift gates:
   the vendored core.js byte-equals app/js/core.js and the dashboard paste
   regenerates byte for byte. */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  handleRpc, toolDefs, parseBearer, cors, PROTOCOL_VERSION, SERVER_INFO,
} from './../supabase/functions/mcp/index.ts';
import { versionFingerprint, APP_VERSION } from './../app/js/core.js';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const AUTH = { keyId: 'k-1', orgId: 'o-1', label: 'Planning agent', projectIds: null, proposeEnabled: false };
const mkCtx = (rpcMap, auth = AUTH) => {
  const calls = []; const audits = [];
  return {
    calls, audits, auth,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'mcp_audit_append') { audits.push(args.p_status); return {}; }
      const h = rpcMap[fn];
      return typeof h === 'function' ? h(args) : (h ?? { ok: true });
    },
  };
};
const call = (name, args) => ({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });

/* ---- initialize ---- */
{
  const ctx = mkCtx({});
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, ctx);
  check('initialize states the protocol, the server name, and the app version',
    r.status === 200 && r.body.result.protocolVersion === PROTOCOL_VERSION
    && r.body.result.serverInfo.name === 'reqpub'
    && r.body.result.serverInfo.version === APP_VERSION
    && JSON.stringify(r.body.result.capabilities) === '{"tools":{}}', r.body);
  check('SERVER_INFO version tracks core APP_VERSION', SERVER_INFO.version === APP_VERSION);
}

/* ---- tools/list gating ---- */
{
  const ctx = mkCtx({});
  const r = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);
  const names = r.body.result.tools.map((t) => t.name);
  check('without the key gate, five read tools and no propose',
    names.length === 5 && !names.includes('reqpub_propose')
    && names.includes('reqpub_get_baseline') && names.includes('reqpub_verify_chain'), names);
  check('every tool carries an input schema', r.body.result.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));
  const ctx2 = mkCtx({ mcp_propose_visible: { ok: true, visible: true } }, { ...AUTH, proposeEnabled: true });
  const r2 = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ctx2);
  check('with both gates possible, propose is listed',
    r2.body.result.tools.map((t) => t.name).includes('reqpub_propose'));
  const ctx3 = mkCtx({ mcp_propose_visible: { ok: true, visible: false } }, { ...AUTH, proposeEnabled: true });
  const r3 = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, ctx3);
  check('with the key gate on but no project on, propose stays hidden',
    !r3.body.result.tools.map((t) => t.name).includes('reqpub_propose'));
  check('toolDefs mirrors the gate directly', toolDefs(false).length === 5 && toolDefs(true).length === 6);
}

/* ---- protocol errors ---- */
{
  const ctx = mkCtx({});
  const bad = await handleRpc({ id: 1, method: 'x' }, ctx);
  check('a message without jsonrpc 2.0 is invalid request', bad.body.error.code === -32600, bad.body);
  const unk = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'resources/list' }, ctx);
  check('an unknown method is method not found', unk.body.error.code === -32601, unk.body);
  const noname = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }, ctx);
  check('tools/call without a name is invalid params', noname.body.error.code === -32602, noname.body);
  const note = await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx);
  check('the initialized notification is accepted with no body', note.status === 202 && note.body === null);
}

/* ---- dispatch, scope args, and the fingerprint ---- */
{
  const snapshot = { answers: { k: 'v' }, sections: {} };
  const ctx = mkCtx({
    mcp_gate: { ok: true },
    mcp_list_projects: { ok: true, projects: [{ id: 'p1', name: 'One', practice: false }] },
    mcp_get_baseline: { ok: true, projectId: 'p1', label: '1.1', seq: 2, status: 'draft', note: '', authorName: 'Micah', snapshot, practice: false },
    mcp_signature_status: { ok: true, requests: [{ signerName: 'Ada Q Client', signerRole: 'Sponsor', status: 'signed', receiptId: 'r-1' }] },
    mcp_get_receipt: { ok: true, receiptId: 'r-1', keyId: 'acc-1', tsaStatus: 'dual', signatureBase64: 'c2ln', receiptJson: { receiptVersion: 1 } },
    mcp_verify_chain: { ok: true, checked: 3 },
  });
  const lp = await handleRpc(call('reqpub_list_projects', {}), ctx);
  const lpCall = ctx.calls.find((c) => c.fn === 'mcp_list_projects');
  check('list_projects passes the key org and scope to the database',
    lpCall.args.p_org === 'o-1' && lpCall.args.p_scope === null
    && JSON.parse(lp.body.result.content[0].text).projects[0].id === 'p1', lpCall);

  const bl = await handleRpc(call('reqpub_get_baseline', { projectId: 'p1' }), ctx);
  const blOut = JSON.parse(bl.body.result.content[0].text);
  const expectFp = await versionFingerprint({ label: '1.1', seq: 2, snapshot });
  check('get_baseline computes the fingerprint with the one recipe',
    blOut.fingerprint === expectFp && /^[0-9a-f]{64}$/.test(blOut.fingerprint), blOut.fingerprint);

  const badSeq = await handleRpc(call('reqpub_get_baseline', { projectId: 'p1', seq: 'two' }), ctx);
  check('a non-integer seq is invalid params', badSeq.body.error.code === -32602, badSeq.body);

  const ss = await handleRpc(call('reqpub_get_signature_status', { projectId: 'p1' }), ctx);
  const rc = await handleRpc(call('reqpub_get_receipt', { receiptId: 'r-1' }), ctx);
  const vc = await handleRpc(call('reqpub_verify_chain', { projectId: 'p1' }), ctx);
  const blob = JSON.stringify([lp.body, bl.body, ss.body, rc.body, vc.body]);
  check('no serialized output carries a token, a key, or an address',
    !blob.includes('@') && !blob.includes('rqp_live_') && !blob.toLowerCase().includes('token'), blob.length);

  const unknownTool = await handleRpc(call('reqpub_delete_everything', {}), ctx);
  check('an unknown tool is refused and audited denied',
    unknownTool.body.error.code === -32601 && ctx.audits.includes('denied'), ctx.audits);
}

/* ---- the params hash is canonical: order never matters ---- */
{
  const seen = [];
  const ctx = mkCtx({ mcp_gate: (a) => { seen.push(a.p_params_hash); return { ok: true }; }, mcp_verify_chain: { ok: true } });
  await handleRpc(call('reqpub_verify_chain', { projectId: 'p1', extra: 1 }), ctx);
  await handleRpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'reqpub_verify_chain', arguments: { extra: 1, projectId: 'p1' } } }, ctx);
  check('two key orders hash identically through canonicalJson',
    seen.length === 2 && seen[0] === seen[1] && /^[0-9a-f]{64}$/.test(seen[0]), seen);
}

/* ---- the gate refusal and the audit discipline ---- */
{
  const ctx = mkCtx({ mcp_gate: { ok: false, error: 'rate_limited' } });
  const r = await handleRpc(call('reqpub_list_projects', {}), ctx);
  check('a rate refusal answers 429 with the plain error and no extra audit row',
    r.status === 429 && r.body.error.code === -32000 && r.body.error.message === 'rate limited'
    && ctx.audits.length === 0, { status: r.status, audits: ctx.audits });
}
{
  const ctx = mkCtx({ mcp_gate: { ok: true }, mcp_get_baseline: { ok: false, error: 'not_in_scope' } });
  const r = await handleRpc(call('reqpub_get_baseline', { projectId: 'pr' }), ctx);
  check('a scope denial returns an isError tool result and audits denied',
    r.body.result.isError === true && r.body.result.content[0].text === 'not_in_scope'
    && ctx.audits.join(',') === 'denied', ctx.audits);
}
{
  const ctx = mkCtx({ mcp_gate: { ok: true }, mcp_verify_chain: () => { throw new Error('boom with /internal/path secrets'); } });
  const r = await handleRpc(call('reqpub_verify_chain', { projectId: 'p1' }), ctx);
  check('a thrown error is a bare internal error, audited, with zero detail',
    r.body.error.code === -32000 && r.body.error.message === 'internal error'
    && !JSON.stringify(r.body).includes('boom') && ctx.audits.join(',') === 'error', r.body);
}

/* ---- the bearer format ---- */
{
  const good = 'rqp_live_' + 'A'.repeat(32);
  check('a well-formed bearer parses to the key', parseBearer('Bearer ' + good) === good);
  check('the wrong prefix, length, or alphabet is refused',
    parseBearer('Bearer sk_live_' + 'A'.repeat(32)) === null
    && parseBearer('Bearer rqp_live_' + 'A'.repeat(31)) === null
    && parseBearer('Bearer rqp_live_' + 'A'.repeat(31) + '!') === null
    && parseBearer('') === null);
}

/* ---- CORS and the paste gates ---- */
{
  check('the CORS surface answers the browser preflight class',
    cors['Access-Control-Allow-Origin'] === '*' && cors['Access-Control-Allow-Methods'].includes('OPTIONS'));
  const src = readFileSync(new URL('./../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');
  const localImports = src.split('\n').filter((l) => /^import /.test(l));
  check('the only static import is the vendored core pair',
    localImports.length === 1 && localImports[0].includes("./core.js"), localImports);
  check('no static remote import exists outside the Deno branch', !/^import .+ from ["']https/m.test(src));
  const appCore = readFileSync(new URL('./../app/js/core.js', import.meta.url), 'utf8');
  const vendored = readFileSync(new URL('./../supabase/functions/mcp/core.js', import.meta.url), 'utf8');
  check('the vendored core.js byte-equals app/js/core.js', appCore === vendored);
  const before = readFileSync(new URL('./../supabase/functions/mcp/dist/index.ts', import.meta.url), 'utf8');
  execFileSync(process.execPath, ['scripts/bundle-mcp-function.mjs'], { cwd: new URL('./..', import.meta.url) });
  const after = readFileSync(new URL('./../supabase/functions/mcp/dist/index.ts', import.meta.url), 'utf8');
  check('the dashboard paste regenerates byte for byte', before === after && before.includes('handleRpc') && before.includes('canonicalJson'));
  check('the paste carries no local import (v2.51 deploy finding: Deno bundler refused ./core.js)', !after.includes('./core.js'));
  check('the paste declares APP_VERSION before its first top-level use in SERVER_INFO',
    after.indexOf("APP_VERSION = '") > -1 && after.indexOf("APP_VERSION = '") < after.indexOf('SERVER_INFO = '));
}

console.log(`mcp scheme: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
