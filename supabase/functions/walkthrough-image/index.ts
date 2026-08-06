// Supabase Edge Function: walkthrough-image
// Serves one demo-walkthrough screenshot to a share reader. The reader is
// accountless; authority is the share token. walkthrough_image_access proves
// the token is a live brief share AND the attachment is inside the walkthrough
// frozen into that share's version, then this function mints a short signed
// URL on the private bucket and redirects. Revoking the share closes the path.
//
// Deploy with "Verify JWT" OFF - readers have no account.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (provided automatically).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const deny = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return deny("GET only", 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return deny("function not configured", 500);

  const u = new URL(req.url);
  const token = (u.searchParams.get("token") ?? "").trim();
  const id = (u.searchParams.get("id") ?? "").trim();
  if (!token || !/^[0-9a-f-]{36}$/i.test(id)) return deny("token and id required", 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data } = await admin.rpc("walkthrough_image_access", { p_token: token, p_attachment: id });
  if (!data?.ok) return deny(data?.error === "invalid_link" ? "invalid or revoked link" : "not available", 403);

  const signed = await admin.storage.from("attachments").createSignedUrl(data.path, 600);
  if (signed.error || !signed.data?.signedUrl) return deny("could not sign", 502);
  return new Response(null, { status: 302, headers: { ...cors, Location: signed.data.signedUrl, "Cache-Control": "private, max-age=300" } });
});
