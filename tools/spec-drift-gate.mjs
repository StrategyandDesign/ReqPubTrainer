#!/usr/bin/env node
/* ReqPub - the spec drift gate. A pipeline step for the pod that builds
   from a ReqPub baseline: it reads the signed baseline over MCP, compares
   its fingerprint with the requirements.json committed in the repository,
   and fails the build when the two disagree. A sealed baseline is required.
   Before the gate can pass, it reads that baseline's acceptance receipt and
   verifies the Ed25519 signature and the receipt fingerprint locally, with
   the same functions as tools/reqpub-verify.mjs.

     REQPUB_MCP_URL=https://<ref>.supabase.co/functions/v1/mcp \
     REQPUB_MCP_KEY=${REQPUB_MCP_KEY} \
     node tools/spec-drift-gate.mjs --project <project id> --file spec/requirements.json \
       [--seq N] [--require-sealed] [--allow-unsealed] [--keys reqpub-keys.json]

   --require-sealed is accepted and changes nothing: sealed is already the
   default, so a pipeline that passes the flag keeps working. --allow-unsealed
   is the opt-out. It prints a warning and will accept a baseline whose
   sealed value is not true.

   Exit 0: fingerprint, label, seal, receipt signature, and receipt
   fingerprint all agree. Exit 1: drift, an unsealed baseline without the
   opt-out, a receipt signature that does not verify, a receipt fingerprint
   that is not the baseline's, or a timestamp token that is present and
   invalid. Exit 2: the gate could not run (no key, no file, no answer, or
   the receipt could not be fetched). It reads; it never writes. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { claimedBaselineFingerprint, verifySeal, verifyTimestampToken } from './reqpub-verify-lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt; };
const flag = (name) => args.includes(name);
const DEFAULT_KEYS = fileURLToPath(new URL('../reqpub-keys.json', import.meta.url));

/* Printed when --allow-unsealed is set. The opt-out is deliberate and loud. */
export const ALLOW_UNSEALED_WARNING = 'WARNING  --allow-unsealed: sealed acceptance is NOT required for this run. An unsealed baseline will be accepted. This is not the normal gate. Remove --allow-unsealed to refuse baselines the client has not signed and sealed.';

async function postTool({ url, key, name, toolArgs, id, fetchFn }) {
  const body = { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: toolArgs } };
  const r = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => null);
  if (!j || j.error) return { ok: false, error: (j && j.error && j.error.message) || ('HTTP ' + r.status) };
  const content = j.result && j.result.content && j.result.content[0] && j.result.content[0].text;
  if (j.result && j.result.isError) {
    const text = String(content || 'denied');
    const i = text.indexOf(': ');
    return i > 0 ? { ok: false, error: text.slice(0, i), detail: text.slice(i + 2) } : { ok: false, error: text };
  }
  let parsed = null;
  try { parsed = JSON.parse(content); } catch { return { ok: false, error: 'unreadable answer' }; }
  if (!parsed || parsed.ok !== true) return { ok: false, error: (parsed && parsed.error) || 'denied', detail: parsed && parsed.message };
  return { ok: true, value: parsed };
}

export async function readBaseline({ url, key, projectId, seq, fetchFn = fetch }) {
  const got = await postTool({
    url, key, name: 'reqpub_get_baseline', id: 1, fetchFn,
    toolArgs: seq != null ? { projectId, seq } : { projectId },
  });
  if (!got.ok) return got;
  return { ok: true, baseline: got.value };
}

export async function readReceipt({ url, key, receiptId, fetchFn = fetch }) {
  const got = await postTool({
    url, key, name: 'reqpub_get_receipt', id: 2, fetchFn,
    toolArgs: { receiptId },
  });
  if (!got.ok) return got;
  return { ok: true, receipt: got.value };
}

export function receiptIdsOf(baseline) {
  const ids = [];
  const add = (id) => { if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id); };
  for (const row of (baseline && baseline.sealedBy) || []) add(row && row.receiptId);
  add(baseline && baseline.receiptId);
  return ids;
}

/* Pure: the verdict for a committed file against a baseline answer.
   Sealed is required unless the caller passes requireSealed: false, which
   is what --allow-unsealed does. --require-sealed does not reach here as a
   separate switch: the default is already sealed. */
