/* ReqPub v2 - intake: populate a blank record from pasted or uploaded text.
   The team member has documents (often drafted with an AI assistant) and
   wants them landed into the record's own framework: the right question,
   the right shape, permanent IDs, provenance stamped. This module is the
   deterministic mapper - pure functions, no network, no AI calls, fully
   unit-tested - so what lands is exactly what the rules say lands, every
   time, and the preview the user approves is the truth.

   Discipline: intake NEVER overwrites a non-empty field. Long and short
   answers are filled only when blank; list and row questions are appended.
   Requirements rows carry src = 'Import · <source>' so provenance renders
   exactly like discovery promotion. Unrecognized sections are never guessed:
   they go to an "unplaced" bucket the user assigns by hand or skips. */
import { Q } from './domain.js';

/* ---------------- segmentation ---------------- */
/* Split raw text into titled segments. Recognized heading forms: markdown
   (#..######), a bold line (**Title**), an ALLCAPS line, a short numbered
   line (1. Title), and setext underlines (=== / ---). Text before the first
   heading becomes an untitled preamble segment. */
export function segmentText(text, source) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const segs = [];
  let title = '';
  let depth = 1;
  let num = '';
  let buf = [];
  const push = () => {
    const body = buf.join('\n').trim();
    if (title || body) segs.push({ title: title.trim(), depth, num, body, source: source || '' });
    buf = [];
  };
  const headOf = (line, next) => {
    let m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) return m[1];
    m = line.match(/^\*\*(.+?)\*\*:?\s*$/);
    if (m) return m[1];
    // ALLCAPS heading: letters, digits, spaces and light punctuation, no
    // sentence period, short enough to be a title rather than a shout, and
    // at least one real word of three letters - table cells like "M M1 T"
    // land as their own lines in a shredded PDF and must never split the
    // document.
    if (/^[A-Z][A-Z0-9 \/&\-()]{3,60}$/.test(line.trim()) && !/[.]$/.test(line.trim()) && /[A-Z]{3}/.test(line.trim())) return line.trim();
    // Numbered heading: short, capitalized, and not a list item that happens
    // to start a long sentence.
    m = line.match(/^(\d+(?:\.\d+)?)[.)]?\s+([A-Z].{2,58})$/);
    if (m && !/[.]$/.test(m[2])) return { t: m[2], d: m[1].includes('.') ? 2 : 1, num: m[1] };
    // Setext: this line is a title if the NEXT line is all = or -.
    if (next != null && /^\s*(={3,}|-{3,})\s*$/.test(next) && line.trim() && line.trim().length <= 70) return line.trim();
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(={3,}|-{3,})\s*$/.test(line) && i > 0 && headOf(lines[i - 1], line)) continue; // consumed as setext underline
    let h = headOf(line, lines[i + 1]);
    if (h != null) {
      if (typeof h === 'string') h = { t: h, d: line.trim().startsWith('##') ? 2 : 1 };
      push(); title = h.t; depth = h.d; num = h.num || ''; continue;
    }
    buf.push(line);
  }
  push();
  return segs;
}

/* ---------------- classification ---------------- */
/* Two tiers, both deterministic. Tier one: a heading that IS one of the
   record's own question labels lands on that question, exactly - the label
   the manual dropdown offers is a label the classifier hears, always, and a
   question rename stays recognized because the vocabulary is derived from
   the question bank itself. Tier two: heading keywords → question ids, first
   match wins. The keyword map is deliberately conservative: only targets
   whose shape we can land faithfully. Anything else stays unplaced and the
   user decides. Unplaced beats misplaced, so a keyword may never route a
   section to a DIFFERENT question than the one wearing that exact label. */
