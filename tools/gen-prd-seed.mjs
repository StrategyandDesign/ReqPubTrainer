/* ============================================================================
   Generate the seed SQL from tools/prd-seed-data.mjs.
   Writes supabase/seed-prds.sql (all worked-example PRDs, idempotent) and one
   standalone supabase/seed-<id>.sql per PRD (adds just that example without
   touching the others). Also validates each PRD by assembling it through the
   real domain builders, so SQL only ships if every PRD produces a well-formed
   document. Run: node tools/gen-prd-seed.mjs
   ============================================================================ */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRDS } from './prd-seed-data.mjs';
import { Q, assembleAnswers, buildSections, assemble } from '../app/js/domain.js';

const qById = Object.fromEntries(Q.map((q) => [q.id, q]));
const sql = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const jsonb = (v) => sql(JSON.stringify(v)) + '::jsonb';

/* Turn a PRD definition into { fields:{id:{value,rev}}, rows:{id:[{k,data,pos}]} }
   in exactly the shape assembleAnswers() consumes, so we can validate it. */
function toState(prd) {
  const fields = {};
  for (const [id, value] of Object.entries(prd.scalars || {})) fields[id] = { value, rev: 1 };
  const rows = {};
  for (const [id, arr] of Object.entries(prd.lists || {})) {
    rows[id] = arr.map((text, i) => ({ id: id + i, k: i + 1, data: { text }, pos: i + 1, rev: 1 }));
  }
  for (const [id, arr] of Object.entries(prd.rows || {})) {
    rows[id] = arr.map((data, i) => ({ id: id + i, k: i + 1, data, pos: i + 1, rev: 1 }));
  }
  return { fields, rows };
}

/* Validate: every field id exists in the question bank, and the doc assembles. */
function validate(prd) {
  const known = new Set(Q.map((q) => q.id));
  const seen = [...Object.keys(prd.scalars || {}), ...Object.keys(prd.lists || {}), ...Object.keys(prd.rows || {})];
  const unknown = seen.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(prd.name + ': unknown field ids ' + unknown.join(', '));
  for (const id of Object.keys(prd.lists || {})) if (qById[id].type !== 'list') throw new Error(prd.name + ': ' + id + ' is not a list question');
  for (const id of Object.keys(prd.rows || {})) if (qById[id].type !== 'rows') throw new Error(prd.name + ': ' + id + ' is not a rows question');
  for (const id of Object.keys(prd.scalars || {})) if (!['short', 'long', 'choice'].includes(qById[id].type)) throw new Error(prd.name + ': ' + id + ' is not a scalar question');
  const st = toState(prd);
  const a = assembleAnswers(st.fields, st.rows);
  const md = assemble(buildSections(a, null, []), a);
  if (!md.startsWith('# ' + prd.scalars.ctrl_product)) throw new Error(prd.name + ': document did not assemble with the product title');
  return { md, a };
}

/* The scalar and row INSERT bodies for a set of PRDs. */
function insertBodies(prds) {
  const fieldRows = [], rowRows = [];
  for (const prd of prds) {
    for (const [id, value] of Object.entries(prd.scalars || {})) {
      fieldRows.push(`  (${sql(prd.id)}, ${sql(id)}, ${jsonb(value)}, 1, 'Seed', now())`);
    }
    const pushRows = (id, items, toData) => items.forEach((item, i) =>
      rowRows.push(`  (${sql(prd.id)}, ${sql(id)}, ${i + 1}, ${jsonb(toData(item))}, ${i + 1}, 'Seed', now())`));
    for (const [id, arr] of Object.entries(prd.lists || {})) pushRows(id, arr, (text) => ({ text }));
    for (const [id, arr] of Object.entries(prd.rows || {})) pushRows(id, arr, (data) => data);
  }
  return { fieldRows, rowRows };
}

/* Render a complete, idempotent seed file for a set of PRDs. `cleanup` is the
   list of DELETE statements run first (so re-running is a clean rebuild). */
