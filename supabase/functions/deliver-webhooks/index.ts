// ReqPub v2.50 - deliver-webhooks: sends one signed webhook delivery per call.
//
// Deploys as a dashboard paste of this file, verbatim: it has no local
// imports, and tests/webhook-scheme.test.mjs pins that plus the scheme
// itself by importing this exact file into Node (the source is plain
// JavaScript in a .ts file, on purpose, so the tested code IS the shipped
// code).
//
// Contract (docs/WEBHOOKS.md is the receiver-facing spec):
//   POST { "deliveryId": "<uuid>" }   Verify JWT OFF; the delivery id is an
//   unguessable capability handle handed only to the party whose action
//   created it (the sign functions return them; managers list them).
//   One delivery per call. 10 second timeout. Redirects refused.
//
// Signing: X-ReqPub-Key-Id: whk-1, X-ReqPub-Timestamp (unix seconds),
// X-ReqPub-Signature = base64 Ed25519 over utf8(timestamp + "." + rawBody)
// with WEBHOOK_SIGNING_KEY. Receivers verify against reqpub-keys.json and
// reject skew over 300 seconds. Delivery is at-least-once; receivers dedupe
// on payload.deliveryId.
//
// SSRF guard, before every attempt: https only, no credentials in the URL,
// resolve the host and refuse loopback, RFC 1918, link-local, CGNAT, ULA,
// and metadata addresses, for A and AAAA alike, v4-mapped forms included.
// A blocked address records a failed attempt and walks the normal ladder to
// dead, so a misconfigured endpoint dies loudly instead of silently.

const env = (k) => (typeof Deno !== "undefined" && Deno.env ? Deno.env.get(k) : undefined) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SIGNING_KEY = env("WEBHOOK_SIGNING_KEY");
export const KID = "whk-1";
export const TIMEOUT_MS = 10000;
export const RETRY_SCHEDULE_SECONDS = [60, 300, 1800, 7200, 43200]; // 1m 5m 30m 2h 12h, then dead

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

/* ---- signing ------------------------------------------------------------ */

export async function signDelivery(timestampSeconds, rawBody, pkcs8Base64) {
  const key = await crypto.subtle.importKey(
    "pkcs8", b64ToBytes(pkcs8Base64), { name: "Ed25519" }, false, ["sign"]);
  const msg = new TextEncoder().encode(String(timestampSeconds) + "." + rawBody);
  return bytesToB64(await crypto.subtle.sign({ name: "Ed25519" }, key, msg));
}

export function signatureHeaders(kid, timestampSeconds, signatureBase64) {
  return {
    "Content-Type": "application/json",
    "X-ReqPub-Key-Id": kid,
    "X-ReqPub-Timestamp": String(timestampSeconds),
    "X-ReqPub-Signature": signatureBase64,
  };
}

/* ---- SSRF guard --------------------------------------------------------- */

// Accepts one IP string (v4 dotted or v6), answers whether it may be dialed.
export function isPrivateAddress(ip) {
  let a = String(ip || "").trim().toLowerCase();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  if (a === "") return true;
  // v4-mapped v6 collapses to its v4 tail.
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) a = mapped[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) {
    const p = a.split(".").map(Number);
    if (p.some((n) => n > 255)) return true;
    if (p[0] === 0) return true;                                  // 0.0.0.0/8
    if (p[0] === 10) return true;                                 // 10/8
    if (p[0] === 127) return true;                                // 127/8
    if (p[0] === 169 && p[1] === 254) return true;                // 169.254/16, metadata included
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;    // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true;                // 192.168/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;   // 100.64/10 CGNAT
    return false;
  }
  // v6.
  if (a === "::" || a === "::1") return true;                     // unspecified, loopback
  if (a.startsWith("fc") || a.startsWith("fd")) return true;      // fc00::/7 ULA
  if (a.startsWith("fe8") || a.startsWith("fe9") ||
      a.startsWith("fea") || a.startsWith("feb")) return true;    // fe80::/10 link-local
  return false;
}

// Static checks on the URL itself, before any network I/O.
export function urlPreflight(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || "")); } catch { return { ok: false, why: "unparsable url" }; }
  if (u.protocol !== "https:") return { ok: false, why: "https required" };
  if (u.username || u.password) return { ok: false, why: "credentials in url refused" };
  const host = u.hostname.toLowerCase();
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, why: "localhost refused" };
  }
  if (/^[\d.]+$/.test(host) || host.includes(":") || (host.startsWith("[") && host.endsWith("]"))) {
    if (isPrivateAddress(host)) return { ok: false, why: "private address refused" };
  }
  return { ok: true, host };
}

