# Cryptographic review: NOT YET COMMISSIONED

**Status:** no third-party cryptographic review has been performed. This is the
prepared scope. Owner item O2.

## Scope

**Canonicalization.** The JSON canonical form and its three implementations,
which CI holds byte-identical. The question for a reviewer: can two different
inputs produce the same canonical bytes, and does the recipe as published in
`docs/SPEC.md` fully determine the output for any snapshot the product can
produce, including unusual Unicode and numeric forms.

**Ed25519 usage.** Key generation, storage as function secrets, signing input
construction, and whether any signed payload is ambiguous about what it covers.

**Timestamp construction.** What is sent to each authority, what is stored,
and whether the stored token is sufficient for independent verification years
later without ReqPub.

**Key custody and rotation.** The runbook, and whether receipts sealed under a
retired key still verify against the published retired key.

**The offline verification story.** Whether a competent third party, following
only the published documents, reaches the same conclusion the product does.

The reviewer is explicitly invited to challenge the honest-limit language: that
a fingerprint proves content but not signer or time. If that framing is wrong
anywhere in the documentation, it is a finding.
