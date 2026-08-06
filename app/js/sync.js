/* ============================================================================
   ReqPub v2 - sync engine
   Field-level optimistic concurrency + realtime broadcast + presence.

   The contract that removes v1's lost writes:
     * every field/row write carries the rev it was based on;
     * the server accepts it only if that rev is still current;
     * a rejected write comes back with the winning value and author, and the
       client resolves it explicitly (keep-typing wins the field you're in,
       remote wins fields you aren't in) - never a silent clobber;
     * adds are inserts - two simultaneous adds both land;
     * every write is awaited and retried with backoff, and its state is
       visible in the UI (saving / saved / offline / failed).
   ============================================================================ */

import { sb, repo as liveRepo } from './data.js';
import { debounce, pushUnique, upsertById } from './core.js';

const FLUSH_MS = 500;          // keystroke coalescing before a field save
const SELF_KEY = Math.random().toString(36).slice(2);

/* Factory so tests can run several independent clients against a mock repo.
   The app uses the singleton exported at the bottom. */
export function createSync() {
  return {
  state: null,                 // the shared APP state object (main.js owns it)
  onChange: null,              // schedule re-render
  onToast: null,
  repo: liveRepo,
  orgCh: null,
  projCh: null,
  pendingFields: new Map(),    // field_id -> latest value awaiting flush
  pendingRows: new Map(),      // row_id -> {fieldId, data}
  inflight: 0,
  failed: 0,
  saveTimer: null,
  presenceTick: null,

  init(state, { onChange, onToast, repo: repoOverride }) {
    this.state = state;
    this.onChange = onChange;
    this.onToast = onToast;
    if (repoOverride) this.repo = repoOverride;
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', (e) => {
        this.flushNow();
        if (this.dirtyCount() > 0) { e.preventDefault(); e.returnValue = ''; }
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushNow();
      });
    }
  },

  /* ---------------- save-state chip ---------------- */
  dirtyCount() { return this.pendingFields.size + this.pendingRows.size + this.inflight; },
  saveState() {
    if (this.failed > 0) return 'error';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    if (this.dirtyCount() > 0) return 'saving';
    return this.state.everSaved ? 'saved' : 'idle';
  },
  bump() { this.state.saveState = this.saveState(); this.onChange('savechip'); },

  /* ---------------- scalar fields ---------------- */
  editField(fieldId, value) {
    const st = this.state;
    st.fields[fieldId] = { ...(st.fields[fieldId] || { rev: 0 }), value, dirty: true };
    this.pendingFields.set(fieldId, value);
    this.scheduleFlush();
    this.bump();
  },

  scheduleFlush() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flushNow(); }, FLUSH_MS);
  },

  flushNow() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    for (const [fieldId, value] of [...this.pendingFields]) {
      this.pendingFields.delete(fieldId);
      this.pushField(fieldId, value);
    }
    for (const [rowId, job] of [...this.pendingRows]) {
      this.pendingRows.delete(rowId);
      this.pushRow(rowId, job);
    }
  },

  async pushField(fieldId, value) {
    const st = this.state;
    const pid = st.pid;
    if (!pid) return;
    const baseRev = (st.fields[fieldId] && st.fields[fieldId].rev) || 0;
    this.inflight++; this.bump();
    const r = await this.repo.saveField(pid, fieldId, value, baseRev);
    this.inflight--;

    if (st.pid !== pid) { this.bump(); return; }         // project changed mid-flight
    if (this.pendingFields.has(fieldId)) { this.bump(); return; } // newer keystrokes queued

    const out = r.data;
    if (r.error || !out) { this.fail('save', () => this.editField(fieldId, value)); return; }

    const f = st.fields[fieldId] || {};
    if (out.ok) {
      st.fields[fieldId] = { ...f, rev: out.rev, dirty: false };
      st.everSaved = true; this.failed = 0;
    } else if (out.conflict) {
      // Someone saved this field since we read it.
      if (st.activeField === fieldId) {
        // You are mid-typing: your text wins the field, rebased onto their rev.
        st.fields[fieldId] = { ...f, rev: out.rev, dirty: true };
        st.conflicts[fieldId] = { by: out.by, at: out.at };
        this.pendingFields.set(fieldId, value);
        this.scheduleFlush();
        this.onToast(`${out.by || 'A teammate'} also edited this field - keeping your text`);
      } else {
        // You had left the field: the newer save wins.
        st.fields[fieldId] = { value: out.value, rev: out.rev, dirty: false, by: out.by, at: out.at };
        this.onChange('field:' + fieldId);
      }
    } else if (out.error === 'not_found') {
      // The server has no row for this field (e.g. it arrived via realtime
      // before its first persisted save landed): re-push as an insert.
      st.fields[fieldId] = { ...f, rev: 0, dirty: true };
      this.pendingFields.set(fieldId, value);
      this.scheduleFlush();
    } else if (out.error === 'forbidden') {
      this.onToast('Your role cannot edit this document');
    }
    this.bump();
  },

  /* ---------------- repeating rows ---------------- */
  async addRow(fieldId, data, afterRender) {
    const st = this.state;
    this.inflight++; this.bump();
    const r = await this.repo.upsertRow(st.pid, fieldId, null, data || {});
    this.inflight--;
    const out = r.data;
    if (r.error || !out || !out.ok) { this.fail('add', () => this.addRow(fieldId, data)); return null; }
    const row = { id: out.id, field_id: fieldId, k: out.k, data: data || {}, pos: out.pos, rev: out.rev };
    (st.rows[fieldId] = st.rows[fieldId] || []).push(row);
    st.everSaved = true; this.failed = 0;
    this.bump();
    this.onChange('rows:' + fieldId);
    if (afterRender) afterRender(row);
    return row;
  },

  editRow(fieldId, rowId, patch) {
    const st = this.state;
    const rows = st.rows[fieldId] || [];
    const row = rows.find((x) => x.id === rowId);
    if (!row) return;
    row.data = { ...row.data, ...patch };
    row.dirty = true;
    this.pendingRows.set(rowId, { fieldId, data: row.data });
    this.scheduleFlush();
    this.bump();
  },

  async pushRow(rowId, job) {
    const st = this.state;
    const pid = st.pid;
    const rows = st.rows[job.fieldId] || [];
    const row = rows.find((x) => x.id === rowId);
    if (!row || !pid) return;
    this.inflight++; this.bump();
    const r = await this.repo.upsertRow(pid, job.fieldId, rowId, job.data, null, row.rev);
    this.inflight--;
    if (st.pid !== pid) { this.bump(); return; }
    if (this.pendingRows.has(rowId)) { this.bump(); return; }
    const out = r.data;
    if (r.error || !out) { this.fail('save', () => { this.pendingRows.set(rowId, job); this.scheduleFlush(); }); return; }
    if (out.ok) {
      row.rev = out.rev; row.dirty = false;
      st.everSaved = true; this.failed = 0;
    } else if (out.conflict) {
      const editingThisRow = st.activeField && String(st.activeField).startsWith('row:' + rowId);
      if (editingThisRow) {
        row.rev = out.rev; row.dirty = true;
        this.pendingRows.set(rowId, job); this.scheduleFlush();
        this.onToast(`${out.by || 'A teammate'} also edited this item - keeping your text`);
      } else {
        row.data = out.data; row.rev = out.rev; row.dirty = false;
        this.onChange('rows:' + job.fieldId);
      }
    } else if (out.error === 'not_found') {
      // The row was deleted remotely while we edited it: drop the orphan edit.
      st.rows[job.fieldId] = (st.rows[job.fieldId] || []).filter((x) => x.id !== rowId);
      this.onToast('That item was removed by a teammate');
      this.onChange('rows:' + job.fieldId);
    }
    this.bump();
  },

  async removeRow(fieldId, rowId) {
    const st = this.state;
    st.rows[fieldId] = (st.rows[fieldId] || []).filter((x) => x.id !== rowId);
    this.onChange('rows:' + fieldId);
    this.inflight++; this.bump();
    const r = await this.repo.deleteRow(st.pid, rowId);
    this.inflight--;
    if (r.error) this.fail('delete', () => this.removeRow(fieldId, rowId));
    else { st.everSaved = true; this.failed = 0; }
    this.bump();
  },

  fail(what, retry) {
    this.failed++;
    this.retryLast = retry;
    this.bump();
    this.onToast(`Could not ${what} - check your connection, then press Retry`);
  },
  retry() {
    this.failed = 0;
    if (this.retryLast) { const r = this.retryLast; this.retryLast = null; r(); }
    this.flushNow();
    this.bump();
  },

  /* ---------------- realtime: org + project channels ---------------- */
  subscribeOrg(orgId) {
    this.unsubscribeOrg();
    if (!sb || !orgId) return;
    this.orgCh = sb.channel('org:' + orgId, { config: { private: true } })
      .on('broadcast', { event: '*' }, (msg) => this.applyOrg(msg))
      .subscribe();
  },
  unsubscribeOrg() { if (this.orgCh) { try { sb.removeChannel(this.orgCh); } catch { /* gone */ } this.orgCh = null; } },

  subscribeProject(pid, me) {
    this.unsubscribeProject();
    if (!sb || !pid) return;
    this.projCh = sb.channel('proj:' + pid, {
      config: { private: true, presence: { key: me.id + ':' + SELF_KEY } }
    })
      .on('broadcast', { event: '*' }, (msg) => this.applyProject(msg))
      .on('presence', { event: 'sync' }, () => this.presenceChanged())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.trackPresence();
      });
  },
  unsubscribeProject() {
    if (this.projCh) { try { sb.removeChannel(this.projCh); } catch { /* gone */ } this.projCh = null; }
    this.state.presence = [];
  },

  trackPresence: null,   // assigned in initPresence
  initPresence(me) {
    this.trackPresence = debounce(() => {
      if (!this.projCh) return;
      try {
        this.projCh.track({
          u: me.id, n: this.state.ctx?.display_name || me.email || 'Member',
          f: this.state.activeField || null, at: Date.now()
        });
      } catch { /* channel closing */ }
    }, 250);
  },
  presenceChanged() {
    if (!this.projCh) return;
    const seen = this.projCh.presenceState();
    const me = this.state.user;
    const out = [];
    for (const key of Object.keys(seen)) {
      for (const p of seen[key]) {
        if (p.u === me.id) continue;
        out.push({ u: p.u, n: p.n || 'Member', f: p.f || null });
      }
    }
    // One entry per user; a user with two tabs is still one person.
    const byUser = new Map();
    out.forEach((p) => { const prev = byUser.get(p.u); if (!prev || (p.f && !prev.f)) byUser.set(p.u, p); });
    this.state.presence = [...byUser.values()];
    this.onChange('presence');
  },

  /* Broadcast payloads carry {operation, record, old_record, table}. Our own
     writes come back too; rev/id guards make re-applying them a no-op. */
  applyProject(msg) {
    const p = (msg && msg.payload) || {};
    const op = p.operation || msg.event, rec = p.record, old = p.old_record;
    const st = this.state;
    if (!st.pid) return;
    switch (p.table) {
      case 'project_fields': {
        if (!rec || rec.project_id !== st.pid) return;
        const f = st.fields[rec.field_id];
        if (f && f.dirty) return;                        // never stomp unsaved local edits
        if (st.activeField === rec.field_id) return;     // never stomp the field being typed in
        if (!f || rec.rev > (f.rev || 0)) {
          st.fields[rec.field_id] = { value: rec.value, rev: rec.rev, by: rec.updated_by_name, at: rec.updated_at };
          this.onChange('field:' + rec.field_id);
        }
        return;
      }
      case 'field_rows': {
        if (!rec || rec.project_id !== st.pid) return;
        const list = st.rows[rec.field_id] = st.rows[rec.field_id] || [];
        const i = list.findIndex((x) => x.id === rec.id);
        if (rec.deleted) { if (i >= 0) { list.splice(i, 1); this.onChange('rows:' + rec.field_id); } return; }
        if (i < 0) {
          list.push({ id: rec.id, field_id: rec.field_id, k: rec.k, data: rec.data, pos: rec.pos, rev: rec.rev });
          list.sort((a, b) => a.pos - b.pos);
          this.onChange('rows:' + rec.field_id);
        } else if (rec.rev > list[i].rev) {
          if (list[i].dirty || (st.activeField || '').startsWith('row:' + rec.id)) return;
          list[i] = { ...list[i], data: rec.data, pos: rec.pos, rev: rec.rev };
          this.onChange('rows:' + rec.field_id);
        }
        return;
      }
      case 'versions': {
        if (!rec || rec.project_id !== st.pid) return;
        const i = st.versions.findIndex((v) => v.id === rec.id);
        const lite = { id: rec.id, seq: rec.seq, label: rec.label, status: rec.status, note: rec.note, author_name: rec.author_name, build: rec.build, created_at: rec.created_at };
        if (i < 0) { st.versions.push(lite); st.versions.sort((a, b) => a.seq - b.seq); }
        else st.versions[i] = { ...st.versions[i], ...lite };
        this.onChange('versions');
        return;
      }
      case 'version_approvals': {
        const row = rec || old;
        if (!row || !row.id) return;                    // ignore malformed broadcasts
        const list = st.approvals[row.version_id] = st.approvals[row.version_id] || [];
        const i = list.findIndex((a) => a.id === row.id);
        if (op === 'DELETE') { if (i >= 0) list.splice(i, 1); }
        else if (!rec || !rec.id) return;               // update/insert needs a real record
        else if (i < 0) list.push(rec); else list[i] = rec;
        this.onChange('versions');
        return;
      }
      case 'comms': {
        if (!rec && !old) return;
        if (op === 'DELETE') {
          st.comms = st.comms.filter((c) => c.id !== old.id);
        } else {
          const i = st.comms.findIndex((c) => c.id === rec.id);
          if (i < 0) st.comms.unshift(rec); else st.comms[i] = rec;
        }
        this.onChange('comms');
        return;
      }
      case 'messages': {
        if (op !== 'INSERT' || !rec) return;
        const list = st.msgs[rec.parent_id] = st.msgs[rec.parent_id] || [];
        const before = list.length;
        pushUnique(list, rec);
        if (list.length !== before) this.onChange('comms');
        return;
      }
      case 'attachments': {
        if (!rec && !old) return;
        st.attachments = st.attachments || [];
        if (op === 'DELETE') st.attachments = st.attachments.filter((a) => a.id !== old.id);
        else pushUnique(st.attachments, rec);
        this.onChange('comms');
        return;
      }
      case 'walkthrough_shots': {
        // Rows arrive without the joined attachment; a cheap authoritative
        // refetch keeps every open teammate's walkthrough in step.
        this.onChange('walkthrough');
        return;
      }
      case 'input_requests': {
        if (!rec && !old) return;
        if (op === 'DELETE') st.requests = st.requests.filter((r) => r.id !== old.id);
        else {
          const i = st.requests.findIndex((r) => r.id === rec.id);
          if (i < 0) st.requests.unshift(rec); else st.requests[i] = rec;
        }
        this.onChange('requests');
        return;
      }
      case 'discovery_entries': {
        if (!rec && !old) return;
        if (op === 'DELETE') st.discovery = st.discovery.filter((d) => d.id !== old.id);
        else {
          const i = st.discovery.findIndex((d) => d.id === rec.id);
          if (i < 0) st.discovery.unshift(rec); else st.discovery[i] = rec;
        }
        this.onChange('discovery');
        return;
      }
      default:
    }
  },

  applyOrg(msg) {
    const p = (msg && msg.payload) || {};
    if (p.table !== 'projects') return;
    const st = this.state;
    const rec = p.record, old = p.old_record;
    if ((p.operation || msg.event) === 'DELETE') {
      st.projects = st.projects.filter((x) => x.id !== (old && old.id));
    } else if (rec) {
      // Same reconciler as the optimistic local write in main.js, so the echo
      // and the local insert converge to one entry in either arrival order.
      upsertById(st.projects, rec, 'updated_at');
    }
    this.onChange('projects');
  },

  setActiveField(fieldId) {
    if (this.state.activeField === fieldId) return;
    this.state.activeField = fieldId;
    if (fieldId) delete this.state.conflicts[fieldId];
    if (this.trackPresence) this.trackPresence();
  }
};
}

/* The application-wide instance. */
export const sync = createSync();