const MAP = [
  [/\b(out of scope|non-?goals?|exclusions?|will not|won'?t)\b/, 'sol_out'],
  [/\b(in scope|scope)\b/, 'sol_in'],
  // Safeguarding is its own home, never a generic quality attribute: this
  // content needs clinical and policy review, and burying it in the NFR
  // table as "to confirm" rows is the misfile that hurt most in the field.
  [/\b(safeguard(ing)?)\b/, 'safeguard'],
  [/\b(non-?functional|nfrs?|quality attributes?|privacy)\b/, 'nfr'],
  [/\b(functional requirements?|features?|user stories)\b/, 'fr'],
  [/\b(acceptance criteria|evaluation criteria|eval(uation)?s?|thresholds?)\b/, 'eval'],
  [/\b(golden (data)?set)\b/, 'golden'],
  [/\b(success metrics?|metrics?|kpis?)\b/, 'metrics'],
  // OKRs are phase-scoped delivery rows, not overview goals; the goals
  // keyword no longer swallows them.
  [/\b(okrs?|key results?)\b/, 'okrs'],
  [/\b(goals?|objectives?)\b/, 'ov_goals'],
  [/\b(user segments?|segmentation)\b/, 'seg'],
  // "Purpose and audience ..." is purpose; before this entry ran first, the
  // audience keyword handed the record's own opening section to Personas.
  [/\b(purpose)\b/, 'ov_purpose'],
  [/\b(personas?|target users?|users|audience)\b/, 'persona'],
  [/\b(problem|pain points?|challenge)\b/, 'ov_problem'],
  [/\b(vision)\b/, 'ov_vision'],
  [/\b(market|competitive landscape|competitors?)\b/, 'ov_market'],
  [/\b(overview|summary|abstract|introduction|background)\b/, 'ov_purpose'],
  [/\b(consent)\b/, 'consent'],
  [/\b(solution|approach|how it works)\b/, 'sol_solution'],
  [/\b(components?|modules?|architecture)\b/, 'components'],
  [/\b(assumptions?)\b/, 'assume'],
  [/\b(dependenc(y|ies))\b/, 'depend'],
  [/\b(constraints?|limitations?)\b/, 'constrain'],
  [/\b(release plan)\b/, 'release'],
  [/\b(gates?|milestones?|phases?|releases?|timeline)\b/, 'gates'],
  [/\b(decisions?)\b/, 'decisions'],
  [/\b(interfaces?|integrations?|apis?)\b/, 'interfaces'],
  [/\b(data (entities|model)|entities)\b/, 'data_entities'],
  [/\b(data residency|residency)\b/, 'residency'],
  [/\b(retention|deletion)\b/, 'retention'],
  [/\b(access control)\b/, 'access'],
  [/\b(operating (context|environment)|context of use)\b/, 'context'],
  // "Risks and issues" lands in the live risks home. A bare "Risks" heading
  // still stays unplaced: too many documents use it for content that is not
  // a delivery row, and unplaced beats misplaced.
  [/\b(risks? (and|&) issues?)\b/, 'updates'],
  [/\b(people and roles|roles and responsibilities|project team)\b/, 'people'],
  [/\b(glossary|terminology|definitions?|people and words)\b/, 'glossary'],
  [/\b(never build|prohibitions?)\b/, 'constrain'],
  [/\b(open items?|open questions?)\b/, 'decisions'],
  [/\b(verification|testing approach|test strategy)\b/, 'verify_note'],
];
/* What shape each recognized target takes when it lands: the question's own
   type, derived from the bank so it cannot drift. Control questions, choice
   questions, and retired questions are never intake targets. */
const KIND = {};
for (const q of Q) {
  if (q.sec === 'control' || q.retired) continue;
  if (q.type === 'long' || q.type === 'short' || q.type === 'list' || q.type === 'rows') KIND[q.id] = q.type;
}
export const intakeKind = (qid) => KIND[qid] || null;
const normLabel = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/\s*[.:]\s*$/, '').trim();
const LABEL2QID = {};
for (const q of Q) if (KIND[q.id]) LABEL2QID[normLabel(q.prompt)] = q.id;
export function classifySegment(title) {
  const t = normLabel(title);
  if (!t) return null;
  if (LABEL2QID[t]) return LABEL2QID[t];
  for (const [rx, qid] of MAP) if (rx.test(t)) return qid;
  return null;
}

/* ---------------- record-form documents (FC-PRD-001 dialect) ----------- */
/* Running footers, page stamps, and form feeds from a shredded PDF, plus
   the two-line SECTION and PILLAR headings folded into single heading lines
   the segmenter already understands. Conservative by regex: anything this
   does not recognize passes through untouched. */
export function normalizeRecordDoc(text) {
  let t = String(text || '').replace(/\f/g, '\n');
  t = t.split('\n').filter((line) => {
    const l = line.trim();
    if (/^PAGE \d+$/.test(l)) return false;
    if (/^[A-Z][A-Z0-9-]{3,}(\s*\u00b7\s*.+)+\s+PAGE \d+$/.test(l)) return false;
    return true;
  }).join('\n');
  t = t.replace(/^\s*SECTION\s+(\d+)\s*\n+\s*([A-Z].{2,70}?)\.?[ \t]*$/gm, '$1. $2');
  t = t.replace(/^\s*PILLAR\s+(ONE|TWO|THREE|FOUR|FIVE)\s*\n+\s*([A-Z].{2,70}?)\.?[ \t]*$/gm, '# $2');
  return t;
}

/* Record-form glossaries write UPPERCASE TERM then the definition on one
   line; record-form open items write OI-N sentences. Both become rows. */
export function plainGlossaryRows(body) {
  const out = [];
  for (const l of String(body || '').split('\n')) {
    const m = l.trim().match(/^([A-Z][A-Z \-]{1,28}?)\s{1,}([A-Z].{4,})$/);
    if (m && m[1] === m[1].toUpperCase()) out.push({ term: m[1].trim(), def: m[2].trim() });
  }
  return out;
}
export function plainDecisionRows(body) {
  const out = [];
  for (const l of String(body || '').split('\n')) {
    const m = l.trim().match(/^(OI-\d+|D-?\d+)\s+(.+)$/);
    if (m) out.push({ decision: m[1] + ' ' + m[2] });
  }
  return out;
}

const REC_ID = /^([A-Z]{2,4}-\d{1,3})\s+(.{2,64})$/;
const REC_TAIL = /\b(MUST|SHOULD)\b\s*\u00b7\s*R(\d)\s*\u00b7\s*VERIFY\s+(DEMO|INSPECT|TEST)\b/i;
const sentenceCase = (u) => { const w = String(u || '').trim(); return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''; };

/* A segment is a requirement record when its heading is an ID plus label and
   its body carries a Done means criterion. Returns the fr row or null. */
export function recordFromSegment(seg) {
  const m = (seg && seg.title || '').match(REC_ID);
  if (!m) return null;
  const body = String(seg.body || '').replace(/\n+/g, '\n').trim();
  const dm = body.match(/(^|\n)\s*Done means\.?\s*/i);
  if (!dm) return null;
  const cut = body.indexOf(dm[0]) + dm[0].length;
  const stmtText = body.slice(0, body.indexOf(dm[0])).replace(/\s+/g, ' ').trim();
  let fitText = body.slice(cut);
  const tail = fitText.match(REC_TAIL);
  let pri = '', release = '', method = '';
  if (tail) {
    pri = tail[1].toUpperCase() === 'MUST' ? 'Must' : 'Should';
    release = 'R' + tail[2];
    method = tail[3].toUpperCase();
    fitText = fitText.slice(0, fitText.indexOf(tail[0]));
  }
  fitText = fitText.replace(/\s+/g, ' ').trim();
  const fit = fitText + (method ? (fitText.endsWith('.') ? '' : '.') + ' Verify ' + method + '.' : '');
  return {
    stmt: m[1] + ' \u00b7 ' + sentenceCase(m[2]) + (stmtText ? '. ' + stmtText : ''),
    fit, pri, comp: release,
  };
}

/* ---------------- extraction primitives ---------------- */
const stripMd = (s) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').trim();
/* mammoth's markdown writer escapes punctuation so its output round-trips
   as markdown ("closes late every month\."). Left alone, those backslashes
   land verbatim in stored answers. This undoes exactly that escape set - a
   backslash before markdown punctuation - and nothing else: real headings
   and bullets were never escaped, and a literal backslash in the source
   arrives doubled, so one pass restores it. */
export function mdUnescape(s) {
  return String(s || '').replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
}
/* Bulk paste (v2.30.0). A requirements list usually already exists in
   Word or Excel; re-keying it cell by cell is the slowest path in the
   product. Pasted text normalizes to the markdown the extractor already
   speaks: a pipe table passes through; tab-separated lines (an Excel or
   Word table on the clipboard) become a pipe table, with the first line
   kept as the header only when its cells look like headers; plain lines
   become bullets. The same deterministic extraction, the same inference,
   the same preview-before-apply. Input is capped at 256 KB. */
const PASTE_CAP = 262144;
const HEADER_VOCAB = new Set(['id', 'ref', 'identifier', 'requirement', 'statement', 'shall', 'fit',
  'fit criterion', 'criterion', 'criteria', 'acceptance', 'pri', 'priority', 'moscow', 'ver',
  'verification', 'rel', 'release', 'dimension', 'metric', 'threshold', 'target', 'dataset', 'set',
  'term', 'meaning', 'definition', 'persona', 'user', 'role', 'job', 'name', 'gate', 'milestone',
  'decision', 'basis', 'rationale', 'owner', 'date', 'interface', 'description', 'label', 'method',
  'verified by', 'notes', 'comp', 'component']);
export function pasteRowsMd(text) {
  let t = String(text || '');
  if (t.length > PASTE_CAP) t = t.slice(0, PASTE_CAP);
  t = t.replace(/\r\n?/g, '\n');
  const lines = t.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  if (!lines.length) return '';
  if (lines.some((l) => l.trim().startsWith('|'))) return lines.join('\n');
  if (lines.some((l) => l.includes('\t'))) {
    const cells = (l) => l.split('\t').map((c) => c.replace(/\|/g, '/').trim());
    const first = cells(lines[0]);
    const headery = first.filter((c) => HEADER_VOCAB.has(c.toLowerCase())).length >= Math.max(1, Math.ceil(first.length / 2));
    const row = (cs) => '| ' + cs.join(' | ') + ' |';
    const sep = '|' + first.map(() => ' --- ').join('|') + '|';
    if (headery) return [row(first), sep, ...lines.slice(1).map((l) => row(cells(l)))].join('\n');
    // No header on the clipboard: a blank header row keeps every pasted
    // line as data and hands the column roles to content inference.
    return [row(first.map(() => ' ')), sep, ...lines.map((l) => row(cells(l)))].join('\n');
  }
  return lines.map((l) => (/^[-*\u2022]\s/.test(l.trim()) ? '- ' + l.trim().replace(/^[-*\u2022]\s+/, '') : '- ' + l.trim())).join('\n');
}
export function pasteToRows(qid, text) {
  return extractRows(qid, pasteRowsMd(text), 'paste');
}

/* When a PDF yields no text at all, the reason decides the advice, and the
   page operators tell the reason. A scan draws one big image per page and
   little else: run OCR or paste the text. Outlined text (a design-tool
   export with fonts converted to curves) draws hundreds of filled paths
   and no text operators: nothing is copyable from that file in ANY viewer,
   so the only fix is at the source - re-export with real text, or upload
   the .docx. Input: one {images, paths, text} count per probed page.
   Majority verdict across pages; scanned outranks outlined on a tie. */
export function pdfEmptyDiagnosis(pageOps) {
  let scanned = 0, outlined = 0;
  for (const pg of pageOps || []) {
    if (!pg || pg.text > 0) continue;
    if ((pg.images || 0) > 0 && (pg.paths || 0) < 50) scanned++;
    else if ((pg.paths || 0) >= 50) outlined++;
  }
  if (!scanned && !outlined) return 'empty';
  return scanned >= outlined ? 'scanned' : 'outlined';
}

/* mammoth's HTML output -> the segmenter's markdown, tables intact. The
   markdown writer in mammoth flattens tables into bare paragraphs - the
   exact shredding the PDF path suffered - while its HTML preserves them.
   mammoth emits a small, flat, predictable tag set (h1-h6, p, ul/ol/li,
   table/tr/td, strong/em/a, br), so a bounded walker converts it: tables
   become pipe tables, headings become #-headings, list items become
   bullets, paragraphs become lines, and everything else is stripped to
   its text. Pure, deterministic, and covered by unit tests. */
const htmlDecode = (t) => String(t || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const htmlCellText = (h) => htmlDecode(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
/* Block text keeps its entities: the final pass strips real tags first and
   decodes once at the end, so a decoded "<text>" is never re-eaten. */
const htmlBlockText = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export function htmlToIntakeMd(html) {
  const tables = [];
  let s2 = String(html || '').replace(/<table[\s\S]*?<\/table>/gi, (m) => {
    const rows = [...m.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((tr) => [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => htmlCellText(c[1])));
    if (!rows.length) return '\n';
    const md = ['| ' + rows[0].join(' | ') + ' |', '|' + rows[0].map(() => ' --- ').join('|') + '|',
      ...rows.slice(1).map((r) => '| ' + r.join(' | ') + ' |')];
    tables.push(md.join('\n'));
    return '\n@@T' + (tables.length - 1) + '@@\n';
  });
  s2 = s2
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, d, t) => '\n' + '#'.repeat(+d) + ' ' + htmlBlockText(t) + '\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, t) => '\n- ' + htmlBlockText(t))
    .replace(/<br\s*\/?>(?=.)/gi, '\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (m, t) => '\n' + htmlBlockText(t) + '\n')
    .replace(/<[^>]+>/g, ' ');
  s2 = htmlDecode(s2).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n');
  s2 = s2.replace(/@@T(\d+)@@/g, (m, i) => '\n' + tables[+i] + '\n');
  return s2.replace(/\n{3,}/g, '\n\n').trim();
}

/* pdf.js text items → plain text with the line structure the segmenter
   needs. Input: one array of {str, hasEOL} items per page, exactly as
   page.getTextContent() returns them. str carries its own spacing; hasEOL
   marks the layout line breaks, so ALLCAPS and numbered headings survive
   as their own lines. Pages join with a blank line. Pure and deterministic:
   the only pdf.js call sites are in main.js; everything testable is here. */
/* The geometry engine (v2.28.0). A consulting-grade PRD is mostly tables,
   and a table shredded to text lines is unreadable to the mapper: statement
   and fit-criterion cells interleave, and Pri/Rel/Ver cells land as bare
   "M M1 T" lines. pdf.js gives every fragment its exact x and y, and that
   is enough to rebuild the table deterministically: fragments cluster into
   visual lines by y; recurring x positions are the columns; a new logical
   row begins when text lands in the leftmost column; continuation lines
   merge into the open row's cells. Detected tables are emitted as markdown
   pipe tables - the mapper's native tongue, same as the docx path - and
   everything else stays prose. Running headers and footers (same text on
   most pages, digits normalized) are dropped. Items without coordinates
   degrade to the plain hasEOL join, so old callers and fixtures keep their
   exact behavior. Pure and deterministic throughout. */
const Y_TOL = 2.5, X_SNAP = 3, MIN_COL_SUPPORT = 3;
export function pdfMarkdownFromItems(pages) {
  pages = pages || [];
  const hasGeo = pages.some((its) => (its || []).some((i) => i && typeof i.x === 'number' && typeof i.y === 'number'));
  if (!hasGeo) return pdfTextFromItems(pages);

  // Visual lines per page: cluster by y, fragments sorted by x.
  const pageLines = pages.map((items) => {
    const frags = (items || []).filter((i) => i && String(i.str || '').trim());
    frags.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lines = [];
    for (const f of frags) {
      const cur = lines[lines.length - 1];
      if (cur && Math.abs(cur.y - f.y) <= Y_TOL) cur.frags.push(f);
      else lines.push({ y: f.y, frags: [f] });
    }
    lines.forEach((l) => l.frags.sort((a, b) => a.x - b.x));
    return lines;
  });

  // Running header/footer: identical short lines (digits normalized) on
  // most pages are page furniture, not content.
  const furniture = new Set();
  if (pageLines.length >= 3) {
    const freq = {};
    for (const lines of pageLines) {
      for (const l of lines) {
        const t = l.frags.map((f) => f.str).join(' ').trim().replace(/\d+/g, '#');
        if (t && t.length <= 120) freq[t] = (freq[t] || 0) + 1;
      }
    }
    const bar = Math.max(2, Math.ceil(pageLines.length * 0.6));
    for (const [t, c] of Object.entries(freq)) if (c >= bar) furniture.add(t);
  }

  const snap = (x, cols) => cols.find((c) => Math.abs(c - x) <= X_SNAP);
  const out = [];
  for (const lines of pageLines) {
    const kept = lines.filter((l) => !furniture.has(l.frags.map((f) => f.str).join(' ').trim().replace(/\d+/g, '#')));
    // Column candidates for this page: x positions that recur.
    const xc = {};
    for (const l of kept) for (const f of l.frags) { const k = Math.round(f.x / X_SNAP) * X_SNAP; xc[k] = (xc[k] || 0) + 1; }
    const cols = Object.entries(xc).filter(([, c]) => c >= MIN_COL_SUPPORT).map(([x]) => +x).sort((a, b) => a - b);
    // A line is tabular when every fragment sits on a recurring column and
    // it is not a lone paragraph opener: two or more fragments, or one
    // fragment starting at a column other than the first (a wrapped cell
    // continuing). Independently, four or more aligned fragments on one
    // visual line are self-evidently tabular even before their columns
    // recur - that is how a one-row page stub earns its table.
    const colOf = (f) => { const c = snap(f.x, cols); return c === undefined ? Math.round(f.x / X_SNAP) * X_SNAP : c; };
    const isTab = (l) => {
      if (l.frags.length >= 4) return true;
      if (!cols.length) return false;
      const snaps = l.frags.map((f) => snap(f.x, cols));
      if (snaps.some((s) => s === undefined)) return false;
      return l.frags.length >= 2 || (snaps[0] !== undefined && snaps[0] !== cols[0]);
    };
    const chunks = [];
    for (const l of kept) {
      const cur = chunks[chunks.length - 1];
      const tab = isTab(l);
      if (cur && cur.tab === tab) cur.lines.push(l);
      else chunks.push({ tab, lines: [l] });
    }
    const pageOut = [];
    for (const ch of chunks) {
      if (!ch.tab) {
        pageOut.push(ch.lines.map((l) => l.frags.map((f) => f.str).join(' ').replace(/[ \t]+/g, ' ').trim()).join('\n'));
        continue;
      }
      // Region columns: the x positions this run actually uses.
      const used = [...new Set(ch.lines.flatMap((l) => l.frags.map((f) => colOf(f))))].sort((a, b) => a - b);
      // Logical rows. A new row begins when the leftmost column receives
      // text - but a narrow ID cell can WRAP ("EVAL-M2-0" / "1"), putting
      // text in the first column mid-row. The vertical rhythm settles it:
      // line spacing inside a row is the smallest gap in the region, and
      // real row boundaries sit visibly below it. When every gap is equal
      // (no cell wraps anywhere), the leftmost-text rule stands alone.
      const gaps = [];
      for (let gi = 1; gi < ch.lines.length; gi++) gaps.push(Math.abs(ch.lines[gi - 1].y - ch.lines[gi].y));
      const g0 = gaps.length ? Math.min(...gaps) : 0;
      const uniform = !gaps.length || Math.max(...gaps) <= g0 * 1.15;
      const rows = [];
      let prevY = null;
      for (const l of ch.lines) {
        const first = colOf(l.frags[0]) === used[0];
        const gapUp = prevY == null ? Infinity : Math.abs(prevY - l.y);
        const newRow = first && (uniform || gapUp > g0 * 1.3);
        if (newRow || !rows.length) rows.push(new Map());
        const row = rows[rows.length - 1];
        for (const f of l.frags) {
          const c = colOf(f);
          row.set(c, ((row.get(c) || '') + ' ' + f.str).trim());
        }
        prevY = l.y;
      }
      const ok3 = used.length >= 3 && rows.length >= 2;
      const ok2 = used.length === 2 && rows.length >= 3;
      const ok1 = used.length >= 4 && rows.length === 1;
      if (!ok3 && !ok2 && !ok1) {
        pageOut.push(ch.lines.map((l) => l.frags.map((f) => f.str).join(' ').trim()).join('\n'));
        continue;
      }
      const cell = (row, c) => String(row.get(c) || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
      const md = [];
      md.push('| ' + used.map((c) => cell(rows[0], c)).join(' | ') + ' |');
      md.push('|' + used.map(() => ' --- ').join('|') + '|');
      for (const r of rows.slice(1)) md.push('| ' + used.map((c) => cell(r, c)).join(' | ') + ' |');
      pageOut.push(md.join('\n'));
    }
    if (pageOut.length) out.push(pageOut.join('\n\n'));
  }
  return out.join('\n\n');
}
export function pdfTextFromItems(pages) {
  const chunks = (pages || []).map((items) => {
    let out = '';
    for (const it of items || []) {
      out += String((it && it.str) || '');
      if (it && it.hasEOL) out += '\n';
    }
    return out.replace(/[ \t]+\n/g, '\n').trim();
  }).filter(Boolean);
  return chunks.join('\n\n');
}
export function bulletItems(body) {
  return String(body || '').split('\n')
    .map((l) => l.match(/^\s*(?:[-*\u2022]|\d+[.)])\s+(.+)$/))
    .filter(Boolean).map((m) => stripMd(m[1]));
}
/* First markdown table in the body → { headers, rows } of trimmed cells. */
export function mdTableIn(body) {
  const lines = String(body || '').split('\n').map((l) => l.trim());
  const start = lines.findIndex((l, i) => l.startsWith('|') && /^\|?[\s:|-]+\|?$/.test(lines[i + 1] || ''));
  if (start < 0) return null;
  const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => stripMd(c));
  const headers = cells(lines[start]).map((h) => h.toLowerCase());
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(cells(lines[i]));
  return rows.length ? { headers, rows } : null;
}
/* Every pipe table in a body, in order. Multi-table sections are the norm
   for a real PRD: one requirements table per surface, headers repeated per
   page by the geometry engine. */
export function mdTablesAll(body) {
  const lines = String(body || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim().startsWith('|') && /^\|[\s\-|]+\|$/.test(lines[i + 1].trim())) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => stripMd(c));
      const headersRaw = cells(lines[i]);
      const headers = headersRaw.map((h) => h.toLowerCase());
      const rows = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(cells(lines[j]));
      if (rows.length || headersRaw.some((h) => h.trim())) out.push({ headers, headersRaw, rows });
      i = j - 1;
    }
  }
  return out;
}
/* "Head: rest" or "Head - rest" split for pairing bullets into two columns. */
export function splitPair(text) {
  const m = String(text || '').match(/^(.{2,80}?)(?::\s+| - )(.+)$/);
  return m ? { head: m[1].trim(), rest: m[2].trim() } : { head: String(text || '').trim(), rest: '' };
}
const pick = (headers, cellsRow, names) => {
  for (const n of names) {
    const i = headers.findIndex((h) => h.includes(n));
    if (i >= 0) return cellsRow[i] || '';
  }
  return '';
};
const priOf = (s) => {
  const t = String(s || '').trim();
  // MoSCoW letters, the compact form a requirements table actually uses.
  if (/^[MSCW]$/i.test(t)) return { m: 'Must', s: 'Should', c: 'Could', w: "Won't" }[t.toLowerCase()];
  return /\b(must|shall)\b/i.test(t) ? 'Must' : /\bshould\b/i.test(t) ? 'Should' : /\b(could|may|nice[- ]to[- ]have)\b/i.test(t) ? 'Could' : /\bwon'?t\b/i.test(t) ? "Won't" : '';
};
/* Permanent identifiers (FR-M1-001, SM-3, D-2) are doctrine in a serious
   PRD: they never change, so they must survive intake. The record's own
   row IDs are positional, so a source ID travels as a prefix on the row's
   primary text. */
