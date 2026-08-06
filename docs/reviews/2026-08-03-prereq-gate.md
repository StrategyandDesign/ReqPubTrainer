# Prerequisite gate report, before v2.51

Run date: 2026-08-03. Tree: v2.50.1, byte-identical to main HEAD.

## Gate tails

tools/audit.mjs: clean. data-action symmetry 198 markup actions with 201
handlers, no orphans. Build stamp 2.50.1 matches package.json. Help anchors
8 of 8. RPC symmetry 58 callsites all defined in schema.sql. Edge symmetry
7 invoked, 7 folders. Syntax clean on 19 modules. Banned language clean on
34 files.

npm test: exit 0, 30 suites, zero failing checks. Tail: webhook scheme 25
passed, 0 failed, including the v2.50.1 preflight regression pins.

npm run test:backend: exit 0 as runner, 25 suites, zero failing checks.
Tail: webhooks backend 38 passed, 0 failed, full stack applied twice.

## Feature presence

v2.47 chain: chain_events and verify_project_chain present in schema.sql,
verified live today (smoke project chain reads genesis, endpoint added,
sign.signed, endpoint deactivated, in order).
v2.48 sealing: seal-receipt deployed, acceptance_receipts and receipt_keys
live with acc-1 and whk-1 registered; one production receipt sealed at
tsa_status dual; its Ed25519 signature verified today against the published
reqpub-keys.json.
v2.49 hashing: attachments.sha256_hex present; attachment-upload deployed
with verify and backfill modes.
v2.50 webhooks: webhook_endpoints, webhook_deliveries, deliver-webhooks
deployed with the v2.50.1 preflight fix; ../WEBHOOKS.md present; a real
signed delivery verified end to end today against whk-1.

## One amber item, recorded, not blocking

reqpub-keys.json is published and cryptographically correct: both kids
verify real production artifacts. Its .tsr countersignatures were never
generated; scripts/timestamp-keys.mjs has not been run. Nothing in v2.51 or
v2.52 depends on them. Remediation is one command on any machine with node
and network: node scripts/timestamp-keys.mjs, then commit the .tsr files.
Carried forward as an open item into Phase C2 item 3.

## U1 and U2

U1 verified: comms.origin check constraint is
('app','brief','sme','partner','team','meeting') at schema.sql section for
comms; v2.51 extends it by drop and re-add with 'agent'. The member insert
policy confines direct inserts to team, sme, meeting; the agent path rides
a definer RPC, so the policy stays untouched.
U2 granted: owner authorized deploying the mcp function and full autonomous
execution on 2026-08-03. seal-receipt, deliver-webhooks, attachment-upload
confirmed deployed and answering today.

Gate result: green with one recorded amber. v2.51 begins.
