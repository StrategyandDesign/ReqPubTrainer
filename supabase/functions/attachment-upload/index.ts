// Supabase Edge Function: attachment-upload
// Receives a file from the team, a partner, or a seated SME, virus-scans it,
// hashes its exact bytes (sha256, computed in the same pass), stores the bytes
// in the private 'attachments' bucket, and registers the metadata via
// attachment_add. Infected files are rejected and never stored.
//
// v2.49 adds two JSON modes on the same endpoint (Content-Type: application/json):
//   { "verify": "<attachment uuid>" }
//       Caller JWT verified, org membership checked via attachment_verify_target
//       before any storage read. Re-downloads the object, re-hashes, compares.
//       Returns { ok, match, stored, computed, file_name }.
//   { "backfill": { "project_id": "<id>", "limit": 25 } }
//       Manager-gated via attachment_backfill_targets. Hashes one page of
//       files that predate hashing, oldest first, records each through
//       attachment_set_hash (idempotent, marks hashed-after-upload), writes
//       one audit line per page via attachment_backfill_note, and returns
//       { ok, hashed, already, failed, remaining } so the caller loops.
//
// This file is intentionally single-file with no local imports: the dashboard
// paste for this function is this file, verbatim. tests/attach-paste.test.mjs
// pins that property, so the paste can never fall behind the source.
//
// Deploy with "Verify JWT" OFF - SMEs are accountless (they authorize with their
// durable reply_token). Team and partner callers still pass a real JWT, which we
// verify explicitly below, so turning platform JWT verification off is safe here.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided automatically)
//   SCAN_URL          (optional)  HTTP virus scanner endpoint. If unset, files are
//                                 stored with scan_status='unscanned' and flagged.
//                                 Point it at a private ClamAV REST service, e.g.
//                                 a self-hosted clamav-rest container (recommended,
//                                 keeps client files private). Do NOT use a public
//                                 scanner that retains uploads.
//   SCAN_FIELD        (optional)  multipart field name the scanner expects (default "FILES").
//   SCAN_API_KEY      (optional)  sent as Authorization: Bearer <key> to the scanner.
//   SCAN_TIMEOUT_MS   (optional)  default 20000.
//   SCAN_FAIL_CLOSED  (optional)  "true" rejects uploads when the scanner is
//                                 unreachable; default stores them flagged 'error'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SCAN_URL = Deno.env.get("SCAN_URL") ?? "";
const SCAN_FIELD = Deno.env.get("SCAN_FIELD") ?? "FILES";
const SCAN_API_KEY = Deno.env.get("SCAN_API_KEY") ?? "";
const SCAN_TIMEOUT_MS = Number(Deno.env.get("SCAN_TIMEOUT_MS") ?? "20000");
const SCAN_FAIL_CLOSED = (Deno.env.get("SCAN_FAIL_CLOSED") ?? "").toLowerCase() === "true";

