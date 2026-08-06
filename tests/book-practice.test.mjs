/* ReqPub v2 - the Book, the packet, and practice (node tests/book-practice.test.mjs)
   Pins v2.55: grid facts render from the batched call with drop-the-fact
   empty states; the PRACTICE pill; every client watermark surface; the
   practice template start; the craft-shelf topic; the invoice packet's
   determinism, manifest hashing, frozen columns, and practice cover; the
   bundle and receipt schemas accepting the additive practice field. */
globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const { viewProjects } = await import('../app/js/views-app.js');
const { practiceMark, renderSignPage, renderBriefView } = await import('../app/js/views-external.js');
const { coverHTML } = await import('../app/js/exports.js');
const { buildVerifyBundle } = await import('../app/js/verifybundle.js');
const { buildInvoicePacket } = await import('../app/js/invoicepacket.js');
const { TEMPLATES, templateByKey } = await import('../app/js/templates.js');
const { HELP_LIBRARY } = await import('../app/js/help-library.js');
const { parseCsvStrict } = await import('../app/js/evidencepack.js');
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };
const bytes = (f) => (typeof f.data === 'string' ? f.data : [...f.data].join(','));

/* ---- grid facts ---- */
const baseApp = { role: 'manager', org: 'CV', orgs: [], projects: [], projectStats: {}, myApprovals: [], helpTopics: [], help: {} };
{
  const APP = { ...baseApp,
    projects: [{ id: 'p1', name: 'Alpha', updated_at: new Date().toISOString(), practice: false },
               { id: 'p2', name: 'Rehearsal', updated_at: new Date().toISOString(), practice: true }],
    projectStats: { p1: { latest: { label: '1.0', status: 'approved' }, unread: 0, open: 0 }, p2: { unread: 0, open: 0 } },
    acceptFacts: { p1: { pending: 2, signed: 1, sealed: true } } };
  const html = viewProjects(APP);
  check('signature counts and Sealed render from the batched facts',
    html.includes('2 awaiting signature') && html.includes('1 signed') && html.includes('>Sealed<'));
  check('a project with no facts renders no fact pills: dropped, not broken',
    !html.includes('0 awaiting') && (html.match(/awaiting signature/g) || []).length === 1);
  check('the PRACTICE pill marks the rehearsal card and only it',
    (html.match(/>PRACTICE</g) || []).length === 1);
  check('Export book sits on the projects surface for a manager', html.includes('data-action="bookexport"'));
  /* This assertion used to be satisfied by the PRACTICE pill's tooltip, which
     is a different element in a different part of the page, so it passed while
     saying nothing about the create form. It now reads the control itself. */
  check('the create form offers the practice choice and states the irreversible part up front',
    html.includes('id="newPractice"') && html.includes('It can never become a real record.'));
  check('the full consequences sit with the control and follow it, revealed when it is chosen',
    html.includes('cannot be undone in either direction')
    && html.indexOf('rp-practice-detail') > html.indexOf('id="newPractice"'));
  check('the template description stays with the chips it describes, not with the practice control',
    html.indexOf('empty worksheet') < html.indexOf('rp-new-rule')
    && html.indexOf('rp-new-rule') < html.indexOf('id="newPractice"'));
  const viewer = viewProjects({ ...APP, role: 'viewer' });
  check('a viewer sees neither Export book nor the archive control', !viewer.includes('data-action="bookexport"'));
}

/* ---- watermarks, every client surface ---- */
{
  check('the mark itself states the doctrine', practiceMark(true).includes('PRACTICE RECORD') && practiceMark(false) === '');
  // The worksheet header: pinned at the source, the same discipline the
  // paste gates use, because a full workspace fixture proves nothing this
  // one conditional does not.
  const src = readFileSync(fileURLToPath(new URL('../app/js/views-app.js', import.meta.url)), 'utf8');
  const hdr = src.slice(src.indexOf('export function viewWorkspace'), src.indexOf('const doc = renderDoc'));
  check('the worksheet header carries the watermark, gated on the project flag',
    hdr.includes("APP.project && APP.project.practice") && hdr.includes('PRACTICE RECORD'));
  check('every cover states it through coverHTML', coverHTML({ product: 'R', practice: true }).includes('PRACTICE RECORD')
    && !coverHTML({ product: 'A' }).includes('PRACTICE RECORD'));
  check('the sign page reads the context flag',
    renderSignPage({ sign: { practice: true, status: 'pending', snapshot: { answers: {}, sections: {} }, project: 'R', label: '1.0' }, share: null }).includes('PRACTICE RECORD'));
  check('the brief reads the share payload flag',
    renderBriefView({ share: { payload: { practice: true, answers: {}, sections: {}, product: 'R' } }, shareForm: {} }).includes('PRACTICE RECORD'));
}

