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
work, check the fingerprint again before claiming conformance.

reqpub_get_signature_status. projectId, optional seq. Per sign request on
that baseline: signerName, signerRole, status, sentAt, signedAt, and
receiptId once sealed.

reqpub_get_receipt. receiptId. The stored receipt JSON, its Ed25519
signature, the signing key id, and the timestamp status. Verify offline
per VERIFY.md against the published reqpub-keys.json.

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

## Exclusions, stated as promises

No tool returns a sign token, an update token, a reply token, or an email
address, to anyone, ever. No tool creates, edits, or deletes fields,
rows, versions, approvals, sign requests, receipts, webhooks, or keys.
The MCP server is structurally incapable of signing anything. Facts are
listed, never scored: no rollups, no verdicts, no derived status.