// Resolve and classify. The resolver is injected so the decision logic is
// testable in Node against known answers; in Deno it is Deno.resolveDns.
export async function resolveAndCheck(host, resolver) {
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    return isPrivateAddress(host)
      ? { ok: false, why: "private address refused" }
      : { ok: true, addrs: [host] };
  }
  const addrs = [];
  for (const kind of ["A", "AAAA"]) {
    try {
      const got = await resolver(host, kind);
      for (const ip of got || []) addrs.push(String(ip));
    } catch { /* one family may not exist */ }
  }
  if (addrs.length === 0) return { ok: false, why: "dns resolution failed" };
  for (const ip of addrs) {
    if (isPrivateAddress(ip)) return { ok: false, why: "private address refused: " + ip };
  }
  return { ok: true, addrs };
}

/* ---- the handler -------------------------------------------------------- */

export async function handleDelivery(deliveryId, deps) {
  const { rpc, fetchFn, resolver, now, signingKey } = deps;
  const take = await rpc("webhook_delivery_take", { p_id: deliveryId });
  if (!take || take.ok !== true) {
    return { status: 409, body: { ok: false, error: (take && take.error) || "not_available" } };
  }
  const record = (ok, code, snippet) =>
    rpc("webhook_delivery_result", { p_id: deliveryId, p_ok: ok, p_status: code, p_snippet: snippet });

  const pre = urlPreflight(take.url);
  if (!pre.ok) {
    const r = await record(false, 0, "blocked: " + pre.why);
    return { status: 200, body: { ok: false, blocked: pre.why, state: r && r.state, attempt: r && r.attempt } };
  }
  const net = await resolveAndCheck(pre.host, resolver);
  if (!net.ok) {
    const r = await record(false, 0, "blocked: " + net.why);
    return { status: 200, body: { ok: false, blocked: net.why, state: r && r.state, attempt: r && r.attempt } };
  }

  const rawBody = JSON.stringify(take.payload);
  const ts = Math.floor(now() / 1000);
  let sig = "";
  try { sig = await signDelivery(ts, rawBody, signingKey); }
  catch { 
    const r = await record(false, 0, "signing key unavailable or invalid");
    return { status: 200, body: { ok: false, blocked: "signing failed", state: r && r.state, attempt: r && r.attempt } };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let statusCode = 0; let snippet = ""; let delivered = false;
  try {
    const resp = await fetchFn(take.url, {
      method: "POST",
      headers: signatureHeaders(KID, ts, sig),
      body: rawBody,
      redirect: "error",
      signal: ctrl.signal,
    });
    statusCode = resp.status;
    delivered = resp.status >= 200 && resp.status < 300;
    try { snippet = (await resp.text()).slice(0, 200); } catch { snippet = ""; }
  } catch (e) {
    statusCode = 0;
    snippet = ctrl.signal.aborted ? "timeout after " + TIMEOUT_MS + "ms" : "fetch failed: " + String(e && e.message).slice(0, 160);
  } finally {
    clearTimeout(timer);
  }
  const r = await record(delivered, statusCode, snippet);
  return { status: 200, body: { ok: delivered, status_code: statusCode, state: r && r.state, attempt: r && r.attempt, next_retry_at: r && r.next_retry_at } };
}

/* ---- Deno entry --------------------------------------------------------- */

if (typeof Deno !== "undefined" && Deno.serve) {
  // The dependency loads only under Deno, so Node can import this exact
  // file and test the shipped signing and SSRF logic directly.
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.112.1");
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) return { ok: false, error: error.message };
    return data;
  };
  // v2.50.1: the ping is a cross-origin browser POST from the app and the
  // signer page, so the preflight must be answered or the browser never
  // sends the request at all. Same open pattern as attachment-upload.
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  Deno.serve(async (req) => {
    const json = (code, body) => new Response(JSON.stringify(body), {
      status: code, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
    let body;
    try { body = await req.json(); } catch { return json(400, { ok: false, error: "json body required" }); }
    const id = body && body.deliveryId;
    if (!id || typeof id !== "string") return json(400, { ok: false, error: "deliveryId required" });
    const out = await handleDelivery(id, {
      rpc,
      fetchFn: fetch,
      resolver: (host, kind) => Deno.resolveDns(host, kind),
      now: () => Date.now(),
      signingKey: SIGNING_KEY,
    });
    return json(out.status, out.body);
  });
}
