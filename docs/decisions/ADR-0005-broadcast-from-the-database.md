# ADR-0005: Broadcast from the database on private channels

> This record is an index into `docs/ARCHITECTURE.md`, not a freshly argued
> decision. The argument lives there and is not repeated here. The fields below
> add the status and consequences that the architecture document does not carry.

## Context

Excerpted from `docs/ARCHITECTURE.md`, section 4. The argument is
not restated here; the source is the reference.

Change fan-out uses **Broadcast-from-Database**: AFTER-triggers on the collaborative tables (fields, rows, versions, comms, input requests, discovery, attachments, messages, approvals) call `realtime.broadcast_changes()` onto `proj:<project_id>` (and `org:<org_id>` for the project list). Supabase's own guidance now recommends broadcast over `postgres_changes` for multi-subscriber scale: `postgres_changes` re-evaluates RLS per subscriber per change and is the likelier bottleneck at nine-plus editors. Channels are **private**: RLS policies on `realtime.messages` admit org members and assigned partners only.

## Decision

Broadcast from the database on private channels.

## Status

Accepted. Shipped before v3.0.0 and unchanged by it.

## Consequences

Recorded in `docs/ARCHITECTURE.md` alongside the argument. The behaviour is
load-bearing and covered by the backend suites, so changing it breaks something
a customer or an integrator already depends on.

## Alternatives considered

Client-side broadcast was rejected because a client can lie about what changed; the database is the only party that knows.
