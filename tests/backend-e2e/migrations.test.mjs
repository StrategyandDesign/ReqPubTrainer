/* ReqPub C3 - the migration replay proof
   (node tests/backend-e2e/migrations.test.mjs)

   Until v3.0.0 the migration set was 29 files with no ordinal, no ledger, and
   an apply order that existed only as prose scattered through a deploy
   document. Nothing proved that replaying them produced the same database as
   loading schema.sql, so the two could drift and the drift would surface on a
   customer's upgrade rather than here.

   This suite closes that. It builds two databases in the same PostgreSQL
   instance: one from schema.sql alone, one by replaying every migration in
   filename order onto a blank schema. Then it compares them through
   information_schema and pg_catalog rather than by diffing text, because the
   question is whether the two databases are the same, not whether the two
   files look alike.

   It also replays the whole chain a second time, because every migration
   claims to be idempotent and a claim needs a test. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-mig-' + process.pid), user: 'postgres', password: 'pw', port: 55510, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start();
/* Two databases, not two schemas. Every definer function in this product
   declares `set search_path = public`, so building a second copy inside a
   named schema produces functions that look in the wrong place. Separate
   databases are what an operator actually has. */
await epg.createDatabase('refdb'); await epg.createDatabase('repdb');
const conn = (name) => new pg.Client({ host: 'localhost', port: 55510, user: 'postgres', password: 'pw', database: name });
let db = conn('refdb'); await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const run = (q) => db.query(q);
const rows = async (q) => (await db.query(q)).rows;
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x).slice(0, 300) : '')); } };

const MIG_DIR = rel('../../supabase/migrations');
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();

/* A shape is the set of things a caller can depend on, read from the catalog
   rather than from the files that created them. */
const digest = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex');
async function shape() {
  const cols = await rows(`select table_name, column_name, data_type, is_nullable, coalesce(column_default,'') d
     from information_schema.columns where table_schema = 'public' order by 1,2`);
  const fns = await rows(`select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' order by 1,2`);
  const idx = await rows(`select tablename, indexname from pg_indexes where schemaname = 'public' order by 1,2`);
  const pol = await rows(`select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1,2,3`);
  const con = await rows(`select conrelid::regclass::text t, conname, contype from pg_constraint c
     join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' order by 1,2`);
  return { cols, fns, idx, pol, con };
}
async function build(name, withMigrations) {
  if (db) { try { await db.end(); } catch {} }
  db = conn(name); await db.connect();
  /* Roles are cluster-wide, so the shim's role creation fails on the second
     database. Splitting SQL on semicolons breaks dollar-quoted bodies, so the
     whole file is attempted and a role collision is tolerated by name. */
  try { await run(sql(rel('shim.sql'))); }
  catch (e) {
    if (!/already exists/.test(e.message)) throw e;
    await run(sql(rel('shim.sql')).split('\n').filter((l) => !/^create role /.test(l)).join('\n'));
  }
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  await run(sql(rel('../../supabase/schema.sql')));
  if (!withMigrations) return null;
  for (const f of files) {
    try { await run(sql(join(MIG_DIR, f))); }
    catch (e) { return f + ': ' + e.message; }
  }
  return null;
}

try {
  await build('refdb', false);
  const ref = await shape();
  check('schema.sql builds on a blank database', ref.cols.length > 0 && ref.fns.length > 0,
    { columns: ref.cols.length, functions: ref.fns.length });

  const firstFailure = await build('repdb', true);
  check(`all ${files.length} migrations apply in filename order`, firstFailure === null, firstFailure);
  check('every migration file carries an ordinal prefix', files.every((f) => /^\d{4}_/.test(f)),
    files.filter((f) => !/^\d{4}_/.test(f)));

  /* ---- the ledger ---- */
  const ledger = await rows(`select version, name, checksum from schema_migrations order by version`);
  check('the ledger holds exactly one row per migration file', ledger.length === files.length,
    { ledger: ledger.length, files: files.length });
  const bad = [];
  for (const f of files) {
    const ver = f.slice(0, 4);
    const row = ledger.find((r) => r.version === ver);
    if (!row) { bad.push(f + ': no ledger row'); continue; }
    const body = sql(join(MIG_DIR, f));
    const above = body.slice(0, body.lastIndexOf('\n\n-- Ledger.'));
    if (createHash('sha256').update(above).digest('hex') !== row.checksum) bad.push(f + ': checksum mismatch');
  }
  check('every ledger checksum matches the file on disk', bad.length === 0, bad.slice(0, 3));

  /* ---- the comparison that matters ---- */
  const rep = await shape();
  for (const [what, key] of [['columns', 'cols'], ['functions', 'fns'], ['indexes', 'idx'], ['policies', 'pol'], ['constraints', 'con']]) {
    const same = digest(ref[key]) === digest(rep[key]);
    if (same) { check(`replay and schema.sql agree on every ${what} (${ref[key].length})`, true); continue; }
    const only = (a2, b2) => a2.filter((x) => !b2.some((y) => JSON.stringify(y) === JSON.stringify(x)));
    check(`replay and schema.sql agree on every ${what}`, false,
      { onlyInSchemaSql: only(ref[key], rep[key]).slice(0, 4), onlyInReplay: only(rep[key], ref[key]).slice(0, 4) });
  }

  /* ---- idempotence, claimed by every file ---- */
  const before = digest(rep);
  let twiceFailure = null;
  for (const f of files) {
    try { await run(sql(join(MIG_DIR, f))); }
    catch (e) { twiceFailure = f + ': ' + e.message; break; }
  }
  check('the whole chain applies a second time without error', twiceFailure === null, twiceFailure);
  check('the second application changes nothing in the schema', before === digest(await shape()));
  const ledger2 = await rows(`select count(*)::int n from schema_migrations`);
  check('the ledger still holds one row per file after a second pass', ledger2[0].n === files.length, ledger2[0].n);
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + String((e && e.message) || e));
} finally {
  try { await db.end(); } catch {}
  try { await epg.stop(); } catch {}
}
console.log(`migrations: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
