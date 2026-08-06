# HARDENING REPORT: Phase C1, in-house adversarial sweep

This report states what was attacked, what broke, what was fixed, and what
was measured rather than assumed. Findings are numbered and carry a severity.
Every fix is pinned by a permanent suite, not a one-off script, so a
regression fails a build rather than surviving to production.

Status of this pass: C1.1 authorization matrix complete, with one critical
finding fixed and verified on production. C1.2 through C1.8 are scheduled and
listed at the end with their current evidence.

---

## C1-001 · CRITICAL · Trail forgery by an unauthenticated caller

**Status:** fixed, deployed to production, verified live, pinned by test.

**What it was.** PostgreSQL grants EXECUTE on every new function to PUBLIC by
default, and PUBLIC includes the `anon` role that every browser client holds.
ReqPub's public API functions are individually revoked and re-granted, but its
internal helpers never were, because they are only ever called from inside
other definer functions and therefore carry no authorization checks of their
own. Eighty-six SECURITY DEFINER functions were reachable by `anon`.

Among them was `log_activity`, which inserts directly into the activity trail
and takes the organization, project, action, entity, and summary as
parameters. It also swallows every exception, by design, so that a failing
audit write never breaks a real write.

**Proven, not theorized.** As role `anon`, with no session and no membership:

```sql
select log_activity('<victim org>', '<victim project>', 'version.approved',
  'version', 'v-forged', 'Baseline 9.9 approved by the client', '{}');
```

The row landed in the victim organization's trail. The insert trigger then
chained it at the next sequence number, committing a forged event as genuine.
No error was returned to the attacker. `chain_ensure_genesis` was reachable on
the same basis.

**Why it is critical.** ReqPub's entire claim is that the record is what
actually happened and that the chain makes tampering evident. A forged,
chained approval defeats that claim directly, and it would appear in the
evidence pack chronology and in chain verification as a valid entry. The
attacker needs nothing but the public anon key, which is a public identifier
by design.

**The fix.** `supabase/migrations/0028_authz_lockdown.sql` revokes EXECUTE on every
function in the public schema from PUBLIC, `anon`, and `authenticated`, then
grants back exactly the surface the codebase already declared. The intended
API is unchanged; only the accidental surface disappears. `log_activity` also
gained two cheap guards: it refuses an organization that does not exist and a
project that does not belong to the organization named.

The fix deliberately is not an identity check inside each helper. Several
helpers are legitimately reached by `anon` through token-scoped flows, because
a client signing a document is anonymous, so an identity gate inside
`log_activity` would break signing while leaving every other helper exposed.
The privilege layer is the correct control.

**Measured on production after deploy.** `anon` calling `log_activity` is
refused with `permission denied for function log_activity`; the trail row
count was unchanged, 35 before and 35 after; the anon-reachable surface fell
from 86 functions to exactly 17, matching the committed allowlist.

**Pinned by.** `tests/backend-e2e/authz-matrix.test.mjs`, 14 checks. The suite
reproduces the exploit on an unpatched stack first, so it proves the fix
rather than asserting it, then applies the lockdown and proves the refusal.

---

## C1-002 · HIGH, self-inflicted · Over-tightening broke every RLS-protected read

**Status:** fixed before deploy, caught by the existing backend suites.

The first lockdown revoked the five membership predicates from
`authenticated`. Row-level security policies call those predicates, and a
policy is evaluated as the querying role, so the revoke did not harden
anything: it broke every policy-protected read and write with `permission
denied for function is_org_manager`. The backend suites failed immediately.

They are granted back with the reason recorded in the migration. Exposure is
bounded by construction: each predicate answers a question about the caller's
own membership, derived from `auth.uid()` inside the function, and returns a
boolean. No row is returned by any of them.

## C1-003 · HIGH, self-inflicted · One client call relied on the PUBLIC default

**Status:** fixed on production, verified across the whole client surface.

