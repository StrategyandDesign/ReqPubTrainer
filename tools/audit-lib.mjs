/* ============================================================================
   Shared parsers for tools/audit.mjs (static gate) and tools/smoke.mjs (live
   prober). Everything here reads the repo as text; nothing touches a network.

   Exports:
     repoRoot()                absolute path of the repo (parent of tools/)
     listAppJs(root)           app/js/*.js, sorted (vendor excluded by layout)
     listServedHtml(root)      every .html the site serves
     parseSchemaFunctions(sql) [{name, args:[{name,type,hasDefault}], returns,
                                 callable, line}] from supabase/schema.sql
     extractRpcNames(js)       rpc('x') and sb.rpc('x') callsite names
     extractInvokeNames(js)    functions.invoke('x') and functions/v1/x names
     collectActions(files)     data-action symmetry inputs (markup, handlers,
                               references, indirect action: fields, failures)
     bannedHits(file, text)    em dash and AI-tell vocabulary findings
     BANNED_TERMS              the vocabulary list, edit here to tune the gate
   ============================================================================ */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

export function listAppJs(root) {
  return readdirSync(join(root, 'app', 'js'))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => join('app', 'js', f));
}

export function listServedHtml(root) {
  const out = [];
  const dirs = ['', 'app', 'login', 'signup'];
  for (const d of dirs) {
    for (const f of readdirSync(join(root, d || '.'))) {
      if (f.endsWith('.html')) out.push(d ? join(d, f) : f);
    }
  }
  return out.sort();
}

/* ---- schema.sql function parser ------------------------------------------ */
/* Walks every `create [or replace] function name(...)`, balances the argument
   parens (types like numeric(10,2) nest), splits arguments at depth zero, and
   captures the return type. `callable` is false for trigger functions, which
   PostgREST never exposes; the live prober must skip them. */
export function parseSchemaFunctions(sql) {
  const fns = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const name = m[1];
    let i = re.lastIndex, depth = 1, inQuote = false;
    while (i < sql.length && depth > 0) {
      const c = sql[i];
      if (inQuote) { if (c === "'") inQuote = false; }
      else if (c === "'") inQuote = true;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    const argBlob = sql.slice(re.lastIndex, i - 1);
    const tail = sql.slice(i, i + 200);
    const rm = tail.match(/^\s*returns\s+([a-z_][a-z0-9_ \[\]]*?)\s+(?:language|as)\b/i);
    const returns = rm ? rm[1].trim().toLowerCase() : '';
    const args = splitTopLevel(argBlob).map((a) => a.trim()).filter(Boolean).map((a) => {
      const parts = a.split(/\s+/);
      return { name: parts[0], type: parts.slice(1).join(' '), hasDefault: /\bdefault\b/i.test(a) };
    });
    const line = sql.slice(0, m.index).split('\n').length;
    fns.push({ name, args, returns, callable: returns !== 'trigger', line });
  }
  return fns;
}

