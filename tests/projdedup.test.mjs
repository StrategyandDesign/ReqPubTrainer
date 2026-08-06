/* ReqPub v2 - project-list reconciliation (node tests/projdedup.test.mjs)
   Locks the fix for the 2026-07-13 duplicate-project incident: the optimistic
   local insert and its org-channel realtime echo land in the SAME array (the
   engine state is APP), in either order. Both paths now flow through one pure
   reconciler, so one database row can never render as two cards, and a
   duplicate-key on a retried insert reads as the success it is instead of
   provoking a second, real project. */
import assert from 'node:assert/strict';
import { upsertById, isDupKey } from '../app/js/core.js';
import { sync } from '../app/js/sync.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const proj = (id, t, extra) => ({ id, name: 'Next Best Project', archived: false, updated_at: t, ...extra });

test('echo first, local second: one entry, not two', () => {
  const list = [];
  upsertById(list, proj('p1', '2026-07-13T11:40:00Z'), 'updated_at');      // realtime echo
  upsertById(list, proj('p1', '2026-07-13T11:40:01Z'), 'updated_at');      // optimistic local
  assert.equal(list.length, 1);
});

test('local first, echo second: still one entry', () => {
  const list = [];
  upsertById(list, proj('p1', '2026-07-13T11:40:00Z'), 'updated_at');
  upsertById(list, proj('p1', '2026-07-13T11:40:02Z', { org_id: 'o1' }), 'updated_at');
  assert.equal(list.length, 1);
  assert.equal(list[0].org_id, 'o1', 'the echo record replaces in place');
});

test('an update echo re-sorts newest-first instead of duplicating', () => {
  const list = [proj('old', '2026-07-01T00:00:00Z'), proj('p1', '2026-07-10T00:00:00Z')];
  upsertById(list, proj('p1', '2026-07-13T11:41:00Z'), 'updated_at');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'p1');
});

test('an archived echo removes the entry', () => {
  const list = [proj('p1', '2026-07-13T11:40:00Z')];
  upsertById(list, proj('p1', '2026-07-13T11:42:00Z', { archived: true }), 'updated_at');
  assert.equal(list.length, 0);
});

test('a record without an id is ignored, never unshifted as undefined', () => {
  const list = [proj('p1', '2026-07-13T11:40:00Z')];
  upsertById(list, { name: 'ghost' }, 'updated_at');
  upsertById(list, null, 'updated_at');
  assert.equal(list.length, 1);
});

test('the engine org handler and the local write converge through the same reconciler', () => {
  const state = { projects: [] };
  sync.state = state;
  sync.onChange = () => {};
  // Local optimistic write lands first (the common case)...
  upsertById(state.projects, proj('p1', '2026-07-13T11:40:00Z'), 'updated_at');
  // ...then the production-shaped broadcast echo (record/old_record keys).
  sync.applyOrg({ event: 'INSERT', payload: { table: 'projects', operation: 'INSERT', record: proj('p1', '2026-07-13T11:40:01Z') } });
  assert.equal(state.projects.length, 1);
  // And the reverse order, echo before the awaited insert resolves.
  sync.applyOrg({ payload: { table: 'projects', operation: 'INSERT', record: proj('p2', '2026-07-13T11:43:00Z') } });
  upsertById(state.projects, proj('p2', '2026-07-13T11:43:01Z'), 'updated_at');
  assert.equal(state.projects.length, 2);
});

test('a delete broadcast removes by old_record id', () => {
  const state = { projects: [proj('p1', '2026-07-13T11:40:00Z')] };
  sync.state = state;
  sync.onChange = () => {};
  sync.applyOrg({ event: 'DELETE', payload: { table: 'projects', operation: 'DELETE', old_record: { id: 'p1' } } });
  assert.equal(state.projects.length, 0);
});

test('a retried insert that trips the primary key reads as success', () => {
  assert.equal(isDupKey({ code: '23505' }), true);
  assert.equal(isDupKey({ message: 'duplicate key value violates unique constraint "projects_pkey"' }), true);
  assert.equal(isDupKey({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isDupKey(null), false);
});

console.log('\nprojdedup.test: ' + n + '/' + n + ' passed');
