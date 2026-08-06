#!/usr/bin/env node
/* ReqPub v2.53 - SPEC-to-schema parity. docs/SPEC.md carries a required-field
   table per format; each schema carries required lists. This script holds
   them equal, both directions, at every nesting the tables name:
   top-level rows against schema.required, parent.child rows against
   properties[parent].required, and files[].field rows against
   properties.files.items.required. A drift in either artifact fails the
   build with the exact field named. Node builtins only. */
import { readFileSync } from 'node:fs';

const spec = readFileSync('docs/SPEC.md', 'utf8');
const formats = [
  ['schemas/reqpub-baseline-bundle.schema.json'],
  ['schemas/reqpub-receipt.schema.json'],
  ['schemas/reqpub-evidence-manifest.schema.json'],
];

let failed = 0;
const bad = (m) => { failed++; console.error('PARITY MISMATCH  ' + m); };
const same = (a, b) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

for (const [file] of formats) {
  const schema = JSON.parse(readFileSync(file, 'utf8'));
  const at = spec.indexOf(file);
  if (at < 0) { bad(file + ' is never named in SPEC.md'); continue; }
  const section = spec.slice(at, spec.indexOf('\n## ', at) > 0 ? spec.indexOf('\n## ', at) : spec.length);
  const rows = [...section.matchAll(/^\| ([^|]+?) \| [^|]+ \| (yes|no) \|$/gm)]
    .map((m) => ({ field: m[1].trim(), required: m[2] === 'yes' }));
  if (!rows.length) { bad(file + ' has no parseable table in SPEC.md'); continue; }

  const topSpec = rows.filter((r) => r.required && !r.field.includes('.') && !r.field.includes('[')).map((r) => r.field);
  if (!same(topSpec, schema.required || []))
    bad(file + ' top level: SPEC says [' + topSpec.join(', ') + '], schema says [' + (schema.required || []).join(', ') + ']');

  const parents = new Set(rows.filter((r) => r.field.includes('.') && !r.field.includes('[')).map((r) => r.field.split('.')[0]));
  for (const p of parents) {
    const specKids = rows.filter((r) => r.required && r.field.startsWith(p + '.')).map((r) => r.field.slice(p.length + 1));
    const schemaKids = (schema.properties && schema.properties[p] && schema.properties[p].required) || [];
    if (!same(specKids, schemaKids))
      bad(file + ' ' + p + ': SPEC says [' + specKids.join(', ') + '], schema says [' + schemaKids.join(', ') + ']');
  }

  const arrs = new Set(rows.filter((r) => r.field.includes('[]')).map((r) => r.field.split('[]')[0]));
  for (const a of arrs) {
    const specItems = rows.filter((r) => r.required && r.field.startsWith(a + '[].')).map((r) => r.field.slice(a.length + 3));
    const schemaItems = (schema.properties && schema.properties[a] && schema.properties[a].items && schema.properties[a].items.required) || [];
    if (!same(specItems, schemaItems))
      bad(file + ' ' + a + '[]: SPEC says [' + specItems.join(', ') + '], schema says [' + schemaItems.join(', ') + ']');
  }
}

if (failed) { console.error('spec-schema parity: ' + failed + ' mismatch' + (failed === 1 ? '' : 'es')); process.exit(1); }
console.log('spec-schema parity: SPEC.md tables and schema required lists agree at every named level');