const idColIndex = (headers) => (headers || []).findIndex((h) => ['id', 'ref', '#', 'identifier', 'release'].includes(String(h).trim()));
const ID_RX = /^[A-Z]{1,6}(-[A-Z0-9]{1,6})*-?\d+[A-Za-z0-9]*$/;
const idNorm = (v) => { const d = String(v || '').replace(/\s+/g, ''); return ID_RX.test(d) ? d : String(v || '').trim(); };
const withId = (id, text) => { id = idNorm(id); text = String(text || '').trim(); return id && text ? id + ': ' + text : text || id; };
/* A serious PRD's requirement tables sometimes arrive headerless: the PDF
   draws the header row as one text run, so the geometry engine cannot split
   it, and the first data row lands as the markdown header. Content gives
   the columns away deterministically: an ID column is IDs (FR-M1-001), a
   MoSCoW column is single letters, and of what remains the widest column
   is the statement and the next widest the fit criterion. When the header
   row itself is data (its first cell is an ID), it is restored as a row
   from the raw, uncased cells. */
export function inferColumns(table) {
  const n = table.headers.length;
  const all = [table.headersRaw || table.headers, ...table.rows];
  const share = (i, test) => all.filter((r) => test(String(r[i] || '').trim())).length / all.length;
  const avg = (i) => all.reduce((a, r) => a + String(r[i] || '').length, 0) / all.length;
  const cols = [...Array(n).keys()];
  // A narrow ID cell wraps in the PDF ("EVAL-M2-0 1"), so the pattern is
  // tested on the de-spaced value; the leftmost qualifying column wins,
  // which keeps a Rel column ("M2") from stealing the id role.
  const despace = (c) => String(c || '').replace(/\s+/g, '');
  const idc = cols.find((i) => share(i, (c) => ID_RX.test(despace(c))) >= 0.6);
  const pric = cols.find((i) => i !== idc && share(i, (c) => /^[MSCW]$/i.test(c)) >= 0.6);
  const wide = cols.filter((i) => i !== idc && i !== pric && avg(i) > 4).sort((a, b) => avg(b) - avg(a));
  // Of the two widest columns, the LEFT one is the statement and the RIGHT
  // one the fit criterion: column order is semantic in a requirements
  // table, and fit criteria often out-run their statements in length.
  const two = wide.slice(0, 2).sort((a, b) => a - b);
  return {
    idc: idc == null ? -1 : idc, pric: pric == null ? -1 : pric,
    stmtc: two.length ? two[0] : -1, fitc: two.length > 1 ? two[1] : -1,
    headerIsData: ID_RX.test(despace((table.headersRaw || table.headers)[0] || '')),
  };
}
/* A table landing in a list-shaped question: one line per row - the ID, the
   longest content cells joined, a Label column carried in parens. */
