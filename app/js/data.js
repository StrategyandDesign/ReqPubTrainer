/* ============================================================================
   ReqPub v2 - data layer
   One Supabase client, one repository object. Every mutation is awaited and
   returns a definite outcome; transient network failures are retried with
   exponential backoff (durable()). Racy structures (fields, rows, versions)
   go through the server-side RPCs so concurrency checks cannot be bypassed.
   ============================================================================ */
import { BRIEF_SECTIONS } from './domain.js';

const HAS_DOM = typeof window !== 'undefined';
const CFG = (HAS_DOM && window.SB_CFG) || { url: '', anon: '' };
export const sb = (HAS_DOM && CFG.url && CFG.anon && window.supabase)
  ? window.supabase.createClient(CFG.url, CFG.anon)
  : null;
export const online = () => !!sb;

/* Retry transient failures only. A PostgREST error carries a SQLSTATE `code`
   (permission denied, constraint violation, missing function): those are
   definitive answers and are returned immediately. Retries are reserved for
   the network layer: timeouts, 429s, 5xx, and thrown fetch failures. */
export async function durable(fn, { tries = 5, base = 400, onRetry } = {}) {
  let lastErr;
  for (let n = 0; n < tries; n++) {
    try {
      const r = await fn();
      if (r && r.error) {
        const status = typeof r.error.status === 'number' ? r.error.status : 0;
        const definitive = !!r.error.code && status < 500;
        const transient = !definitive && (
          status === 408 || status === 429 || status >= 500 ||
          /fetch|network|timeout|load failed/i.test(r.error.message || ''));
        if (!transient) return r;
        lastErr = r.error;
      } else {
        return r;
      }
    } catch (e) {
      lastErr = e;
    }
    if (n < tries - 1) {
      if (onRetry) onRetry(n + 1);
      await new Promise((res) => setTimeout(res, Math.min(base * 2 ** n, 8000) + Math.random() * 150));
    }
  }
  return { error: lastErr || new Error('unreachable') };
}

const rpc = (name, args) => durable(() => sb.rpc(name, args));

