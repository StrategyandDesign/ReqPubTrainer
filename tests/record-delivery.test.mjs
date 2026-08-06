/* ReqPub v2 - the Record of Delivery and the receivers
   (node tests/record-delivery.test.mjs)
   Pins v2.57: the close document's authored and cryptographic content, its
   empty states, a gapped diff, the practice watermark, and the leak grep; the
   close package's single manifest and its hashes; and the receiver reference
   implementations against real Ed25519, including tamper, skew, unknown key,
   and duplicate. */
globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const { buildRecordOfDelivery, buildClosePackage, tsaLine, NOTHING_ASSERTED } = await import('../app/js/recordofdelivery.js');
const { receiveDelivery, memoryStore } = await import('../templates/receivers/node-receiver.mjs');
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };
const doc = (f) => readFileSync(fileURLToPath(new URL('../docs/' + f, import.meta.url)), 'utf8');
const tpl = (f) => readFileSync(fileURLToPath(new URL('../templates/receivers/' + f, import.meta.url)), 'utf8');

/* ---- a full record ---- */
const full = {
  project: { id: 'p1', name: 'Riverbend rollout' },
  answers: {
    ctrl_objective: 'Stand up a working acceptance record for the Riverbend rollout.',
    metrics: [{ metric: 'Submissions posted within one shift', target: 'at least 95%' }],
    eval: [{ dim: 'Hallucination guardrail', metric: 'grounded-answer rate, manual review',
             thresh: 'at least 95%', dataset: 'acceptance-set v3 \u00b7 100 cases', exec: 'Human' }],
  },
  versions: [
    { id: 'v1', seq: 1, label: '1.0', status: 'approved', author_name: 'Micah', created_at: '2026-06-01T10:00:00Z',
      fingerprint: 'ab'.repeat(32),
      snapshot: { answers: { fr: [{ _k: 1, stmt: 'The form captures name', fit: 'unit test', pri: 'Must' }] } } },
    { id: 'v2', seq: 2, label: '1.1', status: 'approved', author_name: 'Micah', created_at: '2026-07-01T10:00:00Z',
      fingerprint: 'cd'.repeat(32),
      snapshot: { answers: { fr: [{ _k: 1, stmt: 'The form captures name and site', fit: 'unit test', pri: 'Must' }] } } },
  ],
  signatures: [{ id: 's1', status: 'signed', revoked: false, signed_name: 'Kate Quill', signer_role: 'Sponsor',
                 signed_at: '2026-07-02T09:00:00Z', version_label: '1.1' }],
  receipts: [{ sign_request_id: 's1', canonical_hash: 'ef'.repeat(32), tsa_status: 'dual' }],
  lineage: { projectId: 'p_pursuit', seq: 2, fingerprint: '12'.repeat(32) },
  practice: false,
  brand: { brandLabel: 'Riverbend Co' },
};
const html = buildRecordOfDelivery(full);

check('the objective appears as authored', html.includes('Stand up a working acceptance record'));
check('success metrics appear with their targets', html.includes('Submissions posted within one shift') && html.includes('at least 95%'));
check('the baseline sequence carries labels, statuses, authors, and dates',
  html.includes('>1.0<') && html.includes('>1.1<') && html.includes('approved') && html.includes('Micah') && html.includes('2026'));
check('the change between approved baselines reports the changed column',
  html.includes('1.0 to 1.1') && html.includes('FR-001') && html.includes('statement changed'));
check('the thresholds table carries the named eval set and executed-by',
  html.includes('acceptance-set v3') && html.includes('Hallucination guardrail') && html.includes('Human'));
check('the signature states the seal in VERIFY language, with the hash prefix',
  html.includes('Kate Quill') && html.includes('timestamped by two independent authorities') && html.includes('efefefefefef'));
check('the receipt hash is a prefix, never the whole value', !html.includes('ef'.repeat(32)));
check('the Born from citation renders where lineage exists',
  html.includes('Born from p_pursuit baseline 2') && html.includes('121212121212'));
check('verification instructions point at the published recipe and the offline checker',
  html.includes('docs/SPEC.md') && html.includes('docs/VERIFY.md') && html.includes('without an account') === false && html.includes('requires an account'));