export function listFromTable(table) {
  const inf = inferColumns(table);
  const named = idColIndex(table.headers);
  const idc = named >= 0 ? named : inf.idc;
  let labc = table.headers.findIndex((h) => h.trim() === 'label');
  // A three-column id table without named headers reads as id, statement,
  // label - the Collection Ventures template's own Assumptions shape.
  if (labc < 0 && idc >= 0 && inf.fitc >= 0 && table.headers.length === 3) labc = inf.fitc;
  const rows = inf.headerIsData ? [table.headersRaw || table.headers, ...table.rows] : table.rows;
  return rows.map((r) => {
    const parts = r.filter((_, i) => i !== idc && i !== labc).map((c) => String(c || '').trim()).filter(Boolean);
    const label = labc >= 0 ? String(r[labc] || '').trim() : '';
    return withId(idc >= 0 ? r[idc] : '', parts.join(' - ')) + (label ? ' (' + label + ')' : '');
  }).filter((t) => t.trim());
}
const fitSplit = (s) => {
  const m = String(s).match(/^(.*?)\s*(?:\bAcceptance:|\bFit:)\s*(.+)$/i);
  return m ? { stmt: m[1].trim().replace(/[.;,]$/, ''), fit: m[2].trim() } : { stmt: s, fit: '' };
};

