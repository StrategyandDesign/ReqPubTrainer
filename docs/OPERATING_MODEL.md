# How ReqPub is built

Published deliberately. A record layer that asks to be trusted with acceptance
evidence should be willing to state how it is built and let anyone check the
statement.

## The gates are the institution, not the engineer

Every release passes the same automated gates. They are not advisory. Each one
fails the build, and none can be waived by the person who wrote the code.

| Gate | What it refuses to let through |
| --- | --- |
| `tools/audit.mjs` | Any handler without markup, any markup without a handler, any version stamp out of lockstep |
| `tests/backend-e2e/authz-matrix.test.mjs` | Any function reachable by an anonymous or authenticated caller that is not on a committed allowlist. Regenerates `security/AUTHZ_MATRIX.md` for review |
| `tools/capabilities-gate.mjs` | Any published capability whose version stamp, anchor, or copy discipline has drifted, including a claim the positioning doctrine forbids |
| `tools/claims-gate.mjs` | Any published claim not tied to an artifact that exists and a test that names it; any banned promise vocabulary; any published path that does not resolve; any model API reference contradicting the no-AI statement |
| `scripts/spec-schema-parity.mjs` | Any divergence between the normative tables in `SPEC.md` and the published JSON Schemas |
| `tests/seal-fixture.test.mjs` | Any drift between the vendored canonicalizer and the application's, any non-deterministic receipt, any empty object where a digest belongs |
| The backend chain | 768 checks across 31 suites, including the adversarial sweeps described in `security/HARDENING_REPORT.md` |

The point of writing them down is that they outlive whoever wrote them. A new
engineer does not need to absorb the doctrine before touching the code; the
doctrine is enforced mechanically and explains itself when it refuses.

## Findings are published, including our own mistakes

`security/HARDENING_REPORT.md` contains every security finding from the in-house
adversarial sweep with reproductions, including the two that were caused by the
fixes themselves. That is deliberate. A vendor who shows only clean results is
showing an incomplete search, and a reviewer who sees no self-inflicted findings
should ask what else was left out.

## What we will never build

Gantt charts, RAG rollups, RAID logs, timelines, notification engines,
auto-advancing workflows, portfolio dashboards. Each one converts the record
into a tracker and hands back the only ground that is uncontested.

The line is not a ban on parties writing something down. A risk table authored
by the team, frozen into a baseline and signed by the client, is record
content. A risk register the platform keeps live, ages, escalates, and rolls up
into a colour is a tracker. Two questions decide any proposed field:

- **Who wrote the value?** A person, in their own words: allowed. The platform,
  by computing over other rows: forbidden.
- **Does it move on its own?** If it changes without an author changing it, it
  is a status engine, and the answer is no.

Your programme platform reports progress. This record proves agreement. The
refusal to do both is what makes the second one worth anything.

## The record outlives the vendor

The formats are published, the verification tool is standalone and has no
dependencies, and an evidence pack verifies with `openssl` and about twenty
lines of code. A customer holding exported packs can prove what was agreed
without ReqPub running, without an account, and without our cooperation. This
is a design property, not a promise, and `VENDOR_PACK/OFFLINE_VERIFICATION.md`
is the ten-minute procedure for testing it yourself.
