/* ReqPub receiver reference implementation, Node, no dependencies.
 *
 * This is the cookbook handler from docs/WEBHOOKS.md promoted to something you
 * can actually run and test. It does four things in a fixed order and refuses
 * the delivery if any of them fails:
 *
 *   1. Reject a timestamp outside the skew window, before any parsing.
 *   2. Verify the Ed25519 signature over the exact raw bytes received,
 *      prefixed by the timestamp and a dot, against the published key whose
 *      kid the delivery names.
 *   3. Parse the JSON only after the signature passes.
 *   4. Refuse a deliveryId already seen, then hand the payload to your code.
 *
 * The order matters. Parsing before verifying means acting on bytes an
 * attacker chose; deduping after handing off means doing the work twice.
 *
 * Nothing here is specific to any platform, product, or vendor. Bring your own
 * store for seen delivery ids: anything with has() and add() will do, and an
 * in-memory Set is fine for a single process. See docs/RECEIVERS.md for the
 * field-by-field mapping into your own records.
 */

import { webcrypto } from 'node:crypto';

export const DEFAULT_KEYS_URL = 'https://reqpub.com/reqpub-keys.json';
export const DEFAULT_SKEW_SECONDS = 300;

/* A minimal seen-id store. Replace with your database in production: the
   contract is has(id) and add(id), and the only requirement is that it
   survives as long as the retry ladder, which runs to twelve hours. */
export function memoryStore(limit = 10000) {
  const seen = new Set();
  const order = [];
  return {
    has: (id) => seen.has(id),
    add: (id) => {
      if (seen.has(id)) return;
      seen.add(id); order.push(id);
      while (order.length > limit) seen.delete(order.shift());
    },
    get size() { return seen.size; },
  };
}

/* Fetch and cache the published keys. A key set changes rarely, so a short
   cache is safe, but never cache a miss: a delivery signed by a key you have
   not seen yet is exactly when you want a fresh fetch. */
export function keyFetcher(url = DEFAULT_KEYS_URL, ttlMs = 300000, fetchImpl = fetch) {
  let cached = null, at = 0;
  return async function keysFor(kid) {
    const fresh = cached && (Date.now() - at) < ttlMs;
    if (fresh) {
      const hit = (cached.keys || []).find((k) => k.kid === kid);
      if (hit) return hit;
    }
    const res = await fetchImpl(url);
    if (!res || !res.ok) throw new Error('key set unavailable');
    cached = await res.json(); at = Date.now();
    return (cached.keys || []).find((k) => k.kid === kid) || null;
  };
}

async function verifySignature(entry, timestamp, rawBody, signatureB64) {
  const key = await webcrypto.subtle.importKey(
    'spki', Buffer.from(entry.publicKeySpkiBase64, 'base64'),
    { name: 'Ed25519' }, false, ['verify']);
  return webcrypto.subtle.verify({ name: 'Ed25519' }, key,
    Buffer.from(signatureB64, 'base64'),
    new TextEncoder().encode(timestamp + '.' + rawBody));
}

/* receiveDelivery({headers, rawBody, store, keysFor, now, skewSeconds})
   -> { ok, reason, event, payload }
   ok false carries a reason your logs should keep: bad_timestamp,
   stale_timestamp, unknown_key, bad_signature, bad_json, duplicate.
   ok true with reason 'accepted' means the payload is yours to act on. */
export async function receiveDelivery(input) {
  const h = input.headers || {};
  const rawBody = input.rawBody == null ? '' : String(input.rawBody);
  const store = input.store || memoryStore();
  const keysFor = input.keysFor || keyFetcher();
  const skew = input.skewSeconds == null ? DEFAULT_SKEW_SECONDS : input.skewSeconds;
  const nowSec = (input.now == null ? Date.now() : input.now) / 1000;

  const get = (name) => h[name] != null ? h[name] : h[name.toLowerCase()];
  const tsRaw = get('x-reqpub-timestamp');
  const kid = get('x-reqpub-key-id');
  const sig = get('x-reqpub-signature');

  const ts = Number(tsRaw);
  if (!tsRaw || !Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSec - ts) > skew) return { ok: false, reason: 'stale_timestamp' };
  if (!kid || !sig) return { ok: false, reason: 'unknown_key' };

  let entry;
  try { entry = await keysFor(kid); } catch { return { ok: false, reason: 'unknown_key' }; }
  if (!entry || !entry.publicKeySpkiBase64) return { ok: false, reason: 'unknown_key' };

  let good = false;
  try { good = await verifySignature(entry, tsRaw, rawBody, sig); } catch { good = false; }
  if (!good) return { ok: false, reason: 'bad_signature' };

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return { ok: false, reason: 'bad_json' }; }

  const id = payload && payload.deliveryId;
  if (!id) return { ok: false, reason: 'bad_json' };
  if (store.has(id)) return { ok: false, reason: 'duplicate', event: payload.event, payload };
  store.add(id);

  return { ok: true, reason: 'accepted', event: payload.event, payload };
}

/* A node:http handler, for a receiver you run yourself. Answer 2xx quickly:
   the sender waits ten seconds and then walks its retry ladder, so do the
   slow part of your work after responding, not before. */
export function nodeHandler(options = {}) {
  const store = options.store || memoryStore();
  const keysFor = options.keysFor || keyFetcher(options.keysUrl);
  const onEvent = options.onEvent || (async () => {});
  return async function handle(req, res) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const result = await receiveDelivery({ headers: req.headers, rawBody, store, keysFor, skewSeconds: options.skewSeconds });
    if (!result.ok && result.reason !== 'duplicate') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: false, reason: result.reason }));
      return result;
    }
    // A duplicate is not an error: the sender is allowed to send twice, and
    // answering 2xx stops the ladder for a delivery already handled.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ accepted: true, duplicate: result.reason === 'duplicate' }));
    if (result.reason === 'accepted') {
      try { await onEvent(result.payload); } catch (e) { options.onError && options.onError(e, result.payload); }
    }
    return result;
  };
}