/* ---------------- extraction per target ---------------- */
export function extractRows(qid, body, source) {
  const src = 'Import · ' + (source || 'document');
  const tables = mdTablesAll(body);
  const items = bulletItems(body);
  // Bullets are the only non-table source of rows. The old whole-body
  // fallback turned a section's intro prose into one junk row; a rows
  // section with neither bullets nor tables contributes nothing, honestly.
  const fallback = items;
  // Table-first: a real PRD carries its rows as tables, often several per
  // section. Every table in the body is read; named headers map when they
  // exist, and headerless tables (the PDF drew the header as one text run)
  // fall back to inferred columns; the source's permanent IDs ride as a
  // prefix on the primary text; columns the record has no home for (Rel,
  // Ver) are dropped and the uploaded document stays their source of truth.
  const fromTables = (make) => {
    const out = [];
    for (const t of tables) {
      const inf = inferColumns(t);
      const named = idColIndex(t.headers);
      const idc = named >= 0 ? named : inf.idc;
      const rows = inf.headerIsData ? [t.headersRaw || t.headers, ...t.rows] : t.rows;
      for (const r of rows) { const row = make(t, r, idc >= 0 ? r[idc] : '', inf); if (row) out.push(row); }
    }
    return out;
  };
  switch (qid) {
    case 'fr': case 'nfr': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          const stmt = pick(t.headers, r, ['requirement', 'statement', 'shall']) || (inf.stmtc >= 0 ? r[inf.stmtc] : '');
          if (!String(stmt || '').trim() || String(stmt).trim() === id) return null;
          const fit = pick(t.headers, r, ['fit', 'acceptance', 'criterion', 'criteria']) || (inf.fitc >= 0 ? r[inf.fitc] : '');
          const pri = pick(t.headers, r, ['pri', 'moscow']) || (inf.pric >= 0 ? r[inf.pric] : '');
          return { stmt: withId(id, stmt), fit: String(fit || '').trim() || 'to confirm', pri: priOf(pri), comp: '', src };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => {
        const f = fitSplit(tx);
        return { stmt: f.stmt, fit: f.fit || 'to confirm', pri: priOf(tx), comp: '', src };
      });
    }
    case 'eval': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          const dim = pick(t.headers, r, ['dimension', 'quality', 'requirement']) || (inf.stmtc >= 0 ? r[inf.stmtc] : '');
          if (!String(dim || '').trim() || String(dim).trim() === id) return null;
          return { dim: withId(id, dim),
                   metric: pick(t.headers, r, ['metric', 'method', 'fit']) || (inf.fitc >= 0 ? r[inf.fitc] : '') || 'to confirm',
                   thresh: pick(t.headers, r, ['threshold', 'target']) || 'to confirm',
                   dataset: pick(t.headers, r, ['set', 'dataset']) || 'to confirm', comp: '' };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => ({ dim: splitPair(tx).head, metric: splitPair(tx).rest, thresh: 'to confirm', dataset: 'to confirm', comp: '' }));
    }
    case 'metrics': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          const metric = pick(t.headers, r, ['metric', 'kpi', 'name']) || (inf.stmtc >= 0 ? r[inf.stmtc] : '');
          if (!String(metric || '').trim() || String(metric).trim() === id) return null;
          return { metric: withId(id, metric), target: pick(t.headers, r, ['target', 'goal']) || (inf.fitc >= 0 ? r[inf.fitc] : ''),
                   method: pick(t.headers, r, ['method', 'measure', 'verified', 'how']) };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { metric: p.head, target: p.rest, method: '' }; });
    }
    case 'glossary': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          const term = pick(t.headers, r, ['term', 'word']) || String(r[0] || '');
          const def = pick(t.headers, r, ['meaning', 'definition']) || String(r[1] || '');
          return String(term).trim() && String(def).trim() ? { term: term.trim(), def: def.trim() } : null;
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { term: p.head, def: p.rest }; }).filter((r) => r.term);
    }
    case 'persona': {
      if (tables.length) {
        const rows = fromTables((t, r) => {
          const persona = pick(t.headers, r, ['persona', 'user', 'role', 'who']) || String(r[0] || '');
          const needs = pick(t.headers, r, ['job', 'needs', 'description', 'goal']) || String(r[1] || '');
          return String(persona).trim() && String(needs).trim() ? { persona: persona.trim(), needs: needs.trim() } : null;
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { persona: p.head, needs: p.rest }; });
    }
    case 'seg': {
      if (tables.length) {
        const rows = fromTables((t, r) => {
          const segment = pick(t.headers, r, ['segment', 'name']) || String(r[0] || '');
          if (!String(segment).trim()) return null;
          return { segment: segment.trim(), share: String(pick(t.headers, r, ['share', 'priority', 'size']) || r[1] || '').trim(),
                   desc: String(pick(t.headers, r, ['description', 'desc']) || r[2] || '').trim() };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { segment: p.head, share: '', desc: p.rest }; });
    }
    case 'people': {
      if (tables.length) {
        const rows = fromTables((t, r) => {
          const name = pick(t.headers, r, ['name', 'person', 'who']) || String(r[0] || '');
          const role = pick(t.headers, r, ['role', 'title', 'responsibilit']) || String(r[1] || '');
          return String(name).trim() ? { name: name.trim(), role: String(role || '').trim() } : null;
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { name: p.head, role: p.rest }; });
    }
    case 'release': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          // 'Release' doubles as the row's own name (idColIndex claims it),
          // so the id-echo guard and the id prefix both stand down here.
          const rel = pick(t.headers, r, ['release', 'version', 'name']) || (inf.stmtc >= 0 ? r[inf.stmtc] : '') || String(r[0] || '');
          if (!String(rel || '').trim()) return null;
          return { rel: String(rel).trim(), obj: pick(t.headers, r, ['objective', 'delivers', 'description', 'goal']) || (inf.fitc >= 0 ? r[inf.fitc] : ''),
                   mvp: pick(t.headers, r, ['mvp']), ship: pick(t.headers, r, ['release date', 'ship', 'launch', 'date']) };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { rel: p.head, obj: p.rest, mvp: '', ship: '' }; });
    }
    case 'okrs': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          const objective = pick(t.headers, r, ['objective', 'goal']) || (inf.stmtc >= 0 ? r[inf.stmtc] : '');
          if (!String(objective || '').trim() || String(objective).trim() === id) return null;
          const done = String(pick(t.headers, r, ['done', 'status']) || '').trim();
          return { objective: withId(id, objective),
                   kr: String(pick(t.headers, r, ['key result', 'kr', 'result', 'measure']) || (inf.fitc >= 0 ? r[inf.fitc] : '') || '').trim(),
                   done: done ? (/\b(done|complete)/i.test(done) ? 'Done' : 'Open') : '', phase: String(pick(t.headers, r, ['phase']) || '').trim() };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { objective: p.head, kr: p.rest, done: '', phase: '' }; });
    }
    case 'updates': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          const title = pick(t.headers, r, ['title', 'risk or issue', 'name']) || (inf.stmtc >= 0 ? r[inf.stmtc] : '');
          const desc = pick(t.headers, r, ['description', 'desc', 'what']) || (inf.fitc >= 0 ? r[inf.fitc] : '');
          if (!String(title || '').trim() && !String(desc || '').trim()) return null;
          const ty = String(pick(t.headers, r, ['type']) || '').trim();
          return { type: /^r/i.test(ty) ? 'Risk' : /^i/i.test(ty) ? 'Issue' : '',
                   title: withId(id, String(title || '').trim()), desc: String(desc || '').trim(),
                   action: pick(t.headers, r, ['action', 'mitigation', 'response']), owner: pick(t.headers, r, ['owner', 'who']),
                   delivery: pick(t.headers, r, ['delivery', 'due', 'date']), status: pick(t.headers, r, ['status']) || 'Open',
                   notes: pick(t.headers, r, ['notes']) };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => {
        const m = tx.match(/^(risk|issue)\s*[:\-·]\s*(.+)$/i);
        const type = m ? (m[1][0].toUpperCase() === 'R' ? 'Risk' : 'Issue') : '';
        const p = splitPair(m ? m[2] : tx);
        return p.rest ? { type, title: p.head, desc: p.rest, status: 'Open' } : { type, title: '', desc: m ? m[2] : tx, status: 'Open' };
      });
    }
    case 'components':
      return fallback.map((t) => { const p = splitPair(t); return { name: p.head, owner: '', status: '', desc: p.rest }; });
    case 'interfaces': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          const iface = pick(t.headers, r, ['interface', 'iface', 'requirement']) || (inf.stmtc >= 0 ? r[inf.stmtc] : '');
          if (!String(iface || '').trim() || String(iface).trim() === id) return null;
          return { iface: withId(id, iface), req: '',
                   fit: pick(t.headers, r, ['fit', 'criterion', 'acceptance']) || (inf.fitc >= 0 ? r[inf.fitc] : '') };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { iface: p.head, req: p.rest, fit: '' }; });
    }
    case 'gates': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          const gate = pick(t.headers, r, ['gate', 'milestone', 'phase', 'name']) || (inf.stmtc >= 0 ? r[inf.stmtc] : '');
          if (!String(gate || '').trim() || String(gate).trim() === id) return null;
          return { gate: withId(id, gate), criteria: pick(t.headers, r, ['criteria', 'exit', 'done', 'closes']) || (inf.fitc >= 0 ? r[inf.fitc] : ''),
                   decider: pick(t.headers, r, ['decider', 'owner', 'who']), target: pick(t.headers, r, ['date', 'target', 'when']) };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { gate: p.head, criteria: p.rest, decider: '', target: '' }; });
    }
    case 'decisions': {
      if (tables.length) {
        const rows = fromTables((t, r, id, inf) => {
          const decision = pick(t.headers, r, ['decision']) || (inf.stmtc >= 0 ? r[inf.stmtc] : '');
          if (!String(decision || '').trim() || String(decision).trim() === id) return null;
          return { decision: withId(id, decision), options: pick(t.headers, r, ['options', 'alternatives']),
                   rationale: pick(t.headers, r, ['basis', 'rationale', 'why']) || (inf.fitc >= 0 ? r[inf.fitc] : ''),
                   owner: pick(t.headers, r, ['decided', 'owner', 'who']), date: pick(t.headers, r, ['date', 'when']), supersedes: '' };
        });
        if (rows.length) return rows;
      }
      return fallback.map((tx) => { const p = splitPair(tx); return { decision: p.head, options: '', rationale: p.rest, owner: '', date: '', supersedes: '' }; });
    }
    case 'data_entities':
      return fallback.map((t) => { const p = splitPair(t); return { entity: p.head, sens: p.rest }; });
    default:
      return [];
  }
}