export const repo = {
  /* ---- session ---- */
  async session() { const { data } = await sb.auth.getSession(); return data.session || null; },
  async signOut() { try { await sb.auth.signOut(); } catch { /* session already gone */ } },
  async context() { const r = await rpc('v2_context'); return r.error ? null : r.data; },
  async saveDisplayName(userId, name) {
    return durable(() => sb.from('user_profiles')
      .upsert({ user_id: userId, display_name: name, updated_at: new Date().toISOString() }));
  },

  /* ---- org / members / invites / partners ---- */
  async createOrg(name) { return rpc('create_org', { p_name: name }); },
  async claimInvites() { return rpc('claim_invites'); },
  async members(orgId) {
    const r = await durable(() => sb.from('org_members').select('user_id,email,role').eq('org_id', orgId));
    return r.data || [];
  },
  async invites(orgId) {
    const r = await durable(() => sb.from('org_invites').select('email,role,created_at').eq('org_id', orgId));
    return r.data || [];
  },
  async helpTopicsFor(orgId) {
    const t = await durable(() => sb.from('help_topics').select('*').eq('org_id', orgId).order('sort_order'));
    const ids = (t.data || []).map((x) => x.id);
    const st = ids.length ? await durable(() => sb.from('help_steps').select('*').in('topic_id', ids).order('step_order')) : { data: [] };
    return { topics: t.data || [], steps: st.data || [] };
  },
  async helpTopicSave(row) {
    const r = await durable(() => sb.from('help_topics').upsert(row).select('*').single());
    return r.data;
  },
  helpTopicDelete: (id) => durable(() => sb.from('help_topics').delete().eq('id', id)),
  async helpStepsReplace(topicId, steps) {
    await durable(() => sb.from('help_steps').delete().eq('topic_id', topicId));
    if (steps.length) await durable(() => sb.from('help_steps').insert(steps.map((s) => ({ ...s, topic_id: topicId }))));
  },
  async helpStateFor(userId) {
    const r = await durable(() => sb.from('help_state').select('topic_id,seen,dismissed,completed').eq('user_id', userId));
    const out = {}; (r.data || []).forEach((x) => { out[x.topic_id] = x; }); return out;
  },
  helpStateSet: (userId, topicId, patch) =>
    durable(() => sb.from('help_state').upsert({ user_id: userId, topic_id: topicId, updated_at: new Date().toISOString(), ...patch })),
  async helpPrefsFor(userId) {
    const r = await durable(() => sb.from('help_prefs').select('*').eq('user_id', userId).maybeSingle());
    return r.data || { beacon_hidden: false };
  },
  helpPrefsSet: (userId, patch) => durable(() => sb.from('help_prefs').upsert({ user_id: userId, updated_at: new Date().toISOString(), ...patch })),
  helpEvent: (topicId, userId, type) => durable(() => sb.from('help_events').insert({ topic_id: topicId, user_id: userId, event_type: type })),
  helpStats: (orgId) => rpc('help_stats', { p_org: orgId }),

  async invite(orgId, email, role) {
    return durable(() => sb.from('org_invites').upsert({ org_id: orgId, email, role }));
  },
  async revokeInvite(orgId, email) {
    return durable(() => sb.from('org_invites').delete().eq('org_id', orgId).eq('email', email));
  },
  async setMemberRole(orgId, userId, role) {
    return durable(() => sb.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', userId));
  },
  async removeMember(orgId, userId) {
    return durable(() => sb.from('org_members').delete().eq('org_id', orgId).eq('user_id', userId));
  },
  sendInviteEmail(email, role, orgName, inviterEmail) {
    // Fire-and-report: email delivery is a courtesy, the invite row is the truth.
    try {
      return sb.functions.invoke('send-invite', { body: { email, role, orgName, inviterEmail } });
    } catch { return Promise.resolve({ error: new Error('function unavailable') }); }
  },
  async orgPartners(orgId) {
    const [pr, ar] = await Promise.all([
      durable(() => sb.from('partners').select('id,email,name').eq('org_id', orgId)),
      durable(() => sb.from('partner_access').select('partner_id,project_id'))
    ]);
    const acc = {};
    (ar.data || []).forEach((x) => { (acc[x.partner_id] = acc[x.partner_id] || {})[x.project_id] = 1; });
    return (pr.data || []).map((p) => ({ ...p, acc: acc[p.id] || {} }));
  },
  async addPartner(orgId, email, name) {
    return durable(() => sb.from('partners').insert({ org_id: orgId, email, name }).select().single());
  },
  async removePartner(id) { return durable(() => sb.from('partners').delete().eq('id', id)); },
  async grantPartner(partnerId, projectId) {
    return durable(() => sb.from('partner_access').upsert({ partner_id: partnerId, project_id: projectId }));
  },
  async revokePartner(partnerId, projectId) {
    return durable(() => sb.from('partner_access').delete()
      .eq('partner_id', partnerId).eq('project_id', projectId));
  },

  /* ---- projects ---- */
  async projects(orgId) {
    const r = await durable(() => sb.from('projects').select('*')
      .eq('org_id', orgId).eq('archived', false).order('updated_at', { ascending: false }));
    return r.data || [];
  },
  /* Standing-structure read for clone-from-record: only the whitelisted
     field ids ever leave the source project. Members of the source can
     read it; RLS enforces that, this just narrows the request. */
  async answersSubset(pid, ids) {
    const [f, r] = await Promise.all([
      durable(() => sb.from('project_fields').select('field_id,value').eq('project_id', pid).in('field_id', ids)),
      durable(() => sb.from('field_rows').select('field_id,data,pos').eq('project_id', pid).in('field_id', ids).eq('deleted', false).order('pos'))
    ]);
    if (f.error || r.error) return { error: f.error || r.error };
    const fields = {}; (f.data || []).forEach((x) => { fields[x.field_id] = x.value; });
    const rows = {}; (r.data || []).forEach((x) => { (rows[x.field_id] = rows[x.field_id] || []).push({ data: x.data }); });
    return { data: { fields, rows } };
  },
  recordTemplateSave(orgId, name, payload) {
    return durable(() => sb.rpc('record_template_put', { p_org: orgId, p_name: name, p_payload: payload }));
  },
  async recordTemplatesList(orgId) {
    const r = await durable(() => sb.rpc('record_templates_list', { p_org: orgId }));
    return r.error ? [] : (r.data || []);
  },
  recordTemplateGet(id) {
    return durable(() => sb.rpc('record_template_get', { p_id: id }));
  },
  recordTemplateDelete(id) {
    return durable(() => sb.rpc('record_template_delete', { p_id: id }));
  },
  recordTemplateTouch(id) {
    return durable(() => sb.rpc('record_template_touch', { p_id: id }));
  },
  async createProject(orgId, id, name, practice) {
    // v2.55: practice is set only here, at creation; the trigger makes it
    // immutable afterward in both directions.
    return durable(() => sb.from('projects').insert({ id, org_id: orgId, name, practice: practice === true }));
  },
  async acceptanceFacts() {
    const { data } = await sb.rpc('project_acceptance_facts');
    return data || {};
  },
  async setLineage(pid, fromPid, fromSeq, fingerprint) {
    const { data, error } = await sb.rpc('project_set_lineage', {
      p_project: pid, p_from_project: fromPid, p_from_seq: fromSeq, p_fingerprint: fingerprint });
    return { data, error };
  },
  async bookExport() {
    const { data } = await sb.rpc('book_export');
    return data || [];
  },
  async renameProject(id, name) {
    return durable(() => sb.from('projects').update({ name, updated_at: new Date().toISOString() }).eq('id', id));
  },
  async archiveProject(id) {
    return durable(() => sb.from('projects').update({ archived: true }).eq('id', id));
  },
  async setDiscExport(id, on) {
    return durable(() => sb.from('projects').update({ disc_export: !!on }).eq('id', id));
  },
  async setBrand(id, logo, label) {
    return durable(() => sb.from('projects')
      .update({ brand_logo: logo || '', brand_label: label || '', updated_at: new Date().toISOString() }).eq('id', id));
  },

  /* ---- worksheet: everything a project view needs, in parallel ---- */
  async projectBundle(pid) {
    const [fields, rows, versions, comms, requests, discovery, reads] = await Promise.all([
      durable(() => sb.from('project_fields').select('field_id,value,rev,updated_by_name,updated_at').eq('project_id', pid)),
      durable(() => sb.from('field_rows').select('id,field_id,k,data,pos,rev,updated_by_name').eq('project_id', pid).eq('deleted', false).order('pos')),
      durable(() => sb.from('versions').select('id,seq,label,status,note,author_name,build,created_at').eq('project_id', pid).order('seq')),
      durable(() => sb.from('comms').select('*').eq('project_id', pid).order('created_at', { ascending: false })),
      durable(() => sb.from('input_requests').select('*').eq('project_id', pid).order('created_at', { ascending: false })),
      durable(() => sb.from('discovery_entries').select('*').eq('project_id', pid).order('created_at', { ascending: false })),
      durable(() => sb.from('read_marks').select('comm_id'))
    ]);
    const f = {}; (fields.data || []).forEach((x) => { f[x.field_id] = { value: x.value, rev: x.rev, by: x.updated_by_name, at: x.updated_at }; });
    const rw = {}; (rows.data || []).forEach((x) => { (rw[x.field_id] = rw[x.field_id] || []).push(x); });
    const reads_ = {}; (reads.data || []).forEach((x) => { reads_[x.comm_id] = true; });
    return {
      fields: f, rows: rw,
      versions: versions.data || [], comms: comms.data || [],
      requests: requests.data || [], discovery: discovery.data || [], reads: reads_
    };
  },
  async versionSnapshot(pid, seq) {
    const r = await durable(() => sb.from('versions').select('snapshot,label,status,seq,author_name,note,build,created_at,id')
      .eq('project_id', pid).eq('seq', seq).maybeSingle());
    return r.data || null;
  },
  async approvals(versionIds) {
    if (!versionIds.length) return {};
    const r = await durable(() => sb.from('version_approvals').select('*').in('version_id', versionIds));
    const map = {};
    (r.data || []).forEach((a) => { (map[a.version_id] = map[a.version_id] || []).push(a); });
    return map;
  },

  /* ---- racy writes → RPCs ---- */
  mcpKeysList(orgId) { return rpc('mcp_keys_list', { p_org: orgId }); },
  mcpKeyIssue(orgId, label, propose) {
    return rpc('mcp_key_issue', { p_org: orgId, p_label: label, p_propose: !!propose, p_project_ids: null });
  },
  mcpKeyRevoke(id) { return rpc('mcp_key_revoke', { p_id: id }); },
  async mcpPing() {
    /* The endpoint takes agent keys, not user sessions, so a keyless
       initialize that answers 401 with a JSON-RPC error proves the function
       is deployed and reachable with JWT verification off. */
    try {
      const r = await sb.functions.invoke('mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
      if (r && r.error) {
        const st = r.error.context && r.error.context.status;
        return { ok: true, reachable: st === 401 || st === 405 || st === 429 };
      }
      return { ok: true, reachable: true };
    } catch { return { ok: false, reachable: false }; }
  },
  saveField(pid, fieldId, value, baseRev) {
    return rpc('save_field', { p_project: pid, p_field: fieldId, p_value: value, p_base_rev: baseRev || 0 });
  },
  upsertRow(pid, fieldId, id, data, pos, baseRev) {
    return rpc('upsert_row', { p_project: pid, p_field: fieldId, p_id: id, p_data: data, p_pos: pos ?? null, p_base_rev: baseRev ?? null });
  },
  deleteRow(pid, id) { return rpc('delete_row', { p_project: pid, p_id: id }); },
  createVersion(pid, major, note, snapshot, build) {
    return rpc('create_version', { p_project: pid, p_major: major, p_note: note, p_snapshot: snapshot, p_build: build || '' });
  },
  setVersionStatus(versionId, status) {
    return rpc('version_set_status', { p_version: versionId, p_status: status });
  },
  async addApprover(versionId, role, name, userId) {
    return durable(() => sb.from('version_approvals').insert({
      version_id: versionId, approver_role: role, approver_name: name,
      approver_user_id: userId || null
    }).select('id'));
  },
  decideApproval(id, status, comment) {
    return rpc('approval_decide', { p_approval: id, p_status: status, p_comment: comment || '' });
  },
  // Team roster (with display names) for the approver picker.
  async orgMembersNamed(orgId) {
    const r = await rpc('org_members_named', { p_org: orgId });
    return (r && r.data) || [];
  },
  // Pending approval slots assigned to the current user on in-review versions.
  async myOpenApprovals() {
    const r = await rpc('my_open_approvals');
    return (r && r.data) || [];
  },
  async removeApprover(id) { return durable(() => sb.from('version_approvals').delete().eq('id', id)); },
  async setBuild(versionId, build) {
    // Versions are immutable at the table (write revoked); the build tag moves
    // only through this definer RPC, which also logs the change.
    const r = await rpc('version_set_build', { p_version: versionId, p_build: build || '' });
    if (r.error) return r;
    return r.data === true ? r : { error: new Error('refused') };
  },

  /* ---- comms / messages ---- */
  async addComm(row) { return durable(() => sb.from('comms').insert(row).select().single()); },
  async setCommStatus(id, status) {
    return durable(() => sb.from('comms').update({ status, updated_at: new Date().toISOString() }).eq('id', id));
  },
  async setCommFields(id, patch) {
    return durable(() => sb.from('comms').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
  },
  async messagesFor(parentIds) {
    if (!parentIds.length) return {};
    const r = await durable(() => sb.from('messages').select('*').in('parent_id', parentIds).order('created_at'));
    const map = {};
    (r.data || []).forEach((m) => { (map[m.parent_id] = map[m.parent_id] || []).push(m); });
    return map;
  },
  async addMessage(orgId, parentKind, parentId, body, authorName, userId) {
    return durable(() => sb.from('messages').insert({
      org_id: orgId, parent_kind: parentKind, parent_id: parentId,
      author_kind: 'team', author_name: authorName, author_user: userId, body
    }).select().single());
  },
  async markRead(userId, commId) {
    return durable(() => sb.from('read_marks').upsert({ user_id: userId, comm_id: commId }));
  },
  // A team member opening a thread: records their read receipt AND clears the
  // team-level "new reply" flag (comms.team_seen_at) for everyone. Viewers too.
  commSeen(commId) { return rpc('comm_seen', { p_comm: commId }); },

  /* ---- input requests / discovery ---- */
  async addRequest(row) { return durable(() => sb.from('input_requests').insert(row).select().single()); },
  async setRequestStatus(id, status) {
    return durable(() => sb.from('input_requests').update({ status }).eq('id', id));
  },
  async deleteRequest(id) { return durable(() => sb.from('input_requests').delete().eq('id', id)); },
  async addDiscovery(row) { return durable(() => sb.from('discovery_entries').insert(row).select().single()); },
  async updateDiscovery(id, patch) {
    return durable(() => sb.from('discovery_entries').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
  },
  async deleteDiscovery(id) { return durable(() => sb.from('discovery_entries').delete().eq('id', id)); },

  /* ---- shares (SME links) ---- */
  sharePut(pid, kind, seq, payload, token) {
    return rpc('share_put', { p_project: pid, p_kind: kind, p_seq: seq, p_payload: payload, p_token: token || null });
  },
  shareRevoke(token) { return rpc('share_revoke', { p_token: token }); },

  /* ---- e-sign v1 (recorded electronic signatures on a version) ---- */
  signCreate(versionId, email, name, role, fingerprint) {
    return rpc('sign_request_create', { p_version: versionId, p_email: email, p_name: name || '', p_role: role || '', p_fingerprint: fingerprint || '' });
  },
  signContext(token) { return rpc('sign_request_context', { p_token: token }); },
  signSign(token, typedName, ua) { return rpc('sign_request_sign', { p_token: token, p_typed_name: typedName, p_ua: ua || '' }); },
  signDecline(token, reason) { return rpc('sign_request_decline', { p_token: token, p_reason: reason || '' }); },
  signRevoke(id) { return rpc('sign_request_revoke', { p_id: id }); },
  async sealKey(kid) {
    const { data } = await sb.from('receipt_keys').select('kid,public_key_spki_base64').eq('kid', kid).maybeSingle();
    return data || null;
  },
  async receiptsFor(pid) {
    const { data } = await sb.rpc('receipts_for_project', { p_project: pid });
    return data || [];
  },
  async sealHealth() {
    return sb.functions.invoke('seal-receipt', { body: { health: true } });
  },
  async retryTimestamps(signRequestId) {
    return sb.functions.invoke('seal-receipt', { body: { signRequestId, retryTsa: true } });
  },
  async sealReceipt(signRequestId) {
    return sb.functions.invoke('seal-receipt', { body: { signRequestId } });
  },
  async evidenceGather(pid) {
    const { data } = await sb.rpc('evidence_gather', { p_project: pid });
    return data || null;
  },
  async evidenceLogExport(pid) {
    const { data } = await sb.rpc('evidence_log_export', { p_project: pid });
    return data || null;
  },
  async receiptRow(signRequestId) {
    const { data } = await sb.rpc('receipt_for', { p_sign_request: signRequestId, p_token: '' });
    return data || null;
  },
  async signsFor(pid) {
    const r = await durable(() => sb.from('sign_requests')
      .select('id,version_id,token,signer_email,signer_name,signer_role,status,signed_name,signed_at,sent_at,decline_reason,revoked')
      .eq('project_id', pid).order('sent_at', { ascending: true }));
    const by = {};
    (r.data || []).forEach((x) => { if (!x.revoked) (by[x.version_id] = by[x.version_id] || []).push(x); });
    return by;
  },
  sendSignEmail(requestId) {
    return sb.functions.invoke('send-sign-request', { body: { request_id: requestId } });
  },
  sendSignReceipt(token) {
    return sb.functions.invoke('send-sign-receipt', { body: { token } });
  },
  updatePublish(pid, payload, windowFrom, preparedBy, recipientName, recipientEmail, recipientRole) {
    return rpc('update_publish', { p_project: pid, p_payload: payload, p_window_from: windowFrom, p_prepared_by: preparedBy,
      p_recipient_name: recipientName || '', p_recipient_email: recipientEmail || '',
      p_recipient_role: recipientRole || '' });
  },
  async updatesFor(pid) {
    const r = await durable(() => sb.from('updates')
      .select('id,seq,token,window_from,window_to,prepared_by,payload,published_at,revoked,recipient_name,recipient_email,recipient_role')
      .eq('project_id', pid).order('seq', { ascending: false }));
    return r.data || [];
  },
  updateContext(token) {
    return rpc('update_context', { p_token: token });
  },
  /* Every write the update link performs runs through a token-scoped RPC.
     Attribution is server-side, from the recipient the token was issued to,
     so nothing here carries a name. */
  updateNoteSave(token, body, baseRev) {
    return rpc('update_note_save', { p_token: token, p_body: body, p_base_rev: baseRev || 0 });
  },
  updateThreadCreate(token, kind, title, body) {
    return rpc('update_thread_create', { p_token: token, p_kind: kind, p_title: title, p_body: body });
  },
  updateThreadReply(token, commId, body) {
    return rpc('update_thread_reply', { p_token: token, p_comm: commId, p_body: body });
  },
  /* Permanent phase-prefixed row IDs for the Update Log: allocated server-side
     under a lock, per (project, phase letter), never reused. */
  updatesNextId(pid, letter) {
    return rpc('updates_next_id', { p_project: pid, p_letter: letter });
  },
  updateRevoke(id) {
    return rpc('update_revoke', { p_id: id });
  },
  async sharesFor(pid) {
    const r = await durable(() => sb.from('shares')
      .select('token,kind,version_seq,revoked,updated_at,sections:payload->sections').eq('project_id', pid));
    return r.data || [];
  },
  getShare(token) { return rpc('get_share', { p_token: token }); },
  submitShare(token, payload) { return rpc('submit_share_v2', { p_token: token, p_payload: payload }); },
  smeThread(replyToken) { return rpc('sme_thread', { p_reply_token: replyToken }); },
  smeReply(replyToken, body) { return rpc('sme_reply', { p_reply_token: replyToken, p_body: body }); },
  smeSeat(pid, name, email) { return rpc('sme_seat', { p_project: pid, p_name: name, p_email: email }); },
  smeSeats(pid) { return rpc('sme_seats', { p_project: pid }); },

  /* ---- attachments (files from team, partners, seated SMEs) ---- */
  async attachmentsFor(pid) {
    const r = await durable(() => sb.from('attachments')
      .select('id,comm_id,message_id,uploader_kind,uploader_name,file_name,mime,size_bytes,storage_path,scan_status,sha256_hex,created_at')
      .eq('project_id', pid).order('created_at'));
    return r.data || [];
  },
  async signedUrl(path) {
    try { const r = await sb.storage.from('attachments').createSignedUrl(path, 120); return (r.data && r.data.signedUrl) || null; }
    catch { return null; }
  },
  // Uploads through the scanning edge function. `opts` carries either a
  // reply_token (accountless SME) or a comm_id (team/partner, with their JWT).
  async uploadAttachment(file, opts = {}) {
    if (!sb || !CFG.url) return { error: { message: 'offline' } };
    const fd = new FormData();
    fd.append('file', file);
    if (opts.replyToken) fd.append('reply_token', opts.replyToken);
    if (opts.commId) fd.append('comm_id', opts.commId);
    if (opts.projectId) fd.append('project_id', opts.projectId);
    const headers = { apikey: CFG.anon };
    try {
      const s = await sb.auth.getSession();
      const tok = s && s.data && s.data.session && s.data.session.access_token;
      if (tok) headers.Authorization = 'Bearer ' + tok;
    } catch { /* accountless SME has no session */ }
    try {
      const res = await fetch(CFG.url + '/functions/v1/attachment-upload', { method: 'POST', body: fd, headers });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) return { error: { message: j.error || 'upload failed' }, data: j };
      return { data: j };
    } catch (e) { return { error: { message: (e && e.message) || 'network' } }; }
  },
  // JSON modes on the same function (v2.49). Both require a signed-in session;
  // the function verifies the JWT and the RPCs enforce scope server-side.
  async attachModeCall(body) {
    if (!sb || !CFG.url) return { error: { message: 'offline' } };
    const headers = { apikey: CFG.anon, 'Content-Type': 'application/json' };
    try {
      const s = await sb.auth.getSession();
      const tok = s && s.data && s.data.session && s.data.session.access_token;
      if (tok) headers.Authorization = 'Bearer ' + tok;
    } catch { /* no session: the function answers 401 */ }
    try {
      const res = await fetch(CFG.url + '/functions/v1/attachment-upload', { method: 'POST', body: JSON.stringify(body), headers });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) return { error: { message: j.error || 'request failed' }, data: j };
      return { data: j };
    } catch (e) { return { error: { message: (e && e.message) || 'network' } }; }
  },
  // Re-download, re-hash, compare against the stored digest.
  verifyAttachment(id) { return this.attachModeCall({ verify: id }); },
  // Hash one page of files that predate v2.49. Loop until remaining is 0.
  backfillAttachmentHashes(pid) { return this.attachModeCall({ backfill: { project_id: pid, limit: 25 } }); },
  /* ---- signed webhooks (v2.50): manager config plus the lazy dispatch ping ---- */
  async whEndpoints(pid) {
    const r = await durable(() => sb.from('webhook_endpoints')
      .select('id,url,description,active,created_at')
      .eq('project_id', pid).order('created_at'));
    return (r && r.data) || [];
  },
  whCreate(pid, url, desc) { return rpc('endpoint_create', { p_project: pid, p_url: url, p_description: desc || '' }); },
  whSetActive(id, active) { return rpc('endpoint_set_active', { p_id: id, p_active: !!active }); },
  whDeliveries(pid) { return rpc('deliveries_list', { p_project: pid, p_limit: 25 }); },
  whRedeliver(id) { return rpc('delivery_redeliver', { p_id: id }); },
  whDue(pid) { return rpc('deliveries_due', { p_project: pid, p_limit: 20 }); },
  // One delivery attempt. Fire after signing flows; the id is the capability.
  async whPing(deliveryId) {
    if (!sb || !CFG.url) return { error: { message: 'offline' } };
    const headers = { apikey: CFG.anon, 'Content-Type': 'application/json' };
    try {
      const s = await sb.auth.getSession();
      const tok = s && s.data && s.data.session && s.data.session.access_token;
      if (tok) headers.Authorization = 'Bearer ' + tok;
    } catch { /* accountless signer: apikey alone; the function verifies nothing else */ }
    try {
      const res = await fetch(CFG.url + '/functions/v1/deliver-webhooks', { method: 'POST', body: JSON.stringify({ deliveryId }), headers });
      return { data: await res.json().catch(() => ({})) };
    } catch (e) { return { error: { message: (e && e.message) || 'network' } }; }
  },
  /* ---- demo walkthrough (ordered screenshots + captions for the build team) ---- */
  async walkthroughFor(pid) {
    const r = await durable(() => sb.from('walkthrough_shots')
      .select('id,attachment_id,position,caption,updated_at,attachment:attachments(file_name,mime,size_bytes,storage_path,scan_status)')
      .eq('project_id', pid).order('position'));
    return r.data || [];
  },
  // Display URLs live an hour; downloads elsewhere keep the short 120s window.
  async wtSignedUrl(path) {
    try { const r = await sb.storage.from('attachments').createSignedUrl(path, 3600); return (r.data && r.data.signedUrl) || null; }
    catch { return null; }
  },
  wtAdd(pid, attachmentId, caption) { return rpc('walkthrough_add', { p_project: pid, p_attachment: attachmentId, p_caption: caption || '' }); },
  wtCaption(shotId, caption) { return rpc('walkthrough_caption', { p_shot: shotId, p_caption: caption || '' }); },
  wtMove(shotId, dir) { return rpc('walkthrough_move', { p_shot: shotId, p_dir: dir }); },
  wtRemove(shotId) { return rpc('walkthrough_remove', { p_shot: shotId }); },

  requestView(token) { return rpc('request_view', { p_token: token }); },
  requestSubmit(token, name, body) { return rpc('request_submit', { p_token: token, p_name: name, p_body: body }); },

  /* ---- partner portal ---- */
  partnerProjects() { return rpc('partner_projects_v2'); },
  partnerPresentToken(pid) { return rpc('partner_present_token', { p_project: pid }); },
  partnerThread(pid) { return rpc('partner_thread_v2', { p_project: pid }); },
  partnerPost(pid, body) { return rpc('partner_post', { p_project: pid, p_body: body }); },
  partnerReply(commId, body) { return rpc('partner_reply', { p_comm: commId, p_body: body }); },
  partnerUpdateProfile(name, title, company) {
    return rpc('partner_update_profile', { p_name: name, p_title: title, p_company: company });
  },

  /* ---- activity ---- */
  async activity(pid, limit = 80) {
    const r = await durable(() => sb.from('activity').select('*')
      .eq('project_id', pid).order('id', { ascending: false }).limit(limit));
    return r.data || [];
  },
  async orgActivity(orgId, limit = 60) {
    const r = await durable(() => sb.from('activity').select('*')
      .eq('org_id', orgId).order('id', { ascending: false }).limit(limit));
    return r.data || [];
  }
};

/* ---- Curated SME share payloads (public-safe subsets; no internal fields) ---- */
export function stripInternal(obj) {
  if (Array.isArray(obj)) return obj.map(stripInternal);
  if (obj && typeof obj === 'object') {
    const o = {};
    for (const k of Object.keys(obj)) { if (k[0] !== '_') o[k] = stripInternal(obj[k]); }   // every _-prefixed key is internal bookkeeping
    return o;
  }
  return obj;
}
/* Brief payloads are section-scoped: only the answer fields backing the
   selected sections are included, so unshared content is absent from the
   payload itself - not merely hidden by the page that renders it. */
/* The tokened image path for share readers: the walkthrough-image edge
   function validates the token against the frozen version, then redirects to
   a short signed URL on the private bucket. */
export const wtImageUrl = (token, id) =>
  CFG.url ? CFG.url + '/functions/v1/walkthrough-image?token=' + encodeURIComponent(token) + '&id=' + encodeURIComponent(id) : '';

export function buildSharePayload(project, answers, versionLabel, seq, kind, build, sectionKeys, walkthrough) {
  const filled = (arr) => (arr || []).filter((r) => Object.keys(r || {}).some((c) => c[0] !== '_' && r[c] && String(r[c]).trim()));
  if (kind === 'pilot') {
    return {
      product: project.name || '', label: versionLabel || '', build: build || '',
      answers: { components: filled(answers.components).map((c) => ({ name: c.name })) }
    };
  }
  const secs = Array.isArray(sectionKeys) && sectionKeys.length
    ? sectionKeys
    : BRIEF_SECTIONS.map((s) => s.key);
  const ca = { ctrl_org: answers.ctrl_org, ctrl_product: answers.ctrl_product };
  // Registry-driven: copy the backing fields of each selected section. A section
  // added to BRIEF_SECTIONS is therefore shareable with no change to this file.
  for (const s of BRIEF_SECTIONS) {
    if (!secs.includes(s.key)) continue;
    for (const f of (s.fields || [])) if (answers[f] !== undefined) ca[f] = answers[f];
  }
  // Shaping for the two structured sections: components carry name + description;
  // requirement grouping needs component names even when components is not shared.
  if (secs.includes('pieces')) ca.components = filled(answers.components).map((c) => ({ name: c.name, desc: c.desc }));
  // AI acceptance is deliberate disclosure: the client signs {dimension,
  // metric, threshold}. Component tags do not ride along, and the FR fit
  // doctrine is untouched - fit criteria never appear in any payload.
  if (secs.includes('aieval')) ca.eval = filled(answers.eval).map((r) => ({ dim: r.dim || '', metric: r.metric || '', thresh: r.thresh || '', dataset: r.dataset || '' }));
  if (secs.includes('willdo')) {
    ca.fr = (answers.fr || []).map((x) => ({ stmt: x.stmt || '', comp: x.comp || '' }));
    if (!secs.includes('pieces')) ca.components = filled(answers.components).map((c) => ({ name: c.name }));
  }
  // The assigned collaborator logo travels with the brief so accountless SMEs
  // and partners see it on the PRD (they cannot read the projects table).
  return {
    product: project.name || '', label: versionLabel || '', sections: secs,
    logo: project.brand_logo || '', brandLabel: project.brand_label || '',
    answers: stripInternal(ca),
    // The frozen walkthrough travels with the brief: order, captions, and file
    // references only. Bytes stay in the private bucket; readers fetch each
    // shot through the tokened walkthrough-image path, which the share's own
    // revocation closes.
    ...(Array.isArray(walkthrough) && walkthrough.length
      ? { walkthrough: walkthrough.map((w) => ({ n: w.n, caption: w.caption || '', file_name: w.file_name || '', attachment_id: w.attachment_id })) }
      : {})
  };
}
