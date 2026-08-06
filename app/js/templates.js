/* ============================================================================
   ReqPub v2 - project templates (validated starters, tested)

   A template is a starter SHAPE, not a worked example: the structural rows a
   disciplined record opens with (approver slots, a first component, a first
   metric, a first requirement with the fit-criterion convention already in
   place), with 'to confirm' where a human decision is owed. The worked
   examples stay in supabase/seed-*.sql; a template teaches the same shape in
   the first five minutes without shipping their content to every workspace.

   Two invariants, both enforced by tests/templates.test.mjs:
   - Every field id a template touches exists in the question bank with the
     matching type (the same rule tools/gen-prd-seed.mjs enforces on seeds).
   - applyTemplate writes through the SAME rev-checked RPCs as live editing
     (repo.saveField / repo.upsertRow), sequentially, so row k order equals
     array order and nothing bypasses the server's concurrency or size rules.

   'to confirm' placeholders are deliberate: the record-health signals count
   them, so a fresh template opens with its own punch list.
   ============================================================================ */

import { Q, ENGAGEMENT } from './domain.js';

export const TEMPLATES = [
  {
    key: 'blank',
    label: 'Blank',
    tag: 'Start empty',
    desc: 'Start with an empty worksheet and answer the questions in order.',
    scalars: {}, lists: {}, rows: {}
  },
  {
    key: 'pursuit',
    label: 'Pursuit',
    tag: 'Scope before the engagement',
    desc: 'A scope conversation with a client: objective, success, approach, assumptions, stakeholders. The worksheet trims to those sections, the record opens on the Document tab, and a signed baseline can be promoted into an engagement that cites it.',
    base: 'engagement', openDoc: true,
    scalars: { ctrl_pursuit: 'Yes' }, lists: {}, rows: {}
  },
  {
    key: 'practice',
    label: 'Practice engagement',
    tag: 'Rehearsal, never evidence',
    desc: 'Engagement mode with practice set at creation, immutable afterward. Watermarked everywhere; excluded from the Book, webhooks, and evidence packs. Opens on the Document tab.',
    base: 'engagement', practice: true, openDoc: true,
    scalars: {}, lists: {}, rows: {}
  },
  {
    key: 'product',
    label: 'Product requirements',
    tag: 'Default',
    desc: 'Approver slots, a first component, metric, and requirement, with the fit-criterion convention in place.',
    scalars: { ctrl_status: 'Draft' },
    lists: {
      ov_goals: ['to confirm. Each goal measurable where possible'],
      sol_out: ['to confirm. The clearest protection against scope creep']
    },
    rows: {
      ctrl_approvers: [
        { role: 'Product', name: 'to confirm' },
        { role: 'Engineering', name: 'to confirm' },
        { role: 'Sponsor', name: 'to confirm' }
      ],
      components: [{ name: 'Core', owner: 'to confirm', status: 'Planned', desc: 'to confirm' }],
      metrics: [{ metric: 'to confirm', target: 'to confirm', method: 'to confirm' }],
      fr: [{ stmt: 'When the user does X, the system does Y.', fit: 'to confirm. The measurable acceptance condition. End with Test, Inspection, or Demonstration.', pri: 'Must', comp: 'Core' }],
      nfr: [{ stmt: 'to confirm. A quality requirement with a number', fit: 'to confirm', pri: 'Must', comp: 'Core' }]
    }
  },
  {
    key: 'engagement',
    label: 'Consulting engagement',
    tag: 'Charter',
    desc: 'The engagement record: objective, workstreams, stakeholders, and the decision log ready to defend.',
    scalars: { ctrl_type: ENGAGEMENT, ctrl_status: 'Draft' },
    lists: {
      ov_goals: ['to confirm. What this engagement must achieve, measurable where possible'],
      assume: ['to confirm. A condition assumed true; if it proves false it becomes a risk'],
      constrain: ['to confirm. A fixed limit the approach must respect']
    },
    rows: {
      ctrl_approvers: [
        { role: 'Engagement lead', name: 'to confirm' },
        { role: 'Client sponsor', name: 'to confirm' }
      ],
      components: [{ name: 'Workstream 1', owner: 'to confirm', status: 'Planned', desc: 'to confirm' }],
      metrics: [{ metric: 'to confirm', target: 'to confirm', method: 'to confirm' }],
      people: [
        { name: 'to confirm', role: 'Engagement lead' },
        { name: 'to confirm', role: 'Client sponsor' }
      ],
      decisions: [{ decision: 'to confirm. The first material decision', options: 'to confirm', rationale: 'to confirm', owner: 'to confirm', date: '', supersedes: '' }]
    }
  },  {
    key: 'gated',
    label: 'Stage-gated engagement',
    tag: 'Gated',
    desc: 'The engagement charter and a gate plan. Each gate names the decision, who makes it, what it is judged against, and when it is due. Name the gate on the baseline; the gate packet carries the evidence into the room.',
    scalars: { ctrl_type: ENGAGEMENT, ctrl_status: 'Draft' },
    lists: {
      ov_goals: ['to confirm. What this engagement must achieve, measurable where possible'],
      assume: ['to confirm. A condition assumed true; if it proves false it becomes a risk'],
      constrain: ['to confirm. A fixed limit the approach must respect']
    },
    rows: {
      gates: [
        { gate: 'Discovery Complete', criteria: 'Discovery log promoted; open questions dispositioned', decider: 'Engagement lead', target: 'to confirm' },
        { gate: 'Requirements Baseline', criteria: 'Every Must has a fit criterion; named approvers assigned', decider: 'Sponsor', target: 'to confirm' },
        { gate: 'Design Baseline', criteria: 'Workstreams owned; interfaces stated with fit criteria', decider: 'Steering committee', target: 'to confirm' },
        { gate: 'Go-Live', criteria: 'Acceptance checklist green; approvals recorded on the baseline', decider: 'Sponsor', target: 'to confirm' }
      ],
      ctrl_approvers: [
        { role: 'Engagement lead', name: 'to confirm' },
        { role: 'Client sponsor', name: 'to confirm' }
      ],
      components: [{ name: 'Workstream 1', owner: 'to confirm', status: 'Planned', desc: 'to confirm' }],
      metrics: [{ metric: 'to confirm', target: 'to confirm', method: 'to confirm' }],
      people: [
        { name: 'to confirm', role: 'Engagement lead' },
        { name: 'to confirm', role: 'Client sponsor' }
      ],
      decisions: [{ decision: 'to confirm. The first material decision', options: 'to confirm', rationale: 'to confirm', owner: 'to confirm', date: '', supersedes: '' }]
    }
  },
  {
    key: 'baseline',
    label: 'Baseline assessment',
    tag: 'AI + safeguarding',
    desc: 'The diagnostic shape: Section 9 unlocked with guardrail criteria, data sensitivity, and safeguarding on.',
    scalars: {
      ctrl_status: 'Draft',
      has_ai: 'Yes',
      vulnerable: 'Yes',
      golden: 'to confirm. What the labeled benchmark set covers, and how hallucination and sycophancy are probed',
      safeguard: 'to confirm. The response if answers indicate a user may be at risk; requires clinical or policy review'
    },
    lists: {
      sol_out: ['Any clinical diagnosis, label, or treatment recommendation.']
    },
    rows: {
      ctrl_approvers: [
        { role: 'Product', name: 'to confirm' },
        { role: 'Data and Privacy', name: 'to confirm' },
        { role: 'Clinical or policy review', name: 'to confirm' }
      ],
      eval: [
        { dim: 'Grounding / hallucination guardrail', metric: 'to confirm. What is measured and how', thresh: 'to confirm', dataset: 'to confirm', comp: '' },
        { dim: 'Safety on distress content', metric: 'to confirm. Red-team set with human review', thresh: 'to confirm', dataset: 'to confirm', comp: '' }
      ],
      data_entities: [{ entity: 'Assessment responses', sens: 'Personal and sensitive' }],
      metrics: [{ metric: 'Scoring correctness', target: '100% agreement with the reference model on golden fixtures', method: 'Automated tests against labeled fixtures on every release.' }],
      fr: [{ stmt: 'When a respondent completes the assessment, the system computes their result deterministically from the scoring model.', fit: 'to confirm - 100% agreement with labeled fixtures. Test.', pri: 'Must', comp: '' }]
    }
  }
];