const MAX_BYTES = 26214400; // 25 MB
const ALLOW = new Set([
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv", "text/markdown",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "application/zip",
]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const safeName = (s: string) => (s || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "file";

// sha256 over exact bytes, lowercase hex. WebCrypto only: this function runs
// on Deno, and the v2.48 gauntlet proved Node's crypto surface does not.
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}

// Scan the bytes. Returns { status, detail }. status: clean | infected | error | unscanned.
async function scan(bytes: Uint8Array, name: string): Promise<{ status: string; detail: string }> {
  if (!SCAN_URL) return { status: "unscanned", detail: "no scanner configured" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SCAN_TIMEOUT_MS);
  try {
    const fd = new FormData();
    fd.append(SCAN_FIELD, new Blob([bytes]), name);
    const headers: Record<string, string> = {};
    if (SCAN_API_KEY) headers["Authorization"] = `Bearer ${SCAN_API_KEY}`;
    const res = await fetch(SCAN_URL, { method: "POST", body: fd, headers, signal: ctl.signal });
    const text = (await res.text()).trim();
    let verdict: string | null = null;
    try {
      const j = JSON.parse(text);
      if (typeof j.clean === "boolean") verdict = j.clean ? "clean" : "infected";
      else if (typeof j.Status === "string") verdict = /ok|clean/i.test(j.Status) ? "clean" : "infected";
      else if (typeof j.status === "string") verdict = /ok|clean/i.test(j.status) ? "clean" : "infected";
    } catch { /* not JSON - fall through to text parsing */ }
    if (verdict === null) {
      if (/\b(found|infected|virus|malware|positive)\b/i.test(text)) verdict = "infected";
      else if (/\b(ok|clean|no[\s-]?virus|negative)\b/i.test(text)) verdict = "clean";
    }
    if (verdict === "infected") return { status: "infected", detail: text.slice(0, 400) };
    if (verdict === "clean") return { status: "clean", detail: "" };
    return { status: "error", detail: "unrecognized scanner response" };
  } catch (e) {
    return { status: "error", detail: String((e as Error)?.message || e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

// Resolve the signed-in caller for the JSON modes. Both modes require a real
// session: verify is member-scoped, backfill is manager-gated, and the RPCs
// enforce that server-side with the user id we resolve here.
async function callerUser(req: Request, admin: ReturnType<typeof createClient>) {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return null;
  const { data: u } = await admin.auth.getUser(jwt);
  return u?.user ?? null;
}

// Download an object from the private bucket and hash its exact bytes.
async function downloadAndHash(admin: ReturnType<typeof createClient>, path: string):
  Promise<{ ok: true; sha256: string } | { ok: false; error: string }> {
  const dl = await admin.storage.from("attachments").download(path);
  if (dl.error || !dl.data) return { ok: false, error: dl.error?.message || "download failed" };
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  return { ok: true, sha256: await sha256Hex(bytes) };
}

// ---- verify mode: re-download, re-hash, compare -----------------------------
async function handleVerify(admin: ReturnType<typeof createClient>, userId: string, id: string) {
  const { data: t } = await admin.rpc("attachment_verify_target", { p_id: id, p_user: userId });
  if (!t?.ok) {
    if (t?.error === "not_found") return json({ error: "attachment not found" }, 404);
    if (t?.error === "unhashed") return json({ error: "no stored hash to verify - run the backfill first", file_name: t.file_name }, 409);
    return json({ error: "not allowed" }, 403);
  }
  const h = await downloadAndHash(admin, t.storage_path);
  if (!h.ok) return json({ error: "could not read the stored file", detail: h.error }, 502);
  return json({ ok: true, match: h.sha256 === t.sha256_hex, stored: t.sha256_hex, computed: h.sha256, file_name: t.file_name });
}

// ---- backfill mode: one page of pre-v2.49 files, oldest first ---------------
async function handleBackfill(admin: ReturnType<typeof createClient>, userId: string, body: Record<string, unknown>) {
  const spec = (body.backfill ?? {}) as Record<string, unknown>;
  const projectId = String(spec.project_id ?? "").trim();
  const limit = Number(spec.limit ?? 25);
  if (!projectId) return json({ error: "project_id required" }, 400);
  const { data: page } = await admin.rpc("attachment_backfill_targets",
    { p_project: projectId, p_user: userId, p_limit: Number.isFinite(limit) ? limit : 25 });
  if (!page?.ok) {
    if (page?.error === "unknown_project") return json({ error: "project not found" }, 404);
    return json({ error: "not allowed" }, 403);
  }
  const rows = Array.isArray(page.rows) ? page.rows : [];
  let hashed = 0, already = 0;
  const failures: { id: string; error: string }[] = [];
  for (const row of rows) {
    const h = await downloadAndHash(admin, String(row.storage_path));
    if (!h.ok) { failures.push({ id: String(row.id), error: h.error }); continue; }
    const { data: setr } = await admin.rpc("attachment_set_hash",
      { p_id: row.id, p_sha256: h.sha256, p_backfilled: true });
    if (!setr?.ok) { failures.push({ id: String(row.id), error: setr?.error || "set failed" }); continue; }
    if (setr.already) already++; else hashed++;
  }
  if (hashed > 0) {
    await admin.rpc("attachment_backfill_note", { p_project: projectId, p_user: userId, p_count: hashed });
  }
  return json({ ok: true, hashed, already, failed: failures.length, remaining: page.remaining, failures: failures.slice(0, 5) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "function not configured" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // JSON body means verify or backfill; multipart means an upload.
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "bad JSON" }, 400); }
    const user = await callerUser(req, admin);
    if (!user) return json({ error: "sign in first" }, 401);
    if (typeof body.verify === "string" && body.verify) return await handleVerify(admin, user.id, body.verify);
    if (body.backfill) return await handleBackfill(admin, user.id, body);
    return json({ error: "unknown mode - expected verify or backfill" }, 400);
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "expected multipart/form-data" }, 400); }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "file required" }, 400);
  const fileName = safeName(file.name);
  const mime = file.type || "application/octet-stream";
  if (file.size <= 0 || file.size > MAX_BYTES) return json({ error: "file too large (25 MB max)" }, 413);
  if (!ALLOW.has(mime)) return json({ error: "file type not allowed" }, 415);

  // Resolve who is uploading and which thread the file lands on.
  let ctx: { org_id: string; project_id: string; comm_id: string; kind: string; name: string; user: string | null };
  const replyToken = String(form.get("reply_token") ?? "").trim();
  if (replyToken) {
    const { data } = await admin.rpc("attachment_sme_target", { p_reply_token: replyToken });
    if (!data?.ok) return json({ error: "invalid link" }, 403);
    ctx = { org_id: data.org_id, project_id: data.project_id, comm_id: data.comm_id, kind: "sme", name: data.name, user: null };
  } else {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const commId = String(form.get("comm_id") ?? "").trim();
    const projectId = String(form.get("project_id") ?? "").trim();
    if (!jwt || (!commId && !projectId)) return json({ error: "sign in and pick a destination" }, 401);
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "invalid session" }, 401);
    if (commId) {
      const { data } = await admin.rpc("attachment_uploader", { p_comm: commId, p_user: u.user.id });
      if (!data?.ok) return json({ error: data?.error === "bad_thread" ? "thread not found" : "not allowed" }, 403);
      ctx = { org_id: data.org_id, project_id: data.project_id, comm_id: commId, kind: data.kind, name: data.name, user: u.user.id };
    } else {
      // Project-anchored team upload (no thread): org membership is the gate.
      // Used by the demo walkthrough; the file also lands on the project's
      // Files list like any other attachment.
      const { data } = await admin.rpc("attachment_team_target", { p_project: projectId, p_user: u.user.id });
      if (!data?.ok) return json({ error: data?.error === "unknown_project" ? "project not found" : "not allowed" }, 403);
      ctx = { org_id: data.org_id, project_id: projectId, comm_id: "", kind: "team", name: data.name, user: u.user.id };
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Hash the exact bytes in the same pass that scans them. The digest is what
  // the verify mode and the receipt's attachmentsAtSend snapshot pin against.
  const sha256 = await sha256Hex(bytes);

  // Virus scan before anything is stored.
  const verdict = await scan(bytes, fileName);
  if (verdict.status === "infected") return json({ error: "This file was flagged by the virus scanner and was not stored.", scan: "infected" }, 422);
  if (verdict.status === "error" && SCAN_FAIL_CLOSED) return json({ error: "The virus scanner is unavailable; try again shortly.", scan: "error" }, 503);
  const scanStatus = verdict.status === "clean" ? "clean" : verdict.status === "error" ? "error" : "unscanned";

  // Store the bytes under <org>/<project>/<uuid>/<name>.
  const path = `${ctx.org_id}/${ctx.project_id}/${crypto.randomUUID()}/${fileName}`;
  const up = await admin.storage.from("attachments").upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return json({ error: "storage upload failed", detail: up.error.message }, 502);

  // Register the metadata (validated + audited). Roll back the object if it fails.
  const { data: reg } = await admin.rpc("attachment_add", {
    p_project: ctx.project_id, p_comm: ctx.comm_id || null, p_message: null,
    p_uploader_kind: ctx.kind, p_uploader_name: ctx.name, p_uploader_user: ctx.user,
    p_file_name: fileName, p_mime: mime, p_size: file.size, p_path: path,
    p_scan_status: scanStatus, p_scan_detail: verdict.detail, p_sha256: sha256,
  });
  if (!reg?.ok) {
    await admin.storage.from("attachments").remove([path]);
    return json({ error: reg?.error === "rate_limited" ? "Too many uploads - try again later." : "could not save attachment", detail: reg?.error }, 400);
  }

  return json({ ok: true, id: reg.id, file_name: fileName, size: file.size, scan_status: scanStatus, sha256_hex: sha256 });
});