export function compare(committed, baseline, { requireSealed = true } = {}) {
  const have = String((committed.fingerprint && committed.fingerprint.value) || '').toLowerCase();
  const want = String(baseline.fingerprint || '').toLowerCase();
  const lines = [];
  const checks = [];
  let fpOk = false;
  if (!/^[0-9a-f]{64}$/.test(have)) {
    checks.push({ name: 'fingerprint', verdict: 'fail', detail: 'committed file has no 64-character fingerprint.value' });
    lines.push('the committed requirements.json carries no 64-character fingerprint.value');
  } else if (!/^[0-9a-f]{64}$/.test(want)) {
    checks.push({ name: 'fingerprint', verdict: 'fail', detail: 'baseline answer has no fingerprint' });
    lines.push('the baseline answer carries no fingerprint; is the MCP function at 3.2.0 or later?');
  } else if (have !== want) {
    checks.push({ name: 'fingerprint', verdict: 'fail' });
    lines.push('DRIFT  committed ' + have.slice(0, 16) + '… is not baseline v' + baseline.label + ' (' + want.slice(0, 16) + '…)');
    lines.push('       regenerate the implementation package from the signed baseline and commit it');
  } else {
    fpOk = true;
    checks.push({ name: 'fingerprint', verdict: 'pass' });
  }
  const label = committed.version && committed.version.label;
  let labelOk = false;
  if (!fpOk) checks.push({ name: 'label', verdict: 'skipped' });
  else if (label && String(label) !== String(baseline.label)) {
    checks.push({ name: 'label', verdict: 'fail' });
    lines.push('DRIFT  committed label v' + label + ' is not the baseline label v' + baseline.label + ' under the same fingerprint');
  } else {
    labelOk = true;
    checks.push({ name: 'label', verdict: 'pass' });
  }
  if (!fpOk || !labelOk) {
    checks.push({ name: 'sealed', verdict: 'skipped' });
    return { ok: false, lines, checks };
  }
  if (baseline.sealed === true) checks.push({ name: 'sealed', verdict: 'pass' });
  else if (requireSealed) {
    checks.push({ name: 'sealed', verdict: 'fail' });
    lines.push('UNSEALED  baseline v' + baseline.label + ' carries no sealed acceptance receipt; --require-sealed refuses it');
    return { ok: false, lines, checks };
  } else checks.push({ name: 'sealed', verdict: 'warning', detail: '--allow-unsealed' });
  lines.push('OK  committed requirements.json is baseline v' + baseline.label + ' seq ' + baseline.seq + ', fingerprint ' + want.slice(0, 16) + '…' +
    (baseline.sealed === true ? ', sealed by ' + ((baseline.sealedBy || []).map((s) => s.signerName).filter(Boolean).join(', ') || 'a signer') : ', not yet sealed'));
  return { ok: true, lines, checks };
}

export function loadPublishedKeys(text) {
  const j = JSON.parse(text);
  if (!j || !Array.isArray(j.keys)) throw new Error('published keys file has no keys array');
  return j.keys;
}

/* TODO(server): reqpub_get_receipt returns tsaStatus only. The RFC 3161
   bytes are stored on acceptance_receipts as base64 (tsa_primary_der,
   tsa_secondary_der) and are not in the MCP answer. A server change, which
   this pull request does not make, would return them, for example as
   tsaPrimaryDer and tsaSecondaryDer. Until that ships, absent tokens are
   reported and do not fail the gate. Present tokens are verified. */
export function timestampTokens(answer) {
  const found = [];
  const take = (name, value) => {
    const bytes = tokenBytes(value);
    if (bytes) found.push({ name, bytes });
  };
  if (!answer || typeof answer !== 'object') return found;
  take('tsa_primary.tsr', answer.tsaPrimaryDer ?? answer.tsa_primary_der);
  take('tsa_secondary.tsr', answer.tsaSecondaryDer ?? answer.tsa_secondary_der);
  for (const list of [answer.timestamps, answer.tsrTokens, answer.tokens]) {
    if (!Array.isArray(list)) continue;
    list.forEach((item, i) => {
      if (item && typeof item === 'object') take(item.name || ('timestamp-' + (i + 1) + '.tsr'), item.der ?? item.base64 ?? item.tsr ?? item.token);
      else take('timestamp-' + (i + 1) + '.tsr', item);
    });
  }
  return found;
}

function tokenBytes(value) {
  if (value == null || value === '') return null;
  if (Buffer.isBuffer(value)) return value.length ? value : null;
  if (value instanceof Uint8Array) return value.byteLength ? Buffer.from(value) : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, 'base64');
  return buf.length ? buf : null;
}

function asReceiptObject(answer) {
  const raw = answer && (answer.receiptJson !== undefined ? answer.receiptJson : answer.receipt);
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* fail closed below */ }
  }
  return null;
}

/* One MCP receipt answer against the baseline and the published keys.
   Crypto is verifySeal and verifyTimestampToken; this function only decides. */
