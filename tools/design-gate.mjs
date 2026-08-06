#!/usr/bin/env node
/* ReqPub - the design gate.
 *
 * Two defects prompted this file, both found by measuring the live pages
 * rather than looking at them.
 *
 * CONTRAST. Every primary button sitting inside a nav rendered slate text on
 * a blue background at a contrast ratio of 2.12 to 1, against a WCAG AA
 * requirement of 4.5 for normal text. Nothing was wrong with the button rule.
 * `.site-head .links a` has specificity (0,2,1) and `.btn-primary` has
 * (0,1,0), so the nav quietly won and the button became unreadable. A rule
 * that sets a background without setting a colour is inviting exactly that,
 * so this gate refuses it.
 *
 * MEASURE. Body paragraphs ran 95 characters per line while leaving a 360
 * pixel gutter on the right: too long to read comfortably and too narrow to
 * look deliberate, at the same time. Both are the same defect, which is that
 * no measure was defined and a paragraph took whatever width its parent
 * happened to give it. The gate requires the measure tokens to exist and to
 * sit inside the readable range.
 *
 * --selftest runs violating fixtures through the same checks.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const hexToRgb = (h) => {
  const s = h.replace('#', '');
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};
const relLum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const l1 = relLum(hexToRgb(a)), l2 = relLum(hexToRgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/* Colour pairs that must stay readable, resolved from the tokens rather than
   typed twice. Each is a real surface in the product. */
export function checkContrast(css) {
  const v = [];
  const token = (name, fallback) => {
    const m = new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,6})').exec(css);
    return m ? m[1] : fallback;
  };
  const pairs = [
    ['primary button', token('brand', '#2563FF'), '#ffffff', 4.5],
    ['primary button, hover', token('brand-600', '#1d4ed8'), '#ffffff', 4.5],
    ['body text', '#ffffff', token('ink-2', '#1e1e1e'), 4.5],
    ['secondary text', '#ffffff', token('ink-3', '#334155'), 4.5],
    ['quiet text', '#ffffff', token('ink-4', '#475569'), 4.5],
    /* The audience card labels. Small uppercase text is normal text, not large
       text, so it needs 4.5. Two of these shipped at 4.24 and 3.34 and were
       darkened once the gate could see them. */
    ['card label, leading', token('sky', '#e6f0ff'), token('brand-700', '#1e40af'), 4.5],
    ['card label, funding', '#eef7ee', '#15803d', 4.5],
    ['card label, weigh in', '#e6f7fb', '#155e75', 4.5],
    ['card label, building', '#f1ebfd', '#7c3aed', 4.5],
    ['pricing flag', token('brand-700', '#1e40af'), '#ffffff', 4.5],
  ];
  for (const [what, bg, fg, min] of pairs) {
    const r = contrast(bg, fg);
    if (r < min) v.push(`CONTRAST  ${what}: ${fg} on ${bg} is ${r.toFixed(2)} to 1, below the ${min} required`);
  }
  /* The specificity trap that caused the defect. */
  if (/\.site-head\s+\.links\s+a\s*\{/.test(css)) {
    v.push('CONTRAST  .site-head .links a is unqualified and will override .btn-primary; exclude buttons with :not(.btn)');
  }
  /* A rule that paints a background must say what colour the text is. */
  for (const m of css.matchAll(/\.btn[\w-]*\s*(?:,[^{]*)?\{([^}]*)\}/g)) {
    const body = m[1];
    if (/background\s*:/.test(body) && !/(^|;)\s*color\s*:/.test(body) && !/transparent|none/.test(body)) {
      const name = /\.btn[\w-]*/.exec(m[0])[0];
      v.push(`CONTRAST  ${name} sets a background without a colour, so its text is whatever wins the cascade`);
    }
  }
  return v;
}

export function checkMeasure(css) {
  const v = [];
  const m = /--measure:\s*(\d+)ch/.exec(css);
  const w = /--measure-wide:\s*(\d+)ch/.exec(css);
  if (!m) { v.push('MEASURE   no --measure token; a paragraph will take whatever width its parent gives it'); return v; }
  const n = Number(m[1]);
  if (n < 45 || n > 75) v.push(`MEASURE   --measure is ${n}ch, outside the readable range of 45 to 75`);
  if (w && Number(w[1]) > 80) v.push(`MEASURE   --measure-wide is ${w[1]}ch, past the point where a reader loses the next line`);
  if (!/\.wrap\.prose|\.measure\b/.test(css)) v.push('MEASURE   the measure tokens exist but nothing applies them');
  return v;
}

if (process.argv.includes('--selftest')) {
  const bad = [
    ...checkContrast('--brand:#8ab4ff;\n.site-head .links a{color:#334155}\n.btn-primary{background:var(--brand)}'),
    ...checkMeasure('--measure:110ch; --measure-wide:130ch; .measure{}'),
    ...checkMeasure('body{}'),
  ];
  const classes = ['CONTRAST', 'MEASURE'];
  const silent = classes.filter((c) => !bad.some((b) => b.startsWith(c)));
  if (silent.length) { console.error('design gate selftest FAILED: silent classes: ' + silent.join(', ')); process.exit(1); }
  console.log('design gate selftest: every class fires on the violating fixture (' + bad.length + ' violations named)');
  process.exit(0);
}

const css = existsSync(join(ROOT, 'site.css')) ? read('site.css') : '';

/* Card accents are declared inline on the page, so the page is read alongside
   the stylesheet. A colour the gate cannot see is a colour that drifts. */
const inline = existsSync(join(ROOT, 'index.html')) ? read('index.html') : '';
const violations = [...checkContrast(css + '\n' + inline), ...checkMeasure(css)];

/* Every page that ships its own stylesheet needs its own measure. index.html
   does not load site.css: it carries a complete inline stylesheet, so a
   measure added to site.css reached the legal pages and the verify page and
   never reached the most-read page on the site. The gate read site.css and
   reported success while the homepage ran 134-character lines. A gate that
   reads one file and speaks for all of them is worse than no gate, because it
   ends the search. */
for (const file of readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
  const html = read(file);
  if (/href="\/?site\.css"/.test(html)) continue;              // covered by the stylesheet check
  const own = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  if (!/\.wrap|\.block/.test(own)) continue;                    // not a layout stylesheet
  for (const v of checkMeasure(own)) violations.push(v.replace('MEASURE   ', `MEASURE   ${file}: `));
}

/* Any inline pair on the page must also appear in the checked list above, or
   it is an accent nobody is watching. */
for (const m of inline.matchAll(/background:(#[0-9a-fA-F]{6})[^"]*color:(?:var\(--([\w-]+)\)|(#[0-9a-fA-F]{6}))/g)) {
  const bg = m[1];
  const fg = m[3] || (new RegExp('--' + m[2] + ':\\s*(#[0-9a-fA-F]{3,6})').exec(css + inline) || [])[1];
  if (!fg) continue;
  const r = contrast(bg, fg);
  if (r < 4.5) violations.push(`CONTRAST  an inline pair on index.html, ${fg} on ${bg}, is ${r.toFixed(2)} to 1`);
}

if (violations.length) {
  for (const x of violations) console.error('DESIGN GATE  ' + x);
  console.error(`design gate: ${violations.length} violation${violations.length === 1 ? '' : 's'}`);
  process.exit(1);
}
const m = /--measure:\s*(\d+)ch/.exec(css)[1];
console.log(`design gate: every colour pair meets WCAG AA, no button paints a background without a colour, ` +
  `and the measure is ${m} characters, inside the readable range`);