check('the closing line states that nothing is asserted', html.includes(NOTHING_ASSERTED));
check('the document computes no status, score, health, or progress',
  !/\b\d+%\s*complete/i.test(html) && !/health/i.test(html) && !/on track|at risk|behind schedule/i.test(html));
check('determinism: two builds of one record are byte-identical', buildRecordOfDelivery(full) === html);

/* ---- the seal language ---- */
check('every timestamp status has words that claim exactly what happened',
  tsaLine('dual').includes('two independent') && tsaLine('primary').includes('one authority')
  && tsaLine('none').includes('no timestamp authority responded') && tsaLine(undefined).includes('no timestamp'));

/* ---- empty states ---- */
{
  const bare = buildRecordOfDelivery({ project: { id: 'p2', name: 'Bare' } });
  check('an empty record says what is missing instead of implying success',
    bare.includes('states no objective') && bare.includes('states no success metrics')
    && bare.includes('No baseline was generated') && bare.includes('No signature was captured')
    && bare.includes('states no evaluation thresholds'));
  check('with no approved baseline it says there is nothing to compare',
    bare.includes('nothing to compare'));
  const one = buildRecordOfDelivery({ ...full, versions: [full.versions[0]], signatures: [], receipts: [] });
  check('with one approved baseline it says there is no prior to compare against',
    one.includes('no prior approved baseline'));
  check('no lineage renders no citation line', !bare.includes('Born from'));
  const unsealed = buildRecordOfDelivery({ ...full, receipts: [] });
  check('a signature without a receipt says not sealed rather than implying one',
    unsealed.includes('not sealed') && !unsealed.includes('two independent'));
}

/* ---- a gapped diff: a requirement added and one removed ---- */
{
  const gapped = buildRecordOfDelivery({ ...full, versions: [
    { ...full.versions[0], snapshot: { answers: { fr: [{ _k: 1, stmt: 'A', fit: 'f' }, { _k: 2, stmt: 'B', fit: 'f' }] } } },
    { ...full.versions[1], snapshot: { answers: { fr: [{ _k: 1, stmt: 'A', fit: 'f' }, { _k: 3, stmt: 'C', fit: 'f' }] } } },
  ] });
  check('a gapped diff reports only requirements present in both, exactly as reqDiffDetail does',
    gapped.includes('No requirement changed between these baselines'));
}

/* ---- practice and leaks ---- */
{
  const pr = buildRecordOfDelivery({ ...full, practice: true });
  check('a practice record watermarks its close document', pr.includes('PRACTICE RECORD'));
  check('an evidence record carries no watermark', !html.includes('PRACTICE RECORD'));
  check('no token and no email address reaches the document',
    !html.includes('rqp_') && !html.includes('TOK_') && !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(html));
}

