export const APP_VERSION = '3.0.1';
/* ReqPub v2 - core utilities: escaping, formatting, icons, theme, toast. */

export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escA = (s) => esc(s).replace(/"/g, '&quot;');

export const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const nowISO = () => new Date().toISOString();

/* Append an item to a list only if its key is not already present, and return
   the list. Used wherever an optimistic local insert and its realtime echo can
   both land: the two can arrive in either order (the websocket echo often beats
   the HTTP response), so every add must be idempotent or the row doubles. */
export const pushUnique = (list, item, keyOf = (x) => x && x.id) => {
  if (item && keyOf(item) != null && !list.some((x) => keyOf(x) === keyOf(item))) list.push(item);
  return list;
};

/* Reconcile a record into a list by id: replace in place if present, insert at
   the front if not, drop it if archived, keep newest-first when a sort key is
   given. One code path for BOTH the optimistic local write and its realtime
   echo, in either arrival order - the 2026-07-13 duplicate-project incident
   was a blind unshift racing the org-channel insert echo into the same array,
   yielding one row rendered as two identical cards. */
export const upsertById = (list, rec, sortKey) => {
  if (!rec || rec.id == null) return list;
  const i = list.findIndex((x) => x && x.id === rec.id);
  if (rec.archived) { if (i >= 0) list.splice(i, 1); return list; }
  if (i < 0) list.unshift(rec); else list[i] = rec;
  if (sortKey) list.sort((a, b) => new Date(b[sortKey]) - new Date(a[sortKey]));
  return list;
};

/* A unique-violation from Postgres (code 23505). durable() retries a lost
   response; if the first attempt committed, the retry trips the primary key.
   That means the write EXISTS - treat it as success, never as failure, or the
   person retries by hand and creates a real second row. */
export const isDupKey = (e) => !!e && (e.code === '23505' || /duplicate key/i.test(e.message || ''));

/* ---- attachments (files on a conversation) ---- */
export const ACCEPT_FILES = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.png,.jpg,.jpeg,.gif,.webp,.heic,.zip';
export const fmtBytes = (n) => {
  n = +n || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
};
export function attachInput({ comm, token, label } = {}) {
  const attrs = (comm ? ' data-comm="' + escA(comm) + '"' : '') + (token ? ' data-token="' + escA(token) + '"' : '');
  return '<label class="btn btn-ghost btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px">' +
    ico(IC.clip, 'i-sm') + (label || 'Attach file') +
    '<input type="file" data-attach="1"' + attrs + ' accept="' + ACCEPT_FILES + '" style="display:none"></label>';
}
// Only surface a flag for genuinely notable states. With no scanner configured,
// files are 'unscanned' and post normally with no flag; 'error' means a scanner
// was set but failed, which the team should see; 'infected' never reaches here.
const scanFlag = (s) => (s === 'infected' || s === 'error')
  ? '<span class="pill" style="height:16px;font-size:9px;padding:0 6px;color:var(--amber);border-color:currentColor;vertical-align:1px">' +
    (s === 'infected' ? 'blocked' : 'scan failed') + '</span>'
  : '';
export function attachChips(list, opts = {}) {
  if (!list || !list.length) return '';
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' + list.map((a) => {
    const inner = ico(IC.file, 'i-sm') +
      '<span style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.file_name) + '</span>' +
      '<span style="color:var(--ink-4);font-size:10.5px">' + fmtBytes(a.size_bytes) + '</span>' + scanFlag(a.scan_status);
    const style = 'display:inline-flex;align-items:center;gap:6px;font-size:11.5px;border:1px solid var(--line);border-radius:8px;padding:4px 9px;background:var(--bg);color:var(--ink-2)';
    return (opts.download && a.storage_path)
      ? '<button data-action="dlattach" data-path="' + escA(a.storage_path) + '" data-scan="' + escA(a.scan_status || 'unscanned') + '" title="Download" style="cursor:pointer;' + style + '">' + inner + '</button>'
      : '<span style="' + style + '">' + inner + '</span>';
  }).join('') + '</div>';
}

/* ---- baseline fingerprint ----
   A version fingerprint is SHA-256 over the canonical JSON of
   { label, seq, snapshot }. Canonical means: object keys sorted, arrays in
   order, strings/numbers/booleans/null exactly as JSON.stringify emits them,
   UTF-8 bytes hashed. The recipe is deliberately simple enough to restate on
   the export itself, so anyone holding the stored snapshot can recompute the
   fingerprint without ReqPub. It identifies the exact baseline an export was
   produced from; it is NOT a signature or a trusted timestamp (that is the
   e-signature and sealing phase). */
export function canonicalJson(v) {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'undefined') return 'null';        // undefined has no JSON form; pin it
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  }
  return 'null';                                       // functions, symbols: no JSON form
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* The fingerprint of one stored version row ({label, seq, snapshot}). */
export function versionFingerprint(v) {
  return sha256Hex(canonicalJson({ label: v.label, seq: v.seq, snapshot: v.snapshot }));
}

/* Display form: sha256:first 16 hex, grouped for reading. Full hex on exports. */
export const fmtFingerprint = (hex, n = 16) =>
  'sha256:' + String(hex || '').slice(0, n).replace(/(.{4})(?=.)/g, '$1 ');

export function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined,
      { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return String(iso || ''); }
}

export function relTime(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 7 * 86400) return Math.round(s / 86400) + 'd ago';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return String(iso); }
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.flush = (...args) => { clearTimeout(t); t = null; fn(...args); };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

export const initials = (name) => {
  const n = String(name || '').trim();
  if (!n) return 'U';
  const p = n.split(/\s+/);
  return (p[0].charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase();
};

export const clip = (s, n) => { s = s || ''; return s.length > n ? s.slice(0, n).trim() + '…' : s; };

/* ---- Icons (feather-style paths, 24x24) ---- */
export const IC = {
  fwd: '<polyline points="9 18 15 12 9 6"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  arrow: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  spark: '<path d="M12 3l1.6 4.8L18 9l-4.4 1.2L12 15l-1.6-4.8L6 9l4.4-1.2z"/>',
  hist: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  word: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="9" x2="11" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  signout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  cmd: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
};
export const ico = (p, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24">${p}</svg>`;
export const brandmark = (size) =>
  `<div class="brandmark"${size ? ` style="width:${size}px;height:${size}px"` : ''}><svg viewBox="0 0 24 24">${IC.fwd}</svg></div>`;

/* ---- Theme ---- */
const THEME_KEY = 'rp:theme';
export function themeGet() { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } }
export function themeApply(mode) {
  const dark = mode === 'dark' ||
    (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
export function themeSet(mode) {
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* private mode */ }
  themeApply(mode);
}
export function themeInit() {
  themeApply(themeGet());
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => { if (themeGet() === 'system') themeApply('system'); });
}

/* ---- Clipboard ---- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}

/* The public read-only presentation URL for a published brief share. Anyone
   with it sees the branded PRD as a fixed, read-only page - no account, no
   review form. It reuses the brief token, so it exposes nothing the brief
   link does not, and is revoked together with it. */
export const presentUrl = (pid, seq, token) =>
  location.origin + location.pathname + '#present/' + pid + '/' + seq + '/' + token;

/* ---- Download helper ---- */
export function download(name, mime, body) {
  if (typeof mime !== 'string' || body === undefined) throw new Error('download(name, mime, body): mime must be a string and body must be provided');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
