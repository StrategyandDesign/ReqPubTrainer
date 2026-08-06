/* ReqPub v2 - the evidence pack builder (node tests/evidencepack.test.mjs)
   Pins v2.52: deterministic bytes with generatedAt only in the manifest;
   the leak grep over every emitted text file; the frozen evidence.csv
   column order; formula-injection prefixing surviving a strict round-trip;
   graceful builds with nothing to pack; the manifest covering every file
   both ways; esc discipline on the cover. */
import { buildEvidencePack, csvCell, parseCsvStrict } from '../app/js/evidencepack.js';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };
const text = (f) => (typeof f.data === 'string' ? f.data : '');

const gather = () => ({
  ok: true,
  project: { id: 'p-ev1', name: 'Fathering <Excellence>' },
  metaOmitted: true,
  metaNote: 'Activity meta is omitted from this gather by standing decision D2; the omission is part of the record.',
  chronology: [
    { at: '2026-08-01T10:00:00Z', action: 'version.created', kind: 'version', ref: 'v1', actor: 'Micah', message: 'Baseline 1.0 created' },
    { at: '2026-08-01T11:00:00Z', action: 'comm.received', kind: 'comm', ref: 'c1', actor: '=HYPERLINK("x")', message: '-2+3 looks like a formula' },
  ],
  versions: [
    { label: '1.0', seq: 1, status: 'approved', note: '', authorName: 'Micah', createdAt: '2026-08-01T10:00:00Z', snapshot: { answers: { a: 1 }, sections: {} } },
    { label: '1.1', seq: 2, status: 'draft', note: 'wip', authorName: 'Micah', createdAt: '2026-08-02T10:00:00Z', snapshot: { answers: { a: 2 }, sections: {} } },
  ],
  signatures: [
    { signerName: 'Kate Client', signerRole: 'Sponsor', signerEmailDomain: 'clientco.com', status: 'signed',
      sentAt: '2026-08-01T12:00:00Z', signedAt: '2026-08-01T13:00:00Z', docFingerprint: 'ab'.repeat(32),
      versionSeq: 1, versionLabel: '1.0', receiptId: 'r-1' },
    { signerName: 'Sam Pending', signerRole: 'PM', signerEmailDomain: 'clientco.com', status: 'pending',
      sentAt: '2026-08-02T12:00:00Z', signedAt: null, docFingerprint: 'cd'.repeat(32),
      versionSeq: 2, versionLabel: '1.1', receiptId: null },
  ],
  receipts: [
    { receiptId: 'r-1', canonicalHash: 'ef'.repeat(32), keyId: 'rk-1', tsaStatus: 'dual', sealedAt: '2026-08-01T13:01:00Z',
      receiptJson: { format: 'reqpub-acceptance-receipt', baseline: { docFingerprint: 'ab'.repeat(32) } },
      signatureBase64: 'c2ln', tsaPrimaryDer: 'AAECAw==', tsaSecondaryDer: 'BAUGBw==', versionSeq: 1 },
  ],
  attachments: [{ fileName: 'sow.pdf', mime: 'application/pdf', sizeBytes: 1234, sha256Hex: '11'.repeat(32), scanStatus: 'unscanned', createdAt: '2026-08-01T09:00:00Z' }],
  keys: [{ kid: 'rk-1', publicKeySpkiBase64: 'cGs=' }],
  chain: { ok: true, head_seq: 9, head_hash: '22'.repeat(32), unchained: 0 },
});

/* Determinism: same gather and same generatedAt build identical bytes for
   every file; a different generatedAt changes exactly one file, and that
   file is the manifest. */
{
  const a = await buildEvidencePack(gather(), { generatedAt: '2026-08-03T00:00:00Z' });
  const b = await buildEvidencePack(gather(), { generatedAt: '2026-08-03T00:00:00Z' });
  const c = await buildEvidencePack(gather(), { generatedAt: '2026-08-04T00:00:00Z' });
  const bytes = (f) => (typeof f.data === 'string' ? f.data : [...f.data].join(','));
  check('same state and same generatedAt build byte-identical packs',
    a.files.length === b.files.length && a.files.every((f, i) => f.name === b.files[i].name && bytes(f) === bytes(b.files[i])));
  const diff = a.files.filter((f, i) => bytes(f) !== bytes(c.files[i])).map((f) => f.name);
  check('a different generatedAt changes exactly manifest.json and nothing else',
    diff.length === 1 && diff[0] === 'manifest.json', diff);
}

