# ../operations/DATA.md: What ReqPub stores, where, and for how long

Written for a security reviewer who needs to answer a data-protection
questionnaire without a call. Every statement here is about what the system
does today, not what it may do later.

## What is stored

**Record content.** Everything a person authors: field values, requirement
rows, notes, decisions, and the snapshots that baselines freeze. This is
customer content and ReqPub treats it as the customer's.

**Identity.** For account holders: an email address, a display name, and an
organization membership with a role. ReqPub stores no password; authentication
is delegated to the hosting provider's auth service.

**Counterparties.** For a signer, an SME, or an update recipient: the name and
email address the customer entered, the role they were given, and what they
did. These people have no account.

**Cryptographic facts.** Baseline fingerprints, receipt hashes, Ed25519
signatures, RFC 3161 timestamp tokens, and the activity chain's link hashes.
These are derived from content and cannot be reversed into it.

**Operational records.** The activity trail, the MCP audit log, and webhook
delivery attempts with their response status.

**Files.** Attachments live in a private object store, never public, reached
only through short-lived signed URLs. Every file carries a SHA-256 computed at
upload.

## What is never stored

No payment details. No passwords. No model prompts or completions, because the
platform calls no model. No third-party analytics or advertising identifiers.
No signer email address in any export, receipt, evidence pack, invoice packet,
or webhook payload: exports carry the email domain only, and a test enforces
this on every artifact the product writes.

## Where it is stored

Primary data in a managed PostgreSQL instance. Files in the same provider's
object storage. Both in the region selected at project creation. Signing keys
exist only as function secrets and are never written to the database, the
repository, or a log.

## Subprocessors

| Role | What it processes |
| --- | --- |
| Hosting, database, storage, auth, edge functions | All customer content and identity data |
| Static site delivery | The application shell; no customer content |
| Transactional email | Recipient address and message body for sign requests, invitations, and update notices |
| Timestamp authorities, two independent | A SHA-256 hash of a receipt, and nothing else. A timestamp authority learns that a hash existed at a time; it learns nothing about the content behind it |

The customer's own webhook receivers are not subprocessors of ReqPub; they are
destinations the customer chooses, and the customer controls what is done with
what arrives.

## Retention

Record content and files are retained for the life of the account and are
deleted on request per the procedure below.

Operational logs are retained for twelve months. This aligns with the
expectation, stated in the EU AI Act's oversight-logging provisions, that
records permitting the reconstruction of a system's operation are kept for a
period appropriate to the purpose; twelve months covers the audit and dispute
window ReqPub is built for.

Timestamp tokens and receipt hashes are retained as long as the record they
seal, because deleting them would destroy the ability to verify what was
signed.

## Export

A manager can export a complete evidence pack per project at any time: the
chronology, every baseline with its fingerprint, every signature and receipt,
the attachment manifest with hashes, the chain verification result, and a
README stating what the pack proves. Account data, meaning the organization,
its members, and their roles, is exported alongside by the documented
procedure in the vendor pack. No part of this requires ReqPub's assistance and
none of it is proprietary: the formats are published and the verification tool
is standalone.

## Deletion

**OWNER DECISION D3, open, framed for counsel.**

The proposal: on a verified deletion request, delete record content, files,
and personal data, and retain chain rows carrying hashes and structure only,
with a written statement to the customer that hashes of deleted content are
retained so the integrity of the remaining record survives.

The reasoning: the chain is a linked list of hashes. Removing a link does not
remove information about deleted content, because a hash discloses nothing,
but it does break every verification that spans the gap, including
verifications of records belonging to other parties who relied on them.

No destructive deletion code exists in the product, and none will be written
until D3 is decided. Today a deletion request is executed by the operator
against the documented procedure.
