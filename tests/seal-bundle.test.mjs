/* ReqPub v2 - seal bundle drift gate (node tests/seal-bundle.test.mjs)
   The single-file dashboard paste must equal a fresh regeneration from the
   three sources, contain no local imports, and keep exactly one server. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
let n = 0; const test = (name, fn) => { fn(); n++; console.log('  \u2713 ' + name); };
const p = 'supabase/functions/seal-receipt/dist/index.ts';
const before = readFileSync(p, 'utf8');
execSync('node scripts/bundle-seal-function.mjs', { stdio: 'ignore' });
const after = readFileSync(p, 'utf8');
test('the committed paste equals a fresh regeneration, no drift', () => assert.equal(before, after));
test('no local module imports survive in the paste', () => {
  assert.ok(!after.includes("from './seallib") && !after.includes("from './core") && !after.includes('import("./seallib'));
});
test('one server, the esm.sh client import intact, health mode present', () => {
  assert.equal(after.split('Deno.serve').length - 1, 1);
  assert.ok(after.includes('esm.sh/@supabase/supabase-js'));
  assert.ok(after.includes('body.health === true'));
});
console.log('\nseal-bundle.test: ' + n + '/' + n + ' passed');
