#!/usr/bin/env node
/* Record what the suites actually prove, so a published figure can be checked
 * against it rather than trusted.
 *
 * The homepage carried "385 automated checks, 231 of them against a real
 * Postgres database" for thirty-four releases after both numbers stopped being
 * true. Nobody lied; nobody looked. A number on a public page is a claim, and
 * a claim needs a source.
 *
 * This runs both chains, reads each suite's own summary line, and writes
 * tests/COUNTS.json. The claims gate reads that file, compares it to the
 * figures on the site, and fails the build when they disagree. It also fails
 * when this file is older than the newest test, because a stale count is
 * exactly as misleading as a wrong one.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/* One hash over every suite file, name and bytes, so the record can say which
   tests produced it. */
export function testsHash() {
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
  return h.digest('hex').slice(0, 16);
}


/* Suites report in two house formats: "name: N passed, M failed" and
   "name: N/M passed". Both are read here rather than imposing one on 73
   existing files. */
function runChain(script) {
  let out = '', ok = true;
  try {
    out = execSync('npm run ' + script + ' --silent', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    ok = false;
  }
  /* The suite output is echoed so a failure is readable in the build log, and
     a failing chain is fatal here. Recording a count from a chain that did not
     finish is how a green build came to publish 415 checks when the suites
     prove 1,392: the script warned, exited zero, and the next gate compared the
     site against a number nobody had earned. */
  process.stdout.write(out);
  if (!ok) {
    console.error(`\nrecord-counts: the ${script} chain did not pass; refusing to record a count from an unfinished run`);
    process.exit(1);
  }
  let total = 0, suites = 0, failed = 0;
  for (const line of out.split('\n')) {
    let m = /(\d+) passed,\s*(\d+) failed/.exec(line);
    if (m) { total += Number(m[1]); failed += Number(m[2]); suites++; continue; }
    m = /:\s*(\d+)\/(\d+) passed/.exec(line);
    if (m) { total += Number(m[1]); failed += Number(m[2]) - Number(m[1]); suites++; }
  }
  return { total, suites, failed };
}

const script = process.argv.includes('--which') ? process.argv[process.argv.indexOf('--which') + 1] : null;
const unit = (!script || script === 'test') ? runChain('test') : null;
const backend = (!script || script === 'test:backend') ? runChain('test:backend') : null;

const prev = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'tests/COUNTS.json'), 'utf8')); } catch { return {}; } })();
const counts = {
  generated: 'by scripts/record-counts.mjs; do not edit by hand',
  format: 'reqpub-check-counts',
  formatVersion: 1,
  version: pkg.version,
  recordedAt: new Date().toISOString(),
  unit: unit ? unit.total : prev.unit || 0,
  unitSuites: unit ? unit.suites : prev.unitSuites || 0,
  backend: backend ? backend.total : prev.backend || 0,
  backendSuites: backend ? backend.suites : prev.backendSuites || 0,
  failed: (unit ? unit.failed : 0) + (backend ? backend.failed : 0),
};
counts.total = counts.unit + counts.backend;
counts.testsHash = testsHash();

writeFileSync(join(ROOT, 'tests/COUNTS.json'), JSON.stringify(counts, null, 2) + '\n');
console.log(`recorded: ${counts.total} checks (${counts.unit} unit across ${counts.unitSuites} suites, ` +
  `${counts.backend} backend across ${counts.backendSuites} suites) at v${counts.version}` +
  (counts.failed ? `, WITH ${counts.failed} FAILING` : ''));

/* Staleness is checked by content, not by modification time. A git checkout
   stamps every file with the checkout time, so an mtime comparison reports
   every file as newer than every record and fails on any clean runner. The
   hash of the suites is the honest question: are these the tests that produced
   these numbers. */
console.log('suites hash: ' + counts.testsHash);
