/* ReqPub v2 - chain recipe doc gate (node tests/chain-recipe.test.mjs)
   The documented recipe and its worked example are recomputed here from
   scratch on node builtins. If VERIFY.md section 8 and this math ever
   disagree, the build fails before anything ships. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const h = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const doc = readFileSync(new URL('../docs/VERIFY.md', import.meta.url), 'utf8');
let n = 0; const test = (name, fn) => { fn(); n++; console.log('  \u2713 ' + name); };

test('section 8 exists and freezes the eleven-field order with U+001F', () => {
  assert.ok(doc.includes('## 8. The activity chain'));
  assert.ok(doc.includes('U+001F'));
  for (const f of ['id (as decimal text)', 'org_id', 'actor_name', 'entity_kind', 'jsonb::text', 'HH24:MI:SS.US']) assert.ok(doc.includes(f), f);
});
test('the worked example recomputes exactly on node builtins', () => {
  const US = String.fromCharCode(31);
  const genesis = h('REQPUB-GENESIS:example');
  const entry = h(['7', '0b0e7d02-0000-0000-0000-00000000aa11', 'example', '', 'system', 'chain.genesis', 'chain', 'example', 'The chain begins at this event.', '{}', '2026-08-01T12:00:00.000000Z'].join(US));
  const link = h(genesis + entry);
  assert.ok(doc.includes(genesis) && doc.includes(entry) && doc.includes(link), 'doc constants match recomputation');
});
test('the doc states the scope limit and the genesis honesty position', () => {
  assert.ok(doc.includes('does not change what any\nsingle baseline fingerprint proves') || doc.includes('does not change what any single baseline fingerprint proves'));
  assert.ok(doc.includes('per-version fingerprints'));
});
console.log('\nchain-recipe.test: ' + n + '/' + n + ' passed');