/* The leak grep: no token substring, no full address, in any emitted text.
   The gather never carries them; the builder is grepped anyway. */
{
  const { files } = await buildEvidencePack(gather(), { generatedAt: '2026-08-03T00:00:00Z' });
  const blob = files.map(text).join('\n');
  check('no rqp_ token substring anywhere in the pack', !blob.includes('rqp_'));
  check('no full email address anywhere in the pack; domains only',
    !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/.test(blob) && blob.includes('clientco.com'));
  check('meta omission is stated in chronology.json',
    text(files.find((f) => f.name === 'chronology.json')).includes('"metaOmitted": true'));
  check('the cover escapes authored text', text(files.find((f) => f.name === 'cover.html')).includes('Fathering &lt;Excellence&gt;'));
  const readme = text(files.find((f) => f.name === 'README.txt'));
  check('the finance line ships in README.txt',
    readme.includes('revenue recognition') && readme.includes('ReqPub asserts none'));
}

/* evidence.csv: the frozen column order, one row per signature, injection
   prefixing surviving a strict round-trip. */
{
  const { files } = await buildEvidencePack(gather(), { generatedAt: '2026-08-03T00:00:00Z' });
  const rows = parseCsvStrict(text(files.find((f) => f.name === 'evidence.csv')));
  check('evidence.csv carries the frozen v2.52 column order',
    rows[0].join('|') === 'project_id|project_name|version_label|seq|doc_fingerprint|signer_name|signer_role|signer_email_domain|signed_at|receipt_id|canonical_hash|tsa_status|sealed_at|chain_head_seq|chain_head_hash');
  check('one row per signature, sealed and pending alike', rows.length === 3 && rows[1][9] === 'r-1' && rows[2][9] === '');
  check('the unsealed row carries empty receipt facts, not nulls', rows[2][10] === '' && rows[2][11] === '' && rows[2][12] === '');
  const chron = parseCsvStrict(text(files.find((f) => f.name === 'chronology.csv')));
  check('formula-looking cells come back with the quote prefix intact',
    chron[2][4] === "'=HYPERLINK(\"x\")" && chron[2][5] === "'-2+3 looks like a formula");
  check('csvCell leaves ordinary text untouched', csvCell('plain') === 'plain' && csvCell('a,b') === '"a,b"');
}

/* The manifest covers everything, both ways, and only the manifest carries
   generatedAt. */
{
  const { files, manifest } = await buildEvidencePack(gather(), { generatedAt: '2026-08-03T00:00:00Z' });
  const listed = new Set(manifest.files.map((f) => f.name));
  const onDisk = files.filter((f) => f.name !== 'manifest.json').map((f) => f.name);
  check('every emitted file is listed and nothing else is',
    onDisk.every((n) => listed.has(n)) && listed.size === onDisk.length);
  check('generatedAt appears in the manifest and in no other file',
    files.filter((f) => text(f).includes('2026-08-03T00:00:00Z')).map((f) => f.name).join(',') === 'manifest.json');
  check('receipt folders carry the receipt bundle files verbatim',
    ['receipt.json', 'signature.txt', 'publickey.txt', 'tsa_primary.tsr', 'tsa_secondary.tsr', 'baseline-bundle.reqpub.json', 'VERIFY.txt']
      .every((n) => listed.has('receipts/' + 'ef'.repeat(4) + '/' + n)));
}

/* Grace: a record with nothing in it still builds a truthful pack. */
{
  const g = gather();
  g.chronology = []; g.versions = []; g.signatures = []; g.receipts = []; g.attachments = []; g.keys = [];
  g.chain = { ok: true, head_seq: -1, head_hash: '', unchained: 0 };
  const { files } = await buildEvidencePack(g, { generatedAt: '2026-08-03T00:00:00Z' });
  check('an empty record builds the eight base files and nothing more',
    files.length === 9 && files.some((f) => f.name === 'manifest.json'));
  const ev = parseCsvStrict(text(files.find((f) => f.name === 'evidence.csv')));
  check('empty evidence.csv is a lone header row', ev.length === 1);
}

console.log(`evidence pack: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
