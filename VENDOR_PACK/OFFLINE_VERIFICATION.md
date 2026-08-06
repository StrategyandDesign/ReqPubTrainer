# Verify a ReqPub record in ten minutes, offline

For a buyer's security team. No account, no network access to ReqPub, no trust
in anything ReqPub asserts. If any step fails, the record is not what it claims
to be.

## What you need

Node.js, `openssl`, the evidence pack or receipt bundle your counterparty gave
you, and one file fetched once from `https://reqpub.com/reqpub-keys.json`. Take
the key file on a machine with network access, then disconnect.

## 1. Confirm the fingerprint from the content alone

The baseline bundle carries the content and the recipe that produced its
fingerprint. Recompute it:

```
node tools/reqpub-verify.mjs --bundle baseline-1.0.json
```

The tool computes SHA-256 over canonical JSON of the label, sequence, and
snapshot, keys sorted, UTF-8 bytes, and compares. It reads nothing else and
calls nothing. The same recipe is published normatively in `docs/SPEC.md`; you
can implement it yourself in twenty lines and get the same answer.

## 2. Confirm the whole pack

```
node tools/reqpub-verify.mjs --evidence ./evidence-pack/
```

Every file is hashed against the manifest, in both directions: a file listed
and missing fails, and a file present and unlisted fails. Change one byte
anywhere and the result changes.

## 3. Confirm who signed, and that the signature is theirs

The receipt names a key id. Find that key in `reqpub-keys.json`, and verify the
Ed25519 signature over the receipt's canonical bytes. The CLI does this; so does
twenty lines of your own code against any Ed25519 library. The key is public
and pinned by id, so a substituted key does not verify.

## 4. Confirm the record existed at a time, without trusting ReqPub

Each sealed receipt carries RFC 3161 timestamp tokens from two independent
authorities. Verify them with the standard tool:

```
openssl ts -verify -in tsa_primary.tsr -queryfile receipt.hash -CAfile <authority CA>
```

The authorities are not ReqPub, do not share ownership with ReqPub, and learned
only a hash. If both verify, the receipt existed at that time regardless of what
ReqPub says.

## 5. Confirm nothing was inserted or removed from the history

The pack's chain verification result reports each activity row's link to its
predecessor. Recompute it from the chronology file: any inserted, removed, or
edited row breaks the chain at the exact seam, and the report names where.

## What each step proves, and what it does not

A fingerprint proves content, not signer and not time. A signature adds who. A
timestamp adds when. The chain adds that the surrounding history is intact.
Together they answer what was agreed, by whom, and when it existed. They do not
prove that the person who typed a name had authority to bind their employer;
that is a question about your counterparty's internal controls, and ReqPub does
not claim to answer it.
