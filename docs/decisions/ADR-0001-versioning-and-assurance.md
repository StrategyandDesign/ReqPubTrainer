# ADR-0001: Versioning and assurance are separate axes

## Context

Until v3.0.0 this repository defined general availability as a version number.
`docs/STATUS.md`, formerly the GA readiness report, now `docs/STATUS.md`, stated that v3.0.0 required a
penetration test with criticals and highs closed and retested, a cryptographic
review letter received, and a signed SOC 2 engagement. It then stated plainly
that the bar was not met and that three of the open items could not be closed
by engineering at all.

That definition creates a trap. The engineering work reaches a major-version
boundary on its own schedule, and third-party attestation reaches its own on a
schedule set by vendors, budgets, and calendars. Tying them together means
either shipping a version number that contradicts a published definition, or
withholding a version number that the software has already earned.

## Decision

The version number describes the software. The assurance state describes what
third parties have verified. They are published separately and neither implies
the other.

v3.0.0 marks the engineering and documentation milestone. It is a major
version because repository paths change in ways that break existing links, and
because the assurance model itself changes.

Assurance is published in `docs/ASSURANCE.md` as one of three named states:
`Self-attested`, `Independently reviewed`, `Attested GA`. ReqPub is at
`Self-attested` and says so on the page and on the website.

## Status

Accepted, 5 August 2026, by the owner.

## Consequences

`docs/STATUS.md` no longer defines GA as a version. It defines GA as an
assurance state, records what the old definition was, and states why it was
wrong rather than quietly replacing it.

The website carries a version and an assurance state adjacent to each other.
Neither is presented as a badge.

A future release may reach `Attested GA` at any version number. The three
requirements that define that state are unchanged: they were the right
requirements, attached to the wrong axis.

## Alternatives considered

**Ship 3.0.0-rc.1 and leave the definition alone.** Honest, and it required no
rewriting. Rejected because a release candidate reads as unfinished to a
non-engineering audience, and because it preserves the original error rather
than correcting it. The conflation was the mistake; a suffix hides it.

**Ship 3.0.0 and quietly amend the definition.** Rejected. A repository whose
central discipline is that a claim needs an artifact and a test cannot amend an
inconvenient definition without recording the amendment.
