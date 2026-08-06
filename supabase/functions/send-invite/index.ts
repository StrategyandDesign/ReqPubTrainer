// Supabase Edge Function: send-invite
// Emails a ReqPub workspace invitation via Resend.
//
// The caller must be a signed-in manager who has already added the recipient:
// the function checks, under the caller's own identity, that a matching
// org_invites or partners row exists. Those tables are manager-scoped by
// row-level security, so a row is visible only to a manager of the workspace
// that added the address. This prevents the function from being used to send
// mail to arbitrary recipients.
//
// Set these in Supabase -> Edge Functions -> Secrets:
//   RESEND_API_KEY  (required)  your Resend API key
//   INVITE_FROM     (optional)  e.g. "ReqPub <invites@reqpub.com>", a Resend-verified sender/domain.
//                               Defaults to Resend's test sender, which only delivers to your own Resend email.
//   APP_URL         (optional)  defaults to https://reqpub.com
//   SUPABASE_URL, SUPABASE_ANON_KEY   (provided automatically)
//
// Keep "Verify JWT" ON when deploying, so only signed-in users can trigger emails.
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

  const email = String(body.email ?? "").trim();
  const role = String(body.role ?? "teammate");
  // The wire key stays 'partner' (schema-permanent); the words a client reads
  // in their own inbox say what the role is called in the product.
  const roleLabel = role === "partner" ? "client contact" : role;
  const workspace = String(body.orgName ?? "").trim() || "a ReqPub workspace";
  const inviter = String(body.inviterEmail ?? "").trim();
  if (!email) return reply(req, { error: "email required" }, 400);

  // Authorize under the caller's identity: they must have already added this
  // recipient to a workspace they manage. The manager-scoped row-level policy on
  // org_invites/partners means such a row is visible to them only if that holds.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader || !SUPABASE_URL || !ANON_KEY) return reply(req, { error: "unauthorized" }, 401);
  const supa = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: who } = await supa.auth.getUser();
  if (!who?.user) return reply(req, { error: "unauthorized" }, 401);
  const [inv, prt] = await Promise.all([
    supa.from("org_invites").select("email").ilike("email", email).limit(1),
    supa.from("partners").select("email").ilike("email", email).limit(1),
  ]);
  if ((inv.data?.length ?? 0) === 0 && (prt.data?.length ?? 0) === 0) {
    return reply(req, { error: "no pending invite for this email in a workspace you manage" }, 403);
  }

  const signup = `${APP_URL}/signup?invite=${encodeURIComponent(email)}`;
  const intro = inviter ? `${esc(inviter)} invited you` : "You've been invited";
  const subject = `You're invited to ${workspace} on ReqPub`;

  const html =
    `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f1114">` +
    `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">` +
    `<table width="100%" style="max-width:520px;background:#fff;border:1px solid #e6e8eb;border-radius:16px">` +
    `<tr><td style="padding:26px 32px 6px"><div style="font-weight:700;font-size:20px;letter-spacing:-.02em">ReqPub</div></td></tr>` +
    `<tr><td style="padding:6px 32px 4px"><h1 style="font-size:22px;margin:0 0 10px;letter-spacing:-.02em">${intro} to ${esc(workspace)}</h1>` +
    `<p style="font-size:15px;color:#555b63;line-height:1.6;margin:0">You've been added as a <strong>${esc(roleLabel)}</strong>. Create your account with <strong>${esc(email)}</strong> to join the shared workspace.</p></td></tr>` +
    `<tr><td style="padding:18px 32px 6px"><a href="${signup}" style="display:inline-block;background:#2563FF;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">Accept invite &amp; sign up</a></td></tr>` +
    `<tr><td style="padding:10px 32px 26px"><p style="font-size:12.5px;color:#767c85;line-height:1.6;margin:0">Or open <a href="${signup}" style="color:#2563FF">this link</a>, choose &ldquo;I was invited,&rdquo; and sign up with ${esc(email)}.</p></td></tr>` +
    `</table><p style="font-size:11.5px;color:#98a0aa;margin:16px 0 0">Sent by ReqPub · If you weren't expecting this, you can ignore it.</p>` +
    `</td></tr></table></body></html>`;

  const text = `${inviter ? inviter + " invited you" : "You've been invited"} to ${workspace} on ReqPub as a ${roleLabel}.\n\n` +
    `Accept: ${signup}\nSign up with ${email} and choose "I was invited".`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: INVITE_FROM, to: [email], subject, html, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return reply(req, { error: (data as { message?: string })?.message ?? "send failed", detail: data }, 502);
  return reply(req, { ok: true, id: (data as { id?: string })?.id ?? null });
});
