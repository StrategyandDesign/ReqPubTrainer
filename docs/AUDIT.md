# Pre-review security & correctness audit (v2.5.0)

Before external review, the codebase was put through two independent adversarial
audits (one on the SQL schema, RLS, and migration; one on the frontend for XSS,
data leakage, and correctness), conducted against the actual code, not its
comments. This document records what was found, what was fixed, and what is a
deliberately accepted residual. Every fix ships with a regression test.

> This records the audit as of v2.5.0. The suite has since grown to 537 checks
> (221 via `npm test`, 316 via `npm run test:backend`); the figures in this file
> are the v2.5.0 baseline.

## Method

- SQL audit: every table's RLS policy set cross-checked against its grants;
  every `SECURITY DEFINER` function checked for `search_path` and for deriving
  identity from `auth.uid()` rather than trusting client input; realtime channel
  policies parsed; `anon`-reachable RPCs enumerated; migration checked for
  cross-org/cross-project attribution and idempotency.
- Frontend audit: the real `mdToHtml`, `inlineMd`, `bBrief`, `buildSharePayload`,
  and `stripInternal` functions executed in Node against malicious payloads to
  get ground truth on escaping and share-scoping, rather than reasoning by eye.
- Verification: `npm test` (32 unit tests: document pipeline, concurrency
  simulation, share scoping) and `npm run test:backend` (73 checks on a real
  embedded Postgres with Supabase parity shims, including an adversarial set).

## Headline findings

The architecture is sound and free of SQL injection; the XSS surface is
effectively closed (every user-data interpolation is escaped, and the markdown
renderer neutralizes HTML before transforming); share payloads are section-scoped
at build time with no internal-field leakage. The issues below were real and are
fixed.

## Fixed in 2.5.0

**Realtime broadcast trust (integrity).** Sending on a project channel was
allowed for any org member, so a read-only viewer could broadcast fabricated
"live edits" onto teammates' screens (the database was never affected, but the
display is trusted). Project-channel send is now restricted to managers (the
only role that can edit), so a forged broadcast grants its sender nothing they
couldn't already do authentically, and viewers/partners/SMEs receive only. The
client also now ignores malformed broadcast payloads instead of applying them.

**Partner reply authorization.** `partner_reply` authorized on comm ownership
alone, so a de-assigned partner could keep replying on historical threads. It
now requires current `partner_access` to the comm's project, matching
`partner_post`.

**Audit-trail and read-only integrity (defense in depth).** This schema shares
a Supabase project with v1, whose setup ran a blanket
`grant ... on all tables to authenticated`. Protection of the write-only-via-RPC
tables therefore rested on the absence of an RLS policy. Write is now explicitly
`revoke`d from `authenticated` on `project_fields`, `field_rows`, and `activity`,
so their protection is affirmative. `activity` also gained a foreign key to
`orgs`, closing a path to orphaned or misattributed audit rows.

**Approval provenance.** A manager could write the `version_approvals` table
directly and forge who signed off. A trigger now forces new approver rows to
start `pending` and stamps `decided_by`/`decided_at` from `auth.uid()` on any
decision, so the approval gate reflects real, attributable sign-off even against
direct writes.

**Anonymous rate-limit races.** The per-project submission caps were computed
then inserted without serialization (a TOCTOU gap under parallel calls) and
could be multiplied by splitting across share kinds. The three anon endpoints
now take a per-project/-request advisory lock around the count-and-insert, and
the submission cap counts all anon origins together.

**Migration attribution.** Recovered v1 submissions were attributed using an
unauthenticated, client-written `payload.project_id`. They are now attributed
using the project of the share the submission was made against.

**Version-label footgun.** A hand-edited non-numeric version label would break
version creation (integer parse). A `CHECK` constraint now enforces the numeric
format.

**Frontend robustness.** Two handlers assumed a non-null comm body (an
externally-authored record could omit it), which could silently dead-button the
Promote actions; both now coalesce. Every click action is additionally wrapped
so any unexpected data shape surfaces as a toast rather than a broken button.

**Performance.** Added indexes on `partners(user_id)` and
`partner_access(project_id)`, which every partner RPC and every project-channel
subscribe queries.

## Accepted residuals (documented, not defects)

- `style-src 'unsafe-inline'` remains in the CSP; script injection, the vector
  that matters, is fully closed (`script-src 'self' + cdn.jsdelivr.net`, no
  `unsafe-inline`, no `unsafe-eval`).
- The public Supabase anon key ships in `config.js` by design; all protection
  rests on RLS and the rev-checked RPCs, which is where reviewer attention is
  best spent and which the backend suite exercises directly.
- A manager can self-approve a version. Managers are trusted writers; the
  provenance trigger guarantees the sign-off is *attributed truthfully*, which
  is the property that matters for the audit trail.
- SME reply tokens authenticate an accountless thread. They are 144-bit CSPRNG
  values returned only to the submitter and never placed in a URL, so they are
  bearer secrets held by one party; enumeration is infeasible.

## Reproduce

```
npm test                # 32 unit checks (v2.5.0 baseline; 98 today)
npm run test:backend    # 73 checks incl. the adversarial hardening set (v2.5.0 baseline; 215 today)
```
