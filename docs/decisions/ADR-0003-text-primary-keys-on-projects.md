# ADR-0003: Text primary keys on projects to preserve v1 share links

> This record is an index into `docs/ARCHITECTURE.md`, not a freshly argued
> decision. The argument lives there and is not repeated here. The fields below
> add the status and consequences that the architecture document does not carry.

## Context

Excerpted from `docs/ARCHITECTURE.md`, section 2. The argument is
not restated here; the source is the reference.

Everything shared is rows in Postgres; nothing user-visible lives in a JSON blob keyed by org anymore.

## Decision

Text primary keys on projects to preserve v1 share links.

## Status

Accepted. Shipped before v3.0.0 and unchanged by it.

## Consequences

Recorded in `docs/ARCHITECTURE.md` alongside the argument. The behaviour is
load-bearing and covered by the backend suites, so changing it breaks something
a customer or an integrator already depends on.

## Alternatives considered

A UUID migration was rejected because every share link already issued would have broken, and a link in a client mailbox is a promise.
