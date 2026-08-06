# Assurance state

The version number describes the software. This page describes what other
people have verified. The two are separate on purpose, and the reasoning is in
[decisions/ADR-0001-versioning-and-assurance.md](decisions/ADR-0001-versioning-and-assurance.md).

## The three states

**Self-attested.** The vendor's own gates and test suites, published in the
repository, reproducible by anyone who clones it. Every claim on the website is
tied to an artifact and a named test, and a gate fails the build when a claim
and its evidence drift apart.

**Independently reviewed.** A named third party has tested the system and
issued a letter. The letter is published in `VENDOR_PACK/`.

**Attested GA.** Penetration test criticals and highs closed and retested, a
cryptographic review letter received, and a SOC 2 engagement signed.

## Current state

**Self-attested**, as of 5 August 2026.

## What that means, precisely

Every control below is enforced by something that runs on every build. None of
it has been verified by a third party.

| Control | Artifact | Enforced by |
| --- | --- | --- |
| Every published claim names an artifact and a test | `tools/claims-gate.mjs` | Blocking CI step |
| Published figures match what the suites prove | `tests/COUNTS.json` | Claims gate, COUNT class |
| A published URL resolves to a file we ship | `reqpub-keys.json` and the rest | Claims gate, SERVED class |
| The executable database surface is an allowlist | `security/AUTHZ_MATRIX.md` | `tests/backend-e2e/authz-matrix.test.mjs` |
| No third-party script origin, vendored files pinned by hash | `app/vendor/VENDOR.md` | `tools/supply-chain-gate.mjs` |
| Contrast at WCAG AA and one measure for body text | `site.css`, `index.html` | `tools/design-gate.mjs` |
| Interface, site, and documents free of assembled prose | every surface | `tools/copy-gate.mjs` |
| The specification and the schemas agree | `SPEC.md`, `../schemas/` | `scripts/spec-schema-parity.mjs` |
| Offline verification works without us | `../tools/reqpub-verify.mjs` | `tests/verify-cli.test.mjs` |

## What the suites do not cover

An outside reviewer reproduced the check counts exactly and then named four
things the numbers do not prove. They are correct, and the first is the widest
gap in this repository.

**Nothing is ever executed in a browser.** There is no Playwright, no
Puppeteer, and no jsdom in the dependencies. Roughly 470 kilobytes of interface
code is covered by syntax parsing, by string-builder assertions that call the
view functions and read the HTML they return, and by a symmetry audit matching
every markup action to a handler. A handler can exist, be correctly wired, pass
all three, and still throw the moment somebody clicks it. Static analysis found
two such defects in August 2026, both calls to functions that did not exist,
one of them in the pursuit promotion path. Nothing in the suites would have
caught either.

**The backend suites validate the migrations, not the deployment.** They build
a schema locally and exercise the functions against it. Nothing in them
confirms that the live project has those migrations applied, the same policies
in force, all eight edge functions deployed with correct secrets, or the
storage buckets configured. The edge functions run through shims here, not the
Deno runtime they run on in production.

**External integrations are tested against their contracts, not against
reality.** Webhook delivery, transactional email, agent clients, and PDF
rendering are covered by schema and fuzz tests with no live counterparty.

**Several gates check prose rather than behaviour.** The copy gate, the
documentation gate, and the claims gate enforce that the writing is consistent
and that every claim names an artifact and a test. That is worth having, and a
passing copy gate says nothing about whether a feature works.

## What is not attested

No third-party penetration test has been commissioned. No cryptographic review
has been commissioned. No SOC 2 engagement is signed. There is no SSO and no
SCIM. A restore from a provider snapshot has never been drilled. DNS rebinding
on webhook delivery is an accepted residual, recorded in
[security/HARDENING_REPORT.md](security/HARDENING_REPORT.md).

These are the same items `STATUS.md` names, in the same words, and they do not
soften because a major version shipped.

## How to verify the self-attestation yourself

Do not take the table above on trust. Clone the repository and run the chain in
`CONTRIBUTING.md`. Every gate prints what it checked and how many things it
checked. Then follow `VENDOR_PACK/OFFLINE_VERIFICATION.md` and verify a sealed
record with `openssl` and a standalone checker that imports nothing from us.

A vendor who says do not take our word for it, here is the command, is in a
different category from one who ships a badge. That is the whole argument for
this page.
