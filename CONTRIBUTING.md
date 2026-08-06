# Contributing

## Running the suites

```bash
npm test                       # unit chain, node only, no install needed
npm ci && npm run test:backend # backend chain against an embedded Postgres
npm run ci                     # every gate
npx eslint .                   # static analysis, zero errors required
```

The unit chain imports nothing outside the standard library, so it runs on a
clean clone. The backend chain downloads and runs a real PostgreSQL, so it
needs the install first.

The backend chain also needs the `en_US.UTF-8` locale, because the embedded
PostgreSQL reads initdb's output to know when the cluster is ready and
hard-codes that locale to do it. `npm run test:backend` checks for it first and
prints the fix if it is missing, rather than failing inside initdb with a
message that does not name the cause. This was found by an outside reviewer who
had to patch `node_modules` to get the suites to run; the locale is present on
the maintainer's image, so the problem was invisible from here.

## What the gates enforce, and why each exists

Each gate was written after something went wrong. The comment header in each
file names the incident.

| Gate | Exists because |
| --- | --- |
| `tools/audit.mjs` | A handler and its markup drifted apart |
| `tools/claims-gate.mjs` | The site claimed a capability that had not shipped, and later claimed a figure that was two years stale |
| `tools/docs-gate.mjs` | Twenty-one documents accumulated at the repository root and nothing stopped it |
| `tools/copy-gate.mjs` | Interface prose read as though it had been assembled rather than written |
| `tools/design-gate.mjs` | A primary button rendered slate text on blue at a contrast ratio of 2.12 to 1 |
| `tools/supply-chain-gate.mjs` | The session client was loaded from a public CDN at a floating version tag |
| `tools/capabilities-gate.mjs` | A capability entry outlived the release it described |
| `tests/backend-e2e/migrations.test.mjs` | Nothing proved that replaying the migrations produced the same database as the schema file |

Never weaken a gate to make a change pass. If a gate is wrong, fix the gate in
its own commit and say what it was wrong about.

## House style

Declarative sentences. Concrete nouns. No superlatives, no em dashes, no
emoji, no exclamation marks. State residual risk rather than omitting it.
`docs/ARCHITECTURE.md` is the reference. If a sentence could appear in any
software README, rewrite it.

## The rule that matters most

**A claim needs an artifact and a test.** Nothing is published, on the site or
in a document, unless a file exists that does the thing and a test names it.
The claims gate enforces this and will refuse a claim you cannot tie down. If
a claim would be natural but you cannot tie it to both, leave the space empty.

## Commits and releases

One workstream per commit series. A schema change ships as a numbered
migration under `supabase/migrations/` with the replay test updated. A change
to the suites means regenerating `tests/COUNTS.json` with `npm run counts`,
because published figures are read from that file and the gate compares them.
Every release gets a `##` heading in `CHANGELOG.md` and a report under
`docs/releases/`.
