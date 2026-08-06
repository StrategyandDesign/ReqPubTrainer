# ADR-0006: Accountless tokened links rather than seats for external parties

> This record is an index into `docs/ARCHITECTURE.md`, not a freshly argued
> decision. The argument lives there and is not repeated here. The fields below
> add the status and consequences that the architecture document does not carry.

## Context

Excerpted from `docs/ARCHITECTURE.md`, section 5. The argument is
not restated here; the source is the reference.

Three tiers, matching how the surveyed tools converge (paid makers, scoped free collaborators, zero-friction reviewers), plus the partner layer none of them model:

## Decision

Accountless tokened links rather than seats for external parties.

## Status

Accepted. Shipped before v3.0.0 and unchanged by it.

## Consequences

Recorded in `docs/ARCHITECTURE.md` alongside the argument. The behaviour is
load-bearing and covered by the backend suites, so changing it breaks something
a customer or an integrator already depends on.

## Alternatives considered

Seats for signers were rejected: an approver who must create an account is an approver who does not approve, and a seat outlives the person.
