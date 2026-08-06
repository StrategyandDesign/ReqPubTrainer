/* Guards the fix for replies doubling in a thread. When a team member sends a
   reply, the realtime echo of the insert and the awaited optimistic push can
   land in EITHER order (the websocket echo often beats the HTTP response). Both
   go through pushUnique, so the message must appear exactly once regardless of
   order. Run: node tests/msgdedup.test.mjs */
import { pushUnique } from '../app/js/core.js';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };

const msg = { id: 'm1', body: 'Where does this land?', author_kind: 'team' };

// 1) Optimistic push first, then the realtime echo (HTTP won the race).
{
  const list = [];
  pushUnique(list, msg);          // optimistic
  pushUnique(list, { ...msg });   // realtime echo (same id, different object)
  check('optimistic-then-realtime yields one message', list.length === 1, list.length);
}

// 2) Realtime echo first, then the optimistic push (websocket won the race).
{
  const list = [];
  pushUnique(list, { ...msg });   // realtime echo
  pushUnique(list, msg);          // optimistic
  check('realtime-then-optimistic yields one message', list.length === 1, list.length);
}

// 3) Distinct messages still both land (dedup is by id, not by content).
{
  const list = [];
  pushUnique(list, { id: 'm1', body: 'same text' });
  pushUnique(list, { id: 'm2', body: 'same text' });
  check('two different ids with identical text both appear', list.length === 2, list.length);
}

// 4) A record without an id is ignored (never renders a broken/blank row).
{
  const list = [];
  pushUnique(list, undefined);
  pushUnique(list, null);
  pushUnique(list, { body: 'no id' });
  check('items with no id are dropped, not pushed', list.length === 0, list);
}

// 5) Idempotent under repeated echoes (a resubscribe can replay recent events).
{
  const list = [];
  for (let i = 0; i < 5; i++) pushUnique(list, { ...msg });
  check('repeated echoes of one id stay single', list.length === 1, list.length);
}

console.log(`\nmsgdedup.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
