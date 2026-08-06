/* ReqPub receiver, fetch-style handler. Same logic as node-receiver.mjs, in
 * the shape any runtime with Request, Response, and WebCrypto accepts. No
 * dependencies and nothing platform-specific: if your runtime hands you a
 * Request and expects a Response, this works.
 *
 * The verification order is identical and load-bearing: skew, signature, then
 * parse, then dedupe, then hand off. Read the raw body as text exactly once
 * and verify those bytes; a re-serialized object is not what was signed.
 */

export const DEFAULT_KEYS_URL = 'https://reqpub.com/reqpub-keys.json';
export const DEFAULT_SKEW_SECONDS = 300;

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function keyFetcher(url = DEFAULT_KEYS_URL, ttlMs = 300000, fetchImpl = fetch) {
  let cached = null, at = 0;
  return async function keysFor(kid) {
    if (cached && (Date.now() - at) < ttlMs) {
      const hit = (cached.keys || []).find((k) => k.kid === kid);
      if (hit) return hit;
    }
    const res = await fetchImpl(url);
    if (!res || !res.ok) throw new Error('key set unavailable');
    cached = await res.json(); at = Date.now();
    return (cached.keys || []).find((k) => k.kid === kid) || null;
  };
}

/* Bring your own store. In a serverless runtime use whatever durable
   key-value or table you already have, keyed on deliveryId, with a retention
   at least as long as the retry ladder, which runs to twelve hours. */
export function memoryStore() {
  const seen = new Set();
  return { has: async (id) => seen.has(id), add: async (id) => { seen.add(id); } };
}

export async function verifyAndParse(request, options = {}) {
  const keysFor = options.keysFor || keyFetcher(options.keysUrl);
  const skew = options.skewSeconds == null ? DEFAULT_SKEW_SECONDS : options.skewSeconds;
  const nowSec = (options.now == null ? Date.now() : options.now) / 1000;

  const tsRaw = request.headers.get('x-reqpub-timestamp');
  const kid = request.headers.get('x-reqpub-key-id');
  const sig = request.headers.get('x-reqpub-signature');

  const ts = Number(tsRaw);
  if (!tsRaw || !Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSec - ts) > skew) return { ok: false, reason: 'stale_timestamp' };
  if (!kid || !sig) return { ok: false, reason: 'unknown_key' };

  const rawBody = await request.text();

  let entry;
  try { entry = await keysFor(kid); } catch { return { ok: false, reason: 'unknown_key' }; }
  if (!entry || !entry.publicKeySpkiBase64) return { ok: false, reason: 'unknown_key' };

  let good = false;
  try {
    const key = await crypto.subtle.importKey('spki', b64ToBytes(entry.publicKeySpkiBase64),
      { name: 'Ed25519' }, false, ['verify']);
    good = await crypto.subtle.verify({ name: 'Ed25519' }, key, b64ToBytes(sig),
      new TextEncoder().encode(tsRaw + '.' + rawBody));
  } catch { good = false; }
  if (!good) return { ok: false, reason: 'bad_signature' };

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return { ok: false, reason: 'bad_json' }; }
  if (!payload || !payload.deliveryId) return { ok: false, reason: 'bad_json' };
  return { ok: true, reason: 'verified', payload };
}

/* handler({onEvent, store, keysFor}) -> (request) => Response
   Answer 2xx within ten seconds. If your runtime offers a way to continue
   work after the response, use it for the handoff rather than making the
   sender wait. */
export function handler(options = {}) {
  const store = options.store || memoryStore();
  const onEvent = options.onEvent || (async () => {});
  return async function onRequest(request) {
    const result = await verifyAndParse(request, options);
    if (!result.ok) {
      return new Response(JSON.stringify({ accepted: false, reason: result.reason }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
    const id = result.payload.deliveryId;
    if (await store.has(id)) {
      // Already handled. 2xx stops the retry ladder; doing the work again
      // would double whatever this receiver causes downstream.
      return new Response(JSON.stringify({ accepted: true, duplicate: true }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    await store.add(id);
    try { await onEvent(result.payload); } catch (e) { options.onError && options.onError(e, result.payload); }
    return new Response(JSON.stringify({ accepted: true, duplicate: false }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
