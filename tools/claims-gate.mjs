#!/usr/bin/env node
/* ReqPub C9 - the claims audit, as a gate rather than a review.
 *
 * Every sentence ReqPub publishes about itself is checked here against the
 * thing it describes. A claim survives only if the artifact it names exists in
 * the repository and the property it asserts is demonstrated by a test whose
 * name is recorded beside it. A claim that cannot be tied to both is a claim
 * that has to be edited.
 *
 * Four classes of check:
 *
 *   BANNED     Words the positioning doctrine forbids anywhere in published
 *              copy, because they promise more than cryptography can deliver:
 *              guarantee, tamper-proof, unhackable, complete security. The
 *              word ReqPub uses is tamper-evident.
 *   CLAIM      A specific published claim, the file it appears in, the
 *              artifact that must exist for it to be true, and the test that
 *              demonstrates it.
 *   NOMODEL    The no-AI statements, checked against a grep proving the
 *              application makes zero model API calls.
 *   LINK       Every published path must resolve inside the repository.
 *
 * Run with --json for the machine-readable table used by the vendor pack.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return null; } };
const has = (p) => existsSync(join(ROOT, p));

/* Published surfaces: everything a reader can see. */
/* The public site. Four stale claims survived here for months because this
   gate only read documentation: the verify page said sealing was "coming
   soon" nine releases after it shipped, and a roadmap block promised
   e-signature and sealing directly above the sentence "we publish what's
   live, not what's planned". A claim on the site is a claim. */
const SITE = ['index.html', 'landing.html', 'verify.html', 'signup.html', 'receipt-verify.html'];

/* Words that promise a future. Each is checked against what has actually
   shipped, because the expensive failure is not promising something, it is
   promising something you already delivered and never came back to update. */
const FUTURE = ['coming soon', 'will soon', 'on the roadmap', 'in a future release',
  'planned for', 'shipping soon', 'in beta', 'early access'];
const SHIPPED = ['e-signature', 'esignature', 'cryptographic sealing', 'sealing', 'evidence pack',
  'webhook', 'mcp', 'record of delivery', 'practice record', 'lineage', 'chain'];

const PUBLISHED = [
  'docs/POSITIONING.md', 'docs/VERIFY.md', 'docs/SPEC.md', 'docs/MCP.md',
  'docs/WEBHOOKS.md', 'docs/RECEIVERS.md', 'docs/ARCHITECTURE.md', 'docs/AUDIT.md',
  'docs/ATTACHMENTS.md', 'app/js/capabilities.js', 'CHANGELOG.md', 'README.md',
];

const BANNED = [
  ['tamper-proof', 'tamper-evident is the word: evidence of tampering, not prevention of it'],
  ['tamper proof', 'tamper-evident is the word'],
  ['unhackable', 'no system is unhackable and no buyer believes the word'],
  ['complete security', 'security is never complete; state the specific control'],
  ['100% secure', 'state the control, not a number'],
  ['military-grade', 'a marketing phrase with no technical meaning'],
  ['bank-grade', 'a marketing phrase with no technical meaning'],
  ['unbreakable', 'no cryptography is unbreakable, only currently infeasible to break'],
  ['fully compliant', 'compliance is a scope and a date, not a state'],
  ['ai-powered', 'ReqPub calls no model; the phrase would be false'],
];
/* "guarantee" is banned as a promise to a buyer, not as a description of what
   a mechanism does. "The provenance trigger guarantees the actor is the
   signer" is an engineering statement and stays; "ReqPub guarantees your data
   is secure" is a promise and goes. The distinction is the subject of the
   sentence, so the check looks for promise shapes on buyer-facing surfaces
   only. */
const BUYER_FACING = ['docs/POSITIONING.md', 'app/js/capabilities.js', 'README.md'];
const GUARANTEE_PROMISE = /\b(we|reqpub|the platform)\s+(\w+\s+){0,2}guarantee/i;

