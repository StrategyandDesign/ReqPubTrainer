/* The homepage checks sentence is tied to its "as of vX.Y.Z" label.
   Three cases: the recorded count passes, an unknown label fails, a
   wrong count fails. */
import assert from 'node:assert/strict';
import { RELEASED_SITE_CHECKS, checkReleasedSiteCount } from '../tools/claims-gate.mjs';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const sentence = (count, version) => count + ' automated checks run on every change, 871 of them against a real Postgres database across 35 suites (as of ' + version + ').';

test('a sentence whose version and count match the map passes', () => {
  const version = 'v3.2.0';
  const count = RELEASED_SITE_CHECKS[version];
  assert.equal(count, 1486);
  assert.deepEqual(checkReleasedSiteCount(sentence('1,486', version)), []);
});

test('a version label with no map entry fails', () => {
  const found = checkReleasedSiteCount(sentence('1,486', 'v3.3.0'));
  assert.equal(found.length, 1);
  assert.match(found[0], /v3\.3\.0/);
  assert.match(found[0], /no entry/);
});

test('a count that is not the map entry for that version fails', () => {
  const found = checkReleasedSiteCount(sentence('1,494', 'v3.2.0'));
  assert.equal(found.length, 1);
  assert.match(found[0], /1494/);
  assert.match(found[0], /1486/);
  assert.match(found[0], /v3\.2\.0/);
});

console.log('\nreleased-site-count.test: ' + n + '/' + n + ' passed');
