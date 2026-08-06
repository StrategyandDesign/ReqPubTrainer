// Supabase Edge Function: send-sign-request
// Emails an e-sign v1 signature link via Resend.
//
// The caller must be a signed-in member of the project's workspace: the
// function reads the sign_requests row under the caller's own identity, and
// the member-scoped row-level policy means the row is visible only if that
// holds. Requests are created manager-gated in sign_request_create; this
// function only delivers mail for rows that already exist, are pending, and
// are not revoked - so it cannot be used to send mail to arbitrary addresses.
//
// Set these in Supabase -> Edge Functions -> Secrets:
//   RESEND_API_KEY  (required)  your Resend API key
//   INVITE_FROM     (optional)  e.g. "ReqPub <records@reqpub.com>", a Resend-verified sender/domain.
//   APP_URL         (optional)  defaults to https://reqpub.com
//   SUPABASE_URL, SUPABASE_ANON_KEY   (provided automatically)
//
// Keep "Verify JWT" ON when deploying:  supabase functions deploy send-sign-request
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const INVITE_FROM = Deno.env.get("INVITE_FROM") ?? "ReqPub <onboarding@resend.dev>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://reqpub.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return reply(req, { error: "POST only" }, 405);
  if (!RESEND_API_KEY) return reply(req, { error: "RESEND_API_KEY is not set in Edge Function secrets" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const requestId = String(body.request_id ?? "").trim();
  if (!requestId) return reply(req, { error: "request_id required" }, 400);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supa = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who } = await supa.auth.getUser();
  if (!who?.user) return reply(req, { error: "unauthorized" }, 401);

  // Visible only to a member of the project's workspace (RLS).
  const { data: sr } = await supa.from("sign_requests")
    .select("id,token,signer_email,signer_name,signer_role,status,revoked,doc_fingerprint,project_id,version_id")
    .eq("id", requestId).maybeSingle();
  if (!sr) return reply(req, { error: "no such signature request in a workspace you belong to" }, 403);
  if (sr.revoked || sr.status !== "pending") return reply(req, { error: "request is not pending" }, 409);

  const [{ data: proj }, { data: ver }] = await Promise.all([
    supa.from("projects").select("name").eq("id", sr.project_id).maybeSingle(),
    supa.from("versions").select("label").eq("id", sr.version_id).maybeSingle(),
  ]);
  const product = (proj?.name ?? "a requirements record").trim();
  const label = (ver?.label ?? "").trim();
  const link = `${APP_URL}/app/#sign/${sr.token}`;
  const fp = String(sr.doc_fingerprint ?? "").slice(0, 16);
  const hello = sr.signer_name ? `${esc(String(sr.signer_name))}, your` : "Your";

  const html =
    `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f1114">` +
    `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">` +
    `<table width="100%" style="max-width:520px;background:#fff;border:1px solid #e6e8eb;border-radius:16px">` +
    `<tr><td style="padding:26px 32px 6px"><div style="font-weight:700;font-size:20px;letter-spacing:-.02em">ReqPub</div></td></tr>` +
    `<tr><td style="padding:6px 32px 4px"><h1 style="font-size:22px;margin:0 0 10px;letter-spacing:-.02em">${hello} signature is requested</h1>` +
    `<p style="font-size:15px;color:#555b63;line-height:1.6;margin:0">Please review and sign <strong>${esc(product)}${label ? " v" + esc(label) : ""}</strong>` +
    `${sr.signer_role ? " as <strong>" + esc(String(sr.signer_role)) + "</strong>" : ""}. ` +
    `The link renders the exact fingerprinted baseline; your browser verifies it before you sign.</p></td></tr>` +
    `<tr><td style="padding:18px 32px 6px"><a href="${link}" style="display:inline-block;background:#2563FF;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">Review &amp; sign</a></td></tr>` +
    `<tr><td style="padding:10px 32px 26px"><p style="font-size:12.5px;color:#767c85;line-height:1.6;margin:0">` +
    `Document fingerprint <span style="font-family:Consolas,monospace">sha256:${esc(fp)}&hellip;</span>. ` +
    `After signing, this same link is your archive copy: it always renders the exact document you signed, with your receipt. ` +
    `This is a recorded electronic signature with an audit trail.</p></td></tr>` +
    `</table><p style="font-size:11.5px;color:#98a0aa;margin:16px 0 0">Sent by ReqPub · If you weren't expecting this, you can ignore it.</p>` +
    `</td></tr></table></body></html>`;

  const resend = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: INVITE_FROM,
      to: [sr.signer_email],
      subject: `Signature requested: ${product}${label ? " v" + label : ""}`,
      html,
    }),
  });
  if (!resend.ok) {
    const detail = await resend.text().catch(() => "");
    return reply(req, { error: "resend_failed", detail }, 502);
  }
  return reply(req, { ok: true });
});
