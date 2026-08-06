#!/usr/bin/env node
/* Writes the repository map into README.md between sentinel comments.
 *
 * The previous map was maintained by hand, listed files rather than
 * directories, and had rotted: it named paths that no longer existed and
 * omitted directories that did. A map nobody can regenerate is a map that
 * drifts, so this one is generated and CI fails if the file changes.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PURPOSE = {
  'app': 'The application: a static shell, no build step, what is committed is what runs',
  'docs': 'Documentation, including the normative formats other people implement against',
  'schemas': 'JSON Schemas for every published artifact',
  'scripts': 'Generators. Everything they write carries a banner saying so',
  'supabase': 'Database schema, ordered migrations, and edge functions',
  'templates': 'Reference receiver implementations for integrators',
  'tests': 'Unit suites, and backend suites that run against an embedded Postgres',
  'tools': 'The gates. Each one blocks the build and explains what it refused',
  'VENDOR_PACK': 'Security and procurement answers for a buyer review',
  '.github': 'CI, contribution templates, and dependency updates',
};
const dirs = readdirSync(ROOT)
  .filter((d) => { try { return statSync(join(ROOT, d)).isDirectory(); } catch { return false; } })
  .filter((d) => d !== 'node_modules' && d !== '.git')
  .sort();

const table = ['| Directory | Purpose |', '| --- | --- |']
  .concat(dirs.map((d) => `| \`${d}/\` | ${PURPOSE[d] || 'See docs/README.md'} |`))
  .join('\n');

const p = join(ROOT, 'README.md');
const s = readFileSync(p, 'utf8');
const a = s.indexOf('<!-- BEGIN TREE -->');
const b = s.indexOf('<!-- END TREE -->');
if (a === -1 || b === -1) { console.error('record-tree: sentinels missing from README.md'); process.exit(1); }
const next = s.slice(0, a) + '<!-- BEGIN TREE -->\n' + table + '\n' + s.slice(b);
if (next !== s) { writeFileSync(p, next); console.log('record-tree: README map regenerated, ' + dirs.length + ' directories'); }
else console.log('record-tree: README map already current, ' + dirs.length + ' directories');