After deploying the lockdown, `my_context()` was denied to `authenticated`.
It had never been granted explicitly; it relied on the PUBLIC default the
lockdown removes, and the client calls it on every load. Every one of the 67
RPCs the client invokes was then checked against the live database rather than
sampled. `my_context()` was the only one denied. It is granted in the
migration and in the allowlist, and the final live check reports no denied
client RPC.

This is recorded as a finding rather than a footnote because it is the
characteristic failure mode of a privilege lockdown, and the only reason it
did not reach users is that the surface was verified live before the session
ended.

---

## Measured negative result · ALTER DEFAULT PRIVILEGES does not hold here

`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM
PUBLIC` stores no `pg_default_acl` row on this PostgreSQL and leaves a newly
created function executable by PUBLIC. This was measured in isolation, both
with and without `FOR ROLE postgres`, not assumed from documentation.

The statement is retained because it is correct where honored and harmless
where not, but it is explicitly **not** the control. The control is the
permanent matrix suite, which fails the build when any function is reachable
by `anon` or `authenticated` without appearing in the committed allowlist. The
suite proves this by creating a function mid-run and asserting the comparison
catches it by name.

---

## The artifact

`../security/AUTHZ_MATRIX.md` is regenerated by the suite on every backend run: every
function in the public schema with the roles that may execute it. Drift is
visible in review as a diff rather than in production as an incident.

Current shape: 17 functions reachable without a session, each gated by a
single-purpose token inside its own body; 5 membership predicates plus 57
identity-gated functions reachable with a session; every other function
private, including the entire chain and trail machinery.

## Verification state after this pass

Audit clean. Unit chain green. Backend 732 checks across 29 suites, exit 0,
which is the evidence that the lockdown removed nothing the product uses: the
suites exercise the intended API end to end and would fail on any revoked
path.

## C1-004 · HIGH · Server-side request forgery through a webhook destination

**Status:** fixed, deployed to production, verified live, pinned by test.

`endpoint_create` required an https URL and a non-empty host, and nothing
else. Any project manager could therefore register a destination inside the
deployment's own network and make the delivery worker, which holds the service
role, sign and POST to it. The cloud metadata address at 169.254.169.254 was
reachable, as were loopback, RFC 1918 space, carrier-grade NAT, and every
IPv6 form. A signed request to an internal listener is worse than an unsigned
one, because a naive listener may treat a valid ReqPub signature as trust.

`supabase/migrations/0029_ssrf_guard.sql` adds `webhook_host_refusal`, one place that
decides whether ReqPub will ever send bytes to a destination, and applies it
twice: at creation, and again at dispatch so that a row stored before the
guard existed never receives bytes either. It refuses IP literals in every
notation including decimal, hexadecimal, octal, dotted and bracketed IPv6;
userinfo in the authority, which is the classic way to make a URL read as one
host and resolve as another; `.local`, `.internal`, `.home.arpa`, `.lan`,
`.corp`, `localhost` and its suffixes; single-label names; and trailing-dot
forms. The refusal names a reason a human can act on rather than a generic
error.

**Measured on production after deploy:** metadata, loopback, decimal
loopback, and IPv6 all refused as `ip_literal_not_allowed`; the userinfo
disguise refused as `userinfo_not_allowed`; `db.internal` refused as
`internal_host`; a genuine public destination still allowed; and zero existing
endpoints affected.

**Pinned by** the twenty-destination corpus in
`tests/backend-e2e/token-injection.test.mjs`.

## C1-005 · MEDIUM · Accepted with a stated residual: DNS rebinding

A hostname that resolves publicly at creation and privately at delivery
defeats a name-based guard, because the check and the connection happen at
different times. Closing it requires resolving the name inside the delivery
function and pinning the address for the life of the request, which is
TypeScript-side work in `deliver-webhooks` and is not done. The other half of
that class is already closed: redirects are not followed, so a public host
cannot bounce the worker inward.

This is recorded as an accepted residual rather than silently omitted. It is
in scope for the C7 penetration test.

---

## C1 completion status

- **C1.1 Authorization matrix.** Complete. 14 checks, allowlist pinned,
  `../security/AUTHZ_MATRIX.md` regenerated every run.
