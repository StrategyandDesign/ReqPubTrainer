/* ReqPub v2 - Pursuit Mode and lineage (node tests/pursuit-lineage.test.mjs)
   Pins v2.56: the pursuit predicate and its section list; the worksheet trim
   riding the existing condition mechanism, with non-pursuit rendering
   unchanged; the three-step header as facts only, with no controls and no
   scoring; the Pursuit template start; the Born from cover line and its
   absence; the promote guards at source, including the fingerprint assertion,
   practice inheritance, and the pursuit flag not crossing; unconfigured
   parity for every prior surface. */
globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
const { isPursuit, pursuitSection, PURSUIT_SECTIONS, SECTIONS, Q } = await import('../app/js/domain.js');
const { pursuitHeaderHTML } = await import('../app/js/views-app.js');
const { coverHTML } = await import('../app/js/exports.js');
const { TEMPLATES, templateByKey } = await import('../app/js/templates.js');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };
const src = (f) => readFileSync(fileURLToPath(new URL('../app/js/' + f, import.meta.url)), 'utf8');

/* ---- the predicate and the section list ---- */
check('pursuit is an authored control, read like any other answer',
  isPursuit({ ctrl_pursuit: 'Yes' }) === true && isPursuit({ ctrl_pursuit: 'No' }) === false && isPursuit({}) === false && isPursuit(null) === false);
check('the pursuit sections are the scope-bearing ones',
  PURSUIT_SECTIONS.join(',') === 'control,overview,metrics,solution,adc,people');
check('every pursuit section is a real section key',
  PURSUIT_SECTIONS.every((k) => SECTIONS.some((s) => s.key === k)),
  PURSUIT_SECTIONS.filter((k) => !SECTIONS.some((s) => s.key === k)));
check('the trimmed-away sections are the ones downstream of agreement',
  ['functional', 'nonfunctional', 'gates', 'risks', 'aieval', 'method'].every((k) => !pursuitSection(k)));
check('the control question ships with both options and no default drift',
  (() => { const q = Q.find((x) => x.id === 'ctrl_pursuit');
    return q && q.sec === 'control' && q.type === 'choice' && q.options.join(',') === 'No,Yes' && !q.req; })());

/* ---- the trim rides the existing filter, and only for pursuits ---- */
{
  const ws = src('views-app.js');
  const line = ws.split('\n').find((l) => l.includes('const secs = SECTIONS.filter'));
  check('the trim is one clause on the existing condition filter',
    !!line && line.includes('!s.cond || s.cond(a)'), line && line.trim().slice(0, 60));
  const region = ws.slice(ws.indexOf('const secs = SECTIONS.filter'), ws.indexOf('const secs = SECTIONS.filter') + 320);
  check('the clause is inert unless the record is a pursuit',
    region.includes('!isPursuit(a) || pursuitSection(s.key)'));
}

/* ---- the header: facts, never controls, never scores ---- */
{
  const base = { fields: { ctrl_pursuit: { value: 'Yes' } }, rows: {}, versions: [], shares: [], signs: {} };
  const empty = pursuitHeaderHTML(base);
  check('an empty pursuit states three absences plainly',
    empty.includes('no baseline yet') && empty.includes('not shared') && empty.includes('no signature yet'));
  const full = pursuitHeaderHTML({ ...base,
    versions: [{ id: 'v1' }, { id: 'v2' }],
    shares: [{ id: 's1', revoked: false }],
    signs: { v2: [{ id: 'g1', status: 'signed', revoked: false }] } });
  check('a working pursuit states the facts it holds',
    full.includes('2 baselines') && full.includes('shared') && full.includes('1 signed'));
  check('a revoked share and a revoked signature are not facts',
    (() => { const h = pursuitHeaderHTML({ ...base, shares: [{ revoked: true }], signs: { v1: [{ status: 'signed', revoked: true }] } });
      return h.includes('not shared') && h.includes('no signature yet'); })());
  check('the header carries no controls: statements only',
    !full.includes('data-action') && !full.includes('<button'));
  check('the header scores nothing: no percentages, no step counting, no next',
    !/\d+%/.test(full) && !/step\s*\d/i.test(full) && !/next/i.test(full));
  check('a non-pursuit record renders no header at all',
    pursuitHeaderHTML({ ...base, fields: {} }) === '');
}

