# Status

**Version 3.0.0. Assurance state: Self-attested.**

## The definition of GA changed, and this says so

Until v3.0.0 this document defined general availability as a version number:
v3.0.0 required a penetration test with criticals and highs closed and
retested, a cryptographic review letter received, and a signed SOC 2
engagement.

That was the wrong axis. A version number describes software. Those three
items describe what third parties have verified, and they move on schedules
set by vendors and budgets rather than by engineering. Tying them together
meant either shipping a number that contradicted this page or withholding a
number the software had earned.

The three requirements are unchanged and are not softened. They now define the
assurance state `Attested GA` in [ASSURANCE.md](ASSURANCE.md) instead of
defining a version. ReqPub is at `Self-attested` and says so on the website.
The reasoning is recorded in
[decisions/ADR-0001-versioning-and-assurance.md](decisions/ADR-0001-versioning-and-assurance.md).

## The bar

GA at v3.0.0 is defined in the program document as: Phase A shipped with gates
green; freeze held; C1 suites green and permanent; C2 verified on production
artifacts offline; C3 drills executed; C4 clean on both organization states; C5
budgets met or revised; C6 written and D3 decided; C7 penetration test criticals
and highs closed and retested, cryptographic review letter received, SOC 2
engagement signed; C8 assembled; C9 clean.

That bar is not met. Six items are open. Three of them cannot be closed by
engineering at all.

## Status by phase

### Phase A · Shipped

v2.51 through v2.57 shipped and are live: MCP server, evidence pack, published
standard, capabilities page, the Book with practice mode, Pursuit Mode and
lineage, the Record of Delivery and receiver templates. Every release carried
its gates green and its own report.

### Phase B · Freeze · Held

Since v2.57 the only changes have been security fixes, tests, and
documentation. Three security releases: 2.57.1, 2.57.2, and the work in this
report. No feature has been added under freeze.

### Phase C

| Item | Status | Evidence |
| --- | --- | --- |
| C1.1 Authorization matrix | **Done** | 14 checks; C1-001 critical found, fixed, verified live; `security/AUTHZ_MATRIX.md` regenerated each build |
| C1.2 Token boundary | **Done** | 5 token types, 20 cross pairs refused; revoked indistinguishable from never-existed |
| C1.3 SSRF and egress | **Done**, one residual | C1-004 high found and fixed; 20 hostile destinations refused; C1-005 DNS rebinding accepted and named |
| C1.4 MCP fuzz | **Done** | 18 checks; no leak of key, token, address, stack frame, path, or SQL in any response |
| C1.5 Webhook replay | **Done** | Real Ed25519: tamper, skew, unknown key, duplicate |
| C1.6 Storage probing | **Done** | 17 checks; C1-006 medium found and fixed: an infected file was labelled blocked but served anyway |
| C1.7 Rate limits under load | **Done** | 90 parallel calls, exactly 60 admitted, no cross-key interference |
| C1.8 Injection and rendering | **Done** | 17 hostile strings through the real write path, escapers, and CSV writer |
| C2 Crypto and evidence verification | **Done except one click** | A real production receipt verified offline: fingerprints self-consistent, no token or address, fails the published schema on exactly one field and validates when only that field is corrected. Signature and timestamp verification of that specific artifact needs a UI export |
| C3 Operational drills | **Done except restore** | Rotation drill executed on real Ed25519 keys and it found a runbook gap, now fixed; `operations/INCIDENT.md` written. Restore from a provider snapshot needs console credentials |
| C4 Completeness audit | **Done** | 23 checks across a fresh and a fully configured organization; the Help defect class is now checked on every surface that points at a control |
| C5 Performance budgets | **Done** | Seven budgets, all met with wide headroom; figures in `security/HARDENING_REPORT.md` |
| C6 Privacy and data lifecycle | **Done except D3** | `operations/DATA.md` written; deletion procedure documented; **D3 open for counsel** |
| C7 External audits | **BLOCKED ON OWNER** | Pen test not commissioned, crypto review not commissioned, SOC 2 not engaged |
| C8 Vendor readiness pack | **Assembled** | `VENDOR_PACK/` with four items honestly marked not-done |
| C9 Claims audit | **Done** | `tools/claims-gate.mjs` gates every published claim against an artifact and a named test |

## What blocks GA, precisely

