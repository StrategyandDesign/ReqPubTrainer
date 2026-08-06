# Verifying a ReqPub baseline

This document specifies, completely, how a ReqPub baseline fingerprint is
computed, so that anyone holding an exported bundle can recompute it with no
ReqPub code and no ReqPub service. The repository ships two independent
checkers built from this page. One is the browser page at `/verify.html`, which
runs the app's own code, and `tools/reqpub-verify.mjs`, a single-file Node
script that imports nothing from ReqPub. And CI asserts on every push that
both agree byte for byte on a bundle produced by the current export code.
That gate is what keeps this document true: the spec cannot drift from the
implementation without the build failing.

## 1. What the fingerprint is, and is not

A baseline fingerprint is `SHA-256(canonical({label, seq, snapshot}))` for
one stored version row, reported as 64 lowercase hexadecimal characters. It
identifies the exact snapshot an export was produced from: change any byte
of the label, the sequence number, or the snapshot and the fingerprint
changes.

It is **not a signature and not a trusted timestamp**. A matching
fingerprint proves this file's content is the content the fingerprint was
computed from. It does not prove who computed it or when. Cryptographic
sealing is the e-signature phase of ReqPub; no sealing claim is made before
it ships.

## 2. The bundle format

The app exports a baseline as a JSON file (the "bundle"). It is a single
JSON object with at least these members:

| Member        | Type              | Meaning                                        |
| ------------- | ----------------- | ---------------------------------------------- |
| `label`       | string            | The version label as stored, for example `1.2` |
| `seq`         | number            | The version's sequence number as stored        |
| `snapshot`    | object            | The full stored snapshot (answers, sections)   |
| `fingerprint` | object, optional  | `{ algorithm: "SHA-256", value, recipe }`      |

`format`, `formatVersion`, `product`, and `note` may also be present; they
are informational and take **no part in the hash**. Only `label`, `seq`, and
`snapshot` are hashed, exactly as clause 3 below defines. Pretty-printing,
key order in the file, and any extra members carry no meaning: verification
parses the JSON and works on the parsed values.

## 3. Canonicalization

The canonical form is a deterministic serialization of the parsed JSON value
`{ label, seq, snapshot }` (an object with exactly those three keys, taken
from the bundle). It is defined recursively:

1. **null** serializes as the four characters `null`.
2. **Booleans** serialize as `true` or `false`.
3. **Numbers** serialize exactly as ECMAScript `JSON.stringify` serializes
   them: the shortest decimal representation that round-trips the IEEE-754
   double (ECMA-262 `Number::toString`). Every value in a bundle has been
   through JSON at least once, so this rule is stable across compliant
   engines: `1.0` in source text parses to the double `1` and canonicalizes
   as `1`; `100` and `1e2` both canonicalize as `100`.