/* ---------------- the plan ---------------- */
/* files: [{ name, text }] → { placements, unplaced }. One placement per
   target: longs merge across files (blank line between), lists and rows
   concatenate. Segments with unrecognized titles land in unplaced. */
export function mapArtifacts(files) {
  const byQid = {};
  const unplaced = [];
  for (const f of files || []) {
    let parent = { qid: null, num: '' };
    for (const seg of segmentText(normalizeRecordDoc(f.text), f.name)) {
      const rec = recordFromSegment(seg);
      if (rec) {
        const p = byQid.fr || (byQid.fr = { qid: 'fr', kind: 'rows', sources: [], value: '', rows: [] });
        if (!p.sources.includes(f.name || 'pasted text')) p.sources.push(f.name || 'pasted text');
        p.rows.push(rec);
        continue;
      }
      // A numbered subsection whose number proves the nesting (7.4 under 7)
      // belongs to its rows-shaped parent no matter what its own title
      // says: "the CI gate" inside Functional Requirements is functional
      // requirements, not stage gates. Everywhere else a section speaks
      // for itself (1.1 Goals under Overview classifies as goals), and an
      // unrecognized title stays unplaced - unplaced beats misplaced.
      let qid = classifySegment(seg.title);
      const nested = seg.num && parent.num && seg.num.indexOf(parent.num + '.') === 0;
      if (seg.depth > 1 && nested && parent.qid && intakeKind(parent.qid) === 'rows') qid = parent.qid;
      if (seg.depth === 1) parent = { qid: classifySegment(seg.title), num: seg.num || '' };
      if (!qid) {
        if (seg.body) unplaced.push({ title: seg.title || '(untitled)', body: seg.body, source: f.name || 'pasted text' });
        continue;
      }
      const kind = intakeKind(qid);
      const p = byQid[qid] || (byQid[qid] = { qid, kind, sources: [], value: '', rows: [] });
      if (!p.sources.includes(f.name || 'pasted text')) p.sources.push(f.name || 'pasted text');
      if (kind === 'long' || kind === 'short') p.value = p.value ? p.value + '\n\n' + seg.body : seg.body;
      else if (kind === 'list') p.rows.push(...listItemsFrom(seg.body).map((t) => ({ text: t })));
      else {
        let rows = extractRows(qid, seg.body, f.name);
        if (!rows.length && qid === 'glossary') rows = plainGlossaryRows(seg.body);
        if (!rows.length && qid === 'decisions') rows = plainDecisionRows(seg.body);
        p.rows.push(...rows);
      }
      if (p.kind !== 'long' && p.kind !== 'short' && !p.rows.length && seg.body) {
        unplaced.push({ title: seg.title || '(untitled)', body: seg.body, source: f.name || 'pasted text' });
      }
    }
  }
  const placements = Object.values(byQid).filter((p) => (p.kind === 'long' || p.kind === 'short' ? p.value.trim() : p.rows.length));
  return { placements, unplaced };
}

