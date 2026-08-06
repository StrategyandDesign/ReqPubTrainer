# Migrations

The ordered set. Applying `0001` through `0029` to a database built
from `supabase/schema.sql` produces the same schema as `schema.sql` alone, and
applying the chain twice changes nothing. Both are proven on every build by
`tests/backend-e2e/migrations.test.mjs`, which compares the two databases
through `information_schema` and `pg_catalog` rather than by diffing text.

A database created from `schema.sql` today needs none of these. They exist for
databases created earlier, and as the record of how the schema arrived at its
current shape.

Each file ends with an idempotent insert into `schema_migrations` recording its
ordinal, its name, and the SHA-256 of everything above that block. Editing a
shipped migration is therefore detectable, and an operator can answer what
revision a database is at with one query.

The production column records what has been applied to the ReqPub production
deployment. It is deployment state rather than documentation, which is why it
lives here and not in the runbook. `unknown` means the record does not say;
every migration is idempotent, so re-applying one is safe.

| Ordinal | File | What it changes | Applied to production |
| --- | --- | --- | --- |
| 0001 | `0001_approval_advance.sql` | An approval decision now advances the version on its own. Before this, | unknown |
| 0002 | `0002_approver_assignment.sql` | In-app approval routing. An approver slot can be assigned to a real team | unknown |
| 0003 | `0003_attachments.sql` | Attachments (files from partners & SMEs) | unknown |
| 0004 | `0004_chain.sql` | The activity chain: a per-project hash chain over the existing insert-only | unknown |
| 0005 | `0005_client_contact_label.sql` | Display-label fix: attachment uploader fallback name | unknown |
| 0006 | `0006_discovery_promote.sql` | Discovery promotion back-link | unknown |
| 0007 | `0007_esign.sql` | Run once on the live database to add e-sign v1 | unknown |
| 0008 | `0008_help.sql` | Fix: in-app help system (v2.40.0). Run once in the Supabase SQL | unknown |
| 0009 | `0009_invite.sql` | Fix: claim_invites returns which orgs were just joined, so the app | unknown |
| 0010 | `0010_new_reply.sql` | Team-level "new reply" signal on each thread. It answers one question for the | unknown |
| 0011 | `0011_partner_identity.sql` | One partner identity per email per workspace | unknown |
| 0012 | `0012_partner_notes.sql` | Trackable partner notes | unknown |
| 0013 | `0013_partner_portal.sql` | Partner-portal fixes (v2.8.2)   ← run this ONE file in Supabase | unknown |
| 0014 | `0014_project_name_sync.sql` | Run once on the live database to keep | unknown |
| 0015 | `0015_record_templates.sql` | Firm templates: a manager saves the STANDING structure of a record | unknown |
| 0016 | `0016_sme_workspace.sql` | Durable SME workspace (v2.9.0)   ← run this ONE file in Supabase | unknown |
| 0017 | `0017_update_panel.sql` | Run once on the live database for v2.34.0 | unknown |
| 0018 | `0018_updates.sql` | Run once on the live database to add weekly updates | unknown |
| 0019 | `0019_version_integrity.sql` | Version integrity: baselines immutable at the table | unknown |
| 0020 | `0020_weekly_update.sql` | Run once on the live database for v2.35.0 | unknown |
| 0021 | `0021_sealing.sql` | Cryptographic sealing: acceptance receipts, Ed25519 over the canonical | unknown |
| 0022 | `0022_attachment_hash.sql` | Attachment hashing: every stored file's exact bytes become provable | unknown |
| 0023 | `0023_webhooks.sql` | SIGNED WEBHOOKS. Run once in the Supabase SQL editor, after | unknown |
| 0024 | `0024_mcp.sql` | THE MCP SERVER. Run once in the Supabase SQL editor, after | unknown |
| 0025 | `0025_evidence.sql` | THE EVIDENCE PACK. Run once in the Supabase SQL editor, | unknown |
| 0026 | `0026_book_practice.sql` | THE BOOK, THE INVOICE PACKET, AND PRACTICE MODE | unknown |
| 0027 | `0027_pursuit_lineage.sql` | ENGAGEMENT LINEAGE. Run once in the Supabase SQL editor, | unknown |
| 0028 | `0028_authz_lockdown.sql` | C1 HARDENING - AUTHORIZATION LOCKDOWN. Run once in the Supabase SQL | yes, 2026-08-05 |
| 0029 | `0029_ssrf_guard.sql` | C1 HARDENING - EGRESS GUARD. Run once in the Supabase SQL editor, | yes, 2026-08-05 |