/* Each claim names the artifact that must exist and the test that proves it. */
const CLAIMS = [
  { claim: 'Published open recipes: the fingerprint recipe is served and normative',
    where: 'docs/VERIFY.md', artifacts: ['docs/VERIFY.md', 'docs/SPEC.md', 'schemas/reqpub-baseline-bundle.schema.json'],
    proof: 'tests/spec-schemas.test.mjs validates live builder output against the served schemas' },
  { claim: 'Verifiable offline, without an account and without ReqPub',
    where: 'docs/VERIFY.md', artifacts: ['tools/reqpub-verify.mjs', 'docs/VERIFY.md'],
    proof: 'tests/evidence-cli.test.mjs verifies a pack on disk with real Ed25519, and rejects a byte flip' },
  { claim: 'Agents propose, humans accept',
    where: 'docs/MCP.md', artifacts: ['supabase/functions/mcp/index.ts', 'supabase/migrations/0024_mcp.sql'],
    proof: 'tests/mcp-fuzz.test.mjs proves propose is refused with the gate off and writes nothing' },
  { claim: 'Every baseline is fingerprinted and immutable',
    where: 'app/js/capabilities.js', artifacts: ['app/js/verifybundle.js'],
    proof: 'tests/backend-e2e/version-integrity.test.mjs' },
  { claim: 'Receipts are sealed with Ed25519 and dual RFC 3161 timestamps',
    where: 'app/js/capabilities.js', artifacts: ['supabase/functions/seal-receipt/seallib.mjs', 'reqpub-keys.json'],
    proof: 'tests/backend-e2e/sealing.test.mjs and tests/seal-fixture.test.mjs' },
  { claim: 'Signed webhooks with replay windows and dedupe',
    where: 'docs/WEBHOOKS.md', artifacts: ['templates/receivers/node-receiver.mjs', 'docs/RECEIVERS.md'],
    proof: 'tests/record-delivery.test.mjs verifies against real Ed25519 including tamper, skew, and duplicate' },
  { claim: 'Row-level security with RPC-only writes',
    where: 'docs/ARCHITECTURE.md', artifacts: ['supabase/schema.sql', 'docs/security/AUTHZ_MATRIX.md'],
    proof: 'tests/backend-e2e/authz-matrix.test.mjs pins the reachable surface to a committed allowlist' },
  { claim: 'Insert-only trails',
    where: 'docs/ARCHITECTURE.md', artifacts: ['supabase/schema.sql'],
    proof: 'tests/backend-e2e/chain.test.mjs' },
  { claim: 'A practice record is never evidence',
    where: 'app/js/capabilities.js', artifacts: ['supabase/migrations/0026_book_practice.sql'],
    proof: 'tests/backend-e2e/book-practice.test.mjs proves immutability, webhook silence, and Book exclusion' },
  { claim: 'A lineage is a citation, not a pipeline',
    where: 'app/js/capabilities.js', artifacts: ['supabase/migrations/0027_pursuit_lineage.sql'],
    proof: 'tests/backend-e2e/pursuit-lineage.test.mjs proves set-once and survival of the cited record\u2019s deletion' },
];

/* The application must call no model API. This is the grep behind the claim. */
const MODEL_PATTERNS = [
  /api\.openai\.com/i, /api\.anthropic\.com/i, /generativelanguage\.googleapis/i,
  /\bopenai\b/i, /\banthropic\b/i, /\bclaude-\d/i, /\bgpt-[0-9]/i, /\bllm\b/i,
  /huggingface/i, /replicate\.com/i, /bedrock/i, /vertexai/i,
];
const APP_DIRS = ['app/js', 'supabase/functions', 'tools', 'scripts'];

function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];
const rows = [];

/* --- BANNED --- */
for (const f of PUBLISHED) {
  const text = read(f);
  if (!text) continue;
  const lower = text.toLowerCase();
  for (const [word, why] of BANNED) {
    if (lower.includes(word)) violations.push(`BANNED  ${f} contains "${word}" \u2014 ${why}`);
  }
  if (BUYER_FACING.includes(f)) {
    const m = GUARANTEE_PROMISE.exec(text);
    if (m) violations.push(`BANNED  ${f} promises a guarantee: "${m[0]}"`);
  }
}

/* --- CLAIM --- */
for (const c of CLAIMS) {
  const missingArtifacts = c.artifacts.filter((a) => !has(a));
  const proofFile = c.proof.split(' ')[0];
  const proofMissing = proofFile.includes('/') && !has(proofFile);
  if (missingArtifacts.length) violations.push(`CLAIM   "${c.claim}" names artifacts that do not exist: ${missingArtifacts.join(', ')}`);
  if (proofMissing) violations.push(`CLAIM   "${c.claim}" cites a test that does not exist: ${proofFile}`);
  rows.push({ claim: c.claim, where: c.where, ok: !missingArtifacts.length && !proofMissing, proof: c.proof });
}

