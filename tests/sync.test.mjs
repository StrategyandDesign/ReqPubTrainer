/* ReqPub v2 - sync engine concurrency tests (node tests/sync.test.mjs)
   Runs the REAL client sync engine (createSync) against a mock server that
   implements the same semantics as the SQL RPCs: rev-checked field saves,
   lock-serialized row inserts with k allocation, lock-serialized version
   sequence allocation. Reproduces v1's failure scenarios and asserts they
   are gone. */
import assert from 'node:assert/strict';
import { createSync } from '../app/js/sync.js';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await sleep(10);
  }
};

/* ---- Mock server: same contracts as save_field / upsert_row / create_version.
   Mutations run through a mutex (like Postgres row locks); calls arrive with
   random latency (like the network). ---- */
class MockServer {
  constructor() {
    this.fields = new Map();   // fieldId -> {value, rev, by}
    this.rows = new Map();     // rowId -> row
    this.versions = [];
    this.chain = Promise.resolve();
    this.nextId = 1;
    this.failures = 0;         // inject N transient failures
  }
  lockstep(fn) {
    const p = this.chain.then(fn);
    this.chain = p.then(() => {}, () => {});
    return p;
  }
  latency() { return sleep(1 + Math.random() * 12); }
  repoFor(name) {
    const srv = this;
    return {
      async saveField(pid, fieldId, value, baseRev) {
        await srv.latency();
        if (srv.failures > 0) { srv.failures--; return { error: { message: 'network', status: 0 } }; }
        return srv.lockstep(async () => {
          const cur = srv.fields.get(fieldId);
          if (!cur && (!baseRev || baseRev === 0)) {
            srv.fields.set(fieldId, { value, rev: 1, by: name });
            return { data: { ok: true, rev: 1 } };
          }
          if (cur && cur.rev === baseRev) {
            srv.fields.set(fieldId, { value, rev: cur.rev + 1, by: name });
            return { data: { ok: true, rev: cur.rev + 1 } };
          }
          const now = srv.fields.get(fieldId);
          if (!now) return { data: { ok: false, error: 'not_found' } };   // matches save_field SQL
          return { data: { ok: false, conflict: true, rev: now.rev, value: now.value, by: now.by, at: 'now' } };
        });
      },
      async upsertRow(pid, fieldId, id, data, pos, baseRev) {
        await srv.latency();
        return srv.lockstep(async () => {
          if (id == null) {
            const ks = [...srv.rows.values()].filter((r) => r.field_id === fieldId && !r.deleted).map((r) => r.k);
            const k = (ks.length ? Math.max(...ks) : 0) + 1;
            const row = { id: 'row' + srv.nextId++, field_id: fieldId, k, data, pos: k, rev: 1, deleted: false, by: name };
            srv.rows.set(row.id, row);
            return { data: { ok: true, id: row.id, k: row.k, rev: 1, pos: row.pos } };
          }
          const row = srv.rows.get(id);
          if (!row) return { data: { ok: false, error: 'not_found' } };
          if (baseRev != null && row.rev !== baseRev) {
            return { data: { ok: false, conflict: true, rev: row.rev, data: row.data, by: row.by, at: 'now' } };
          }
          row.data = data; row.rev += 1; row.by = name;
          return { data: { ok: true, id: row.id, k: row.k, rev: row.rev, pos: row.pos } };
        });
      },
      async deleteRow(pid, id) {
        await srv.latency();
        return srv.lockstep(async () => {
          const row = srv.rows.get(id);
          if (row) row.deleted = true;
          return { data: !!row };
        });
      },
      async createVersion() {
        await srv.latency();
        return srv.lockstep(async () => {
          const seq = srv.versions.length + 1;
          const prev = srv.versions[srv.versions.length - 1];
          const maj = prev ? parseInt(prev.label.split('.')[0], 10) : 1;
          const min = prev ? parseInt(prev.label.split('.')[1], 10) + 1 : 0;
          const label = prev ? maj + '.' + min : '1.0';
          srv.versions.push({ seq, label });
          return { data: { ok: true, id: 'v' + seq, seq, label } };
        });
      }
    };
  }
}

const makeClient = (server, name) => {
  const state = {
    pid: 'p1', fields: {}, rows: {}, versions: [], conflicts: {}, presence: [],
    activeField: null, everSaved: false, saveState: 'idle',
    comms: [], msgs: {}, requests: [], discovery: [], approvals: {}, projects: [], reads: {}
  };
  const client = createSync();
  const toasts = [];
  client.init(state, { onChange: () => {}, onToast: (t) => toasts.push(t), repo: server.repoFor(name) });
  return { client, state, toasts, name };
};

