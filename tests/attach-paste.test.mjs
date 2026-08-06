/* ReqPub v2 - attachment function paste gate (node tests/attach-paste.test.mjs)
   The attachment-upload function deploys as a dashboard paste of its own
   index.ts, verbatim: unlike seal-receipt it has no generated bundle because
   it has no local imports. This gate pins that property, so the single-file
   paste can never silently stop being the whole function, and pins the
   v2.49 wiring: WebCrypto hashing (the v2.48 lesson: Node's crypto surface
   does not run on Deno) and the digest handed to attachment_add. */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync('supabase/functions/attachment-upload/index.ts', 'utf8');

test('attachment-upload has no local imports: the paste is the file, verbatim', () => {
  assert.equal(/from\s+["']\.\//.test(src), false);
  const imports = src.split('\n').filter((l) => /^import /.test(l));
  assert.equal(imports.length, 1);
  assert.match(imports[0], /esm\.sh\/@supabase\/supabase-js/);
});

test('hashing is WebCrypto, never node:crypto', () => {
  assert.match(src, /crypto\.subtle\.digest\("SHA-256"/);
  assert.equal(src.includes('node:crypto'), false);
});

test('the digest reaches attachment_add and the JSON modes exist', () => {
  assert.match(src, /p_sha256: sha256/);
  assert.match(src, /attachment_verify_target/);
  assert.match(src, /attachment_backfill_targets/);
  assert.match(src, /attachment_set_hash/);
  assert.match(src, /attachment_backfill_note/);
});
