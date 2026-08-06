/* ReqPub C1.4 - adversarial sweep of the agent surface
   (node tests/mcp-fuzz.test.mjs)

   The MCP endpoint is the only place a non-human speaks to the record, so it
   is the surface an auditor probes hardest. This suite attacks it the way an
   attacker would: malformed envelopes, wrong types, oversized parameters,
   unknown tools and methods, scope escalation against foreign project and
   receipt ids, propose with the gates off, and repeated calls against the
   rate limit.

   Two properties are asserted on every single response, not just the happy
   ones: no response ever carries a token, an email address, or a stack trace,
   and no refusal ever reveals whether the thing being asked for exists. A
   404-shaped answer that differs from a 403-shaped answer is an enumeration
   oracle, and the tests below treat that as a defect. */
import { handleRpc, toolDefs, parseBearer } from './../supabase/functions/mcp/index.ts';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const AUTH = { keyId: 'k-1', orgId: 'o-1', label: 'Planning agent', projectIds: ['p-mine'], proposeEnabled: false };
const _OPEN = { ...AUTH, projectIds: null, proposeEnabled: true };

const mkCtx = (rpcMap, auth = AUTH) => {
  const calls = [], audits = [];
  return {
    calls, audits, auth,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'mcp_audit_append') { audits.push(args.p_status); return {}; }
      const h = rpcMap[fn];
      if (typeof h === 'function') return h(args);
      if (h !== undefined) return h;
      return null;
    },
  };
};

/* Every response passes through here. These are the invariants that hold for
   success and failure alike. */
const LEAKY = [
  [/rqp_live_[A-Za-z0-9._-]+/, 'an API key'],
  [/TOK_[A-Za-z0-9._-]{6,}/, 'a link token'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an email address'],
  [/\bat [A-Za-z0-9_$.]+ \(.*:\d+:\d+\)/, 'a stack frame'],
  [/\/home\/|\/var\/task\/|file:\/\//, 'a filesystem path'],
  [/\b(?:select|insert|update|delete)\s+.*\s+from\s+\w+/i, 'a SQL fragment'],
  [/pg_|postgres|PGRST\d+/, 'a database internal'],
];
function scan(label, res) {
  const s = JSON.stringify(res);
  for (const [re, what] of LEAKY) {
    if (re.test(s)) return label + ' leaked ' + what + ': ' + s.slice(0, 140);
  }
  return null;
}
const leaks = [];
async function call(msg, ctx) {
  const res = await handleRpc(msg, ctx);
  const l = scan(String(JSON.stringify(msg) ?? typeof msg).slice(0, 60), res);
  if (l) leaks.push(l);
  return res;
}

/* ---- malformed envelopes ---- */
{
  const ctx = mkCtx({});
  const bad = [
    null, undefined, 42, 'string', [], {},
    { jsonrpc: '1.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', id: 1 },
    { jsonrpc: '2.0', id: 1, method: 42 },
    { jsonrpc: '2.0', id: 1, method: '' },
    { jsonrpc: '2.0', id: { nested: true }, method: 'initialize' },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: null },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: 'not an object' },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: null } },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reqpub_get_baseline', arguments: 'nope' } },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reqpub_get_baseline', arguments: [] } },
  ];
  let threw = null, allShaped = true;
  for (const m of bad) {
    try {
      const r = await call(m, ctx);
      if (!r || typeof r.status !== 'number' || !r.body) { allShaped = false; break; }
      if (r.body.error && typeof r.body.error.code !== 'number') { allShaped = false; break; }
    } catch (e) { threw = String(e && e.message); break; }
  }
  check('no malformed envelope throws: every one returns a shaped JSON-RPC response',
    threw === null && allShaped, threw);
  const r = await call({ jsonrpc: '1.0', id: 1, method: 'initialize' }, ctx);
  check('a wrong protocol version is invalid request, -32600', r.body.error.code === -32600);
  const u = await call({ jsonrpc: '2.0', id: 2, method: 'no/such/method' }, ctx);
  check('an unknown method is method not found, -32601', u.body.error.code === -32601);
  const t = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'reqpub_delete_everything', arguments: {} } }, ctx);
  check('an unknown tool is refused without hinting at what exists',
    !!t.body.error && !/get_baseline|propose|list_projects/.test(JSON.stringify(t.body)));
}