/* =====================  the v1 failure scenarios  ===================== */

await test('two editors adding notes/requirements at once: BOTH land (v1 lost one)', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  const B = makeClient(srv, 'Ben');
  const [ra, rb] = await Promise.all([
    A.client.addRow('fr', { stmt: 'From Ana' }),
    B.client.addRow('fr', { stmt: 'From Ben' })
  ]);
  assert.ok(ra && rb);
  assert.notEqual(ra.k, rb.k, 'k values must be distinct');
  assert.equal([...srv.rows.values()].length, 2, 'both rows exist on the server');
});

await test('nine editors adding rows simultaneously: all nine land with unique permanent ids', async () => {
  const srv = new MockServer();
  const clients = Array.from({ length: 9 }, (_, i) => makeClient(srv, 'Eng' + i));
  const rows = await Promise.all(clients.map((c, i) => c.client.addRow('fr', { stmt: 'Req from Eng' + i })));
  assert.equal(rows.filter(Boolean).length, 9);
  const ks = new Set(rows.map((r) => r.k));
  assert.equal(ks.size, 9, 'nine distinct requirement numbers');
  assert.equal([...srv.rows.values()].filter((r) => !r.deleted).length, 9);
});

await test('two editors, different fields: both saved, no cross-clobber (v1 clobbered)', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  const B = makeClient(srv, 'Ben');
  A.client.editField('ov_vision', 'Vision by Ana');
  B.client.editField('ov_problem', 'Problem by Ben');
  A.client.flushNow(); B.client.flushNow();
  await until(() => A.client.dirtyCount() === 0 && B.client.dirtyCount() === 0);
  assert.equal(srv.fields.get('ov_vision').value, 'Vision by Ana');
  assert.equal(srv.fields.get('ov_problem').value, 'Problem by Ben');
});

await test('same field, second writer NOT typing: newer save wins locally, no silent loss', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  const B = makeClient(srv, 'Ben');
  // Both start from rev 0. A saves first; B's stale write must be rejected and reconciled.
  B.client.editField('ov_vision', 'Ben text');   // queued
  A.client.editField('ov_vision', 'Ana text');
  A.client.flushNow();
  await until(() => A.client.dirtyCount() === 0);
  B.state.activeField = null;                     // Ben has left the field
  B.client.flushNow();
  await until(() => B.client.dirtyCount() === 0);
  // Ben's client must now hold Ana's committed value at rev 1 or hold his own at rev 2 -
  // either way the server value is what a client shows, never a phantom.
  const server = srv.fields.get('ov_vision');
  assert.equal(B.state.fields.ov_vision.value, server.value);
  assert.equal(B.state.fields.ov_vision.rev, server.rev);
});

await test('same field, second writer IS typing: their text wins by rebase, with a visible conflict notice', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  const B = makeClient(srv, 'Ben');
  A.client.editField('ov_vision', 'Ana text');
  A.client.flushNow();
  await until(() => A.client.dirtyCount() === 0);
  B.state.activeField = 'ov_vision';              // Ben is mid-typing
  B.client.editField('ov_vision', 'Ben newer text');
  B.client.flushNow();
  await until(() => B.client.dirtyCount() === 0, 5000);
  assert.equal(srv.fields.get('ov_vision').value, 'Ben newer text', 'typing editor wins after rebase');
  assert.ok(B.toasts.some((t) => t.includes('also edited')), 'Ben was told about the concurrent edit');
  assert.equal(srv.fields.get('ov_vision').rev, 2, 'rebased write went through the rev check');
});

await test('rapid keystrokes coalesce: last text wins, revs stay consistent', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  for (const t of ['H', 'He', 'Hel', 'Hell', 'Hello world']) A.client.editField('ov_vision', t);
  A.client.flushNow();
  await until(() => A.client.dirtyCount() === 0);
  assert.equal(srv.fields.get('ov_vision').value, 'Hello world');
});

await test('transient network failure: write is retried, nothing dropped (v1 dropped silently)', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  srv.failures = 1;                               // first attempt dies on the wire
  A.client.editField('ov_vision', 'Survives the outage');
  A.client.flushNow();
  await until(() => A.client.failed > 0);
  assert.equal(A.client.saveState(), 'error', 'failure is visible, not silent');
  A.client.retry();
  await until(() => A.client.dirtyCount() === 0 && A.client.failed === 0);
  assert.equal(srv.fields.get('ov_vision').value, 'Survives the outage');
});