/* A list-shaped body → one string per item. Bullets first; a list section
   arriving as a table (Goals, Assumptions with ID and Label columns) lands
   one line per row, ID and label kept; record-form prose lists (Never
   build) write one item per line with no bullet marks. */
export function listItemsFrom(body) {
  const bl = bulletItems(body);
  let rows = bl.length ? bl : mdTablesAll(body).flatMap(listFromTable);
  if (!rows.length) rows = String(body || '').split('\n').map((l) => l.trim()).filter((l) => /^[A-Z].{4,}/.test(l));
  return rows;
}

/* One unplaced section, one user-chosen home → the same landing shape the
   classifier would produce. Prose targets take the body verbatim (the caller
   appends, never overwrites); list and rows targets run the same
   deterministic extractors, so a routed table lands exactly like a
   classified one. Zero extracted rows is an honest answer the preview shows
   before anything is written. */
export function routeUnplaced(qid, body, source) {
  const kind = intakeKind(qid);
  if (!kind) return null;
  if (kind === 'long' || kind === 'short') return { kind, value: String(body || '').trim(), rows: [] };
  if (kind === 'list') return { kind, value: '', rows: listItemsFrom(body).map((t) => ({ text: t })) };
  let rows = extractRows(qid, body, source);
  if (!rows.length && qid === 'glossary') rows = plainGlossaryRows(body);
  if (!rows.length && qid === 'decisions') rows = plainDecisionRows(body);
  return { kind, value: '', rows };
}