- **C1.2 Token boundary.** Complete. Five token types, twenty cross pairs,
  every one refused; revoked tokens indistinguishable from tokens that never
  existed; no token value or address in any token-scoped response.
- **C1.3 SSRF and egress.** Complete for the name-based class, with C1-005
  accepted as a stated residual.
- **C1.4 MCP fuzz.** Complete. 18 checks: malformed envelopes, wrong types, a
  two-megabyte parameter, two-hundred-deep nesting, unknown methods and tools,
  scope escalation against foreign ids, injection-shaped ids, propose with the
  gate off, and nine authorization header shapes. Every response in the sweep
  is scanned for keys, tokens, addresses, stack frames, filesystem paths, SQL
  fragments, and database internals. A refusal for a foreign project is
  byte-indistinguishable from a refusal for one that does not exist, so the
  endpoint is not an enumeration oracle.
- **C1.5 Webhook replay.** Complete for the shipped receiver: skew, tamper,
  unknown key, and duplicate delivery ids are tested against real Ed25519 in
  `tests/record-delivery.test.mjs`. Replaying a captured production payload is
  folded into C2.
- **C1.6 Storage probing.** Not started. Attachments live in a private bucket
  reached only through signed URLs; the probing suite is not written.
- **C1.7 Rate limits under parallel load.** Not started. The MCP limit is
  enforced and tested serially; the parallel demonstration is not.
- **C1.8 Injection and rendering.** Complete. Seventeen hostile strings across
  SQL, script, attribute-break, template, formula, NUL, and bidirectional
  classes, written through the real RPC and read back through the real
  escapers and the real CSV writer. Findings: values cross a parameter
  boundary and round-trip byte for byte; no payload can form a tag after
  escaping; every formula-leading value is prefixed; a NUL byte is refused at
  the database boundary rather than truncating.

Two items remain open and are named as open. Nothing here is claimed that a
test does not demonstrate.

---

## C2-001 · MEDIUM · A production receipt does not validate against the published schema

**Status:** scope measured, forward path fixed and pinned, historical variant
documented rather than rewritten.

**Found by** the C2 procedure itself: pulling a real production artifact and
checking it against the standard ReqPub publishes, rather than checking a
fixture. The first artifact examined failed.

The single acceptance receipt in production, sealed 2026-08-03, carries
`project.nameSha256` as `{}` instead of a 64-character hex digest. The build
that sealed it did not await the digest, and an unawaited promise serializes to
an empty object. Every production receipt is therefore non-conformant, which is
one receipt out of one.

**What is unaffected:** the baseline fingerprint, the Ed25519 signature, both
RFC 3161 timestamps, and the chain head. The signature covers the bytes as
written, so the artifact is internally consistent and verifies. The failure is
conformance to the published format, not integrity.

**Why it shipped:** the receipt predates the published standard, which arrived
in v2.53, so no schema existed to validate against at seal time. The current
code awaits correctly and `tests/spec-schemas.test.mjs` already validates a live
receipt against the schema on every build; what was missing was a check for the
specific shape a forgotten await leaves behind.

**Fixed forward:** `tests/seal-fixture.test.mjs` now walks a built receipt and
fails on any empty object anywhere in it, plus pins `project.nameSha256` as a
64-hex digest. That closes the class, not just the instance.

**Not rewritten:** ReqPub does not re-seal historical receipts to fit a later
specification. Re-signing an artifact to make it conform would defeat the
purpose of having sealed it. `../VERIFY.md` section 12 tells a verifier
exactly what to expect, what still holds, and why.

## C5 · Performance budgets, measured

Budgets are plain sentences about what a person waits for, measured on
production-shaped data with a 1,000-row record.

| Budget | Limit | Measured |
| --- | --- | --- |
| A 1,000-row record accepts its rows | 20,000ms | 38ms |
| The worksheet payload for that record loads | 2,000ms | 1ms, 95 kB |
| A baseline is generated over a 1,000-row snapshot | 3,000ms | 8ms |
| A diff between two 1,000-row baselines renders | 3,000ms | 13ms |
| Fifty acceptance rows chain without a gap | 15,000ms | 65ms, no gaps |
| A 100-delivery webhook burst enqueues | 10,000ms | 5ms |
| Evidence gather for a 1,000-row record | 5,000ms | 23ms |

