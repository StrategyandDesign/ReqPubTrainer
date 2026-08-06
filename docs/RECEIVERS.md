# Receiving ReqPub deliveries

This document is written for an integrator who has never seen ReqPub before
and needs a working, correct receiver in under an hour. It states the field
mapping normatively, so two teams implementing from it independently produce
receivers that behave the same way.

Two runnable references sit in `templates/receivers/`: `node-receiver.mjs`
for a service you run, and `serverless-handler.mjs` for any runtime that
hands you a `Request` and expects a `Response`. Both use only platform
builtins, and both are covered by the test suite in this repository.

Nothing in this directory names a product, a platform, or a firm. The mapping
below is stated in terms of the record you are writing into, whatever your
system calls it.

## 1. What arrives

One HTTP POST per event per endpoint, JSON body, three headers:

```
X-ReqPub-Key-Id: whk-1
X-ReqPub-Timestamp: <unix seconds>
X-ReqPub-Signature: <base64 Ed25519 over utf8(timestamp + "." + rawBody)>
```

The full envelope and its guarantees are specified in `WEBHOOKS.md`.
This document covers what to do with it.

## 2. The verification order, which is not optional

1. Reject if `|now - X-ReqPub-Timestamp| > 300` seconds.
2. Look up the key whose `kid` equals `X-ReqPub-Key-Id` in
   `https://reqpub.com/reqpub-keys.json` and import its
   `publicKeySpkiBase64`.
3. Verify the signature over the exact raw bytes received, prefixed by the
   timestamp string and a dot.
4. Parse the JSON only after the signature passes.
5. Refuse a `deliveryId` you have already accepted.
6. Hand the payload to your code.

Parsing before verifying means acting on bytes an attacker chose. Deduping
after handoff means doing the work twice. Re-serializing the body before
verifying means checking a signature over bytes the sender never sent.

## 3. The field mapping

Every delivery carries these fields. The target column is the field in your
own record that each one belongs in; the rule column states what an
implementation MUST do with it.

| ReqPub field | Type | Target record field | Rule |
| --- | --- | --- | --- |
| event | string | Event type | MUST branch on this; unknown values MUST be accepted and ignored, never rejected |
| deliveryId | string | Idempotency key | MUST be stored and checked before any side effect |
| occurredAt | ISO 8601 UTC | Event timestamp | MUST be stored as the event time; MUST NOT be used as the received time |
| projectId | string | Engagement or matter reference | MUST be the join key to your own record for this engagement |
| versionLabel | string | Baseline label | SHOULD be shown to humans reading the record |
| seq | integer | Baseline sequence | MUST be used for ordering baselines, not the label |
| signRequestId | string | Signature reference | MUST be unique per signature request |
| docFingerprint | 64 hex chars | Document fingerprint | MUST be stored verbatim; this is what makes the record checkable later |
| chainHead.seq | integer | Chain position | SHOULD be stored for audit reconstruction |
| chainHead.linkHash | 64 hex chars | Chain hash | SHOULD be stored alongside chain position |
| signerName | string | Signer | SHOULD be stored as authored; MAY be empty before signature |
| signerRole | string | Signer role | SHOULD be stored as authored; MAY be empty |
| receiptId | string, optional | Receipt reference | Present only on sealed events; MUST be treated as absent otherwise |

No email address, token, or key ever appears in a delivery. If your mapping
expects one, the mapping is wrong.

## 4. Idempotency

`deliveryId` is unique per delivery attempt group. Delivery is at-least-once:
the same `deliveryId` MAY arrive more than once, and a correct receiver acts
exactly once.

An implementation MUST record `deliveryId` durably before performing any side
effect, and MUST answer 2xx to a repeat without repeating the effect.
Retention MUST be at least twelve hours, which is the length of the retry
ladder; retaining longer costs nothing and protects against a manual
redelivery days later.

Two events describing the same signature are not duplicates of each other:
dedupe on `deliveryId`, never on `signRequestId`.

## 5. Retries and response expectations

Answer any 2xx within ten seconds. The first 200 characters of the response
body are kept for the sending manager's delivery log, so a short machine
readable body helps whoever is debugging.

A non-2xx or a timeout walks a fixed ladder: 1 minute, 5 minutes, 30 minutes,
2 hours, 12 hours, then the delivery is marked dead. Redirects are not
followed. A manager can redeliver a failed or dead delivery at any time,
which is why the idempotency rule above is stated as MUST.

If your work takes longer than ten seconds, respond first and continue after.

## 6. Security checklist

An implementation MUST:

- Verify the signature on every request, including retries and redeliveries.
- Compare timestamps with a bounded skew window and reject outside it.
- Read the raw body exactly once and verify those bytes.
- Fetch the key set over HTTPS and pin the `kid`, not a URL you construct.
- Refuse a delivery whose `kid` is unknown rather than falling back to any
  other key.
- Store `deliveryId` before side effects.

An implementation MUST NOT:

- Parse or act on the body before the signature passes.
- Trust any field as an authorization decision; a delivery states that
  something happened, never that the receiver may do something.
- Log the raw signature or the key material.
- Treat an unknown `event` value as an error.

## 7. Testing your receiver

The reference implementations are tested against four cases, and yours should
be too. A valid delivery is accepted. A body altered by one byte is refused
with `bad_signature`. A timestamp outside the window is refused with
`stale_timestamp`, before any parsing. A repeated `deliveryId` is refused
with `duplicate` while still answering 2xx.
