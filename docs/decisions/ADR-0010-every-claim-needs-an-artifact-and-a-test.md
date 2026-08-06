# ADR-0010: Every published claim requires an artifact and a named test

## Context

The site claimed a capability that had not shipped and a figure that was two years stale, and no mechanism noticed either.

## Decision

Every published claim requires an artifact and a named test.

## Status

Accepted.

## Consequences

A claim that cannot be tied to an artifact and a test does not ship, even when
it is true. That has cost real copy, and it is the reason the site survived an
audit that found four stale claims elsewhere.

## Alternatives considered

Review by reading was rejected. It had already failed twice.
