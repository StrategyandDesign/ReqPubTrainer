# ADR-0004: Row-level security with SECURITY DEFINER helpers

> This record is an index into `docs/ARCHITECTURE.md`, not a freshly argued
> decision. The argument lives there and is not repeated here. The fields below
> add the status and consequences that the architecture document does not carry.

## Context

Excerpted from `docs/ARCHITECTURE.md`, section 3. The argument is
not restated here; the source is the reference.

Row-level security on every table; membership checks run through `SECURITY DEFINER` helper functions (`is_org_member`, `is_org_manager`, `is_project_partner`) to avoid RLS recursion, the pattern proven in v1 and kept.

## Decision

Row-level security with SECURITY DEFINER helpers.

## Status

Accepted. Shipped before v3.0.0 and unchanged by it.

## Consequences

Recorded in `docs/ARCHITECTURE.md` alongside the argument. The behaviour is
load-bearing and covered by the backend suites, so changing it breaks something
a customer or an integrator already depends on.

## Alternatives considered

Inline policy subqueries were rejected because they recurse: a policy on org_members that reads org_members cannot terminate.
