#!/usr/bin/env node
/* ReqPub v3.2 - the spec drift gate. A pipeline step for the pod that builds
   from a ReqPub baseline: it reads the signed baseline over MCP, compares
   its fingerprint with the requirements.json committed in the repository,
   and fails the build when the two disagree. The repository copy is then a
   verified mirror of the record, and a Coder that builds against it builds
   against what the client signed.

     REQPUB_MCP_URL=https://<ref>.supabase.co/functions/v1/mcp \
     REQPUB_MCP_KEY=rqp_live_... \
     node tools/spec-drift-gate.mjs --project <project id> --file spec/requirements.json [--seq N] [--require-sealed]

   Exit 0: the committed fingerprint equals the baseline's. Exit 1: drift,
   an unsealed baseline where one is required, or a project that hands off
   only from sealed baselines and has none. Exit 2: the gate could not run
   (no key, no file, no answer). It reads; it never writes. */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const flag = (name) => args.includes(name);

export async function readBaseline({ url, key, projectId, seq, fetchFn = fetch }) {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'reqpub_get_baseline', arguments: seq != null ? { projectId, seq } : { projectId } } };
  const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  if (!j || j.error) return { ok: false, error: (j && j.error && j.error.message) || ('HTTP ' + r.status) };
  const content = j.result && j.result.content && j.result.content[0] && j.result.content[0].text;
  if (j.result && j.result.isError) {
    const text = String(content || 'denied');
    const i = text.indexOf(': ');
    return i > 0 ? { ok: false, error: text.slice(0, i), detail: text.slice(i + 2) } : { ok: false, error: text };
  }
  let out = null;
  try { out = JSON.parse(content); } catch { return { ok: false, error: 'unreadable answer' }; }
  if (!out || out.ok !== true) return { ok: false, error: (out && out.error) || 'denied', detail: out && out.message };
  return { ok: true, baseline: out };
}

/* Pure: the verdict for a committed file against a baseline answer. */
export function compare(committed, baseline, { requireSealed = false } = {}) {
  const have = String((committed.fingerprint && committed.fingerprint.value) || '').toLowerCase();
  const want = String(baseline.fingerprint || '').toLowerCase();
  const lines = [];
  if (!/^[0-9a-f]{64}$/.test(have)) return { ok: false, lines: ['the committed requirements.json carries no 64-character fingerprint.value'] };
  if (!/^[0-9a-f]{64}$/.test(want)) return { ok: false, lines: ['the baseline answer carries no fingerprint; is the MCP function at 3.2.0 or later?'] };
  if (have !== want) {
    lines.push('DRIFT  committed ' + have.slice(0, 16) + '… is not baseline v' + baseline.label + ' (' + want.slice(0, 16) + '…)');
    lines.push('       regenerate the implementation package from the signed baseline and commit it');
    return { ok: false, lines };
  }
  const label = committed.version && committed.version.label;
  if (label && String(label) !== String(baseline.label)) {
    lines.push('DRIFT  committed label v' + label + ' is not the baseline label v' + baseline.label + ' under the same fingerprint');
    return { ok: false, lines };
  }
  if (requireSealed && baseline.sealed !== true) {
    lines.push('UNSEALED  baseline v' + baseline.label + ' carries no sealed acceptance receipt; --require-sealed refuses it');
    return { ok: false, lines };
  }
  lines.push('OK  committed requirements.json is baseline v' + baseline.label + ' seq ' + baseline.seq + ', fingerprint ' + want.slice(0, 16) + '…' +
    (baseline.sealed === true ? ', sealed by ' + ((baseline.sealedBy || []).map((s) => s.signerName).filter(Boolean).join(', ') || 'a signer') : ', not yet sealed'));
  return { ok: true, lines };
}

async function main() {
  const url = process.env.REQPUB_MCP_URL, key = process.env.REQPUB_MCP_KEY;
  const projectId = opt('--project'), file = opt('--file', 'requirements.json');
  const seqArg = opt('--seq');
  const seq = seqArg != null ? Number(seqArg) : null;
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
  const v = compare(committed, r.baseline, { requireSealed: flag('--require-sealed') });
  for (const l of v.lines) console.log('spec drift gate: ' + l);
  process.exit(v.ok ? 0 : 1);
}

/* An endpoint that cannot be reached, or hangs past the timeout, is a gate
   that could not run: exit 2, one line, no stack trace. */
if (process.argv[1] && /spec-drift-gate\.mjs$/.test(process.argv[1])) {
  main().catch((e) => { console.error('spec drift gate: cannot reach the MCP endpoint: ' + (e && e.message ? e.message : String(e))); process.exit(2); });
}