export function checkPublishedReceipt(answer, baseline, keys) {
  const receipt = asReceiptObject(answer);
  const kid = (answer && (answer.keyId || answer.key_id)) || (receipt && receipt.issuer && receipt.issuer.kid) || '';
  const published = (keys || []).find((k) => k && k.kid === kid);
  const sig = (answer && (answer.signatureBase64 || answer.signature_base64)) || '';
  if (!receipt || !sig || !published || !published.publicKeySpkiBase64) {
    const why = !published || !published.publicKeySpkiBase64
      ? ('kid ' + (kid || '(none)') + ' is not in the published keys')
      : 'receipt answer is missing the receipt or the signature';
    return {
      ok: false,
      checks: [
        { name: 'receipt signature', verdict: 'fail', detail: why },
        { name: 'receipt fingerprint', verdict: 'skipped', detail: 'receipt signature did not verify' },
        { name: 'timestamps', verdict: 'skipped', detail: 'receipt signature did not verify' },
      ],
    };
  }
  const seal = verifySeal(receipt, sig, published.publicKeySpkiBase64);
  const { claimed } = claimedBaselineFingerprint(receipt);
  const want = String((baseline && baseline.fingerprint) || '').toLowerCase();
  const have = String(claimed || '').toLowerCase();
  const fpOk = /^[0-9a-f]{64}$/.test(have) && have === want;
  const sigDetail = seal.reason === 'invalid-spki' ? 'published key is not a valid Ed25519 SPKI'
    : seal.reason === 'placeholder' ? 'published key is the deploy placeholder'
    : 'Ed25519 signature does not verify';
  const sigCheck = seal.ok
    ? { name: 'receipt signature', verdict: 'pass', detail: 'kid ' + kid }
    : { name: 'receipt signature', verdict: 'fail', detail: sigDetail };
  const fpCheck = { name: 'receipt fingerprint', verdict: fpOk ? 'pass' : 'fail', detail: fpOk ? '' : ('receipt claims ' + (have ? have.slice(0, 16) + '…' : 'nothing')) };
  if (!seal.ok) {
    return { ok: false, checks: [sigCheck, fpCheck, { name: 'timestamps', verdict: 'skipped', detail: 'receipt signature did not verify' }] };
  }
  const tokens = timestampTokens(answer);
  let ts;
  let tsOk = true;
  if (tokens.length === 0) ts = { name: 'timestamps', verdict: 'status-only' };
  else {
    const bad = [];
    const unchecked = [];
    let good = 0;
    for (const t of tokens) {
      const res = verifyTimestampToken(t.bytes, seal.canonHash);
      if (res.ok) good++;
      else if (res.unsupported) unchecked.push(t.name + ': ' + res.reason);
      else { bad.push(t.name + ': ' + res.reason); tsOk = false; }
    }
    if (bad.length) ts = { name: 'timestamps', verdict: 'fail', detail: bad.join('; ') };
    else if (good === 0) ts = { name: 'timestamps', verdict: 'warning', detail: unchecked.join('; ') };
    else ts = { name: 'timestamps', verdict: 'pass', detail: unchecked.length ? (good + ' checked; not checked here: ' + unchecked.join('; ')) : '' };
  }
  return { ok: fpOk && tsOk, checks: [sigCheck, fpCheck, ts] };
}

function foldChecks(parts) {
  const names = ['receipt signature', 'receipt fingerprint', 'timestamps'];
  return names.map((name) => {
    const rows = parts.map((p) => p.find((c) => c.name === name)).filter(Boolean);
    if (!rows.length) return { name, verdict: 'skipped' };
    if (rows.some((r) => r.verdict === 'fail')) {
      return { name, verdict: 'fail', detail: rows.filter((r) => r.verdict === 'fail').map((r) => r.detail).filter(Boolean).join('; ') };
    }
    if (rows.some((r) => r.verdict === 'not run')) {
      return { name, verdict: 'not run', detail: rows.filter((r) => r.verdict === 'not run').map((r) => r.detail).filter(Boolean).join('; ') };
    }
    if (name === 'timestamps' && rows.every((r) => r.verdict === 'status-only')) return { name, verdict: 'status-only' };
    if (rows.every((r) => r.verdict === 'skipped')) return { name, verdict: 'skipped', detail: rows.map((r) => r.detail).filter(Boolean)[0] || '' };
    if (rows.some((r) => r.verdict === 'warning') && rows.every((r) => r.verdict === 'warning' || r.verdict === 'status-only')) {
      return { name, verdict: 'warning', detail: rows.map((r) => r.detail).filter(Boolean).join('; ') };
    }
    return { name, verdict: 'pass', detail: rows.map((r) => r.detail).filter(Boolean).join('; ') };
  });
}

