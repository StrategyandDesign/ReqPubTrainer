# The ReqPub MCP server

A read surface for the record and a door into the inbox, never a hand on
the pen. Agents connect over MCP, read authored and cryptographic facts,
and, where two separate switches allow it, file a proposal a human will
triage. Nothing here signs, approves, edits, or finalizes anything.

## Connecting

Endpoint: POST https://<project-ref>.supabase.co/functions/v1/mcp
Protocol: MCP over Streamable HTTP, JSON-RPC 2.0. Methods: initialize,
tools/list, tools/call. Server name reqpub; version tracks the app.
Auth: Authorization: Bearer rqp_live_<32 base62 characters>.

A workspace manager issues keys from the Agent access panel on a project's
Share page. The key renders once at issuance; ReqPub stores only its
sha256. Revocation is immediate: the next call with a revoked key fails.
A key is scoped to the whole workspace or to a named set of projects,
fixed at issue.

## Rate limit

60 admitted calls per key per minute. The window counts every audit row,
so refused, denied, and errored calls consume budget too. Over the limit,
tools/call answers HTTP 429 with a JSON-RPC error reading rate limited.
Every call appends one row to an insert-only audit log: key, tool, a hash
of the parameters, outcome, time.

## Tools

reqpub_list_projects. No parameters. Every project the key can read:
id, name, createdAt, latest baseline label and status, and the practice
flag.

reqpub_get_baseline. projectId, optional seq. The stored version row:
label, seq, status, note, authorName, createdAt, the full snapshot, and
the fingerprint computed with the published recipe in VERIFY.md.
This is the spec an agent executes against: pin the fingerprint, do the
work, check the fingerprint again before claiming conformance. Since
3.2.0 the answer also states sealed (whether a signed, unrevoked request
on the version holds an acceptance receipt), sealedBy (signer name, role,
signed at, receipt id, timestamp status) and signedHandoff. A project with
signed handoff on answers an unsealed version with the error unsealed and
a sentence naming the baseline; the handler passes that sentence through
as "unsealed: ..." in the tool error text.

reqpub_get_signature_status. projectId, optional seq. Per sign request on
that baseline: signerName, signerRole, status, sentAt, signedAt, and
receiptId once sealed.

reqpub_get_receipt. receiptId. The stored receipt JSON, its Ed25519
signature, the signing key id, and the timestamp status. It does not
return the RFC 3161 `.tsr` tokens. Verify offline per VERIFY.md against
the published reqpub-keys.json. A caller that needs the tokens reads them
from a receipt bundle; the spec drift gate, below, says what it does when
the MCP answer has status only.

reqpub_verify_chain. projectId. Runs the project's activity-chain
verification and returns its output verbatim.

reqpub_propose. projectId, subject, body, optional targetRef such as
FR-003. Files a proposal into the project's Inbox with origin agent,
attributed to the key's label, status new. A human promotes it, actions
it, or closes it through the same triage every other inbound submission
gets. The response says what happens next: proposal recorded for human
review; agents propose, humans accept.

## The propose doctrine

Two switches, both default off, both required: the key's propose
permission, set at issue, and the project's Agent proposals setting,
turned on by a manager on the Share page and stored as an authored
control field on the record. tools/list omits reqpub_propose unless the
key allows it and at least one in-scope project has it on; the write
itself re-checks both against live rows.

## The spec drift gate

The pod commits requirements.json from the implementation package and runs
`tools/spec-drift-gate.mjs` in its pipeline:

    REQPUB_MCP_URL=https://<ref>.supabase.co/functions/v1/mcp \
    REQPUB_MCP_KEY=${REQPUB_MCP_KEY} \
    node tools/spec-drift-gate.mjs --project <project id> --file spec/requirements.json [--seq N] [--require-sealed] [--allow-unsealed]

`${REQPUB_MCP_KEY}` in that example is a placeholder for the pipeline
secret. Requiring a sealed baseline is the default. The gate reads the
baseline with reqpub_get_baseline, checks the committed fingerprint and,
when the committed file carries one, the label, and checks that `sealed`
is true. `--require-sealed` is accepted and changes nothing, so a pipeline
that already passes it keeps working. `--allow-unsealed` is the opt-out:
the gate prints a warning and will accept a baseline whose `sealed` value
is not true. Passing both flags still opts out, because `--require-sealed`
does not override it. The opt-out does not skip receipt verification when
a receipt is there.

The opt-out is visible only in the operator's CI log today. The gate does
not write it anywhere a client can read. Making `--allow-unsealed` visible
to the client would need a server-side record of the run. That record is
not this change. TODO.

The gate is run by whoever operates the CI. That operator also chooses
`REQPUB_MCP_URL`. A client who needs independent assurance should run this
gate, or the offline verifier in `docs/VERIFY.md`, themselves, against the
published keys. A green CI log is the operator's claim, not the client's check.

Before a pass, the gate calls reqpub_get_receipt for each receipt id on
that baseline and verifies the answer locally with `tools/reqpub-verify-lib.mjs`,
the same code as `tools/reqpub-verify.mjs`. By default it fetches the
published keyset from `https://reqpub.com/reqpub-keys.json` (the keyset
`docs/VERIFY.md` documents, at the site root) and uses those bytes only
when their SHA-256 matches the pin in the gate. It passes only when the
fingerprint matches, the receipt's Ed25519 signature verifies against the
published key for its kid in that keyset, and the fingerprint inside the
receipt equals the baseline fingerprint. A local `--keys` file is refused
unless `--trust-local-keys` is also set. That flag prints a loud warning
on stderr and puts the same warning in the verdict. It is how a test uses
an ephemeral key. It is not the normal gate: a builder who controls the
file can make a forged receipt pass. The verdict lines name the MCP host
the gate actually used, then fingerprint, label, sealed, receipt signature,
receipt fingerprint, and timestamps.

reqpub_get_receipt currently returns timestamp status and not the `.tsr`
bytes. When no token is present the gate prints `timestamps: not verifiable
over MCP (status only)` and does not fail on that alone. When a token is
present (base64 `tsaPrimaryDer` or `tsaSecondaryDer`, or a similar field),
the gate verifies it with the offline `.tsr` reader and fails on any invalid
token. Returning those bytes is a server change this gate does not make.

Exit 0 when every check passes. Exit 1 on drift, on a label mismatch, on an
unsealed baseline without the opt-out, on a receipt signature that does not
verify, on a receipt fingerprint that is not the baseline's, on an invalid
timestamp token, or on a project that refuses the baseline read. Exit 2 when
the gate could not run, including when a receipt the baseline names cannot
be fetched. It reads and never writes. The key is a read key issued on the
Share page, held as a pipeline secret, revocable at once.

## Exclusions, stated as promises

No tool returns a sign token, an update token, a reply token, or an email
address, to anyone, ever. No tool creates, edits, or deletes fields,
rows, versions, approvals, sign requests, receipts, webhooks, or keys.
The MCP server is structurally incapable of signing anything. Facts are
listed, never scored: no rollups, no verdicts, no derived status.