/* --- NOMODEL --- */
const modelHits = [];
for (const dir of APP_DIRS) {
  for (const f of walk(dir)) {
    if (/capabilities\.js|claims-gate\.mjs/.test(f)) continue;   // the claim text itself
    const text = read(f) || '';
    for (const re of MODEL_PATTERNS) {
      const m = re.exec(text);
      if (m) modelHits.push(`${f}: ${m[0]}`);
    }
  }
}
if (modelHits.length) violations.push(`NOMODEL the no-AI claim is contradicted by: ${modelHits.slice(0, 5).join('; ')}`);

/* --- COUNT: a number published on the site must equal the number the
   repository can prove. The homepage carried "385 automated checks ... as of
   v2.23.2" thirty-four releases after it stopped being true, because no gate
   read it. A published figure is a claim. --- */
{
  const pkg = JSON.parse(read('package.json'));
  const site = read('index.html') || '';
  const visible = site.replace(/<[^>]+>/g, ' ');

  /* The version stamp on the site must be the version in the repository. */
  const vm = /\bv(\d+\.\d+\.\d+)\b/.exec(visible);
  if (vm && vm[1] !== pkg.version) {
    violations.push(`COUNT   index.html states v${vm[1]} where package.json says ${pkg.version}`);
  }

  /* Suite counts are structural and cheap to derive: the number of suites in
     each chain. Check counts themselves are written by the suites at run time
     into tests/COUNTS.json, and the gate compares the site against that file
     when it exists rather than trusting a typed number. */
  const counts = existsSync(join(ROOT, 'tests/COUNTS.json'))
    ? JSON.parse(read('tests/COUNTS.json')) : null;
  const claimed = /([\d,]{3,7})\s+automated checks/.exec(visible);
  if (claimed && counts) {
    const stated = Number(claimed[1].replace(/,/g, ''));
    const truth = (counts.unit || 0) + (counts.backend || 0);
    if (stated !== truth) {
      violations.push(`COUNT   index.html claims ${stated} automated checks; the suites recorded ${truth} in tests/COUNTS.json`);
    }
  }
  /* F1: the README rotted because no gate read it. Any figure adjacent to
     "checks" or "suites" must equal the recorded value. */
  if (counts) {
    const rm = read('README.md') || '';
    const pairs = [
      [/([\d,]{2,7})\s+checks across ([\d,]{1,4})\s+suites,\s*node only/, 'unit', 'unitSuites'],
      [/([\d,]{2,7})\s+checks across ([\d,]{1,4})\s+suites on an embedded/, 'backend', 'backendSuites'],
    ];
    for (const [re, nKey, sKey] of pairs) {
      const m = re.exec(rm);
      if (!m) continue;
      const n = Number(m[1].replace(/,/g, '')), sc = Number(m[2].replace(/,/g, ''));
      if (n !== counts[nKey]) violations.push(`COUNT   README.md claims ${n} ${nKey} checks; the suites recorded ${counts[nKey]}`);
      if (sc !== counts[sKey]) violations.push(`COUNT   README.md claims ${sc} ${nKey} suites; the suites recorded ${counts[sKey]}`);
    }
  }
  const backendClaim = /([\d,]{3,7})\s+of them against a real Postgres/.exec(visible);
  if (backendClaim && counts) {
    const stated = Number(backendClaim[1].replace(/,/g, ''));
    if (stated !== (counts.backend || 0)) {
      violations.push(`COUNT   index.html claims ${stated} backend checks; the suites recorded ${counts.backend} in tests/COUNTS.json`);
    }
  }
  if (!counts) {
    violations.push('COUNT   tests/COUNTS.json is absent; run npm run counts so the published figures can be checked');
  } else {
    /* Staleness is checked by content. An mtime comparison fails on every
       clean runner, because a checkout stamps all files with the checkout
       time, so the gate would have blocked every CI build while passing
       locally: the worst possible arrangement. */
    const dirs = ['tests', 'tests/backend-e2e'];
    const h = createHash('sha256');
    for (const d of dirs) {
      const abs = join(ROOT, d);
      if (!existsSync(abs)) continue;
      for (const f of readdirSync(abs).filter((x) => x.endsWith('.mjs')).sort()) {
        h.update(d + '/' + f);
        h.update(readFileSync(join(abs, f)));
      }
    }
    const now = h.digest('hex').slice(0, 16);
    if (counts.testsHash && counts.testsHash !== now) {
      violations.push(`COUNT   tests/COUNTS.json was recorded against a different set of suites (${counts.testsHash} against ${now}); run npm run counts`);
    }
    if (counts.version !== JSON.parse(read('package.json')).version) {
      violations.push(`COUNT   tests/COUNTS.json was recorded at v${counts.version}, the repository is at v${JSON.parse(read('package.json')).version}`);
    }
  }
}

