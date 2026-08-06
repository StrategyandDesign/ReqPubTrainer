# Ninety minutes to a running verification surface

For an engineer joining ReqPub. At the end you will have run every gate,
verified a sealed record offline, and broken something on purpose to watch a
gate catch you. No tribal knowledge required, and none conferred: everything
here is enforced by a test, so if this document is ever wrong, the build says
so before a reviewer does.

## 0 to 15 · Get it running

```
npm install
npm test                 # the unit chain
npm run test:backend     # 768 checks across 31 suites, embedded PostgreSQL
node tools/audit.mjs
```

The backend suites boot a real PostgreSQL, load `schema.sql` and every fix
file in order, and exercise the product as five different roles. If they pass,
your machine is correct.

## 15 to 35 · Read the three documents that constrain everything

`../POSITIONING.md` for what the product refuses to be. `../VERIFY.md` for
the recipe a stranger uses to check our work. `../security/HARDENING_REPORT.md` for what
went wrong and what it cost, including the mistakes made while fixing the
earlier mistakes.

The single sentence to carry: the platform never forms a view about delivery.
It records what people agreed and makes that record checkable by someone who
does not trust us.

## 35 to 55 · Verify a record the way a client would

Export an evidence pack from any project. Then, with the network disabled:

```
node tools/reqpub-verify.mjs --evidence ./pack/
```

Change one byte in any file and run it again. Watch it name the file. This is
the property the whole product exists to provide; feel it work before you
change any code.

## 55 to 75 · Break something and let a gate stop you

Do all four. Each takes two minutes and teaches you one gate.

1. Add a `data-action` to a button with no case in `main.js`. Run
   `node tools/audit.mjs`.
2. Add a function to `schema.sql` and grant it to `authenticated`. Run
   `node tests/backend-e2e/authz-matrix.test.mjs`. It names your function.
3. Write a capability entry claiming the product is "tamper-proof". Run
   `node tools/capabilities-gate.mjs`.
4. Change `../SPEC.md` to require a field the schema does not. Run
   `node scripts/spec-schema-parity.mjs`.

Undo all four.

## 75 to 90 · Understand what shipping looks like

Every schema change is an idempotent fix file, mirrored into `schema.sql` in
the same release, so a fresh install and an upgraded install converge. Every
release carries a report. Security fixes ship alone, with a test that
reproduces the failure first and passes after.

The rule that matters most is the smallest one: when a gate catches you, fix
the code, not the gate. The two times that rule was bent in this codebase are
both written up in `../security/HARDENING_REPORT.md`, and both times the gate was right.
