/* ReqPub v2 - the implementation package: the build team's counterpart to the
   client baseline report. One click on a stored baseline produces the spec
   bundle engineers and coding agents work from - requirements.json (every
   requirement row with its permanent id, fit criterion, priority, component,
   promotion source, and attested recorder), acceptance.md (the fit criteria
   and AI thresholds as a testable checklist), CHANGES.md (the per-column
   evidence diff against the prior baseline), prd.md (the full assembled
   document), and a README carrying the fingerprint and its recipe. The same
   SHA-256 sits on the client report, so the document the client signed and
   the package the builders received are provably the same baseline.
   Everything here is a pure function of the stored snapshot. */
import { rowsFilled, reqDiff, reqDiffDetail, buildSections, assemble, mdTable, ALL_GROUPS, ROW_PREFIX } from './domain.js';
import { buildKnowledgeMap } from './knowledgemap.js';

const RECIPE = 'SHA-256 over the canonical JSON (object keys sorted, arrays in order, UTF-8) of {label, seq, snapshot} for this version, as stored.';
const NOT_A_SIGNATURE = 'The fingerprint identifies the exact snapshot; it is not a signature or a trusted timestamp.';

/* Every file in the package carries the full fingerprint, so a single file
   handed on without the zip still names the baseline it came from. The recipe
   lives once, in requirements.json and README.md. */
const fingerprintLine = (meta) => 'Fingerprint `' + String(meta.fingerprint || '') + '` (recipe in requirements.json)';

