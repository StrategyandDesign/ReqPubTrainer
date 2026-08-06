# Paths to delete after upgrading to 3.0.0

v3.0.0 moves and renames files. A release delivered as an archive can add and
overwrite, but it cannot delete, so a repository upgraded by extracting the
archive holds both trees at once. Continuous integration fails on the first
push, at the documentation gate, because the old documents are still at the
repository root where the gate refuses them.

Delete these 53 paths once. Nothing references them; every one has a
successor in the new tree, listed beside it where the successor is not obvious.

The fastest route in a browser: open the repository and press `.` to launch the
web editor, select the files, and delete them in one commit. The alternative is
one deletion per file through the normal interface.

## Root documents, 22

These moved under `docs/`. The gate that refuses them is the reason the root is
readable now.

- `ADVISOR_AUDIT.md`
- `AUDIT_REPORT_v2.47.md`
- `AUTHZ_MATRIX.md`
- `COPY_AUDIT_V2.md`
- `DATA.md`
- `DEPLOY.md`
- `ENGINEERING_ONBOARDING.md`
- `GA_READINESS_REPORT.md`
- `HARDENING_REPORT.md`
- `INCIDENT.md`
- `PREREQ_REPORT.md`
- `RELEASE_1_REPORT.md`
- `RELEASE_REPORT_v2.48.md`
- `RELEASE_REPORT_v2.49.md`
- `RELEASE_REPORT_v2.50.md`
- `RELEASE_REPORT_v2.51.md`
- `RELEASE_REPORT_v2.52.md`
- `RELEASE_REPORT_v2.53.md`
- `RELEASE_REPORT_v2.54.md`
- `RELEASE_REPORT_v2.55.md`
- `RELEASE_REPORT_v2.56.md`
- `RELEASE_REPORT_v2.57.md`

## Migrations, 29

Renamed with ordinals under `supabase/migrations/`. The content is unchanged;
each file gained a ledger insert recording its own checksum.

- `supabase/fix-approval-advance.sql`
- `supabase/fix-approver-assignment.sql`
- `supabase/fix-attachment-hash.sql`
- `supabase/fix-attachments.sql`
- `supabase/fix-authz-lockdown.sql`
- `supabase/fix-book-practice.sql`
- `supabase/fix-chain.sql`
- `supabase/fix-client-contact-label.sql`
- `supabase/fix-discovery-promote.sql`
- `supabase/fix-esign.sql`
- `supabase/fix-evidence.sql`
- `supabase/fix-help.sql`
- `supabase/fix-invite.sql`
- `supabase/fix-mcp.sql`
- `supabase/fix-new-reply.sql`
- `supabase/fix-partner-identity.sql`
- `supabase/fix-partner-notes.sql`
- `supabase/fix-partner-portal.sql`
- `supabase/fix-project-name-sync.sql`
- `supabase/fix-pursuit-lineage.sql`
- `supabase/fix-record-templates.sql`
- `supabase/fix-sealing.sql`
- `supabase/fix-sme-workspace.sql`
- `supabase/fix-ssrf-guard.sql`
- `supabase/fix-update-panel.sql`
- `supabase/fix-updates.sql`
- `supabase/fix-version-integrity.sql`
- `supabase/fix-webhooks.sql`
- `supabase/fix-weekly-update.sql`

## Generated artifacts, 2

Moved under `dist/` so a reader cannot mistake a build output for a source.

- `supabase/functions/mcp/DASHBOARD-PASTE-index.ts`
- `supabase/functions/seal-receipt/DASHBOARD-PASTE-index.ts`

## Verifying the cleanup

`SHA_MANIFEST.txt` lists every file the release contains. After deleting,
continuous integration is the check: the documentation gate fails while any
unexpected file remains at the root, and it names each one.
