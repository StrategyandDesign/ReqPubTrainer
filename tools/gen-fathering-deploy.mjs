/* ============================================================================
   Generate supabase/deploy-fathering-baseline.sql from the fatheringBaseline
   PRD (tools/prd-seed-data.mjs), which is mapped section-for-section from
   FC-REQ-001. The migration rebuilds the existing Fathering project in place:
   retitle, erase all SME/partner interchanges, replace the worksheet content,
   and publish an APPROVED v1.1 with the document's named approvers.

   The content is validated through the real domain builders (so the SQL only
   ships if it assembles), and the stored v1.1 snapshot is the exact
   { answers, sections } shape the app itself writes via create_version.
   Run: node tools/gen-fathering-deploy.mjs
   ============================================================================ */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fatheringBaseline as PRD } from './prd-seed-data.mjs';
import { Q, assembleAnswers, buildSections, assemble } from '../app/js/domain.js';

const qById = Object.fromEntries(Q.map((q) => [q.id, q]));
const s = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const jsonb = (v) => s(JSON.stringify(v)) + '::jsonb';

/* Build the assembleAnswers input shape from the PRD definition. */
const fields = {}, rows = {};
for (const [id, value] of Object.entries(PRD.scalars)) fields[id] = { value, rev: 1 };
for (const [id, arr] of Object.entries(PRD.lists)) rows[id] = arr.map((text, i) => ({ id: id + i, k: i + 1, data: { text }, pos: i + 1, rev: 1 }));
for (const [id, arr] of Object.entries(PRD.rows)) rows[id] = arr.map((data, i) => ({ id: id + i, k: i + 1, data, pos: i + 1, rev: 1 }));

/* Validate field ids and types against the question bank. */
const known = new Set(Q.map((q) => q.id));
const unknown = [...Object.keys(PRD.scalars), ...Object.keys(PRD.lists), ...Object.keys(PRD.rows)].filter((id) => !known.has(id));
if (unknown.length) throw new Error('unknown field ids: ' + unknown.join(', '));
for (const id of Object.keys(PRD.lists)) if (qById[id].type !== 'list') throw new Error(id + ' is not a list question');
for (const id of Object.keys(PRD.rows)) if (qById[id].type !== 'rows') throw new Error(id + ' is not a rows question');
for (const id of Object.keys(PRD.scalars)) if (!['short', 'long', 'choice'].includes(qById[id].type)) throw new Error(id + ' is not a scalar question');

/* Assemble and build the v1.1 snapshot exactly as the app's create_version does. */
const answers = assembleAnswers(fields, rows);
const vmeta = [{ seq: 1, label: '1.1', created_at: '2026-07-07T00:00:00.000Z', author_name: 'Micah Canfield', note: 'Baseline Father Profile Assessment, Phase 1 (FC-REQ-001).' }];
const sections = buildSections(answers, '1.1', vmeta);
const md = assemble(sections, answers);
if (!md.startsWith('# ' + PRD.scalars.ctrl_product)) throw new Error('document did not assemble with the product title');
const snapshot = { answers, sections };

/* VALUES bodies (keyed on the plpgsql variable v_pid). */
const fieldVals = Object.entries(PRD.scalars)
  .map(([id, value]) => `    (v_pid, ${s(id)}, ${jsonb(value)}, 1, 'FC-REQ-001', now())`).join(',\n');
const rowVals = [];
const push = (id, items, toData) => items.forEach((item, i) =>
  rowVals.push(`    (v_pid, ${s(id)}, ${i + 1}, ${jsonb(toData(item))}, ${i + 1}, 'FC-REQ-001', now())`));
for (const [id, arr] of Object.entries(PRD.lists)) push(id, arr, (t) => ({ text: t }));
for (const [id, arr] of Object.entries(PRD.rows)) push(id, arr, (d) => d);