function render(prds, { intro, cleanup }) {
  let out = `-- ============================================================================
-- ${intro}
-- ============================================================================
-- Run ONCE in the Supabase SQL editor, AFTER schema.sql. Re-runnable (idempotent).
-- It targets the org named exactly 'Collection Ventures'. If your workspace is
-- named differently, change the name on the first line of the DO block.
-- Generated from tools/prd-seed-data.mjs; do not hand-edit.
-- ============================================================================

begin;

do $$
declare v_org uuid;
begin
  select id into v_org from orgs where name = 'Collection Ventures' order by created_at limit 1;
  if v_org is null then
    raise exception 'No workspace named "Collection Ventures" was found. Edit the name in this file and re-run.';
  end if;

`;
  out += cleanup.map((c) => '  ' + c).join('\n') + '\n\n';
  out += '  -- Insert the project shells (owned by the workspace; filled drafts, no version).\n';
  out += '  insert into projects (id, org_id, name, disc_export) values\n';
  out += prds.map((p) => `    (${sql(p.id)}, v_org, ${sql(p.name)}, false)`).join(',\n') + ';\nend $$;\n\n';

  const { fieldRows, rowRows } = insertBodies(prds);
  out += '-- Scalar answers\ninsert into project_fields (project_id, field_id, value, rev, updated_by_name, updated_at) values\n';
  out += fieldRows.join(',\n') + '\non conflict (project_id, field_id) do update set value = excluded.value, rev = 1;\n\n';
  out += '-- Repeating rows (lists and tables). k is the permanent per-field id used for FR-/NFR-style numbering.\n';
  out += 'insert into field_rows (project_id, field_id, k, data, pos, updated_by_name, updated_at) values\n';
  out += rowRows.join(',\n') + '\non conflict (project_id, field_id, k) do update set data = excluded.data, pos = excluded.pos, rev = 1;\n\n';
  out += 'commit;\n';
  return { out, fieldCount: fieldRows.length, rowCount: rowRows.length };
}

/* Validate every PRD before writing anything. */
for (const prd of PRDS) {
  const { md } = validate(prd);
  console.log('  ✓ ' + prd.name + ' assembles (' + md.split('\n').length + ' lines, ' +
    (prd.rows.fr ? prd.rows.fr.length : 0) + ' functional requirements)');
}

const root = new URL('../supabase/', import.meta.url);
const shortId = (p) => p.id.replace(/^prd-/, '');

// Combined file: all worked examples, with the legacy cleanup (removes BotYield
// and any prior copy of these PRDs, by name and by id).
const allIds = PRDS.map((p) => sql(p.id)).join(', ');
const combined = render(PRDS, {
  intro: 'ReqPub - worked-example PRDs for the Collection Ventures workspace',
  cleanup: [
    'delete from projects where org_id = v_org and name ilike \'%botyield%\';',
    'delete from projects where org_id = v_org and (name ilike \'%fathering%\' or lower(name) = \'fathering excellence profile\');',
    `delete from projects where org_id = v_org and id in (${allIds});`
  ]
});
writeFileSync(fileURLToPath(new URL('seed-prds.sql', root)), combined.out);

// Standalone per-PRD files: add just that one example, touching nothing else.
for (const prd of PRDS) {
  const one = render([prd], {
    intro: 'ReqPub - seed the "' + prd.name + '" worked-example PRD (standalone; touches nothing else)',
    cleanup: [`delete from projects where org_id = v_org and id = ${sql(prd.id)};`]
  });
  writeFileSync(fileURLToPath(new URL('seed-' + shortId(prd) + '.sql', root)), one.out);
}

console.log('\nWrote supabase/seed-prds.sql (' + PRDS.length + ' PRDs, ' +
  combined.fieldCount + ' fields, ' + combined.rowCount + ' rows) and ' +
  PRDS.length + ' standalone seed-*.sql files.');
