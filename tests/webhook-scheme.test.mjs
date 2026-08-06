/* ReqPub v2 - webhook scheme (node tests/webhook-scheme.test.mjs)
   Imports supabase/functions/deliver-webhooks/index.ts DIRECTLY - the tested
   code is the shipped code, byte for byte. Pins: the Ed25519 signature round
   trip exactly as docs/WEBHOOKS.md tells receivers to verify it, tamper and
   skew rejection, the exact header names and key id, the retry ladder, the
   SSRF classifier over every refused range (v4, v6, mapped), URL preflight,
   the injected-resolver private-hostname refusal, the full handler path with
   a verifying receiver, and the dashboard paste gate (no local imports). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const mod = await import('../supabase/functions/deliver-webhooks/index.ts');
const src = readFileSync(fileURLToPath(new URL('../supabase/functions/deliver-webhooks/index.ts', import.meta.url)), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };
const b64 = (buf) => Buffer.from(buf).toString('base64');

/* ---- the signing scheme, verified the way WEBHOOKS.md tells receivers to ---- */
const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pkcs8 = b64(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
const spki = b64(await webcrypto.subtle.exportKey('spki', pair.publicKey));
const receiverVerify = async (spkiB64, tsHeader, rawBody, sigB64, nowSeconds) => {
  // The documented recipe: reject skew over 300 seconds, then verify
  // Ed25519 over utf8(timestamp + '.' + rawBody) against reqpub-keys.json.
  if (Math.abs(nowSeconds - Number(tsHeader)) > 300) return { ok: false, why: 'skew' };
  const key = await webcrypto.subtle.importKey('spki', Buffer.from(spkiB64, 'base64'), { name: 'Ed25519' }, false, ['verify']);
  const msg = new TextEncoder().encode(String(tsHeader) + '.' + rawBody);
  const ok = await webcrypto.subtle.verify({ name: 'Ed25519' }, key, Buffer.from(sigB64, 'base64'), msg);
  return ok ? { ok: true } : { ok: false, why: 'signature' };
};

const body = JSON.stringify({ event: 'sign.signed', deliveryId: 'd-1', projectId: 'p1' });
const ts = Math.floor(Date.now() / 1000);
const sig = await mod.signDelivery(ts, body, pkcs8);
check('the signature round-trips through the documented receiver recipe', (await receiverVerify(spki, ts, body, sig, ts)).ok === true);
check('a tampered body fails verification', (await receiverVerify(spki, ts, body + ' ', sig, ts)).why === 'signature');
check('a tampered timestamp fails verification', (await receiverVerify(spki, ts + 1, body, sig, ts)).why === 'signature');
check('a replay outside the 300 second window is rejected on skew', (await receiverVerify(spki, ts, body, sig, ts + 301)).why === 'skew');
const hdrs = mod.signatureHeaders(mod.KID, ts, sig);
check('the header names and key id match the contract',
  hdrs['X-ReqPub-Key-Id'] === 'whk-1' && hdrs['X-ReqPub-Timestamp'] === String(ts) && hdrs['X-ReqPub-Signature'] === sig && hdrs['Content-Type'] === 'application/json', hdrs);
check('the retry ladder is exactly 1m, 5m, 30m, 2h, 12h', JSON.stringify(mod.RETRY_SCHEDULE_SECONDS) === JSON.stringify([60, 300, 1800, 7200, 43200]), mod.RETRY_SCHEDULE_SECONDS);
check('the timeout is ten seconds', mod.TIMEOUT_MS === 10000, mod.TIMEOUT_MS);

/* ---- the SSRF classifier ---- */
const refused = ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '169.254.169.254',
  '0.0.0.0', '100.64.0.1', '999.1.1.1', '::1', '::', 'fc00::1', 'fd12::9', 'fe80::1', '::ffff:10.0.0.1', '[::1]'];
check('every private, reserved, and metadata address is refused', refused.every((ip) => mod.isPrivateAddress(ip) === true),
  refused.filter((ip) => !mod.isPrivateAddress(ip)));
const allowed = ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'];
check('public addresses pass, v4 and v6 alike', allowed.every((ip) => mod.isPrivateAddress(ip) === false),
  allowed.filter((ip) => mod.isPrivateAddress(ip)));

