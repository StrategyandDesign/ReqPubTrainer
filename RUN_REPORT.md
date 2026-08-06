# Run report

Executed against the v3 specification. The tree is at 2.57.9 and green. The
version bump to 3.0.0 has not happened; it is the last act of Workstream H and
must move together with every stamp in Section 2.2.

## Workstreams completed

- **A1a.** Both `ajv`-importing suites moved from the unit chain to
  `test:backend`. The unit chain is now provably dependency-free: 37 suites, no
  import outside `node:` and relative paths, so `npm test` succeeds on a clean
  clone with no install and the phrase "node only" is true.
- **B2.** All 21 root documents moved per the move table, with a
  repository-wide reference update in the same pass across 40 files.
- **B3.** `docs/README.md`, `docs/releases/README.md`, `docs/reviews/README.md`
  written; every review row names `STATUS.md` as its successor.
- **B4.** `docs/operations/RUNBOOK.md` rewritten into the four-part shape.
  `docs/DEPLOY.md` retitled and cross-linked in both directions.
- **B5.** `docs/STATUS.md` opens by stating the GA redefinition rather than
  sliding past it.
- **B6.** Title separators normalised, generated banners added, and the
  `AUTHZ_MATRIX.md` generator now writes its own banner so the next run cannot
  drop it.
- **B7.** D8 fixed, D9 fixed, changelog split into `docs/changelog/v2.md` with
  both the capabilities gate and its unit suite taught to resolve a
  `sinceVersion` against either file.
- **B8.** `README.md` rewritten to the seven-section shape, every figure read
  from `tests/COUNTS.json`.
- **F1.** Claims gate extended to README numeric parity.
- **F2.** `tools/docs-gate.mjs` written with `--selftest` and `--json`, wired
  as a blocking CI step.
- **F4.** `scripts/record-tree.mjs` generates the repository map; CI fails if
  it drifts.
- **G1 partial, G2 partial, G3.** ADR-0001 and `docs/ASSURANCE.md` written.

## Gate chain at the end of the run, verbatim

```
docs gate: the root carries only its allowlist, 55 markdown files carry titles rather than filenames, every index is complete, every generated file says so, every relative link resolves, and all 18 frozen paths are present
audit: clean.
capabilities gate: 39 entries clean; COVERED_THROUGH 2.57.9 equals package.json; every reference resolves; the copy discipline holds
claims gate: 10 published claims, each tied to an existing artifact and a named test; 25 published paths resolve; no banned phrase in 17 published surfaces and no stale promise on the site; the no-model claim holds by grep across 4 source trees
copy gate: 873 interface strings scanned, 0 flagged against a ceiling of 0
design gate: every colour pair meets WCAG AA, no button paints a background without a colour, and the measure is 66 characters, inside the readable range
supply chain gate: 15 served pages, every one carrying a policy that permits no third-party script source; every vendored file matches the hash recorded in VENDOR.md
spec-schema parity: SPEC.md tables and schema required lists agree at every named level
npm run ci   exit 0
npm test     exit 0    564 checks across 37 suites
npm run test:backend   exit 0    828 checks across 34 suites
```

## Judgment calls

- **Both ajv suites moved, not one.** The spec named `spec-schemas.test.mjs`;
  `book-practice.test.mjs` imports `ajv` too, so moving one would have left the
  unit chain still requiring an install. Chose the reversible option: moving a
  suite between chains is one line, writing a validator is not.
- **`test:offline` added as an alias for `test`.** A reader should be able to
  see from `package.json` that a dependency-free chain exists.
- **Runbook upgrade table says "the release before" in the From column.** The
  per-release fragments in the old file did not record a From version, and
  inventing one would have been a claim with no source.
- **The 3.0.0 changelog entry was not written.** G1 requires it before the
  website work, and the website work is not started; writing the heading now
  would put a version in the changelog that no stamp matches.
- **`docs/` link rewriting was mechanical.** Every reference from inside
  `docs/` was made relative in the same pass; the docs gate now proves all of
  them resolve, which is stronger evidence than reviewing them by eye.

## Defects found that were not in the spec

- **The `AUTHZ_MATRIX.md` generator writes a path.** The mechanical reference
  update rewrote it into a mangled path under tests/
  and the backend chain failed on the next run. Repaired. The spec anticipated
  the generator needing an update; it did not anticipate that a naive rewrite
  would corrupt it, and the lesson is that a path inside a `rel()` call is code
  and must be reviewed rather than substituted.
- **`tests/capabilities.test.mjs` reads `CHANGELOG.md` itself.** Appendix B
  lists the gate but not the suite that duplicates its input. Splitting the
  changelog broke the suite while the gate passed, which is exactly the
  divergence the appendix exists to prevent. Both now read both files.
- **`record-counts.mjs` refused twice during this run**, correctly, once for a
  failing backend chain and once for a changed suite set. Not a defect. Worth
  recording as evidence that the guard works under real conditions rather than
  in a fixture.

## Not done, and why

- **Workstream C, migrations.** Not started. It is the highest-value remaining
  item and it is large: 30 files renamed with derived ordering, a ledger table,
  a replay test comparing a migrated database against `schema.sql` through
  `information_schema`, and a generated ledger document. It needs a session of
  its own and the exact next action is in `RUN_STATE.md`.
- **Workstream D, hygiene.** Not started. No `eslint.config.js`, no
  `CONTRIBUTING.md`, no CODEOWNERS, no templates, no dependabot, and the
  `DASHBOARD-PASTE` artifacts still sit beside their sources.
- **Workstream E, code structure.** Not started, and it is the optional one.
- **Workstream G, remaining ADRs 0002 through 0010.** Not written.
- **Workstream H, website and version.** Not started. Nothing on the site
  mentions the assurance state yet, and the version is still 2.57.9.
- **F3, copy gate typography rules.** The moved paths were updated, but the B6
  typography rules were not added to the copy gate scan; the docs gate enforces
  them instead. Recorded as a deliberate placement, not an omission.