export const templateByKey = (key) => TEMPLATES.find((t) => t.key === key) || null;

/* Validate one template against the question bank: every id must exist with
   the matching question type. Throws with the offending id. This is the same
   contract the seed generator enforces, applied to the in-app starters. */
export function validateTemplate(t) {
  const qById = Object.fromEntries(Q.map((q) => [q.id, q]));
  const need = (id, kinds) => {
    const q = qById[id];
    if (!q) throw new Error(t.key + ': unknown field id ' + id);
    if (!kinds.includes(q.type)) throw new Error(t.key + ': ' + id + ' is a ' + q.type + ' question, not ' + kinds.join('/'));
  };
  for (const id of Object.keys(t.scalars || {})) need(id, ['short', 'long', 'choice']);
  for (const id of Object.keys(t.lists || {})) need(id, ['list']);
  for (const id of Object.keys(t.rows || {})) need(id, ['rows']);
  return true;
}

/* Apply a template to a freshly created project, through the live RPC layer.
   `name` (the project name the manager just typed) becomes ctrl_product so
   the document titles itself immediately. Writes run sequentially: scalars
   first, then each collection's rows in array order, so the server allocates
   k = 1..n in the order authored here. Returns { ok, fields, rows, failed }
   and never throws; a transient failure is counted, not fatal, because the
   project itself already exists and opens regardless. */
