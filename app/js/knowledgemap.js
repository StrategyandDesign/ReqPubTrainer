/* ReqPub v3.2 - the knowledge map: the baseline as an Open Knowledge Format
   bundle (OKF 0.2, github.com/GoogleCloudPlatform/knowledge-catalog, okf/SPEC.md).
   One concept document per requirement, criterion, interface, decision,
   glossary term and discovery entry, each a markdown file with YAML
   frontmatter whose only required key is `type`; an index.md at the bundle
   root with headed sections of links; a log.md of the revision history,
   newest first, under ISO date headings. A Documenter agent folds the
   bundle into a repository map; a knowledge agent reads it by path.

   Pure: a stored snapshot in, a list of {name, text} out, deterministic for
   an unchanged baseline. The frontmatter carries the fingerprint and the
   baseline label on every concept, so a single file handed on alone still
   names the exact version it came from. Nothing here is computed over the
   record: every value is a cell a person wrote, placed under a key. */
import { rowsFilled, idOf } from './domain.js';

/* YAML scalars, quoted when anything in them could be read as structure. */
const y = (v) => {
  const s = String(v == null ? '' : v);
  if (s === '') return '""';
  if (/^[A-Za-z0-9 ._()/%+-]+$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/^[-+.]?\d/.test(s)) return s;
  return JSON.stringify(s);
};
const ylist = (arr) => '[' + arr.map(y).join(', ') + ']';
/* OKF concept ids are file paths without .md; the row's permanent id is the
   file name, so a link like /requirements/FR-003 is stable across versions. */
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'term';

