# Run state

Keyed to the v3 specification.

## Where the run stopped

**A, B, C, D, F, G, H complete. E not started**, which is the workstream the
brief marked optional and told me to drop if short.

The tree is at **3.2.0** (the engineering seam release) with every stamp in lockstep, and the full chain is
green: eslint 0 errors, `npm run ci` 0, `npm test` 0, `npm run test:backend` 0.

## Exact next action

**Ahead of Workstream E**, close the interface execution gap: a headless
browser in the backend chain that boots the real application against a seeded
database, clicks every registered action, and asserts nothing throws. An
outside reviewer named it as the widest gap between 1,481 passing checks and
"the features work", and they are right. It is recorded in `docs/ASSURANCE.md`
and as an open item in `docs/STATUS.md`.

Then Workstream **E1**: split `app/js/main.js`, currently 3,215 lines, into a state module, a router, an actions module, and a main module that
retains wiring only. The precondition is that `tests/views.test.mjs` and
`tests/projects-view.test.mjs` pass unchanged before and after; if either needs
to change, the split is wrong. The duplicate imports E1 mentions were already
merged by eslint's `no-duplicate-imports` in Workstream D.

Then E2, extracting fragments over roughly 200 characters in the view builders
into named functions, and E3, one test reporter format across all 72 suites.

## Partial work in the tree

None. Every change is complete.

## Version

**3.2.0.** `package.json`, `package-lock.json`, `app/js/core.js`, both vendored
`core.js` copies and their generated function bundles, `app/js/capabilities.js`,
`index.html`, `docs/STATUS.md`, and `tests/COUNTS.json` all read 3.2.0, and
`CHANGELOG.md` carries the `## 3.2.0` entry that the capabilities gate resolves
`sinceVersion` against. The claims gate fails the build if any of them drifts.
Production matches once the deploy in `docs/releases/v3.2.md` is done:
migration 0031 applied, the site served from `main`, and all eight edge
functions redeployed from the repository with the JWT setting each header
states.
