# ADR-0007: A fingerprint identifies content; the receipt establishes signer and time

## Context

A fingerprint proves which bytes were agreed. It does not prove who agreed or when. Conflating the two would let a reader believe an unsigned baseline had been accepted.

## Decision

A fingerprint identifies content; the receipt establishes signer and time.

## Status

Accepted.

## Consequences

Every export states what a fingerprint proves and what it does not, in those
words. A reader who takes a fingerprint as proof of signature has been misled
by us, so the sentence is not optional and the copy gate carries it.

## Alternatives considered

Publishing the fingerprint as proof of agreement was rejected as overclaiming.