function concept({ path, type, title, description, tags, fields, body, meta }) {
  const fm = ['---', 'type: ' + y(type), 'title: ' + y(title)];
  if (description) fm.push('description: ' + y(description));
  if (tags && tags.length) fm.push('tags: ' + ylist(tags));
  fm.push('generated:', '  by: ' + y('ReqPub ' + meta.appVersion), '  at: ' + y(meta.generatedAt));
  fm.push('reqpub:', '  id: ' + y(meta.id), '  baseline: ' + y(meta.label), '  fingerprint: ' + y(meta.fingerprint));
  if (meta.author) fm.push('  author: ' + y(meta.author));
  if (meta.origin) fm.push('  origin: ' + y(meta.origin));
  if (meta.recordedBy) fm.push('  recordedBy: ' + y(meta.recordedBy));
  fm.push('---');
  const lines = ['# ' + title, ''];
  (fields || []).forEach(([label, value]) => { if (value) lines.push('**' + label + '.** ' + String(value).replace(/\n+/g, ' ')); });
  if (body) lines.push('', body);
  return { name: path + '.md', text: fm.join('\n') + '\n\n' + lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n' };
}

const rowMeta = (base, id, r) => ({ ...base, id, author: r._author || '', origin: r._origin || '', recordedBy: r._by || '' });

/* input: { answers, label, seq, fingerprint, product, versions, generatedAt, appVersion }
   output: [{name, text}] with names relative to the bundle root (no leading slash). */
export function buildKnowledgeMap(input) {
  const a = input.answers || {};
  const base = { label: input.label, fingerprint: input.fingerprint || '', generatedAt: input.generatedAt || '', appVersion: input.appVersion || '' };
  const files = [];
  const index = {};
  const add = (section, file, title, description) => {
    files.push(file);
    (index[section] = index[section] || []).push({ path: '/' + file.name.replace(/\.md$/, ''), title, description });
  };

  rowsFilled(a.fr).forEach((r, i) => {
    const id = idOf('FR', r, i);
    add('Functional requirements', concept({ path: 'requirements/' + id, type: 'requirement', title: id + ' ' + (r.stmt || ''), description: r.fit || '',
      tags: ['functional', r.pri || 'Must', r.exec || 'Human', ...(r.comp ? [r.comp] : [])],
      fields: [['Fit criterion', r.fit], ['Test input', r.input], ['Expected result', r.expected], ['Priority', r.pri || 'Must'], ['Executed by', r.exec || 'Human'], ['Component', r.comp], ['Source', r.src]],
      meta: rowMeta(base, id, r) }), id, r.stmt || '');
  });
  rowsFilled(a.nfr).forEach((r, i) => {
    const id = idOf('NFR', r, i);
    add('Non-functional requirements', concept({ path: 'requirements/' + id, type: 'requirement', title: id + ' ' + (r.stmt || ''), description: r.fit || '',
      tags: ['non-functional', r.pri || 'Must', r.exec || 'Human', ...(r.comp ? [r.comp] : [])],
      fields: [['Fit criterion', r.fit], ['Test input', r.input], ['Expected result', r.expected], ['Priority', r.pri || 'Must'], ['Executed by', r.exec || 'Human'], ['Component', r.comp], ['Source', r.src]],
      meta: rowMeta(base, id, r) }), id, r.stmt || '');
  });
  rowsFilled(a.eval).forEach((r, i) => {
    const id = idOf('EVAL', r, i);
    add('Evaluation criteria', concept({ path: 'evaluation/' + id, type: 'evaluation-criterion', title: id + ' ' + (r.dim || ''), description: (r.metric || '') + (r.thresh ? ', threshold ' + r.thresh : ''),
      tags: ['evaluation', r.exec || 'Human', ...(r.comp ? [r.comp] : [])],
      fields: [['Metric and method', r.metric], ['Threshold', r.thresh], ['Eval set', r.dataset], ['Grader', r.grader], ['Pass rate', r.pass_rate], ['Executed by', r.exec || 'Human'], ['Component', r.comp]],
      meta: rowMeta(base, id, r) }), id, r.dim || '');
  });
  rowsFilled(a.interfaces).forEach((r, i) => {
    const id = idOf('IR', r, i);
    add('Interfaces', concept({ path: 'interfaces/' + id, type: 'interface-requirement', title: id + ' ' + (r.iface || ''), description: r.req || '',
      tags: ['interface', ...(r.comp ? [r.comp] : [])],
      fields: [['Requirement', r.req], ['Fit criterion', r.fit], ['Component', r.comp]],
      meta: rowMeta(base, id, r) }), id, r.iface || '');
  });
  rowsFilled(a.ranking).forEach((r, i) => {
    const id = idOf('RANK', r, i);
    add('Ranked problems', concept({ path: 'discovery/ranking/' + id, type: 'ranked-problem', title: id + ' ' + (r.problem || ''), description: r.mechanism || '',
      tags: ['discovery', 'ranking', ...(r.status ? [r.status] : [])],
      fields: [['Rank', r.rank], ['Mechanism', r.mechanism], ['Priced gap', r.gap], ['Status', r.status]],
      meta: rowMeta(base, id, r) }), id, r.problem || '');
  });
  rowsFilled(a.clearance).forEach((r, i) => {
    const id = idOf('CLR', r, i);
    add('Clearance', concept({ path: 'discovery/clearance/' + id, type: 'clearance', title: id + ' ' + (r.item || ''), description: r.scope || '',
      tags: ['discovery', 'clearance', ...(r.status ? [r.status] : [])],
      fields: [['Scope', r.scope], ['Approved by', r.approver], ['Date', r.date], ['Status', r.status]],
      meta: rowMeta(base, id, r) }), id, r.item || '');
  });
  rowsFilled(a.findings).forEach((r, i) => {
    const id = idOf('FND', r, i);
    add('Findings', concept({ path: 'discovery/findings/' + id, type: 'finding', title: id + ' ' + (r.finding || ''), description: r.contradicts ? 'Contradicts ' + r.contradicts : '',
      tags: ['discovery', 'finding', ...(r.kind ? [r.kind] : [])],
      fields: [['Contradicts', r.contradicts], ['Source', r.source], ['Owner', r.owner], ['Kind', r.kind]],
      meta: rowMeta(base, id, r) }), id, r.finding || '');
  });
  rowsFilled(a.controls).forEach((r, i) => {
    const id = idOf('CON', r, i);
    add('Control function constraints', concept({ path: 'discovery/constraints/' + id, type: 'constraint', title: id + ' ' + (r.constraint || ''), description: r.fit || '',
      tags: ['discovery', 'constraint', (r.negotiable || 'No') === 'Yes' ? 'negotiable' : 'non-negotiable'],
      fields: [['Control function', r.owner], ['Fit criterion', r.fit], ['Negotiable', r.negotiable || 'No']],
      meta: rowMeta(base, id, r) }), id, r.constraint || '');
  });
  rowsFilled(a.returns).forEach((r, i) => {
    const id = idOf('REL', r, i);
    add('Release reviews', concept({ path: 'discovery/releases/' + id, type: 'release-review', title: id + ' ' + (r.build || ''), description: r.result ? 'Suite result ' + r.result : '',
      tags: ['discovery', 'release-review', ...(r.result ? [r.result] : [])],
      fields: [['Build reference', r.build], ['Baseline fingerprint', r.fingerprint], ['Suite result', r.result], ['Notes', r.notes], ['Accepted by', r.accepted], ['Date', r.date]],
      meta: rowMeta(base, id, r) }), id, r.build || '');
  });
  rowsFilled(a.decisions).forEach((r, i) => {
    const id = idOf('DEC', r, i);
    add('Decisions', concept({ path: 'decisions/' + id, type: 'decision', title: id + ' ' + (r.decision || ''), description: r.rationale || '',
      tags: ['decision', ...(r.kind ? [r.kind] : [])],
      fields: [['Concerns', r.ref], ['Kind', r.kind], ['Options considered', r.options], ['Rationale', r.rationale], ['Decided by', r.owner], ['Date', r.date], ['Supersedes', r.supersedes]],
      meta: rowMeta(base, id, r) }), id, r.decision || '');
  });
  rowsFilled(a.glossary).forEach((r) => {
    const name = slug(r.term);
    add('Glossary', concept({ path: 'glossary/' + name, type: 'term', title: r.term || '', description: r.def || '',
      tags: ['glossary'], fields: [['Definition', r.def]], meta: { ...base, id: r.term || '' } }), r.term || '', r.def || '');
  });

  /* index.md: no frontmatter beyond the bundle version, headed sections of
     bulleted links with one-line descriptions, in record order. */
  const head = ['---', 'okf_version: "0.2"', '---', '', '# ' + (input.product || 'Record') + ' v' + input.label, '',
    'The signed baseline as a knowledge bundle. Fingerprint `' + base.fingerprint + '` (recipe in requirements.json). ' +
    'Every concept below is a row a person wrote; the frontmatter names its author, origin and recorder where the record holds them. Nothing is computed.', ''];
  const order = ['Ranked problems', 'Clearance', 'Findings', 'Control function constraints', 'Functional requirements', 'Non-functional requirements', 'Evaluation criteria', 'Interfaces', 'Decisions', 'Release reviews', 'Glossary'];
  order.forEach((sec) => {
    const items = index[sec];
    if (!items || !items.length) return;
    head.push('## ' + sec, '');
    items.forEach((it) => head.push('- [' + it.title + '](' + it.path + ')' + (it.description ? ': ' + String(it.description).replace(/\n+/g, ' ') : '')));
    head.push('');
  });
  files.unshift({ name: 'index.md', text: head.join('\n') + '\n' });

  /* log.md: the revision history as date-grouped entries, newest first,
     with ISO date headings as the specification requires. */
  const vs = (input.versions || []).slice().sort((p, q) => (q.seq || 0) - (p.seq || 0));
  const log = ['# Log', '', 'Exported from v' + input.label + ', fingerprint `' + base.fingerprint + '`. Newest first.', ''];
  vs.forEach((v) => {
    const at = v.createdAt || v.created_at;
    const d = at ? new Date(at).toISOString().slice(0, 10) : '';
    log.push('## ' + d, '', '- **' + (v.seq === 1 ? 'Creation' : 'Update') + '** v' + v.label + (v.author_name || v.author ? ' by ' + (v.author_name || v.author) : '') + ': ' + (v.note || (v.seq === 1 ? 'Initial baseline' : 'Revision')), '');
  });
  files.push({ name: 'log.md', text: log.join('\n').replace(/\n{3,}/g, '\n\n') + '\n' });
  return files;
}