function verdictLine(check) {
  if (check.name === 'timestamps' && check.verdict === 'status-only') return 'timestamps: not verifiable over MCP (status only)';
  const detail = check.detail ? ' (' + check.detail + ')' : '';
  return check.name + ': ' + check.verdict + detail;
}

function skippedReceipt(detail) {
  return [
    { name: 'receipt signature', verdict: 'skipped', detail },
    { name: 'receipt fingerprint', verdict: 'skipped', detail },
    { name: 'timestamps', verdict: 'skipped', detail },
  ];
}

function notRunReceipt(detail) {
  return [
    { name: 'receipt signature', verdict: 'not run', detail },
    { name: 'receipt fingerprint', verdict: 'not run', detail },
    { name: 'timestamps', verdict: 'not run', detail },
  ];
}

async function main() {
  const url = process.env.REQPUB_MCP_URL, key = process.env.REQPUB_MCP_KEY;
  const projectId = opt('--project'), file = opt('--file', 'requirements.json');
  const seqArg = opt('--seq');
  const seq = seqArg != null ? Number(seqArg) : null;
  const allowUnsealed = flag('--allow-unsealed');
  /* Accepted and ignored. Sealed is already the default, so existing CI
     that passes --require-sealed does not change behavior and does not break. */
  flag('--require-sealed');
  if (!url || !key || !projectId) { console.error('spec drift gate: REQPUB_MCP_URL, REQPUB_MCP_KEY and --project are required'); process.exit(2); }
  if (seqArg != null && !Number.isInteger(seq)) { console.error('spec drift gate: --seq must be an integer, got ' + seqArg); process.exit(2); }
  let committed;
  try { committed = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { console.error('spec drift gate: cannot read ' + file + ': ' + e.message); process.exit(2); }
  const r = await readBaseline({ url, key, projectId, seq });
  if (!r.ok) {
    const hard = r.error === 'unsealed';
    console.error('spec drift gate: ' + (hard ? 'REFUSED  ' : 'cannot read the baseline: ') + r.error + (r.detail ? ' (' + r.detail + ')' : ''));
    process.exit(hard ? 1 : 2);
  }
  if (allowUnsealed) {
    console.error('spec drift gate: ' + ALLOW_UNSEALED_WARNING);
    console.log('spec drift gate: ' + ALLOW_UNSEALED_WARNING);
  }
  const v = compare(committed, r.baseline, { requireSealed: !allowUnsealed });
  const checks = v.checks.slice();
  let code = v.ok ? 0 : 1;
  if (!v.ok) checks.push(...skippedReceipt('baseline comparison did not pass'));
  else {
    const ids = receiptIdsOf(r.baseline);
    if (!ids.length && r.baseline.sealed !== true) checks.push(...skippedReceipt('--allow-unsealed; baseline is not sealed'));
    else if (!ids.length) {
      checks.push(...notRunReceipt('sealed baseline names no receipt id'));
      code = 2;
    } else {
      let keys;
      try { keys = loadPublishedKeys(readFileSync(opt('--keys', DEFAULT_KEYS), 'utf8')); }
      catch (e) {
        console.error('spec drift gate: cannot read published keys: ' + e.message);
        process.exit(2);
      }
      const groups = [];
      let fetchFailed = false;
      for (const id of ids) {
        const got = await readReceipt({ url, key, receiptId: id });
        if (!got.ok) {
          fetchFailed = true;
          const why = 'cannot fetch receipt ' + id + ': ' + got.error + (got.detail ? ' (' + got.detail + ')' : '');
          groups.push(notRunReceipt(why));
          continue;
        }
        groups.push(checkPublishedReceipt(got.receipt, r.baseline, keys).checks);
      }
      const folded = foldChecks(groups);
      checks.push(...folded);
      if (folded.some((c) => c.verdict === 'fail')) code = 1;
      else if (fetchFailed) code = 2;
    }
  }
  for (const c of checks) console.log('spec drift gate: ' + verdictLine(c));
  for (const l of v.lines) {
    /* compare() writes the OK line when the committed file matches a sealed
       baseline. That line is the pass sentence, so it stays off the transcript
       when a later receipt check refuses the run. */
    if (l.startsWith('OK  ') && code !== 0) continue;
    console.log('spec drift gate: ' + l);
  }
  process.exit(code);
}

/* An endpoint that cannot be reached, or hangs past the timeout, is a gate
   that could not run: exit 2, one line, no stack trace. */
if (process.argv[1] && /spec-drift-gate\.mjs$/.test(process.argv[1])) {
  main().catch((e) => { console.error('spec drift gate: cannot reach the MCP endpoint: ' + (e && e.message ? e.message : String(e))); process.exit(2); });
}
