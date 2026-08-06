# ReqPub

The accountability record for enterprise AI development. A client signs a
measurable definition of done before the work starts, the engineers build
against that baseline, and every change to it is diffed, attributed, and
dated. The record is fingerprinted, and a third party can verify it without an
account and without asking us.

ReqPub calls no model API. Nothing enters a record without a person approving
it, and the platform forms no view about whether the work is going well. It
records what the parties agreed and makes that record checkable.

## What changed in v3

Documentation, migrations, and published claims each acquired a gate that
fails the build when they drift. See [CHANGELOG.md](CHANGELOG.md); the 2.x
history is archived in [docs/changelog/v2.md](docs/changelog/v2.md).

## Quick start

```bash
npm test                      # 564 checks across 37 suites, node only, no install needed
npm ci && npm run test:backend # 841 checks across 35 suites on an embedded Postgres
npm run ci                    # every gate
```

The first command runs on a clean clone with no prior install. The unit chain
imports nothing outside the standard library.

## Repository map

<!-- BEGIN TREE -->
| Directory | Purpose |
| --- | --- |
| `.github/` | CI, contribution templates, and dependency updates |
| `VENDOR_PACK/` | Security and procurement answers for a buyer review |
| `app/` | The application: a static shell, no build step, what is committed is what runs |
| `docs/` | Documentation, including the normative formats other people implement against |
| `login/` | See docs/README.md |
| `schemas/` | JSON Schemas for every published artifact |
| `scripts/` | Generators. Everything they write carries a banner saying so |
| `signup/` | See docs/README.md |
| `supabase/` | Database schema, ordered migrations, and edge functions |
| `templates/` | Reference receiver implementations for integrators |
| `tests/` | Unit suites, and backend suites that run against an embedded Postgres |
| `tools/` | The gates. Each one blocks the build and explains what it refused |
<!-- END TREE -->

## Where to read next

| Document | Answers |
| --- | --- |
| [docs/README.md](docs/README.md) | What documentation exists and what each file answers |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Why the system is shaped this way |
| [docs/STATUS.md](docs/STATUS.md) | What is open right now, and what is not finished |
| [docs/ASSURANCE.md](docs/ASSURANCE.md) | What third parties have verified, which today is nothing |
| [docs/operations/RUNBOOK.md](docs/operations/RUNBOOK.md) | How to install and upgrade it |

## How this is verified

Every gate below blocks the build.

| Gate | Refuses |
| --- | --- |
| `tools/audit.mjs` | A handler without markup, markup without a handler, a version stamp out of lockstep |
| `tools/claims-gate.mjs` | A published claim with no artifact and no named test, a stale promise, a figure that disagrees with the suites, a price absent from `docs/PRICING.md` |
| `tools/capabilities-gate.mjs` | A capability whose stamp, anchor, or copy discipline has drifted |
| `tools/copy-gate.mjs` | Assembled prose in the interface, the site, or the documents |
| `tools/design-gate.mjs` | Contrast below WCAG AA, or body text without one measure |
| `tools/supply-chain-gate.mjs` | A third-party script origin, or a vendored file whose hash disagrees with its inventory |
| `scripts/spec-schema-parity.mjs` | A specification and a schema that disagree |
| `tests/backend-e2e/authz-matrix.test.mjs` | Any database function reachable outside the committed allowlist |

## Roles

Manager (internal, writes), Viewer (internal, reads everything and can reply), Client contact (UI label for the `partner` schema role: external account, assigned projects only, threads and file uploads with the team), SME (accountless tokened links for briefs, app testing, and input requests, plus a durable per-PRD workspace, each opening a two-way thread). Deployment doctrine - one workspace per client account, role-to-surface map, operating rules - lives in `docs/DEPLOY.md`.

## Enterprise posture

The controls a security or procurement reviewer looks for:

- Append-only audit trail, written only by SECURITY DEFINER functions inside the database; no update or delete path exists from the app.
- A real approval state machine: a version cannot be Approved while a named approver is pending. Approvals can be routed in-app, where the assigned teammate gets a dashboard flag and signs off their own slot.
- Per-field edit attribution with server-stamped team identity, and immutable version baselines.
- Org-scoped row-level security on every table, rate-limited anonymous endpoints, and input size ceilings.
- Uploads stored in a private bucket and virus-scanned when a scanner is configured (see `docs/ATTACHMENTS.md`).
- A Health tab that computes baseline-readiness signals (a Must without a fit criterion, an approved version with no published brief, unresolved placeholders) from the record itself - derived, never stored.
- One-click promotion from discovery and the inbox into numbered requirements and decisions, back-linked to their source, with version notes attributing additions to their origin.
- A client baseline report whose cover carries a SHA-256 fingerprint of the exact baseline (recipe restated on the document); the fingerprint identifies the snapshot, and cryptographic sealing remains the e-signature phase.

Also a command palette (⌘K), dark mode, and exports that carry status, approvals, and revision history. See `SECURITY.md` for the threat model and accepted residual risks, and `CHANGELOG.md` for release history.