4. **Strings** serialize exactly as ECMAScript `JSON.stringify` serializes
   them: wrapped in double quotes, with `"` and `\` backslash-escaped,
   control characters U+0000 to U+001F escaped (`\n`, `\t`, `\r`, `\b`,
   `\f`, and `\u00XX` for the rest), and all other characters, including
   non-ASCII, emitted literally as their UTF-8 bytes when hashed.
5. **Arrays** serialize as `[`, the canonical forms of their elements in
   array order joined by `,`, then `]`. An element that is `undefined` or a
   function (unreachable after `JSON.parse`; pinned for completeness)
   serializes as `null`.
6. **Objects** drop every key whose value is `undefined`, sort the remaining
   keys ascending by UTF-16 code units (the ECMAScript default string
   sort), and serialize as `{`, then for each key `"key":value` with the
   key escaped per rule 4 and the value canonical, joined by `,`, then `}`.
7. **No whitespace** appears anywhere outside string content.

The reference implementation is `canonicalJson` in `app/js/core.js` (23
lines). `tools/reqpub-verify.mjs` reimplements it from this page alone.

## 4. Hashing

Encode the canonical string as UTF-8 and hash with SHA-256 (FIPS 180-4).
Report the digest as 64 lowercase hexadecimal characters. Displays may
prefix `sha256:` and group or truncate for reading; the recorded and
compared value is always the full 64 characters.

## 5. Worked example

Input object (any key order, any whitespace):

```json
{ "seq": 2, "label": "1.1", "snapshot": { "answers": { "ov_vision": "The vision" } } }
```

Canonical form (one line, no spaces):

```
{"label":"1.1","seq":2,"snapshot":{"answers":{"ov_vision":"The vision"}}}
```

SHA-256 of the UTF-8 bytes of that line:

```
d681043efd35679b213072b1724b7f5031b6c39f167ec5fb8b6abcdc89ef9edb
```

Any implementation that reproduces this value on this input, and honors
clauses 3.1 through 3.7, verifies real bundles.

## 6. Checking a bundle

**In the browser.** Open `/verify.html` on the ReqPub site, paste or upload
the bundle, and read the result. The check runs entirely in your browser
with no network call; the page imports the same `canonicalJson` and SHA-256
code the app used to record the fingerprint.

**Offline.** With Node 18 or later installed:

```
node tools/reqpub-verify.mjs my-baseline.reqpub.json
```

The script prints the computed and embedded fingerprints and exits 0 on a
match, 1 on a mismatch, 2 on unusable input or when there is nothing to
compare against. To check against a fingerprint printed on a document
rather than the embedded one:

```
node tools/reqpub-verify.mjs my-baseline.reqpub.json d681043efd35679b...
```

To see the exact canonical byte stream (for reimplementers):

```
node tools/reqpub-verify.mjs --print-canonical my-baseline.reqpub.json
```

## 7. What the gate in CI asserts

`tests/verify-cli.test.mjs` builds a bundle with the app's current export
code, verifies it with the standalone CLI, and asserts three things: the
CLI's canonical byte stream is identical to the app's, the CLI reports
VERIFIED on the untouched bundle, and the CLI reports MISMATCH after a
single-byte change to the snapshot. The suite runs on every push. If the
export code, this specification, or the CLI ever disagree, the build fails
before anything ships.

## 8. The activity chain (v2.47)

Each project carries a hash chain over its activity trail. The chain proves
the recorded sequence is complete and unaltered. It does not change what any
single baseline fingerprint proves, and it never canonicalizes JSON in the
database: it hashes delimited column bytes.

For every chained activity row:

entry_hash = sha256 over the UTF-8 bytes of these fields, joined by the
unit separator character U+001F, in this frozen order:

1. id (as decimal text)
2. org_id (uuid text)
3. project_id (empty string when null, and such rows are never chained)
4. actor (uuid text, empty string when null)
5. actor_name
6. action
7. entity_kind
8. entity_id
9. summary
10. meta as Postgres jsonb::text
11. created_at at UTC as YYYY-MM-DD"T"HH24:MI:SS.US"Z"

link_hash = sha256 over the UTF-8 bytes of prev_hash || entry_hash, both as
64-character lowercase hex. Genesis is seq 0: its prev_hash is
sha256('REQPUB-441028c6f98459f24c57f2e850c689ba14a7ddbbf7a7edfd3bbb3019936c92d0ESIS:' || project_id) and its entry covers a chain.genesis
activity row whose summary states that the chain begins at that event,
earlier rows are enumerated after it by the backfill in insertion order, and
baseline integrity before that point rests on the per-version fingerprints.

Worked example. Project id `example`; a genesis activity row with id 7,
org_id 0b0e7d02-0000-0000-0000-00000000aa11, actor null, actor_name
`system`, action `chain.genesis`, entity_kind `chain`, entity_id `example`,
summary `The chain begins at this event.`, meta `{}`, created_at
2026-08-01T12:00:00.000000Z:

```
prev_hash  = 441028c6f98459f24c57f2e850c689ba14a7ddbbf7a7edfd3bbb3019936c92d0
entry_hash = ae640fbba60f206e6801f482e1f0aa6b7e73901b71e5bf5565eb1e65decc4447
link_hash  = 892ab5e7177b662617b6ae05f663196e81180218d01634e7abba79c18013077f
```

Verification walks seq 0 to head recomputing every entry and link from the
activity rows; the RPC verify_project_chain returns ok with the head, or
the first divergence seq, plus a coverage count of project rows not yet
chained. The chain proves sequence integrity of the recorded trail. Scope
ends there.

## 9. The acceptance receipt and the seal (v2.48)

A sealed receipt turns a signed baseline into an offline-verifiable
artifact. It carries an Ed25519 signature over the canonical receipt and,
when the timestamp authorities are reachable, two RFC 3161 timestamps. The
receipt itself is JSON, format `reqpub-receipt`, formatVersion 1. It carries
hashes, not content: the project name as a SHA-256, the baseline fingerprint
this receipt seals, and the signer facts as recorded. It never carries a
sign token or a signer's email address; the signer's email domain appears,
computed at read time.

Legacy note: sign requests created before fingerprint capture carry an
empty captured value. Their receipts seal with `docFingerprint` empty, the
recomputed value present, and a `fingerprintNote` stating the absence. The
verifier compares the baseline against the recomputed value in that case
and says so. A receipt where both values are present and differ cannot
exist: sealing aborts on that condition.

The receipt's `baseline` block carries both the fingerprint captured when the
request was sent and the fingerprint recomputed from the stored snapshot at
seal time. Sealing asserts these equal and aborts otherwise, because sealing
a divergent pair would be manufacturing evidence. The receipt's `chain` block
carries the project chain head as it stood before this receipt's own
`seal.issued` activity row, so a receipt never contains the hash of its own
logging; when the chain is unreachable at seal time the block states
`chain_unavailable` and the seal still issues.

To verify a receipt bundle offline, three steps:

1. Baseline. Recompute the fingerprint of the enclosed
   `baseline-bundle.reqpub.json` per sections 3 to 5 and confirm it equals
   `receipt.json` `baseline.docFingerprint`.
2. Seal. Canonicalize `receipt.json` per section 3, take its SHA-256, and
   verify the Ed25519 signature in `signature.txt` against the public key in
   `publickey.txt`. On Node 20 or later: `crypto.verify(null, hashBytes,
   publicKey, signatureBytes)` returns true.
3. Time. For each `.tsr`, verify it against the receipt canonical hash with
   the OpenSSL command printed by `tools/reqpub-verify.mjs`.

`node tools/reqpub-verify.mjs <extracted-receipt-directory>` performs steps 1
and 2 from this document alone, on Node builtins, importing nothing from
ReqPub, and prints the OpenSSL commands for step 3.

What the seal proves: this receipt content was signed by the holder of the
ReqPub key named by its kid, and, where timestamps are present, existed at
the timestamp authority times. Who typed the name is evidenced by the signing
record, not by the seal. The published keys live at reqpub-keys.json at the
site root, retired keys included, forever.

## 10. Attachment hashes (v2.49)

Every file the platform stores carries `sha256_hex`, the SHA-256 digest of
the file's exact bytes, 64 lowercase hex characters, computed by the upload
function in the same pass that virus-scans the bytes and recorded through
the same validated insert. An empty value means no digest was recorded,
never that the digest is unknown-but-implied.

Two provenances exist and are never confused. A digest recorded at upload
is the strongest claim: these bytes, at the moment they arrived. A digest
added later by the backfill carries `hashed-after-upload` in the row's
`scan_detail`, permanently: it proves what the bytes were when the backfill
ran, and nothing earlier. The backfill never overwrites an existing digest,
at-upload provenance included, so re-running it cannot rewrite history.

To check a stored file yourself, download it from the Files list and hash
it locally:

    shasum -a 256 <file>          (macOS, Linux)
    certutil -hashfile <file> SHA256   (Windows)

The result must equal the row's `sha256_hex`. The in-app Verify action does
the same thing server-side: it re-downloads the object from storage,
re-hashes, and reports match or mismatch with both values. A mismatch means
the stored bytes and the recorded digest disagree, and the honest reading
is that one of them changed after recording.

Sign requests created from v2.49 onward snapshot the project's clean,
hashed files into the signing record at the moment of send, oldest first,
as `evidence.attachmentsAtSend`: file name, digest, size, nothing else. A
file that cannot prove its bytes at send, unscanned, scan-errored, or
unhashed, is excluded, because the snapshot is evidence rather than
inventory. The snapshot rides inside the sealed receipt (section 9): the
receipt's `evidence` block carries it verbatim, so the Ed25519 signature
and the RFC 3161 timestamps cover it. It never contains a sign token or an
email address.

What the snapshot claims, precisely: these files, with these exact bytes,
existed on the project when the signature request went out. It does not
claim the signer read them and it does not make any file part of the
accepted deliverable. Attachments are thread artifacts; the accepted
deliverable is the version snapshot, already fingerprinted per sections 1
through 5. No acceptance rule gates on attachment state, by design.

## 11. The evidence pack (v2.52)

One zip per project, exported by a manager: what was agreed, what changed,
who signed, provable, offline. Layout:

    README.txt                       what the pack proves and does not
    cover.html                       printable cover, counts only
    chronology.json                  every activity row; meta omitted, stated
    chronology.csv                   the same rows as csv
    evidence.csv                     one row per signature; the column list
                                     is normative and frozen at v2.52
    attachments-manifest.csv         file_name, mime, size_bytes, sha256_hex,
                                     scan_status, created_at
    chain-verification.json          verify_project_chain output verbatim,
                                     recompute per section 8
    VERIFY-excerpt.txt               the working excerpt of this document
    versions/baseline-<seq>.reqpub.json   one bundle per baseline, section 2
    receipts/<hash8>/...             one folder per sealed receipt, exactly
                                     the receipt bundle of section 9
    manifest.json                    the recipe below

The manifest recipe. manifest.json lists every other file in the pack with
its SHA-256 computed over the exact bytes of that file. generatedAt appears
only in the manifest, so per-file hashes are deterministic: two exports of
an unchanged record differ in exactly one file, and that file says why.
evidence.csv columns, in order: project_id, project_name, version_label,
seq, doc_fingerprint, signer_name, signer_role, signer_email_domain,
signed_at, receipt_id, canonical_hash, tsa_status, sealed_at,
chain_head_seq, chain_head_hash. Every csv cell that begins with a
character a spreadsheet would execute is prefixed with a single quote.

Verification is strict both ways. A listed file that is missing or whose
bytes do not hash to its manifest entry fails the pack. A file present in
the folder but absent from the manifest fails the pack. Then every
baseline bundle must reproduce its embedded fingerprint per sections 3 to
6, and every receipt folder must pass section 9, with the .tsr timestamps
checked by the printed openssl ts commands.

One command runs all of it:

    node tools/reqpub-verify.mjs --evidence <unzipped-pack-folder>

PACK-VERIFIED on success. MISMATCH names the first thing that failed. The
pack asserts no computed status and no summary judgment; mapping to
revenue recognition judgments belongs to the firm and its auditors, and
ReqPub asserts none.

## 12. A known variant in receipts sealed before the published standard

The standard in `SPEC.md` and the JSON Schemas were published in v2.53.
Receipts sealed before that release may carry `project.nameSha256` as an empty
object rather than a 64-character hex digest, because the build that produced
them did not await the digest and an unawaited promise serializes to `{}`.

If you are validating such a receipt against the published schema, expect that
one field to fail and nothing else. The properties that matter are unaffected
and still verify exactly as described above: the baseline fingerprint, the
Ed25519 signature over the canonical receipt bytes, both RFC 3161 timestamps,
and the chain head. The signature covers the bytes as they were written, so it
verifies against the receipt you hold.

ReqPub does not re-seal historical receipts to make this disappear. Re-signing
an artifact to fit a later specification would defeat the point of sealing it
in the first place. The variant is recorded here, its scope is stated in
`security/HARDENING_REPORT.md` under C2-001, and receipts sealed from v2.53 onward carry
the digest, which is enforced by test on every build.
