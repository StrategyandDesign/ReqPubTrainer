# SPEC.md: The ReqPub formats

This document is normative for the three published ReqPub formats. The
machine-readable schemas live in schemas/ as JSON Schema draft 2020-12,
generated to match the implementation and frozen; this document and those
schemas ship in the same commit as the code that emits them, and a CI
parity gate holds the required-field tables below equal to each schema's
required list.

License: OWNER TO CONFIRM per standing decision D1.

## The standing invariant

ReqPub formats are verified by exact bytes and canonical JSON per
VERIFY.md. There is no JSON-LD processing, no RDF canonicalization,
and no Data Integrity proofs, now or in any future formatVersion.
Canonicalization is VERIFY.md clause 3 and nothing else: object keys
sorted, arrays in order, strings, numbers, booleans, and null exactly as
JSON.stringify emits them, undefined pinned to null, UTF-8 bytes hashed
with SHA-256.

## Versioning policy

Each format carries a format constant and a formatVersion integer. Within
a formatVersion, changes are additive only: a consumer built against this
document keeps working when new optional fields appear. A breaking change
increments formatVersion, and both schema versions stay published. The
runtime CLI performs hand-rolled required-field and type checks derived
from this document on node builtins; the ajv validation in the test suite
is a devDependency only and never ships in the CLI.

## 1. The baseline bundle · schemas/reqpub-baseline-bundle.schema.json

One JSON file holding exactly what the fingerprint covers, {label, seq,
snapshot}, plus the fingerprint the record captured. The fingerprint is
SHA-256 over the canonical JSON of {label, seq, snapshot}; VERIFY.md
sections 3 to 6 are the recipe and the worked example. The fingerprint
identifies the exact snapshot; it is not a signature and not a trusted
timestamp.

| Field | Type | Required |
|---|---|---|
| format | the constant reqpub-baseline-bundle | yes |
| formatVersion | the integer 1 | yes |
| product | string, display name at export time, no verification meaning | no |
| label | string, the version label as stored | yes |
| seq | integer, at least 1, the version sequence as stored | yes |
| snapshot | object, the stored snapshot verbatim | yes |
| fingerprint | object: algorithm, value, recipe | yes |
| fingerprint.algorithm | the constant SHA-256 | yes |
| fingerprint.value | 64 lowercase hex characters | yes |
| fingerprint.recipe | string, the recipe restated in words | yes |
| note | string, the not-a-signature statement | no |
| practice | the constant true, present only on a practice record | no |

## 2. The acceptance receipt · schemas/reqpub-receipt.schema.json

The sealed record of one signature on one baseline. The seal is an
Ed25519 signature over the SHA-256 of this object's canonical JSON;
VERIFY.md section 9 is the verification recipe, and the .tsr files beside
the receipt are RFC 3161 timestamps over that same hash, checked with the
printed openssl ts commands. No token and no email address appears in a
receipt; signer identity is name, role, and email domain.

| Field | Type | Required |
|---|---|---|
| format | the constant reqpub-receipt | yes |
| formatVersion | the integer 1 | yes |
| receiptId | string, the receipt row id | yes |
| sealedAt | string, ISO 8601 | yes |
| project | object: id, nameSha256 | yes |
| project.id | string | yes |
| project.nameSha256 | 64 lowercase hex, SHA-256 of the project name at seal time | yes |
| baseline | object: label, seq, docFingerprint, recomputedFingerprint | yes |
| baseline.label | string | yes |
| baseline.seq | integer, at least 1 | yes |
| baseline.docFingerprint | 64 lowercase hex, or empty only on the named legacy path | yes |
| baseline.recomputedFingerprint | 64 lowercase hex, recomputed at seal time | yes |
| baseline.fingerprintNote | string, present only on the legacy path | no |
| signature | object: signRequestId, signedName, signerRole, signerEmailDomain, signedAt, channel | yes |
| signature.signRequestId | string | yes |
| signature.signedName | string, the name the signer typed | yes |
| signature.signerRole | string | yes |
| signature.signerEmailDomain | string, domain only, never an address | yes |
| signature.signedAt | string | yes |
| signature.channel | string | yes |
| chain | object: headSeq, headHash, and reason when unavailable | yes |
| chain.headSeq | integer or null | yes |
| chain.headHash | 64 lowercase hex or null | yes |
| chain.reason | string, present only when the chain was unavailable | no |
| issuer | object: name, kid | yes |
| issuer.name | the constant ReqPub | yes |
| issuer.kid | string, the signing key id published in reqpub-keys.json | yes |
| practice | the constant true, present only on a practice record | no |

## 3. The evidence pack manifest · schemas/reqpub-evidence-manifest.schema.json

manifest.json inside an evidence pack: every other file in the pack with
its SHA-256 over exact bytes. VERIFY.md section 11 is the pack layout and
the verification recipe. Verification is strict both ways: a listed file
that is missing or changed fails the pack, and a file present but
unlisted fails the pack. generatedAt lives only in the manifest, so
per-file hashes are deterministic for an unchanged record.

| Field | Type | Required |
|---|---|---|
| format | the constant reqpub-evidence-manifest | yes |
| formatVersion | the integer 1 | yes |
| project | object: id, name | yes |
| project.id | string | yes |
| project.name | string | yes |
| generatedAt | string, ISO 8601, appears in no other file of the pack | yes |
| recipe | string, the manifest recipe restated in words | yes |
| files | array of objects: name, sha256 | yes |
| files[].name | string, path inside the pack, forward slashes | yes |
| files[].sha256 | 64 lowercase hex over the exact bytes of the named file | yes |

## Seal and timestamp semantics

The seal and the timestamps are defined once, in VERIFY.md section 9, and
this document points there rather than restating them: the Ed25519 public
keys are published at reqpub-keys.json with their kids, a valid signature
proves only that the holder of that key signed, and the RFC 3161 replies
prove the hash existed at the stated times per the timestamp authorities'
certificates.