export async function applyTemplate(repo, pid, key, name) {
  const t = templateByKey(key);
  const out = { ok: true, fields: 0, rows: 0, failed: 0 };
  if (!t || t.key === 'blank') return out;             // blank is the pre-existing behavior: no writes
  const scalars = { ...(name ? { ctrl_product: name } : {}), ...t.scalars };

  for (const [id, value] of Object.entries(scalars)) {
    const r = await repo.saveField(pid, id, value, 0);
    if (r.error || !r.data || !r.data.ok) { out.failed++; out.ok = false; } else out.fields++;
  }
  const pushRows = async (id, items, toData) => {
    for (const item of items) {
      const r = await repo.upsertRow(pid, id, null, toData(item));
      if (r.error || !r.data || !r.data.ok) { out.failed++; out.ok = false; } else out.rows++;
    }
  };
  for (const [id, arr] of Object.entries(t.lists || {})) await pushRows(id, arr, (text) => ({ text }));
  for (const [id, arr] of Object.entries(t.rows || {})) await pushRows(id, arr, (data) => data);
  return out;
}

/* ---- Firm templates and clone-from-record (v2.30.0) ----
   A template or a clone carries the STANDING structure of an engagement
   and nothing else: organization, document type, the non-functional
   requirements, and the glossary. Client content (the product name, the
   overview, functional requirements, versions, approvals) never travels.
   The whitelist is enforced on save and again on apply, so a hand-edited
   payload cannot smuggle other sections in. */
export const TPL_SCALARS = ['ctrl_org', 'ctrl_doctype'];
export const TPL_ROWS = ['nfr', 'glossary'];

/* From live state ({fields, rows} as data.js loads them) to a payload.
   Pure. Values pass through String() and rows keep only their data. */
export function buildTemplatePayload(state) {
  const fields = (state && state.fields) || {};
  const rows = (state && state.rows) || {};
  const payload = { scalars: {}, rows: {} };
  for (const id of TPL_SCALARS) {
    const f = fields[id];
    const v = f && typeof f === 'object' && 'value' in f ? f.value : f;
    if (v != null && String(v).trim()) payload.scalars[id] = String(v);
  }
  for (const id of TPL_ROWS) {
    const list = Array.isArray(rows[id]) ? rows[id] : [];
    const data = list.map((r) => (r && r.data && typeof r.data === 'object' ? r.data : null))
      .filter((d) => d && Object.values(d).some((v) => String(v == null ? '' : v).trim()));
    if (data.length) payload.rows[id] = data;
  }
  return payload;
}

/* Apply a stored payload (template or clone) to a freshly created project
   through the same rev-checked RPCs as live editing. Same contract as
   applyTemplate: sequential writes, never throws, returns counts. */
export async function applyAnswerSet(repo, pid, payload, name) {
  const out = { ok: true, fields: 0, rows: 0, failed: 0 };
  const p = payload && typeof payload === 'object' ? payload : {};
  const scalars = { ...(name ? { ctrl_product: name } : {}) };
  for (const id of TPL_SCALARS) {
    const v = p.scalars && p.scalars[id];
    if (v != null && String(v).trim()) scalars[id] = String(v);
  }
  for (const [id, value] of Object.entries(scalars)) {
    const r = await repo.saveField(pid, id, value, 0);
    if (r.error || !r.data || !r.data.ok) { out.failed++; out.ok = false; } else out.fields++;
  }
  for (const id of TPL_ROWS) {
    const list = Array.isArray(p.rows && p.rows[id]) ? p.rows[id] : [];
    for (const data of list) {
      if (!data || typeof data !== 'object') continue;
      const r = await repo.upsertRow(pid, id, null, data);
      if (r.error || !r.data || !r.data.ok) { out.failed++; out.ok = false; } else out.rows++;
    }
  }
  return out;
}