// The whole migration is ONE plpgsql DO block. A DO command is a single
// statement, so it is atomic on its own and needs no session temp table or
// multi-statement transaction - which is what a connection pooler (Supabase's
// SQL editor) cannot carry across statements. The resolved project id lives in
// the variable v_pid and is used directly in every insert.
const out = `-- ============================================================================
-- deploy-fathering-baseline.sql   (one atomic statement; generated, do not hand-edit)
--
-- Rebuilds the existing Fathering project in the 'Collection Ventures' workspace
-- as "Fathering Baseline Assessment", mapped from FC-REQ-001. It:
--   1. finds the current Fathering project and retitles it in place,
--   2. ERASES all SME/partner interchanges for a fresh deployment
--      (threads, messages, input requests, share links, attachments, and the
--       partner assignments themselves),
--   3. replaces the worksheet content and clears prior versions, and
--   4. publishes an APPROVED v1.1 baseline, signed off by the document's named
--      approvers (Product, Engineering, Sponsor).
--
-- Run ONCE in the Supabase SQL editor, AFTER schema.sql and the feature
-- migrations. The entire operation is a single DO block, so it is atomic
-- (all-or-nothing) and safe under connection pooling. It is destructive only for
-- this one project's collaboration history and prior versions; branding, the
-- audit/activity log, and every other project are left untouched. Re-runnable.
-- Generated from tools/prd-seed-data.mjs (fatheringBaseline).
-- ============================================================================

do $fb$
declare
  v_org   uuid;
  v_pid   text;
  v_owner uuid;
  v_ver   uuid;
begin
  select id, created_by into v_org, v_owner from orgs where name = 'Collection Ventures' order by created_at limit 1;
  if v_org is null then
    raise exception 'No workspace named "Collection Ventures" was found. Edit the name in this file and re-run.';
  end if;

  -- Find the existing Fathering project to rebuild in place (prefer the seeded id).
  select id into v_pid from projects
    where org_id = v_org and (id = 'prd-fathering-excellence' or name ilike '%fathering%')
    order by (id = 'prd-fathering-excellence') desc, created_at asc
    limit 1;
  if v_pid is null then
    v_pid := 'prd-fathering-baseline';
    insert into projects (id, org_id, name) values (v_pid, v_org, 'Fathering Baseline Assessment');
  end if;

  -- Retitle in place and un-archive.
  update projects set name = 'Fathering Baseline Assessment', archived = false, updated_at = now() where id = v_pid;

  -- Erase all SME/partner interchanges and notes for a fresh deployment.
  delete from attachments    where project_id = v_pid;
  delete from messages       where parent_id in (select id from comms where project_id = v_pid)
                                or parent_id in (select id from input_requests where project_id = v_pid);
  delete from comms          where project_id = v_pid;   -- cascades read_marks
  delete from input_requests where project_id = v_pid;
  delete from shares         where project_id = v_pid;
  delete from partner_access where project_id = v_pid;

  -- Replace worksheet content and clear prior versions so v1.1 is the fresh baseline.
  delete from field_rows     where project_id = v_pid;
  delete from project_fields where project_id = v_pid;
  delete from versions       where project_id = v_pid;   -- cascades version_approvals

  -- Worksheet scalars.
  insert into project_fields (project_id, field_id, value, rev, updated_by_name, updated_at) values
${fieldVals};

  -- Worksheet rows (lists and tables); k is the permanent per-field id.
  insert into field_rows (project_id, field_id, k, data, pos, updated_by_name, updated_at) values
${rowVals.join(',\n')};

  -- Approved v1.1 baseline with the assembled { answers, sections } snapshot.
  insert into versions (id, project_id, seq, label, status, note, author_name, snapshot, created_by, created_at)
    values (gen_random_uuid(), v_pid, 1, '1.1', 'approved',
      'Baseline Father Profile Assessment, Phase 1 (FC-REQ-001).', 'Micah Canfield',
      ${jsonb(snapshot)}, v_owner, now())
    returning id into v_ver;

  -- Record the document's named approvers as signed off. The provenance trigger
  -- forces new rows to 'pending', so we insert then mark approved.
  insert into version_approvals (version_id, approver_role, approver_name) values
    (v_ver, 'Product', 'Micah Canfield'),
    (v_ver, 'Engineering', 'Alon Arad'),
    (v_ver, 'Sponsor', 'Dr. Ken Canfield');

  update version_approvals set status = 'approved', decided_by = v_owner, decided_at = now() where version_id = v_ver;

  raise notice 'Fathering Baseline Assessment deployed: project %, version 1.1 approved.', v_pid;
end
$fb$;

-- Verify what landed:
--   select id, name, archived from projects where name = 'Fathering Baseline Assessment';
--   select label, status, author_name from versions where project_id =
--     (select id from projects where name = 'Fathering Baseline Assessment');
--   select approver_role, approver_name, status from version_approvals;
`;

writeFileSync(fileURLToPath(new URL('../supabase/deploy-fathering-baseline.sql', import.meta.url)), out);

console.log('  ✓ Fathering Baseline Assessment assembles (' + md.split('\n').length + ' lines, ' +
  PRD.rows.fr.length + ' FR, ' + PRD.rows.nfr.length + ' NFR, ' + PRD.rows.eval.length + ' EVAL, ' +
  PRD.rows.interfaces.length + ' IR)');
console.log('  sections: ' + md.split('\n').filter((l) => /^## \d/.test(l)).map((l) => l.replace('## ', '')).join(' | '));
console.log('\nWrote supabase/deploy-fathering-baseline.sql (' +
  Object.keys(PRD.scalars).length + ' fields, ' + rowVals.length + ' rows, snapshot ' +
  Math.round(JSON.stringify(snapshot).length / 1024) + ' KB).');
