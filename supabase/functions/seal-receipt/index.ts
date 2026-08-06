// Supabase Edge Function: seal-receipt
// Seals a SIGNED e-sign request into an offline-verifiable acceptance
// receipt: Ed25519 over the canonical receipt hash, dual RFC 3161
// timestamps requested non-blocking. Follows the send-sign-receipt
// pattern: no service role, the token or project membership is the
// credential and the definer RPCs enforce it. Idempotent by design.
//
// Deploy: supabase functions deploy seal-receipt --no-verify-jwt
// Secrets: RECEIPT_SIGNING_KEY (PKCS8 base64, from scripts/generate-seal-keys.mjs)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildReceipt, canonicalHashOf, signReceiptHash, tsaRequestDer, tsaGranted } from "./seallib.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SIGNING_KEY = Deno.env.get("RECEIPT_SIGNING_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://reqpub.com";
const KID = "acc-1";
const TSA = [
  { name: "primary", url: "https://freetsa.org/tsr" },
  { name: "secondary", url: "http://timestamp.digicert.com" },
];

const ALLOWED_ORIGINS = new Set([APP_URL, "https://reqpub.com"]);
function corsFor(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : APP_URL,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const reply = (req: Request, o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...corsFor(req), "Content-Type": "application/json" } });

async function requestTsa(hashHex: string) {
  const body = tsaRequestDer(hashHex);
  const out: Record<string, string | null> = { primary: null, secondary: null };
  await Promise.all(TSA.map(async (t) => {
    try {
      const r = await fetch(t.url, {
        method: "POST", body,
        headers: { "Content-Type": "application/timestamp-query", "Accept": "application/timestamp-reply" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (tsaGranted(bytes)) out[t.name] = btoa(String.fromCharCode(...bytes));
    } catch { /* non-blocking by doctrine */ }
  }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return reply(req, { error: "POST only" }, 405);
  if (!SIGNING_KEY) return reply(req, { error: "sealing is not configured" }, 503);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return reply(req, { error: "bad json" }, 400); }
  const token = typeof body.token === "string" ? body.token : "";
  const signRequestId = typeof body.signRequestId === "string" ? body.signRequestId : "";
  const retryTsa = body.retryTsa === true;
  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });

  try {
    if (body.health === true) {
      const status: Record<string, unknown> = { ok: false, signingKey: 'missing', pairOk: null };
      if (SIGNING_KEY) {
        try {
          const testHash = "ab".repeat(32);
          const sig = await signReceiptHash(testHash, SIGNING_KEY);
          status.signingKey = "valid";
          const { data: keyRow } = await sb.from("receipt_keys").select("public_key_spki_base64").eq("kid", KID).maybeSingle();
          if (keyRow && keyRow.public_key_spki_base64 && !String(keyRow.public_key_spki_base64).startsWith("SET-AT-DEPLOY")) {
            const { verifyReceiptHash } = await import("./seallib.mjs");
            status.pairOk = await verifyReceiptHash(testHash, sig, keyRow.public_key_spki_base64);
          } else status.pairOk = "public key not registered (runbook step 5)";
        } catch (e) { status.signingKey = "key import failed: " + (e instanceof Error ? e.message : String(e)); }
      }
      status.ok = status.signingKey === "valid" && status.pairOk === true;
      return reply(req, status);
    }

    if (retryTsa) {
      if (!signRequestId) return reply(req, { error: "signRequestId required" }, 400);
      const { data: rec, error: e2 } = await sb.rpc("receipt_for", { p_sign_request: signRequestId, p_token: token });
      if (e2 || !rec) return reply(req, { error: "no receipt" }, 404);
      if (rec.tsa_status === "dual") return reply(req, { ok: true, tsa_status: "dual" });
      const tsa = await requestTsa(rec.canonical_hash);
      if (!tsa.primary && !tsa.secondary) return reply(req, { ok: true, tsa_status: rec.tsa_status, note: "authorities unreachable; try again later" });
      const { data: upd, error: e3 } = await sb.rpc("receipt_tsa_update", {
        p_receipt: rec.id, p_token: token, p_primary: tsa.primary, p_secondary: tsa.secondary,
      });
      if (e3) return reply(req, { error: e3.message }, 400);
      return reply(req, { ok: true, tsa_status: upd.tsa_status });
    }

    // Seal path: resolve context by token (signer) or by id (member).
    let ctx: Record<string, unknown> | null = null;
    let srId = signRequestId;
    if (token) {
      const { data, error } = await sb.rpc("sign_request_context", { p_token: token });
      if (error || !data) return reply(req, { error: "not found" }, 404);
      ctx = data;
      // The token path lacks the id in context v1; the app sends it too.
      if (!srId && typeof body.id === "string") srId = body.id;
    } else if (signRequestId) {
      const { data, error } = await sb.rpc("seal_context", { p_sign_request: signRequestId });
      if (error || !data) return reply(req, { error: "not allowed" }, 403);
      ctx = data;
    } else return reply(req, { error: "token or signRequestId required" }, 400);

    if (!ctx || ctx.revoked) return reply(req, { error: "revoked" }, 403);
    if (ctx.status !== "signed") return reply(req, { error: "not signed" }, 409);
    if (!srId) return reply(req, { error: "signRequestId required" }, 400);

    // Chain head, best effort: member JWT sees it; the anon token path
    // records chain_unavailable, stated in VERIFY.md section 9.
    let chain: unknown = null;
    const projectId = (ctx.projectId as string) || "";
    if (projectId) {
      const { data: ch } = await sb.rpc("verify_project_chain", { p_project: projectId });
      chain = ch ?? null;
    }

    const receiptId = crypto.randomUUID();
    const receipt = await buildReceipt({
      receiptId,
      projectId: projectId || (ctx.project as string),
      practice: ctx.practice === true,
      project: ctx.project, label: ctx.label, seq: ctx.seq, snapshot: ctx.snapshot,
      fingerprint: ctx.fingerprint, legacyNoFingerprint: !ctx.fingerprint, signRequestId: srId,
      signedName: ctx.signedName, signedAt: ctx.signedAt,
      signer: ctx.signer ?? {}, evidence: ctx.evidence ?? {},
    }, chain, KID, new Date().toISOString());
    const hash = await canonicalHashOf(receipt);
    let sig = "";
    try { sig = await signReceiptHash(hash, SIGNING_KEY); }
    catch (e) { return reply(req, { error: "signing key import failed: " + (e instanceof Error ? e.message : String(e)) }, 503); }
    const { data: stored, error: se } = await sb.rpc("receipt_store", {
      p_sign_request: srId, p_token: token, p_receipt: receipt,
      p_hash: hash, p_sig: sig, p_kid: KID,
    });
    if (se) return reply(req, { error: se.message }, 400);
    if (stored.existing) return reply(req, { ok: true, existing: true, id: stored.id, canonical_hash: stored.canonical_hash, tsa_status: stored.tsa_status });

    const tsa = await requestTsa(hash);
    let tsaStatus = "pending";
    if (tsa.primary || tsa.secondary) {
      const { data: upd } = await sb.rpc("receipt_tsa_update", {
        p_receipt: stored.id, p_token: token, p_primary: tsa.primary, p_secondary: tsa.secondary,
      });
      if (upd) tsaStatus = upd.tsa_status;
    }
    return reply(req, { ok: true, id: stored.id, canonical_hash: hash, tsa_status: tsaStatus });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const divergence = e instanceof Error && (e as { divergence?: boolean }).divergence;
    return reply(req, { error: divergence ? msg : "seal failed: " + msg }, divergence ? 409 : 500);
  }
});