/* ---- URL preflight ---- */
check('http is refused before any network I/O', mod.urlPreflight('http://hooks.example.com/x').ok === false);
check('credentials in the URL are refused', mod.urlPreflight('https://user:pw@hooks.example.com/x').ok === false);
check('localhost is refused by name', mod.urlPreflight('https://localhost/x').ok === false && mod.urlPreflight('https://a.localhost/x').ok === false);
check('a literal private address is refused at preflight', mod.urlPreflight('https://10.0.0.1/x').ok === false);
check('a plain https endpoint passes preflight', mod.urlPreflight('https://hooks.example.com/reqpub').ok === true);

/* ---- resolver-injected refusal: the hostname that resolves privately ---- */
const privately = await mod.resolveAndCheck('internal.example.com', async () => ['10.0.0.5']);
check('a hostname resolving to a private address is refused', privately.ok === false && privately.why.includes('private address'), privately);
const publicly = await mod.resolveAndCheck('hooks.example.com', async (h, k) => (k === 'A' ? ['93.184.216.34'] : []));
check('a hostname resolving publicly is allowed', publicly.ok === true, publicly);
const noAnswer = await mod.resolveAndCheck('gone.example.com', async () => { throw new Error('NXDOMAIN'); });
check('a hostname with no answer fails closed', noAnswer.ok === false && noAnswer.why.includes('dns'), noAnswer);

/* ---- the full handler, driven end to end with a verifying receiver ---- */
const calls = [];
const mkDeps = (takeUrl, respStatus) => ({
  rpc: async (fn, args) => {
    calls.push([fn, args]);
    if (fn === 'webhook_delivery_take') return { ok: true, url: takeUrl, event_type: 'sign.signed', attempt: 0, payload: { event: 'sign.signed', deliveryId: 'd-9' } };
    if (fn === 'webhook_delivery_result') return { ok: true, state: args.p_ok ? 'delivered' : 'failed', attempt: 1, next_retry_at: args.p_ok ? null : 'soon' };
    return { ok: false };
  },
  fetchFn: async (url, opts) => {
    calls.push(['fetch', url, opts.headers, opts.body, opts.redirect]);
    return { status: respStatus, text: async () => 'received, thanks' };
  },
  resolver: async () => ['93.184.216.34'],
  now: () => Date.now(),
  signingKey: pkcs8,
});
calls.length = 0;
const okRun = await mod.handleDelivery('d-9', mkDeps('https://hooks.example.com/reqpub', 200));
const fetched = calls.find((c) => c[0] === 'fetch');
const resulted = calls.find((c) => c[0] === 'webhook_delivery_result');
const sigOk = await receiverVerify(spki, fetched[2]['X-ReqPub-Timestamp'], fetched[3], fetched[2]['X-ReqPub-Signature'], Math.floor(Date.now() / 1000));
check('a 200 walks take, signed fetch, delivered result', okRun.body.ok === true && resulted[1].p_ok === true && resulted[1].p_status === 200, okRun.body);
check('the wire signature verifies against the payload actually sent', sigOk.ok === true && fetched[4] === 'error', sigOk);
calls.length = 0;
const blockedRun = await mod.handleDelivery('d-9', mkDeps('https://10.0.0.1/x', 200));
check('a private endpoint is blocked before any fetch, recorded as a failed attempt',
  blockedRun.body.blocked && !calls.some((c) => c[0] === 'fetch') && calls.find((c) => c[0] === 'webhook_delivery_result')[1].p_ok === false, blockedRun.body);
calls.length = 0;
const failRun = await mod.handleDelivery('d-9', mkDeps('https://hooks.example.com/reqpub', 503));
check('a 5xx records a failed attempt with the status and snippet',
  failRun.body.ok === false && calls.find((c) => c[0] === 'webhook_delivery_result')[1].p_status === 503, failRun.body);

/* ---- the dashboard paste gate ---- */
check('the function has no static imports at all: the paste is the file',
  !/^import\s/m.test(src) && src.includes('await import("https://esm.sh/@supabase/supabase-js@2")'));
check('the refused ranges are spelled in the shipped source',
  ['169.254', '172.16', '192.168', '100.64', 'fc', 'fe8'].every((m) => src.includes(m)));
check('the serve tail answers the browser preflight (v2.50.1 regression pin)',
  src.includes('req.method === "OPTIONS"') && src.includes('Access-Control-Allow-Origin'));
check('every JSON response carries the CORS headers', src.includes('...cors, "Content-Type"'));

console.log(`webhook scheme: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