**Owner items, requiring signature and budget. None can be done by engineering.**

- **O1 Penetration test.** Scope, rules of engagement, and crown-jewel targets
  are written and waiting in `VENDOR_PACK/PENTEST_LETTER.md`. Needs a vendor
  and a budget. Typical elapsed time from signature to retest letter: six to
  ten weeks.
- **O2 Cryptographic review and SOC 2.** Scope written. SOC 2 Type I requires
  only a signed engagement letter for GA, not the report, but the letter takes
  weeks to negotiate.
- **O3 Support and uptime commitment.** Undecided. State only what will be
  honored.
- **O4 Vendor E&O and cyber insurance.** Not obtained. In enterprise
  onboarding this is frequently the longest-lead item of all, often longer than
  the penetration test.
- **D3 Deletion versus chain retention.** Framed for counsel in `operations/DATA.md`. No
  destructive deletion code will be written until it is decided.

**Engineering items: closed, with two exceptions that need a human hand.**

C1.6, C3 rotation, C4, and the offline half of C2 are complete and permanent.
Two findings came out of them, both fixed: C1-006, an infected attachment that
was labelled blocked and served anyway, and a rotation runbook that never said
a retired key must stay published, which is the omission that would have
destroyed every historical receipt at the first rotation.

What is left needs credentials or a click, not engineering:

- **Restore drill.** A provider snapshot restored to a scratch instance, and
  the time it takes. The structural half is already continuous: every backend
  suite rebuilds the whole database from source and exercises it.
- **C2's last step.** Export a receipt bundle and an evidence pack through the
  interface and run the CLI and `openssl` against them. Five minutes for an
  account holder. The procedure is proven on real keys by the rotation drill
  and the evidence CLI suite; what is unverified is that one production
  artifact's signature bytes.

## For the six teams who will audit this

What to read first, and what will impress or worry a reviewer:

1. `security/HARDENING_REPORT.md`. It contains two serious defects found by the
   in-house sweep, both with reproductions, and two more that were
   self-inflicted during the fixes. A vendor who shows only clean results is
   showing an incomplete search.
2. `security/AUTHZ_MATRIX.md`. Every function and who may execute it, regenerated by a
   test that fails the build on drift.
3. `VENDOR_PACK/OFFLINE_VERIFICATION.md`. Ten minutes, no account, no network
   access to ReqPub. If it does not work as written, that is a finding.
4. The gates: `tools/audit.mjs`, `tools/capabilities-gate.mjs`,
   `tools/claims-gate.mjs`, `scripts/spec-schema-parity.mjs`, and the 30-suite
   backend chain. They are the reason the documentation and the code cannot
   drift apart quietly.

What a reviewer should press hardest on, stated so they do not have to find it:
the DNS-rebinding residual on webhook delivery; storage isolation, which is
unexercised by our own suites; and the absence of any third-party attestation.

---

## Strategy audit · an external assessment, checked against the product

An assessment of five weaknesses was reviewed against measured repository and
production state. Recording the result here because a plan built on stale facts
spends money twice.

### Already shipped. Do not fund these again.

- **"Ship a pursuit to engagement starter path, already partially present."**
  Fully shipped in v2.56, including promote with a fingerprint recomputed and
  asserted equal to what the signer signed, and a mismatch that aborts before
  anything is created.
- **"A one-click close package."** Shipped in v2.57: the Record of Delivery
  plus the full evidence pack, flattened under a single manifest.
- **"A light mode or template set that still produces a fingerprinted
  baseline."** This is the Pursuit template. It trims the worksheet to the
  scope-bearing sections and leaves the cryptographic surface identical, which
  is exactly the described requirement.
- **"One more permanent adversarial suite for the remaining C1 items."**
  C1.2, C1.3, C1.4, C1.5, C1.7, and C1.8 are complete and permanent. C1.6
  storage probing remains, and is named as unexercised in the pen test scope.

### Accurate, open, and now addressed in this release

- **The gates as institutional memory rather than individual discipline.**
  `OPERATING_MODEL.md` publishes every gate, what it refuses, the
  never-build list with the rule that decides any future field, and the reason
  our own findings are published.
- **A procurement one-pager mapping each risk question to a mechanism and a
  test.** `VENDOR_PACK/PROCUREMENT_BRIEF.md`. Six rows say not yet, on purpose.