function splitTopLevel(s) {
  const out = []; let depth = 0, cur = '', inQuote = false;
  for (const c of s) {
    if (inQuote) { cur += c; if (c === "'") inQuote = false; continue; }
    if (c === "'") { inQuote = true; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/* ---- backend callsite extraction ----------------------------------------- */
export function extractRpcNames(js) {
  const names = new Set();
  const re = /\brpc\(\s*['"]([a-z0-9_]+)['"]/gi;
  let m; while ((m = re.exec(js))) names.add(m[1]);
  return names;
}

export function extractInvokeNames(js) {
  const names = new Set();
  let m;
  const re1 = /functions\.invoke\(\s*['"]([a-z0-9-]+)['"]/gi;
  while ((m = re1.exec(js))) names.add(m[1]);
  const re2 = /functions\/v1\/([a-z0-9-]+)/gi;
  while ((m = re2.exec(js))) names.add(m[1]);
  return names;
}

/* ---- data-action symmetry ------------------------------------------------ */
/* Classification, per occurrence:
     markup      the attribute appears on rendered markup (template literal,
                 static HTML, or setAttribute); must have a handler
     handlers    a `case 'x':` inside handleAction, or a change-delegation
                 branch `t.matches('[data-action="x"]')`
     references  querySelector('[data-action="x"]') lookups; the button must
                 exist in markup and the action must have a handler
     indirect    `action: 'x'` object fields (palette items) that dispatch
                 through handleAction; must have a handler
   Dynamic `data-action="' + ident + '"` concatenations resolve through the
   enclosing helper: every call site must pass a string literal (or a ternary
   of two literals) at that parameter position, else the audit fails, because
   an action name the auditor cannot see is an action name it cannot gate. */
export function collectActions(files) {
  const markup = new Map(), references = new Map(), indirect = new Map();
  const handlers = new Map();
  const failures = [];
  const add = (map, name, where) => { if (!map.has(name)) map.set(name, []); map.get(name).push(where); };

  for (const { path, text } of files) {
    const isJs = path.endsWith('.js');
    const lines = text.split('\n');

    if (isJs && /async function handleAction/.test(text)) {
      const body = functionBody(text, text.indexOf('async function handleAction'));
      const startLine = text.slice(0, text.indexOf('async function handleAction')).split('\n').length;
      const caseRe = /case\s+'([\w-]+)'\s*:/g;
      let m; while ((m = caseRe.exec(body))) {
        add(handlers, m[1], path + ':' + (startLine + body.slice(0, m.index).split('\n').length - 1));
      }
    }

    lines.forEach((line, ix) => {
      const where = path + ':' + (ix + 1);

      let m;
      const matchRe = /\.matches\(\s*'\[data-action="([\w-]+)"\]/g;
      while ((m = matchRe.exec(line))) add(handlers, m[1], where);

      const qsRe = /querySelector(?:All)?\(\s*'\[data-action="([\w-]+)"\]/g;
      while ((m = qsRe.exec(line))) add(references, m[1], where);

      const setRe = /setAttribute\(\s*'data-action'\s*,\s*'([\w-]+)'/g;
      while ((m = setRe.exec(line))) add(markup, m[1], where);

      if (isJs) {
        const fieldRe = /(?<![\w.$])action:\s*'([\w-]+)'/g;
        while ((m = fieldRe.exec(line))) add(indirect, m[1], where);
      }

      const ternRe = /data-action="'\s*\+\s*\(([^()]*\?[^()]*:[^()]*)\)\s*\+\s*'"/g;
      while ((m = ternRe.exec(line))) {
        const lits = [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1]);
        if (lits.length) lits.forEach((l) => add(markup, l, where));
        else failures.push(where + ': dynamic data-action ternary with no string literals');
      }

      const dynRe = /data-action="'\s*\+\s*([A-Za-z_$][\w$]*)\s*\+\s*'"/g;
      while ((m = dynRe.exec(line))) {
        const resolved = resolveHelperLiterals(text, m[1], path);
        if (resolved.ok) resolved.names.forEach((n) => add(markup, n, where + ' via ' + resolved.helper + '()'));
        else failures.push(where + ': ' + resolved.error);
      }

      const litRe = /data-action="([\w-]+)"/g;
      while ((m = litRe.exec(line))) {
        const prev = line[m.index - 1];
        if (prev === '[') continue;               /* selector, classified above */
        add(markup, m[1], where);
      }
    });
  }
  return { markup, handlers, references, indirect, failures };
}

function functionBody(text, defIndex) {
  const open = text.indexOf('{', defIndex);
  let depth = 0, i = open;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) break; }
  }
  return text.slice(open, i + 1);
}

/* Find the function whose parameter list names `ident`, then pull the literal
   passed at that position from every call site in the same file. */
function resolveHelperLiterals(text, ident, path) {
  const defs = [];
  let m;
  const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>/g;
  while ((m = fnRe.exec(text))) {
    const name = m[1] || m[3], params = (m[2] ?? m[4] ?? '').split(',').map((p) => p.trim().split(/[=\s]/)[0]);
    const ix = params.indexOf(ident);
    if (name && ix >= 0) defs.push({ name, ix, at: m.index });
  }
  if (!defs.length) return { ok: false, error: 'dynamic data-action from "' + ident + '" with no resolvable helper in ' + path };
  const names = new Set();
  for (const d of defs) {
    /* A helper defined inside a function is called inside that function; the
       same short name in another scope is a different helper. Restrict the
       call-site scan to the enclosing body so the two never cross. */
    const scope = enclosingBody(text, d.at);
    const callRe = new RegExp('\\b' + d.name + '\\(', 'g');
    let c;
    while ((c = callRe.exec(scope.text))) {
      const abs = scope.start + c.index;
      if (abs === d.at || text.slice(Math.max(0, abs - 9), abs).match(/function\s$/)) continue;
      const args = argSplit(text, abs + c[0].length);
      if (args === null) continue;                      /* not a call site */
      const raw = (args[d.ix] || '').trim();
      const lit = raw.match(/^'([\w-]+)'$/);
      const tern = !lit && [...raw.matchAll(/'([\w-]+)'/g)].map((x) => x[1]);
      if (lit) names.add(lit[1]);
      else if (tern && tern.length && /\?/.test(raw)) tern.forEach((n) => names.add(n));
      else return { ok: false, error: 'call to ' + d.name + '() passes a non-literal "' + ident + '" (' + raw.slice(0, 40) + ') in ' + path };
    }
  }
  return { ok: true, names, helper: defs[0].name };
}

/* Innermost `function ...(){}` body containing position `at`; the whole file
   when the definition is top-level. */
function enclosingBody(text, at) {
  let best = { start: 0, text };
  const re = /function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{|function\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf('{', m.index);
    let depth = 0, i = open;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) break; }
    }
    if (open < at && at < i && open > best.start) best = { start: open, text: text.slice(open, i + 1) };
  }
  return best;
}

/* Split a call's arguments starting just after the opening paren; quote and
   depth aware, so 'var(--sky)' and nested calls survive. */
function argSplit(text, start) {
  const out = []; let depth = 1, cur = '', quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { cur += c; if (c === quote && text[i - 1] !== '\\') quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (depth === 0) { out.push(cur); return out; } }
    if (c === ',' && depth === 1) { out.push(cur); cur = ''; continue; }
    cur += c;
    if (i - start > 4000) return null;
  }
  return null;
}

/* ---- banned language ----------------------------------------------------- */
/* The em dash is banned outright. The vocabulary list is the set of tells that
   never appear in ReqPub's voice; matches are whole-word, case-insensitive.
   Domain uses of plain words ("unlocks Section 9") are not on this list on
   purpose: the list bans the tell, not the language. */
export const BANNED_TERMS = [
  'delve', 'delves', 'delving',
  'seamless', 'seamlessly',
  'leverage', 'leverages', 'leveraged', 'leveraging',
  'holistic', 'holistically', 'synergy', 'synergies',
  'empower', 'empowers', 'empowering',
  'supercharge', 'supercharged', 'unleash', 'unleashed',
  'game-changer', 'game-changing', 'cutting-edge', 'state-of-the-art',
  'best-in-class', 'world-class', 'revolutionize', 'revolutionizes',
  'transformative', 'utilize', 'utilizes', 'utilized', 'utilizing',
  'testament', 'tapestry', "in today's", 'it is important to note', "it's important to note",
];

export function bannedHits(path, text) {
  const hits = [];
  text.split('\n').forEach((line, ix) => {
    if (line.includes('\u2014')) hits.push({ where: path + ':' + (ix + 1), term: 'em dash', text: line.trim().slice(0, 90) });
    for (const term of BANNED_TERMS) {
      const re = new RegExp('(?<![\\w-])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])', 'i');
      if (re.test(line)) hits.push({ where: path + ':' + (ix + 1), term, text: line.trim().slice(0, 90) });
    }
  });
  return hits;
}