/* ---- the bundle states it, additively ---- */
{
  const v = { label: '1.0', seq: 1, snapshot: { answers: {}, sections: {} } };
  const withFlag = JSON.parse(await buildVerifyBundle(v, { product: 'R', practice: true }));
  const without = JSON.parse(await buildVerifyBundle(v, { product: 'A' }));
  check('a practice bundle carries practice true; an evidence bundle carries nothing',
    withFlag.practice === true && !('practice' in without));
  check('the flag never touches the fingerprint', withFlag.fingerprint.value === without.fingerprint.value);
  const ajv = new Ajv2020.default({ strict: true });
  const load = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
  const vB = ajv.compile(load('../schemas/reqpub-baseline-bundle.schema.json'));
  check('both shapes validate against the published baseline schema', vB(withFlag) && vB(without));
  const rSchema = ajv.compile(load('../schemas/reqpub-receipt.schema.json'));
  const receipt = { format: 'reqpub-receipt', formatVersion: 1, receiptId: 'r', sealedAt: 't', practice: true,
    project: { id: 'p', nameSha256: 'ab'.repeat(32) },
    baseline: { label: '1.0', seq: 1, docFingerprint: 'cd'.repeat(32), recomputedFingerprint: 'cd'.repeat(32) },
    signature: { signRequestId: 's', signedName: 'K', signerRole: '', signerEmailDomain: 'x.co', signedAt: 't', channel: 'link' },
    chain: { headSeq: 1, headHash: 'ef'.repeat(32) }, issuer: { name: 'ReqPub', kid: 'k1' } };
  check('a receipt with practice true validates; practice false is refused as non-additive',
    rSchema(receipt) && !rSchema({ ...receipt, practice: false }));
}

/* ---- the template start and the topic ---- */
{
  const t = templateByKey('practice');
  check('the Practice engagement start exists: engagement base, practice set, opens the Document tab',
    !!t && t.base === 'engagement' && t.practice === true && t.openDoc === true);
  check('it sits near the head of the row, behind Blank',
    TEMPLATES[0].key === 'blank' && TEMPLATES.slice(0, 3).some((x) => x.key === 'practice'),
    TEMPLATES.map((x) => x.key).slice(0, 3));
  const topic = HELP_LIBRARY.find((x) => x.title === 'The practice engagement');
  check('the craft-shelf topic ships with the sample intake',
    !!topic && topic.sort_order >= 200 && topic.body_md.includes('FR-001') && topic.body_md.includes('never evidence'));
}

/* ---- the invoice packet ---- */
{
  const input = {
    receipt: { id: 'rc1', canonical_hash: 'ef'.repeat(32), key_id: 'k1', tsa_status: 'dual',
      sealed_at: '2026-08-01T13:01:00Z', signature_base64: 'c2ln', tsa_primary_der: 'AAECAw==', tsa_secondary_der: 'BAUG',
      receipt_json: { format: 'reqpub-receipt', receiptId: 'rc1', sealedAt: '2026-08-01T13:01:00Z',
        baseline: { label: '1.0', seq: 1, docFingerprint: 'ab'.repeat(32) },
        signature: { signedName: 'Kate Q', signerRole: 'Sponsor', signerEmailDomain: 'clientco.com', signedAt: '2026-08-01T13:00:00Z' },
        chain: { headSeq: 7, headHash: '11'.repeat(32) } } },
    sign: { signed_name: 'Kate Q', signer_role: 'Sponsor', doc_fingerprint: 'ab'.repeat(32) },
    version: { label: '1.0', seq: 1 },
    project: { id: 'p1', name: 'Alpha', practice: false },
    generatedAt: '2026-08-04T00:00:00Z',
  };
  const a = await buildInvoicePacket(input);
  const b = await buildInvoicePacket(input);
  const c = await buildInvoicePacket({ ...input, generatedAt: '2026-08-05T00:00:00Z' });
  check('the packet is deterministic for one signature', a.files.every((f, i) => bytes(f) === bytes(b.files[i])));
  const diff = a.files.filter((f, i) => bytes(f) !== bytes(c.files[i])).map((f) => f.name);
  check('a different moment changes exactly the manifest', diff.join(',') === 'packet-manifest.json', diff);
  const names = a.files.map((f) => f.name);
  check('the packet carries receipt, signature, both timestamps, the row, the cover, the manifest',
    ['receipt.json', 'signature.txt', 'tsa_primary.tsr', 'tsa_secondary.tsr', 'evidence-row.csv', 'cover.html', 'packet-manifest.json']
      .every((n) => names.includes(n)));
  const rows = parseCsvStrict(a.files.find((f) => f.name === 'evidence-row.csv').data);
  check('one row, the frozen columns, the at-seal chain snapshot',
    rows.length === 2 && rows[0][0] === 'project_id' && rows[1][13] === '7' && rows[1][14] === '11'.repeat(32));
  const man = JSON.parse(a.files.find((f) => f.name === 'packet-manifest.json').data);
  check('the manifest hashes every other file and carries its own canonical hash',
    man.files.length === a.files.length - 1 && /^[0-9a-f]{64}$/.test(man.manifestCanonicalSha256));
  const pr = await buildInvoicePacket({ ...input, project: { ...input.project, practice: true } });
  check('a practice packet watermarks its cover',
    pr.files.find((f) => f.name === 'cover.html').data.includes('PRACTICE RECORD')
    && !a.files.find((f) => f.name === 'cover.html').data.includes('PRACTICE RECORD'));
  const blob = a.files.filter((f) => typeof f.data === 'string').map((f) => f.data).join('\n');
  check('no token substring and no full address in the packet',
    !blob.includes('rqp_') && !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/.test(blob) && blob.includes('clientco.com'));
}

console.log(`book+practice: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
