/* ReqPub v2 - the published standard (node tests/spec-schemas.test.mjs)
   Pins v2.53: the three schemas validate the CURRENT builders' live output,
   so the implementation can never drift from the published standard; the
   schemas have teeth, refusing a missing field, a wrong type, and a bad
   hash; the SPEC-to-schema parity script holds the tables equal; the
   served files exist, parse, and declare draft 2020-12; SPEC.md states the
   standing invariant and the D1 license marker. ajv is a devDependency
   here only; the runtime CLI stays on node builtins. */
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const { buildVerifyBundle, BUNDLE_FORMAT } = await import('../app/js/verifybundle.js');
const { buildEvidencePack } = await import('../app/js/evidencepack.js');
const { versionFingerprint } = await import('../app/js/core.js');
const L = await import('../supabase/functions/seal-receipt/seallib.mjs');

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };
const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const load = (p) => JSON.parse(readFileSync(rel(p), 'utf8'));

const ajv = new Ajv2020.default({ strict: true, allErrors: true });
const vBundle = ajv.compile(load('../schemas/reqpub-baseline-bundle.schema.json'));
const vReceipt = ajv.compile(load('../schemas/reqpub-receipt.schema.json'));
const vManifest = ajv.compile(load('../schemas/reqpub-evidence-manifest.schema.json'));
const firstErr = (v) => (v.errors && v.errors[0] && (v.errors[0].instancePath + ' ' + v.errors[0].message)) || '';

/* ---- live outputs validate: the no-drift gate ---- */
const version = { label: '1.0', seq: 1, snapshot: { answers: { obj: 'Ship' }, sections: {} } };
const bundle = JSON.parse(await buildVerifyBundle(version, { product: 'Spec Gate' }));
check('a live baseline bundle validates against its schema', vBundle(bundle), firstErr(vBundle));
check('the schema pins the implementation format constant', bundle.format === BUNDLE_FORMAT);

const fp = await versionFingerprint(version);
const ctx = { receiptId: 'r-spec', projectId: 'p-spec', project: 'Spec Gate', label: '1.0', seq: 1,
  snapshot: version.snapshot, fingerprint: fp, signRequestId: 'sr-spec', signedName: 'Kate Q Client',
  signedAt: '2026-08-01T10:00:00.000Z', signer: { role: 'Sponsor', emailDomain: 'clientco.com' }, evidence: { channel: 'link' } };
const receipt = await L.buildReceipt(ctx, { ok: true, head_seq: 3, head_hash: 'de'.repeat(32) }, 'acc-1', '2026-08-01T12:00:00.000Z');
check('a live receipt validates against its schema', vReceipt(receipt), firstErr(vReceipt));
const receiptNoChain = await L.buildReceipt(ctx, null, 'acc-1', 't');
check('the chain-unavailable receipt shape validates too', vReceipt(receiptNoChain), firstErr(vReceipt));

const gather = { ok: true, project: { id: 'p-spec', name: 'Spec Gate' }, metaOmitted: true, metaNote: 'stated',
  chronology: [], versions: [version], signatures: [], receipts: [], attachments: [], keys: [],
  chain: { ok: true, head_seq: 1, head_hash: 'ab'.repeat(32), unchained: 0 } };
const { manifest } = await buildEvidencePack(gather, { generatedAt: '2026-08-04T00:00:00Z' });
check('a live evidence manifest validates against its schema', vManifest(manifest), firstErr(vManifest));

/* ---- teeth: the schemas refuse what the standard refuses ---- */
{
  const b = JSON.parse(JSON.stringify(bundle)); delete b.snapshot;
  check('a bundle missing its snapshot is refused', !vBundle(b));
  const b2 = JSON.parse(JSON.stringify(bundle)); b2.seq = '1';
  check('a string seq is refused', !vBundle(b2));
  const b3 = JSON.parse(JSON.stringify(bundle)); b3.fingerprint.value = 'XYZ';
  check('a non-hex fingerprint is refused', !vBundle(b3));
  const r = JSON.parse(JSON.stringify(receipt)); r.signature.signerEmailDomain = undefined; delete r.signature.signerEmailDomain;
  check('a receipt missing the signer domain is refused', !vReceipt(r));
  const r2 = JSON.parse(JSON.stringify(receipt)); r2.issuer.name = 'NotReqPub';
  check('a foreign issuer name is refused', !vReceipt(r2));
  const m = JSON.parse(JSON.stringify(manifest)); m.files.push({ name: 'x' });
  check('a manifest entry without its hash is refused', !vManifest(m));
}

/* ---- the parity script holds SPEC.md and the schemas equal ---- */
{
  let out = '', code = 0;
  try { out = execFileSync(process.execPath, [rel('../scripts/spec-schema-parity.mjs')], { encoding: 'utf8', cwd: rel('..') }); }
  catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  check('the SPEC-to-schema parity script passes', code === 0 && out.includes('agree at every named level'), out.trim());
}

/* ---- served files and the normative document ---- */
{
  const names = ['reqpub-baseline-bundle', 'reqpub-receipt', 'reqpub-evidence-manifest'];
  const all = names.map((n) => load('../schemas/' + n + '.schema.json'));
  check('all three schemas declare draft 2020-12 and their served $id',
    all.every((s, i) => s.$schema === 'https://json-schema.org/draft/2020-12/schema' && s.$id === 'https://reqpub.com/schemas/' + names[i] + '.schema.json'));
  const spec = readFileSync(rel('../docs/SPEC.md'), 'utf8');
  check('SPEC.md states the standing invariant in its exact words',
    spec.includes('no JSON-LD processing, no RDF canonicalization,\nand no Data Integrity proofs, now or in any future formatVersion'));
  check('the D1 license marker is present', spec.includes('OWNER TO CONFIRM'));
  check('SPEC.md points at VERIFY.md clause 3 and section 9',
    spec.includes('VERIFY.md clause 3') && spec.includes('VERIFY.md section 9'));
}

console.log(`spec schemas: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