/* ---- the close package ---- */
{
  const gather = { project: { id: 'p1', name: 'Riverbend rollout' }, chronology: [], versions: [], signatures: [], receipts: [], attachments: [], keys: [] };
  const a = await buildClosePackage({ gather, rod: html, product: 'Riverbend rollout', generatedAt: '2026-08-05T00:00:00Z' });
  const names = a.files.map((f) => f.name);
  check('the package leads with the Record of Delivery', names[0] === 'record-of-delivery.html');
  check('the evidence pack contents are flattened in beside it',
    names.includes('README.txt') && names.includes('evidence.csv') && names.includes('cover.html'));
  check('exactly one manifest describes the archive',
    names.filter((n) => n === 'manifest.json').length === 1 && names[names.length - 1] === 'manifest.json');
  const man = JSON.parse(a.files[a.files.length - 1].data);
  check('the manifest names the close format and hashes every other file',
    man.format === 'reqpub-close-package-manifest' && man.files.length === a.files.length - 1
    && man.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  const b = await buildClosePackage({ gather, rod: html, product: 'Riverbend rollout', generatedAt: '2026-08-05T00:00:00Z' });
  check('the package is deterministic for one moment',
    a.files.every((f, i) => String(f.data) === String(b.files[i].data)));
}

/* ---- the receivers, against real Ed25519 ---- */
{
  const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', kp.publicKey)).toString('base64');
  const keysFor = async (kid) => (kid === 'whk-1' ? { kid, publicKeySpkiBase64: spki } : null);
  const now = 1786000000000;
  const body = JSON.stringify({ event: 'acceptance.sealed', deliveryId: 'd-1', projectId: 'p1', docFingerprint: 'ab'.repeat(32) });
  const sign = async (ts, raw) => Buffer.from(await webcrypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey,
    new TextEncoder().encode(ts + '.' + raw))).toString('base64');
  const ts = String(Math.floor(now / 1000));
  const headers = { 'x-reqpub-key-id': 'whk-1', 'x-reqpub-timestamp': ts, 'x-reqpub-signature': await sign(ts, body) };
  const store = memoryStore();

  const good = await receiveDelivery({ headers, rawBody: body, store, keysFor, now });
  check('a valid delivery is accepted and its payload handed over',
    good.ok === true && good.event === 'acceptance.sealed' && good.payload.deliveryId === 'd-1', good.reason);
  const dupe = await receiveDelivery({ headers, rawBody: body, store, keysFor, now });
  check('the same deliveryId a second time is refused as a duplicate', dupe.ok === false && dupe.reason === 'duplicate', dupe.reason);

  const tampered = body.replace('"p1"', '"p2"');
  const t = await receiveDelivery({ headers, rawBody: tampered, store: memoryStore(), keysFor, now });
  check('one altered byte is refused as a bad signature', t.ok === false && t.reason === 'bad_signature', t.reason);

  const old = await receiveDelivery({ headers, rawBody: body, store: memoryStore(), keysFor, now: now + 400000 });
  check('a timestamp outside the window is refused before anything is parsed',
    old.ok === false && old.reason === 'stale_timestamp', old.reason);

  const unknown = await receiveDelivery({ headers: { ...headers, 'x-reqpub-key-id': 'whk-9' }, rawBody: body, store: memoryStore(), keysFor, now });
  check('an unknown key is refused rather than falling back to another', unknown.ok === false && unknown.reason === 'unknown_key', unknown.reason);

  const noJson = await receiveDelivery({ headers: { ...headers, 'x-reqpub-signature': await sign(ts, 'not json') }, rawBody: 'not json', store: memoryStore(), keysFor, now });
  check('a validly signed body that is not JSON is refused after the signature passes',
    noJson.ok === false && noJson.reason === 'bad_json', noJson.reason);
}

/* ---- vendor neutrality and doc completeness ---- */
{
  const rec = doc('RECEIVERS.md');
  const all = rec + tpl('node-receiver.mjs') + tpl('serverless-handler.mjs');
  const named = ['stripe', 'salesforce', 'netsuite', 'quickbooks', 'jira', 'servicenow', 'aws', 'azure',
    'vercel', 'cloudflare', 'lambda', 'workers', 'zapier', 'slack', 'hubspot', 'sap', 'oracle', 'deloitte', 'kearney', 'accenture'];
  check('no product, platform, or firm is named anywhere in the receivers directory or doc',
    !named.some((n) => new RegExp('\\b' + n + '\\b', 'i').test(all)),
    named.filter((n) => new RegExp('\\b' + n + '\\b', 'i').test(all)));
  check('the mapping table is normative and covers every payload field',
    ['event', 'deliveryId', 'occurredAt', 'projectId', 'versionLabel', 'seq', 'signRequestId',
     'docFingerprint', 'chainHead.seq', 'chainHead.linkHash', 'signerName', 'signerRole', 'receiptId']
      .every((f) => rec.includes('| ' + f + ' |')));
  check('the doc states the idempotency rule, the ladder, and the checklist',
    rec.includes('at-least-once') && rec.includes('twelve hours') && rec.includes('12 hours')
    && rec.includes('MUST NOT') && rec.includes('Security checklist'));
  check('the verification order is stated as an order, parse after verify',
    rec.indexOf('Verify the signature over the exact raw bytes') < rec.indexOf('Parse the JSON only after'));
  check('both references use platform builtins only: no dependency imports',
    !/from ['"][a-z@][^'"]*['"]/.test(tpl('serverless-handler.mjs'))
    && !/from ['"](?!node:)[a-z@][^'"]*['"]/.test(tpl('node-receiver.mjs')));
}

console.log(`record of delivery + receivers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