/* Selected placements + current answers → concrete write operations, with
   the never-overwrite rule applied and reported. `answers` is the current
   field-value map; rows are inherently additive so they always land. */
export function applyPlan(placements, answers) {
  const ops = [];
  const kept = [];
  for (const p of placements || []) {
    if (p.kind === 'long' || p.kind === 'short') {
      const cur = String((answers || {})[p.qid] || '').trim();
      if (cur) { kept.push(p.qid); continue; }   // existing content is never touched
      ops.push({ kind: 'field', qid: p.qid, value: p.value });
    } else {
      for (const r of p.rows) ops.push({ kind: 'row', qid: p.qid, data: r });
    }
  }
  return { ops, kept };
}

/* ---------------- execution ---------------- */
/* Run the ops through the repo's rev-checked RPC wrappers, sequentially, in
   plan order - the same discipline applyTemplate uses, so imported content
   is indistinguishable from typed content at the storage layer. Field ops
   may carry baseRev (the caller knows the live field revisions); rows insert
   with a server-generated id. onStep reports progress for the UI. */
export async function executeOps(repo, pid, ops, onStep) {
  const out = { ok: true, fields: 0, rows: 0, failed: 0 };
  let done = 0;
  for (const op of ops || []) {
    const r = op.kind === 'field'
      ? await repo.saveField(pid, op.qid, op.value, op.baseRev || 0)
      : await repo.upsertRow(pid, op.qid, null, op.data);
    if (r.error || !r.data || !r.data.ok) { out.failed++; out.ok = false; }
    else if (op.kind === 'field') out.fields++;
    else out.rows++;
    done++;
    if (onStep) onStep(done, (ops || []).length);
  }
  return out;
}
