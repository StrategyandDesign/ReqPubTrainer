# ADR-0008: No model API is called anywhere in the product

## Context

The record must be reproducible and explainable. A model in the path makes both conditional on a vendor and a version.

## Decision

No model API is called anywhere in the product.

## Status

Accepted.

## Consequences

The claim is enforced by grep across four source trees on every build, so it
cannot become false quietly. It also means no feature may be built that needs
a model, which is a real constraint and is meant to be.

## Alternatives considered

An assisted intake mapper was rejected; the mapper is deterministic and every row is approved by a person.