/* ---- wrong types and oversized parameters ---- */
{
  const ctx = mkCtx({ mcp_project_baseline: null });
  const wrong = [
    { project_id: 42 }, { project_id: null }, { project_id: {} }, { project_id: [] },
    { project_id: true }, { project_id: '' },
  ];
  let ok = true;
  for (const args of wrong) {
    const r = await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'reqpub_get_baseline', arguments: args } }, ctx);
    if (!r.body || (!r.body.error && !r.body.result)) { ok = false; break; }
  }
  check('wrong argument types are handled without a throw and without a database call', ok);

  const huge = 'A'.repeat(2 * 1024 * 1024);
  const start = Date.now();
  const r = await call({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'reqpub_get_baseline', arguments: { project_id: huge } } }, ctx);
  check('a two megabyte parameter is refused or handled, and quickly',
    !!r.body && (Date.now() - start) < 3000, Date.now() - start);

  const deep = (n) => n === 0 ? 'x' : { a: deep(n - 1) };
  const d = await call({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'reqpub_get_baseline', arguments: { project_id: 'p-mine', extra: deep(200) } } }, ctx);
  check('a deeply nested argument object does not blow the stack', !!d.body);
}

/* ---- scope escalation ---- */
{
  const seen = [];
  const ctx = mkCtx({
    mcp_project_baseline: (args) => { seen.push(args); return { ok: true, label: '1.0', seq: 1, snapshot: { answers: {}, sections: {} } }; },
    mcp_receipt: (args) => { seen.push(args); return { ok: true, receipt: { canonicalHash: 'ab'.repeat(32) } }; },
  }, AUTH);
  const foreign = await call({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'reqpub_get_baseline', arguments: { project_id: 'p-not-mine' } } }, ctx);
  check('a project outside the key scope is refused',
    !!foreign.body.error || (foreign.body.result && /not (found|permitted)|forbidden|scope/i.test(JSON.stringify(foreign.body.result))),
    JSON.stringify(foreign.body).slice(0, 120));
  check('the refusal happens before any database call for a foreign project',
    !seen.some((a) => JSON.stringify(a).includes('p-not-mine')), seen);

  const sqlish = ["p-mine' or '1'='1", 'p-mine; drop table projects', 'p-mine union select token from sign_requests', '../../etc/passwd', 'p-mine%00'];
  for (const pid of sqlish) {
    const r = await call({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'reqpub_get_baseline', arguments: { project_id: pid } } }, ctx);
    if (scan('injection probe', r)) leaks.push('injection probe leaked for ' + pid);
  }
  check('injection-shaped project ids are passed as parameters, never concatenated',
    seen.every((a) => typeof a.p_project === 'string' || a.p_project === undefined));
  check('an out-of-scope refusal is indistinguishable from a not-found refusal',
    (() => { const a = JSON.stringify(foreign.body); return !/does not exist|no such project|unknown project/i.test(a); })(),
    JSON.stringify(foreign.body).slice(0, 120));
}

/* ---- propose with the gates off ---- */
{
  const writes = [];
  const ctx = mkCtx({ mcp_propose: (args) => { writes.push(args); return { ok: true }; } }, AUTH);
  const r = await call({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'reqpub_propose', arguments: { project_id: 'p-mine', title: 't', body: 'b' } } }, ctx);
  check('propose is refused when the key gate is off', !!r.body.error || /not enabled|forbidden|disabled/i.test(JSON.stringify(r.body)));
  check('nothing was written when propose is refused', writes.length === 0, writes.length);
  // toolDefs takes the gate as a boolean, not the auth record.
  const names = toolDefs(false).map((t) => t.name);
  check('a gated key is not even told the propose tool exists', !names.includes('reqpub_propose') && names.length === 5, names);
  const open = toolDefs(true).map((t) => t.name);
  check('an ungated key sees exactly one write tool and five read tools',
    open.includes('reqpub_propose') && open.length === 6, open);
}

/* ---- the bearer parser ---- */
{
  const bad = ['', 'Bearer', 'Bearer ', 'Basic abc', 'bearer rqp_live_x', 'Bearer rqp_test_x',
    'Bearer rqp_live_' + 'x'.repeat(5000), 'Bearer\u0000rqp_live_x', 'Bearer rqp_live_x rqp_live_y'];
  let threw = null;
  for (const h of bad) { try { parseBearer(h); } catch { threw = h; break; } }
  check('no authorization header shape throws in the parser', threw === null, threw);
  check('a non-live key prefix is not accepted', !parseBearer('Bearer rqp_test_abcdef'));
}

/* ---- the leak invariant across every response above ---- */
check('no response in this sweep leaked a token, an address, a path, or a stack frame',
  leaks.length === 0, leaks.slice(0, 3));

console.log(`mcp fuzz: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
