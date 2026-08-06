/* ReqPub v2 - update archive tests (node tests/update-archive.test.mjs)
   The archive row's whole job is to answer "which link went to whom". The
   recipient therefore renders on its own line, in full weight, with no
   ellipsis and no nowrap anywhere near it, so a long name and a role pill
   can never be cut off by the action buttons. A link issued to nobody says
   so in the same position. */
import assert from 'node:assert/strict';

globalThis.location = { origin: 'https://reqpub.com', pathname: '/app/' };
const { renderUpdates } = await import('../app/js/views-collab.js');
const { qById } = await import('../app/js/domain.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const APP = (list) => ({
  role: 'manager', pid: 'apollo', upd: null, updRecipDraft: null,
  updatesList: list, versions: [], fields: {}, rows: {},
});

test('the recipient renders on its own full-width line with name in weight and the role pill', () => {
  const html = renderUpdates(APP([{
    id: 'u1', seq: 5, token: 'tok5', published_at: '2026-07-30T16:37:00Z',
    prepared_by: 'Micah Canfield', recipient_name: 'Jeremy Aldous Worthington-Smythe',
    recipient_role: 'Partner', revoked: false, payload: {},
  }]), {});
  assert.ok(html.includes('to <strong>Jeremy Aldous Worthington-Smythe</strong>'), 'the full name, never truncated');
  assert.ok(/pill[^>]*>Partner</.test(html), 'the role pill rides the recipient line');
  const row = html.split('no. 5')[1].split('</div>')[0] + html.split('no. 5')[1];
  assert.ok(!row.includes('text-overflow:ellipsis'), 'no ellipsis anywhere in the row');
  assert.ok(!row.includes('white-space:nowrap'), 'no nowrap anywhere in the row');
});

test('withdrawn updates fold into a record shelf under the live list', () => {
  const rows = [
    { id: 'u5', seq: 5, token: 't5', published_at: '2026-07-30T16:37:00Z', prepared_by: 'Micah Canfield', recipient_name: 'Jeremy', recipient_role: 'Partner', revoked: false, payload: {} },
    { id: 'u4', seq: 4, token: 't4', published_at: '2026-07-30T16:25:00Z', prepared_by: 'Micah Canfield', recipient_name: '', recipient_role: '', revoked: true, payload: {} },
    { id: 'u1', seq: 1, token: 't1', published_at: '2026-07-30T15:56:00Z', prepared_by: 'Micah Canfield', recipient_name: '', recipient_role: '', revoked: true, payload: {} },
  ];
  const folded = renderUpdates(APP(rows), {});
  assert.ok(folded.includes('Withdrawn updates'), 'the shelf bar renders');
  assert.ok(folded.includes('2 kept on the record'), 'with its count and its reason');
  assert.ok(!folded.includes('no. 4'), 'folded rows are off screen');
  assert.ok(folded.includes('to <strong>Jeremy</strong>'), 'the live row stays clean above it');
  const app = APP(rows); app.updWx = true;
  const open = renderUpdates(app, {});
  assert.ok(open.includes('no. 4') && open.includes('no. 1'), 'opening the shelf shows every withdrawn row');
  assert.ok(open.includes('issued to nobody') && open.includes('withdrawn'), 'each one states its history');
});


test('the composer offers the two authored boxes, prefilled, and the derived inputs are gone', () => {
  const app = APP([]);
  app.upd = { busy: false, draft: { window: { from: null, to: '2026-07-30' }, keyu: 'Crew formation shipped\nNorm run scheduled', keyq: 'Confirm the Aug 8 call' } };
  const html = renderUpdates(app, {});
  assert.ok(html.includes('id="updkeyu"') && html.includes('id="updkeyq"'), 'both boxes render');
  assert.ok(html.includes('Crew formation shipped') && html.includes('Confirm the Aug 8 call'), 'prefill lands');
  assert.ok(!html.includes('id="updnote"') && !html.includes('id="updnext"') && !html.includes('data-updask'), 'the derived digest inputs are gone');
  assert.ok(html.includes('Publish and copy link'));
});


test('the source map names every link section with a live count and a jump to the worksheet', () => {
  const app = APP([]);
  app.upd = { busy: false, draft: { window: { from: null, to: '2026-07-30' }, keyu: '', keyq: '' } };
  const html = renderUpdates(app, { ctrl_phase: 'Design', okrs: [{ _k: 1, objective: 'O', kr: 'K', done: 'Open' }], updates: [] });
  assert.ok(html.includes('Where each section of the link comes from'), 'the map exists at the point of publish');
  assert.ok(html.includes('data-action="jumpq" data-id="okrs"'), 'Objectives jump straight to the worksheet question');
  assert.ok(html.includes('data-action="jumpq" data-id="updates"'), 'Risks and Issues too');
  assert.ok(html.includes('data-action="jumpq" data-id="ctrl_phase"'), 'and the phase');
  assert.ok(html.includes('1 key result (1 in Design)'), 'live counts render, scoped to the current phase');
  assert.ok(html.includes('no risks or issues in any phase'), 'an empty source states what the link will say');
});

test('the feeding questions are flagged and share one name with the link', () => {
  for (const id of ['ctrl_phase', 'okrs', 'updates']) {
    assert.equal(qById[id].feed, 'update', id + ' carries the weekly-update flag');
  }
  assert.equal(qById.updates.prompt, 'Risks and issues', 'the worksheet says what the link says');
});

console.log('\nupdate-archive.test: ' + n + '/' + n + ' passed');