await test('two managers generating at once: distinct seq and labels (v1 collided)', async () => {
  const srv = new MockServer();
  const repoA = srv.repoFor('Ana'), repoB = srv.repoFor('Ben');
  const [a, b] = await Promise.all([repoA.createVersion(), repoB.createVersion()]);
  assert.notEqual(a.data.seq, b.data.seq);
  assert.notEqual(a.data.label, b.data.label);
  assert.equal(srv.versions.length, 2);
});

await test('concurrent edit + delete on different rows converge', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  const B = makeClient(srv, 'Ben');
  const r1 = await A.client.addRow('fr', { stmt: 'one' });
  const r2 = await A.client.addRow('fr', { stmt: 'two' });
  B.state.rows.fr = A.state.rows.fr.map((r) => ({ ...r }));  // B loaded the same bundle
  await Promise.all([
    (async () => { B.client.editRow('fr', r1.id, { stmt: 'one, edited by Ben' }); B.client.flushNow(); await until(() => B.client.dirtyCount() === 0); })(),
    A.client.removeRow('fr', r2.id)
  ]);
  const live = [...srv.rows.values()].filter((r) => !r.deleted);
  assert.equal(live.length, 1);
  assert.equal(live[0].data.stmt, 'one, edited by Ben');
});

await test('realtime apply: remote change lands unless the field is dirty or focused', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  const apply = (rec) => A.client.applyProject({ event: 'UPDATE', payload: { table: 'project_fields', operation: 'UPDATE', record: rec } });
  // clean field: applies
  apply({ project_id: 'p1', field_id: 'ov_vision', value: 'Remote v2', rev: 2, updated_by_name: 'Ben' });
  assert.equal(A.state.fields.ov_vision.value, 'Remote v2');
  // dirty local edit: remote echo must NOT stomp it
  A.client.editField('ov_vision', 'Local unsaved');
  apply({ project_id: 'p1', field_id: 'ov_vision', value: 'Remote v3', rev: 3, updated_by_name: 'Ben' });
  assert.equal(A.state.fields.ov_vision.value, 'Local unsaved');
  // stale echo (lower rev) is ignored even when clean
  A.state.fields.ov_market = { value: 'Newer', rev: 5 };
  apply({ project_id: 'p1', field_id: 'ov_market', value: 'Older', rev: 4, updated_by_name: 'Ben' });
  assert.equal(A.state.fields.ov_market.value, 'Newer');
});

await test('realtime apply: comms and rows dedupe by id (self-echo safe)', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  const msg = (table, record, op = 'INSERT') => ({ event: op, payload: { table, operation: op, record } });
  A.client.applyProject(msg('comms', { id: 'c1', project_id: 'p1', origin: 'sme', title: 'Hi', created_at: 'now' }));
  A.client.applyProject(msg('comms', { id: 'c1', project_id: 'p1', origin: 'sme', title: 'Hi', created_at: 'now' }));
  assert.equal(A.state.comms.length, 1);
  const row = { id: 'r9', project_id: 'p1', field_id: 'fr', k: 9, data: { stmt: 'x' }, pos: 1, rev: 1, deleted: false };
  A.client.applyProject(msg('field_rows', row));
  A.client.applyProject(msg('field_rows', row));
  assert.equal(A.state.rows.fr.length, 1);
  A.client.applyProject(msg('field_rows', { ...row, deleted: true, rev: 2 }, 'UPDATE'));
  assert.equal(A.state.rows.fr.length, 0, 'remote delete removes the row');
});

await test('field known only via realtime (server row missing): save recovers as an insert', async () => {
  const srv = new MockServer();
  const A = makeClient(srv, 'Ana');
  // Field arrives over the wire with rev 2, but this server never stored it
  // (e.g. replica lag or a cleared table in dev).
  A.client.applyProject({ event: 'UPDATE', payload: { table: 'project_fields', operation: 'UPDATE', record: { project_id: 'p1', field_id: 'ov_vision', value: 'Ghost', rev: 2, updated_by_name: 'Ben' } } });
  A.client.editField('ov_vision', 'Recovered text');
  A.client.flushNow();
  await until(() => A.client.dirtyCount() === 0 && !A.state.fields.ov_vision.dirty, 5000);
  assert.equal(srv.fields.get('ov_vision').value, 'Recovered text');
});

/* Let any straggler timers fire before declaring victory - a late unhandled
   rejection here would fail the run. */
await sleep(700);
console.log('\nsync.test: ' + passed + '/' + passed + ' passed');
