# ADR-0002: Server-ordered field-level last-write-wins rather than a CRDT

> This record is an index into `docs/ARCHITECTURE.md`, not a freshly argued
> decision. The argument lives there and is not repeated here. The fields below
> add the status and consequences that the architecture document does not carry.

## Context

Excerpted from `docs/ARCHITECTURE.md`, section 1. The argument is
not restated here; the source is the reference.

v1 failed under nine editors because of two compounding properties: whole-object writes (every save shipped an entire array or answers object) and stale reads (no realtime, cache-first opens). Any two concurrent writers overwrote each other's whole object, and because reads were stale, the overwrite was the norm. The audit that preceded this rebuild counted the read-modify-write anti-pattern in roughly eighteen places.

## Decision

Server-ordered field-level last-write-wins rather than a CRDT.

## Status

Accepted. Shipped before v3.0.0 and unchanged by it.

## Consequences

Recorded in `docs/ARCHITECTURE.md` alongside the argument. The behaviour is
load-bearing and covered by the backend suites, so changing it breaks something
a customer or an integrator already depends on.

## Alternatives considered

A CRDT was rejected: the conflict rate on a requirements document is low, the merge semantics are hard to explain to the party who has to sign the result, and an unexplainable merge is unacceptable in a record whose purpose is agreement.
