# ADR-0009: Ordered migrations with a ledger

## Context

Twenty-nine migrations existed with no ordinal and an apply order recorded only in prose, so nothing proved that replay matched the schema file.

## Decision

Ordered migrations with a ledger.

## Status

Accepted.

## Consequences

Replay is proven against the schema file on every build. A migration cannot
be edited after shipping without the checksum changing, and the replay test
names the file when it does.

## Alternatives considered

Leaving the order in prose was rejected: it cannot be tested, and an upgrade path that cannot be tested fails at a customer.