/* --- SITE: a future promise must not name a shipped capability --- */
for (const f of SITE) {
  const text = read(f);
  if (!text) continue;
  const visible = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const low = visible.toLowerCase();
  for (const [word, why] of BANNED) {
    if (low.includes(word)) violations.push(`BANNED  ${f} contains "${word}" \u2014 ${why}`);
  }
  for (const phrase of FUTURE) {
    let i = -1;
    while ((i = low.indexOf(phrase, i + 1)) !== -1) {
      const window = low.slice(Math.max(0, i - 160), i + 220);
      const named = SHIPPED.filter((cap) => window.includes(cap));
      if (named.length) {
        violations.push(`STALE   ${f} says "${phrase}" near a capability that already shipped: ${named.join(', ')}`);
      }
    }
  }
}

/* --- PRICE: a figure on the site must exist in the pricing source of truth.
   Publishing a price binds the company commercially, so the number a visitor
   reads and the number the company decided are held to be the same file. --- */
{
  const pricing = read('docs/PRICING.md');
  if (!pricing) {
    violations.push('PRICE   docs/PRICING.md is missing; a published price needs a source of truth');
  } else {
    for (const f of SITE) {
      const text = read(f);
      if (!text) continue;
      const visible = text.replace(/<[^>]+>/g, ' ');
      const figures = [...visible.matchAll(/\$[\d,]{3,12}/g)].map((m) => m[0]);
      for (const fig of new Set(figures)) {
        if (!pricing.includes(fig)) {
          violations.push(`PRICE   ${f} publishes ${fig}, which does not appear in docs/PRICING.md`);
        }
      }
    }
  }
}

/* --- SERVED: every https://reqpub.com/... path a document tells a reader to
   fetch must exist as a file in the repository at the path it will be served
   from. reqpub-keys.json was named by thirteen files, required by the shipped
   webhook receivers, and step three of the offline verification walkthrough,
   and it was never committed. It returned 404 in production while this gate
   reported success, because the gate checked the working tree instead of the
   thing a stranger would actually request. --- */
{
  const sources = [...PUBLISHED, ...SITE, 'templates/receivers/node-receiver.mjs',
    'templates/receivers/serverless-handler.mjs', 'tools/reqpub-verify.mjs', 'SECURITY.md'];
  const wanted = new Set();
  for (const f of sources) {
    const text = read(f);
    if (!text) continue;
    for (const m of text.matchAll(/https:\/\/reqpub\.com\/([A-Za-z0-9._\/-]+)/g)) {
      const path = m[1].replace(/[.,)`'"]+$/, '');
      if (path && !path.startsWith('app/') && !path.includes('#')) wanted.add(path);
    }
  }
  for (const path of wanted) {
    if (!has(path)) {
      violations.push(`SERVED  documents tell a reader to fetch https://reqpub.com/${path}, which is not a file in this repository`);
    }
  }
}

/* --- LINK --- */
const linkRe = /(?:^|[\s(`])((?:docs|schemas|tools|templates|app|supabase)\/[A-Za-z0-9._\/-]+\.[A-Za-z0-9]+)/g;
const seen = new Set();
// The changelog is a historical record: an entry describes the repository as
// it stood at that release, and a file renamed or absorbed later does not make
// the entry false. Link checking therefore covers current documentation only.
const LINK_SURFACES = PUBLISHED.filter((f) => f !== 'CHANGELOG.md');
for (const f of LINK_SURFACES) {
  const text = read(f);
  if (!text) continue;
  let m;
  while ((m = linkRe.exec(text)) !== null) {
    const path = m[1].replace(/[.,)`]+$/, '');
    if (seen.has(path)) continue;
    seen.add(path);
    if (!has(path)) violations.push(`LINK    ${f} points at ${path}, which does not exist`);
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ claims: rows, violations, checkedFiles: PUBLISHED.length, linksChecked: seen.size }, null, 2));
  process.exit(violations.length ? 1 : 0);
}

if (violations.length) {
  for (const v of violations) console.error('CLAIMS GATE  ' + v);
  console.error(`claims gate: ${violations.length} violation${violations.length === 1 ? '' : 's'}; a claim that cannot be tied to an artifact and a test has to be edited`);
  process.exit(1);
}
console.log(`claims gate: ${rows.length} published claims, each tied to an existing artifact and a named test; ` +
  `${seen.size} published paths resolve; no banned phrase in ${PUBLISHED.length + SITE.length} published surfaces and no stale promise on the site; ` +
  `the no-model claim holds by grep across ${APP_DIRS.length} source trees`);