Every budget is met with two orders of magnitude of headroom, measured against
an embedded database rather than the managed one, so these are floor figures
for the query shapes rather than end-to-end latency for a user on a network.
That distinction is stated because a benchmark presented as an experience is a
lie by framing.

## C1.7 · Rate limits under parallel load

Ninety calls issued in parallel against one key: exactly 60 admitted, exactly
30 refused, no overshoot from a read-modify-write race, and every refusal a
clean rate-limit answer rather than an error. A saturated key does not throttle
a second key, so the limiter does not turn one tenant's burst into another
tenant's outage.

## C1-006 · MEDIUM · An infected attachment was labelled blocked but served anyway

**Status:** found by the C1.6 storage sweep, fixed, pinned.

The attachment list marked a file the scanner had flagged with a "blocked"
pill, and the download handler then minted a signed URL for whatever path the
markup carried, with no reference to the scan result. Marking is not refusing.
A file flagged as infected, a file whose scan errored, and a file not yet
scanned were all downloadable by anyone who could see the record.

The handler now refuses anything that is not `clean`, with a distinct message
for each case, and it resolves the attachment from loaded state rather than
trusting the path in the markup, because markup is the one input a person can
edit. Pinned by five checks in `tests/backend-e2e/storage-probing.test.mjs`,
including that the gate sits before the signed-URL call rather than after it.

## C1.6 · Storage probing · Complete

Seventeen checks. An unauthenticated caller reads no attachment row and
therefore never learns a storage path. A rival manager cannot read our rows,
cannot find them by exact path, and cannot find them by prefix across the whole
organization, while still seeing their own file, so the suite measures
isolation rather than a broken query. A rival cannot plant a row in our
organization and cannot mark an infected file clean. Signed URLs carry explicit
lifetimes of an hour or less. The evidence pack lists attachments by name and
hash and never by storage path.

## C3 · Drills

**Rotation drill, executed.** `tests/rotation-drill.test.mjs` performs a real
rotation on real Ed25519 keys: seal under key A, retire A while keeping it
published, seal under key B, then verify both receipts the way an outsider
does, using only the published key set. It proves the property that matters and
the mistake that destroys it: removing a retired key from the published set
makes every receipt sealed under it permanently unverifiable while leaving new
receipts healthy, so the damage is invisible in normal testing.

The drill found a runbook gap and the runbook was fixed, which is what C3.2
asks for. `SECURITY.md` now states that a retired key remains published forever
with a retirement date, that a `kid` is never reused, and that removal is
reserved for compromise, where removal alone is insufficient because a
compromised key cannot distinguish a genuine seal from a forged one.

**Restore drill: not executed.** It requires a real backup restored to a
scratch instance, which needs credentials and a provider console. The
structural half is covered continuously: every backend suite builds the entire
database from `schema.sql` plus the fix files and exercises it, so a rebuild
from source is verified on every run. What remains unverified is a restore of
customer data from a provider snapshot, and the time it takes.

## C4 · Completeness audit · Complete

Twenty-three checks across two organization states, a fresh organization with
nothing configured and one with every feature exercised. Every surface that can
be rendered without a browser is scanned for the marks of an unfinished screen:
the word undefined, a raw null, NaN, a stringified object, an invalid date, and
an empty element where copy belongs.

The suite exists because the owner found a defect before it did: the
capabilities page offered a control that lives on another screen, so pressing
it lit nothing while the step text claimed otherwise. The class is now checked
on every surface that points at a control, on both routes, along with the rule
at its other site, the walkthrough, which had always enforced it.

Two of the audit's first findings were the audit's own: a layout container
closing after a child element, and a zero-width progress fill, are both empty
by design. The rule was narrowed to elements whose whole job is to carry copy.

## C2 · Verification against a real production artifact

The single acceptance receipt in production was pulled and checked offline,
with no reference to any ReqPub service:

- The captured fingerprint and the fingerprint recomputed at seal time are
  identical, and both are well-formed.
- The chain head hash is well-formed.
- No token, key, or email address appears anywhere in the artifact; the signer
  is identified by email domain only.
- Validated against the published JSON Schema: **fails on exactly one field**,
  `project/nameSha256 must be string`. Correcting only that field makes the
  artifact validate, which confirms the C2-001 scope precisely: one field, no
  collateral divergence.

**What remains an owner step.** Verifying the Ed25519 signature and the two
RFC 3161 tokens of that specific production receipt requires exporting the
receipt bundle through the interface, which only an account holder can do. The
procedure itself is proven end to end on real keys by the rotation drill and
the evidence CLI suite; what is untested is that one production artifact's
signature bytes. It is a five-minute click and a CLI run.

## C1-007 · HIGH · The session client was loaded from a public CDN at a floating tag

**Status:** found by an external advisor's audit, confirmed independently,
fixed, pinned by a new gate.

`app/index.html`, `login/index.html`, and `signup/index.html` each loaded
`@supabase/supabase-js` from `cdn.jsdelivr.net` at the floating tag `@2`, with
no subresource integrity and no crossorigin attribute, and the content
security policy on each page named that origin in `script-src`.

That script holds the session token and mediates every read and every write. A
compromise of the CDN, or a single malicious publish to the 2.x line, would
have executed arbitrary code with full session authority against every ReqPub
customer at the same time. It is the highest-severity issue that had been
available in this codebase, and unlike C1-001 it was reachable without any
database knowledge at all.

What makes it worth recording rather than quietly patching: `app/vendor/`
already held a vendored PDF worker, pinned and same-origin, with a comment
explaining that a cross-origin worker will not start. The harder case had been
reasoned through and solved. The easier and more dangerous one was missed
because nothing checked it.

**Fixed.** The client is vendored at exactly 2.112.1, with the version in the
filename so an upgrade is a visible diff, pinned by SHA-384, and served from
our own origin. `script-src` is `'self'` on all three pages. Ten further pages
that carried no policy at all now carry one, and the two verification pages
keep `connect-src 'none'`, which is what lets a reviewer prove they make no
network request.

**Pinned by** `tools/supply-chain-gate.mjs`, blocking in CI, which fails on a
third-party script origin, a missing policy, a `script-src` naming anything
but `'self'`, a vendored file whose hash disagrees with `app/vendor/VENDOR.md`,
and the loss of `connect-src 'none'` on either verification page. Proven both
ways before shipping: reintroducing the CDN tag fails it, and appending one
byte to the vendored client fails it.

## A gap in the gates themselves

The same audit found that `claims-gate.mjs` and `copy-gate.mjs` were never
wired into `.github/workflows/ci.yml`. They ran when someone remembered, which
is not a control. Both are now blocking CI steps, as is the new supply chain
gate, and `npm run counts` records what the suites prove before the claims
gate reads it.

---

## Close-out of this pass

**Fresh-install verification.** schema.sql section 34 mirrors the migration.
Loading schema.sql alone, with no fix file, yields an anon-reachable surface of
17 functions, `log_activity` closed to anon, and both `my_context()` and the
RLS predicates intact. A new deployment is therefore not vulnerable to C1-001
by default.

**Suite repair, recorded.** Mirroring the lockdown into schema.sql removed the
vulnerable state the matrix suite relied on to reproduce C1-001, and the suite
correctly failed. It now constructs the vulnerable configuration explicitly,
restoring EXECUTE to PUBLIC on the ungated helper before attacking it, so the
reproduction remains a real attack against a real configuration rather than a
narrative. A test that can no longer fail for the original reason is not
evidence of anything.

**Fixture correction.** The chain suite used `log_activity` directly as a
fixture to generate trail rows. That helper is private now, so the fixture
writes through the owner path instead, which also makes the suite exercise the
chain trigger rather than a grant.

**Final state.** Audit clean, capabilities gate clean at 39 entries, schema
parity clean, unit chain green, backend 732 checks across 29 suites at exit 0.