const id3 = (prefix, k) => prefix + '-' + String(k).padStart(3, '0');
const clean = (o) => { const r = {}; Object.keys(o).forEach((k) => { if (o[k] !== undefined && o[k] !== '') r[k] = o[k]; }); return r; };
const clip = (t, n) => { const x = String(t || '').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

const mapRows = (arr, fn) => rowsFilled(arr).map((r) => clean({ ...fn(r), source: r.src, author: r._author, origin: r._origin, recordedBy: r._by }));
function jsonRows(answers) {
  const map = mapRows;
  return {
    fr: map(answers.fr, (r) => ({ id: id3('FR', r._k), statement: r.stmt || '', fit: r.fit || '', testInput: r.input, expectedResult: r.expected, priority: r.pri || '', executedBy: r.exec || 'Human', component: r.comp || '' })),
    nfr: map(answers.nfr, (r) => ({ id: id3('NFR', r._k), statement: r.stmt || '', fit: r.fit || '', testInput: r.input, expectedResult: r.expected, priority: r.pri || '', executedBy: r.exec || 'Human', component: r.comp || '' })),
    eval: map(answers.eval, (r) => ({ id: id3('EVAL', r._k), dimension: r.dim || '', metricAndMethod: r.metric || '', threshold: r.thresh || '', dataset: r.dataset, grader: r.grader, passRate: r.pass_rate, executedBy: r.exec || 'Human', component: r.comp || '' })),
    interfaces: map(answers.interfaces, (r) => ({ id: id3('IR', r._k), interface: r.iface || '', requirement: r.req || '', fit: r.fit || '', component: r.comp || '' }))
  };
}
/* v3.2 The rest of the record, machine readable beside the requirements:
   the discovery record, the decisions with what each concerns, the
   commercial thresholds with their baseline measure and comparison method,
   and the glossary the tests use. Absent keys are omitted, never empty. */
function jsonRecord(answers) {
  const map = mapRows;
  const out = {};
  const discovery = clean({
    clearance: map(answers.clearance, (r) => ({ id: id3('CLR', r._k), item: r.item, scope: r.scope, approvedBy: r.approver, date: r.date, status: r.status })),
    ranking: map(answers.ranking, (r) => ({ id: id3('RANK', r._k), rank: r.rank, problem: r.problem, mechanism: r.mechanism, pricedGap: r.gap, status: r.status })),
    findings: map(answers.findings, (r) => ({ id: id3('FND', r._k), finding: r.finding, contradicts: r.contradicts, source: r.source, owner: r.owner, kind: r.kind })),
    constraints: map(answers.controls, (r) => ({ id: id3('CON', r._k), constraint: r.constraint, controlFunction: r.owner, fit: r.fit, negotiable: r.negotiable || 'No' })),
    releaseReviews: map(answers.returns, (r) => ({ id: id3('REL', r._k), build: r.build, baselineFingerprint: r.fingerprint, result: r.result, notes: r.notes, acceptedBy: r.accepted, date: r.date }))
  });
  Object.keys(discovery).forEach((k) => { if (!discovery[k].length) delete discovery[k]; });
  if (Object.keys(discovery).length) out.discovery = discovery;
  const decisions = map(answers.decisions, (r) => ({ id: id3('DEC', r._k), decision: r.decision, concerns: r.ref, kind: r.kind, options: r.options, rationale: r.rationale, decidedBy: r.owner, date: r.date, supersedes: r.supersedes }));
  if (decisions.length) out.decisions = decisions;
  const thresholds = rowsFilled(answers.metrics).map((r) => clean({ metric: r.metric, target: r.target, method: r.method, baselineMeasure: r.baseline, comparisonMethod: r.comparison }));
  if (thresholds.length) out.thresholds = thresholds;
  const glossary = rowsFilled(answers.glossary).map((r) => clean({ term: r.term, definition: r.def }));
  if (glossary.length) out.glossary = glossary;
  return out;
}

function acceptanceThresholds(answers) {
  const ev = rowsFilled(answers.eval);
  if (!ev.length) return '';
  const graded = ev.some((r) => String(r.grader || r.pass_rate || '').trim());
  return '## Signed acceptance thresholds\n\n' +
    'Each threshold is measured on its named eval set. A build below any threshold does not ship. Executed by names who performs the work the criterion accepts; it is an authored attribute and nothing is computed from it.\n\n' +
    (graded
      ? mdTable(['ID', 'Dimension', 'Metric', 'Threshold', 'Eval set', 'Grader', 'Pass rate', 'Executed by'],
        ev.map((r, i) => [id3('EVAL', r._k != null ? r._k : i + 1), r.dim || '', r.metric || '', r.thresh || 'to confirm', r.dataset || 'to confirm', r.grader || 'to confirm', r.pass_rate || 'to confirm', r.exec || 'Human']))
      : mdTable(['ID', 'Dimension', 'Metric', 'Threshold', 'Eval set', 'Executed by'],
        ev.map((r, i) => [id3('EVAL', r._k != null ? r._k : i + 1), r.dim || '', r.metric || '', r.thresh || 'to confirm', r.dataset || 'to confirm', r.exec || 'Human']))) + '\n\n';
}
/* v3.2 The commercial thresholds and the control function constraints that
   carry a fit criterion are acceptance too: the first is what the executive
   signed, the second is a test the suite carries under its author's name. */
function commercialThresholds(answers) {
  const m = rowsFilled(answers.metrics).filter((r) => String(r.baseline || r.comparison || '').trim());
  if (!m.length) return '';
  return '## Commercial thresholds\n\n' +
    'Each threshold names its mechanism, the baseline taken before the build, and the comparison method that separates market movement from system movement. The client measures the result by the method stated.\n\n' +
    mdTable(['Metric', 'Target', 'Measurement method', 'Baseline measure', 'Comparison method'],
      m.map((r) => [r.metric || '', r.target || 'to confirm', r.method || 'to confirm', r.baseline || 'to confirm', r.comparison || 'to confirm'])) + '\n\n';
}
function acceptanceMd(answers, meta) {
  const P = ['# Acceptance checklist - ' + (meta.product || 'Untitled') + ' v' + meta.label,
    ['Baselined ' + day(meta.baselined), meta.approvedAt ? 'Approved ' + day(meta.approvedAt) : null,
      fingerprintLine(meta)
    ].filter(Boolean).join(' · ')];
  const box = (id, stmt, fit, exec, r) => '- [ ] **' + id + '** ' + stmt + ((exec && exec !== 'Human') ? ' (executed by ' + exec.toLowerCase() + ')' : '') + '\n      Fit: ' + (fit || 'to confirm') +
    (r && String(r.input || '').trim() ? '\n      Input: ' + r.input : '') + (r && String(r.expected || '').trim() ? '\n      Expected: ' + r.expected : '');
  const fr = rowsFilled(answers.fr), nfr = rowsFilled(answers.nfr), ir = rowsFilled(answers.interfaces), ev = rowsFilled(answers.eval);
  const con = rowsFilled(answers.controls).filter((r) => String(r.fit || '').trim());
  const th = acceptanceThresholds(answers);
  if (th) P.push(th.trim());
  const ct = commercialThresholds(answers);
  if (ct) P.push(ct.trim());
  if (fr.length) P.push('## Functional requirements\n\n' + fr.map((r) => box(id3('FR', r._k), r.stmt || '', r.fit, r.exec, r)).join('\n'));
  if (nfr.length) P.push('## Non-functional requirements\n\n' + nfr.map((r) => box(id3('NFR', r._k), r.stmt || '', r.fit, r.exec, r)).join('\n'));
  if (ir.length) P.push('## Interfaces\n\n' + ir.map((r) => box(id3('IR', r._k), (r.iface ? r.iface + ' - ' : '') + (r.req || ''), r.fit)).join('\n'));
  if (con.length) P.push('## Control function constraints\n\n' + con.map((r) => box(id3('CON', r._k), (r.constraint || '') + (r.owner ? ' (' + r.owner + ')' : ''), r.fit)).join('\n'));
  if (ev.length) P.push('## AI acceptance criteria\n\n' + ev.map((r) =>
    '- [ ] **' + id3('EVAL', r._k) + '** ' + (r.dim || '') + ' - ' + (r.metric || '') + ' - threshold: ' + (r.thresh || 'to confirm') + (r.dataset ? ' on ' + r.dataset : '')).join('\n') +
    (answers.golden ? '\n\nGolden dataset and red-team method: ' + answers.golden : ''));
  P.push('_A box is ticked when its fit criterion passes as stated. ' + NOT_A_SIGNATURE + '_');
  return P.join('\n\n');
}

const KEY_OF_PREFIX = Object.fromEntries(Object.entries(ROW_PREFIX).map(([k, v]) => [v, k]));
function changesMd(answers, meta, prevAnswers, prevLabel) {
  if (!prevAnswers) {
    const j = jsonRows(answers);
    const disc = ['clearance', 'ranking', 'findings', 'controls', 'returns'].reduce((n, k) => n + rowsFilled(answers[k]).length, 0);
    return '# v' + meta.label + ' - initial baseline\n\n' + fingerprintLine(meta) + '\n\n' +
      [j.fr.length + ' functional', j.nfr.length + ' non-functional', j.eval.length + ' AI acceptance', j.interfaces.length + ' interface']
        .join(' · ') + ' requirements' + (disc ? ' · ' + disc + ' discovery record ' + (disc === 1 ? 'row' : 'rows') : '') +
      (rowsFilled(answers.decisions).length ? ' · ' + rowsFilled(answers.decisions).length + ' decisions' : '') + '.' + (meta.note ? '\n\n> ' + meta.note : '');
  }
  const rd = reqDiff(prevAnswers, answers, ALL_GROUPS);
  const detail = reqDiffDetail(prevAnswers, answers, ALL_GROUPS);
  const stmtOf = (id) => {
    const [pre, k] = id.split('-');
    const key = KEY_OF_PREFIX[pre];
    const row = (answers[key] || []).find((r) => r && String(r._k) === String(+k)) || {};
    return row.stmt || row.dim || row.iface || row.decision || row.item || row.problem || row.finding || row.constraint || row.build || '';
  };
  const P = ['# Changes in v' + meta.label + ' (compared to v' + prevLabel + ')',
    [meta.author ? 'By ' + meta.author : null, day(meta.baselined), fingerprintLine(meta)].filter(Boolean).join(' · ') + (meta.note ? '\n\n> ' + meta.note : '')];
  if (rd.added.length) P.push('## Added\n\n' + rd.added.map((id) => '- **' + id + '** ' + clip(stmtOf(id), 120)).join('\n'));
  if (detail.length) P.push('## Modified\n\n' + detail.map((d) =>
    '**' + d.id + '**\n' + d.changes.map((c) => '- ' + c.label + ': ~~' + clip(c.from, 120) + '~~ → ' + clip(c.to, 120)).join('\n')).join('\n\n'));
  if (rd.removed.length) P.push('## Removed\n\n' + rd.removed.map((id) => '- ' + id).join('\n'));
  if (!rd.added.length && !detail.length && !rd.removed.length) P.push('No row-level changes.');
  return P.join('\n\n');
}

/* The assembled document, with the fingerprint on the line under its title so
   prd.md on its own still names the baseline. The title stays first. */
function prdMd(answers, meta) {
  const doc = assemble(buildSections(answers, meta.label, meta.versions || []), answers);
  const nl = doc.indexOf('\n');
  if (!doc.startsWith('# ') || nl < 0) return fingerprintLine(meta) + '\n\n' + doc;
  return doc.slice(0, nl) + '\n\n' + fingerprintLine(meta) + doc.slice(nl);
}

function readmeMd(meta) {
  return ['# Implementation package - ' + (meta.product || 'Untitled') + ' v' + meta.label,
    ['Status: ' + (meta.status || 'draft'), 'Baselined ' + day(meta.baselined), meta.approvedAt ? 'Approved ' + day(meta.approvedAt) : null]
      .filter(Boolean).join(' · '),
    '**requirements.json** - every requirement row with its permanent id, statement, fit criterion, test input and expected result, priority, component, promotion source, author and origin, and attested recorder; the signed thresholds with grader and pass rate; the discovery record, the decisions, the commercial thresholds and the glossary, machine readable.\n' +
    '**acceptance.md** - the fit criteria, the AI thresholds, the commercial thresholds and the testable control function constraints as a checklist.\n' +
    '**CHANGES.md** - what changed against the prior baseline, per column, with before and after, for every row that carries a permanent id.\n' +
    '**prd.md** - the full assembled document as of this baseline.\n' +
    '**knowledge/** - the same baseline as an Open Knowledge Format bundle (OKF 0.2): one concept file per row with YAML frontmatter, an index.md, a log.md. A Documenter agent folds it into the repository map; a knowledge agent reads it by path.',
    '## Fingerprint\n\n`' + (meta.fingerprint || '') + '`\n\nRecipe: ' + RECIPE +
    '\n\nThe client baseline report for v' + meta.label + ' carries this same fingerprint: the document the client signed and this package were produced from byte-identical baselines. ' + NOT_A_SIGNATURE
  ].join('\n\n');
}

/* input: { product, label, seq, status, note, author, baselined, approvedAt,
   fingerprint, answers, prevAnswers, prevLabel, versions } → [{name, text}] */
export function buildImplementationFiles(input) {
  const meta = input || {};
  const answers = meta.answers || {};
  const spec = {
    product: meta.product || '',
    version: clean({ label: meta.label, seq: meta.seq, status: meta.status, gate: meta.gate, baselined: meta.baselined, approvedAt: meta.approvedAt, note: meta.note, author: meta.author }),
    fingerprint: { algorithm: 'SHA-256', value: meta.fingerprint || '', recipe: RECIPE },
    requirements: jsonRows(answers),
    components: rowsFilled(answers.components).map((c) => clean({ name: c.name, owner: c.owner, status: c.status, description: c.desc })),
    ...jsonRecord(answers)
  };
  // The signed acceptance thresholds, machine-readable: each criterion is
  // anchored to a named eval set so the number cannot be cherry-picked. This
  // is content from the fingerprinted baseline.
  const ev = rowsFilled(answers.eval);
  if (ev.length) {
    // Permanent keys, identical to the printed document and the checklist:
    // one id per criterion across every artifact in the zip, forever.
    spec.acceptance = ev.map((r, i) => clean({
      id: id3('EVAL', r._k != null ? r._k : i + 1),
      dimension: r.dim, metric: r.metric, threshold: r.thresh,
      dataset: r.dataset, grader: r.grader, passRate: r.pass_rate, executedBy: r.exec || 'Human', component: r.comp
    }));
  }
  // Who signed, machine-readable. Approvals are record-state, not baseline
  // content: the fingerprint covers the baseline; this block reports the
  // approvals as of the latest decision on the record, and says so.
  if (Array.isArray(meta.approvals) && meta.approvals.length) {
    const recs = meta.approvals.map((x) => clean({ role: x.approver_role, name: x.approver_name, status: x.status, decided_at: x.decided_at }));
    const latest = meta.approvals.map((x) => x.decided_at).filter(Boolean).sort().pop();
    spec.approvals = clean({ note: 'Record-state at the latest decision; the fingerprint covers the baseline, not this block.', latest_decision_at: latest, records: recs });
  }
  // The knowledge map's generated-at is the baseline's own date, so two
  // exports of one baseline are byte-identical, as every other file is.
  const km = buildKnowledgeMap({ answers, label: meta.label, seq: meta.seq, fingerprint: meta.fingerprint || '', product: meta.product || '',
    versions: meta.versions || [], generatedAt: meta.baselined ? new Date(meta.baselined).toISOString() : '', appVersion: meta.appVersion || '' });
  return [
    { name: 'requirements.json', text: JSON.stringify(spec, null, 2) + '\n' },
    { name: 'acceptance.md', text: acceptanceMd(answers, meta) + '\n' },
    { name: 'CHANGES.md', text: changesMd(answers, meta, meta.prevAnswers || null, meta.prevLabel || '') + '\n' },
    { name: 'prd.md', text: prdMd(answers, meta) + '\n' },
    { name: 'README.md', text: readmeMd(meta) + '\n' },
    ...km.map((f) => ({ name: 'knowledge/' + f.name, text: f.text }))
  ];
}