/* ---- the Pursuit template start ---- */
{
  const t = templateByKey('pursuit');
  check('the Pursuit start sets the control, opens the Document tab, engagement base',
    !!t && t.scalars.ctrl_pursuit === 'Yes' && t.openDoc === true && t.base === 'engagement');
  check('it sits with the other starts without displacing Blank',
    TEMPLATES[0].key === 'blank' && TEMPLATES.some((x) => x.key === 'pursuit'));
}

/* ---- the Born from line ---- */
{
  const withL = coverHTML({ product: 'Child', bornFrom: { projectId: 'p_parent', seq: 3, fingerprint: 'ab'.repeat(32) } });
  check('the cover cites the parent, the sequence, and twelve characters',
    withL.includes('Born from') && withL.includes('p_parent baseline 3') && withL.includes('abababababab'));
  check('it prints twelve characters, not the whole fingerprint',
    !withL.includes('ab'.repeat(32)));
  check('a record with no lineage carries no line',
    !coverHTML({ product: 'Child' }).includes('Born from'));
  check('a partial lineage renders nothing rather than half a citation',
    !coverHTML({ product: 'C', bornFrom: { projectId: 'p', seq: 1 } }).includes('Born from'));
}

/* ---- promote: the guards, pinned at source ---- */
{
  const m = src('main.js');
  const region = m.slice(m.indexOf("case 'promote'"), m.indexOf("case 'bookexport'"));
  check('promote requires a signed, unrevoked baseline',
    region.includes("x.status === 'signed' && !x.revoked") && region.includes('Promote needs a signed baseline'));
  check('the fingerprint is recomputed and asserted equal to what was signed',
    region.includes('await versionFingerprint(ver)') && region.includes('fp !== sg.doc_fingerprint'));
  check('a mismatch aborts before anything is created',
    region.indexOf('fp !== sg.doc_fingerprint') < region.indexOf('createProject'));
  check('practice inherits: a rehearsal\u2019s child is a rehearsal',
    region.includes('const practice = !!(APP.project && APP.project.practice)') && region.includes('createProject(APP.orgId, childId, childName, practice)'));
  check('the pursuit flag does not cross to the child',
    region.includes("if (id2 === 'ctrl_pursuit') continue"));
  check('the child is an engagement',
    region.includes('ENGAGEMENT'));
  check('content is carried through the rev-checked field RPC, one at a time',
    region.includes('await repo.saveField(childId') && region.includes('APP.promoteWrote = wrote; render();'));
  check('lineage is written through the set-once RPC',
    region.includes('await repo.setLineage(childId, APP.pid, ver.seq, fp)'));
  check('a double click cannot promote twice',
    region.includes('if (APP.promoting) break;'));
  const d = readFileSync(fileURLToPath(new URL('../app/js/data.js', import.meta.url)), 'utf8');
  check('the repo call names the definer RPC and its four arguments',
    d.includes("sb.rpc('project_set_lineage'") && d.includes('p_from_seq: fromSeq') && d.includes('p_fingerprint: fingerprint'));
}

/* ---- unconfigured parity: pinned at source, because a full workspace
   fixture proves nothing these two conditionals do not ---- */
{
  const ws = src('views-app.js');
  check('the header is called exactly once, from the workspace header',
    (ws.match(/pursuitHeaderHTML\(APP\) \+/g) || []).length === 1
    && ws.indexOf('pursuitHeaderHTML(APP) +') > ws.indexOf('export function viewWorkspace'));
  check('the header returns empty for a record without the control',
    pursuitHeaderHTML({ fields: {}, rows: {}, versions: [], shares: [], signs: {} }) === '');
  const ex = readFileSync(fileURLToPath(new URL('../app/js/exports.js', import.meta.url)), 'utf8');
  check('the cover line is gated on a complete citation',
    ex.includes('meta.bornFrom && meta.bornFrom.projectId && meta.bornFrom.fingerprint'));
  check('nothing reads back up the chain: no lookup of the parent record anywhere',
    !src('main.js').includes('born_from_project_id]') && !ex.includes('bornFrom.parent'));
}

console.log(`pursuit+lineage: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