- **Onboarding without tribal knowledge.** `operations/ONBOARDING.md`: ninety
  minutes ending in deliberately breaking four things to watch four gates catch
  you.

### One gap the assessment did not name

**There is no SSO and no SCIM.** Authentication is delegated to the hosting
provider's auth service; there is no SAML or OIDC federation and no directory
provisioning. For the buyer profile in question this is usually the first
question from the identity team, before security review begins. It is now
stated on the procurement brief rather than discovered in a questionnaire.

### Three recommendations to change

1. **"Prioritize the SOC 2 Type II path."** Type II cannot be prioritized
   directly. It attests that controls operated over an observation window,
   typically three to twelve months, which cannot begin before the Type I
   engagement exists. Sequence: sign the Type I engagement, which is the item
   GA actually requires, operate, then Type II. Pursuing Type II first delays
   the only milestone that unblocks GA by roughly a year and gains nothing.

2. **"A named external reviewer re-runs the red-team suite quarterly and
   publishes the report."** The suites already run on every build, so a
   quarterly external re-run buys attestation, not coverage, at four times the
   cost. Better use of the same budget: one deep penetration test with a real
   scope, plus publishing the gate results and `security/AUTHZ_MATRIX.md` per release,
   which is continuous, free, and inspectable.

3. **"One reference engagement, even if anonymized."** Correct in intent, with
   a constraint the assessment missed. A convincing reference artifact is a
   sealed baseline with a real client's name inside it, because that is what
   sealing means. The alternatives are a real engagement with written
   permission to publish, or a practice record, which is watermarked
   PRACTICE RECORD on every surface by design and will read as a demo. There is
   no third option, and discovering that in a partner meeting would be
   expensive. Get permission from the first real engagement, at the start,
   before anything is signed.

### The conclusion worth carrying into a partner room

The assessment's own summary principle is right and the product already
implements it further than the assessment realised: convert internal rigour
into external, inspectable proof. The strongest single artifact for that is not
a deck. It is a stranger, offline, with no account, verifying a sealed record in
ten minutes using only published documents. That procedure exists, it is
written down, and it is the thing to put in front of a technical audience
first.

---

## External specification audit, 5 August 2026

An advisor specification proposing 25 items was audited against the repository
rather than accepted. `reviews/2026-08-05-advisor-audit.md` records the whole verdict. Summary:

**One serious finding, now fixed.** The Supabase client was loaded from a
public CDN at a floating version tag on the three pages that hold a session,
with the content security policy naming that origin. Recorded as C1-007, fixed
by vendoring at a pinned hash, and made permanent by
`tools/supply-chain-gate.mjs`.

**A gap in the gates themselves.** The claims gate and the copy gate were
never in CI. Both are blocking steps now.

**Four items were already shipped** and would have been funded twice: storage
probing, the completeness sweep, the rotation drill, and the offline
verification work.

**Two claims about this repository were false**, including the claim that the
public key file was missing and the claims gate red.

**Refused, pending an owner decision:** five invented prices, and three
features that would have broken the declared freeze. The strongest idea in the
document, running ReqPub on ReqPub to produce a genuine sealed reference
record, needs real named approvals and therefore needs a person.

## The honest summary

The engineering is in good condition and the discipline is unusual: every claim
is tied to a test, every schema change ships mirrored, every finding is written
up including the ones caused by the fixes. Two genuinely serious
vulnerabilities were found and closed by adversarial work on our own system
before anyone external looked, which is the outcome that process is for.

It is not GA. It cannot be GA until three third parties have looked at it and
one lawyer has answered one question. Presenting it as GA before then would be
the single fastest way to lose the room with the audience this is being built
for.
## Open: no interface code is executed in a test

The widest gap in the suites, named by an outside reviewer in August 2026 and
recorded in [ASSURANCE.md](ASSURANCE.md). Roughly 470 kilobytes of interface
code is covered by syntax parsing, by view functions called as functions, and
by a symmetry audit. None of that executes a click. A handler can be present,
correctly wired, pass every gate, and throw when a person uses it.

Closing it means a headless browser in the suites, driving the real
application against a seeded database, clicking every registered action and
asserting nothing throws. That is a real build and it is not started. It is
listed here rather than in a backlog because it is the honest answer to
someone who reads 1,420 passing checks and assumes the interface is covered.

