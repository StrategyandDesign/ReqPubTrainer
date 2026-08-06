# Runbook: installing and upgrading ReqPub

This is the infrastructure runbook. For how to run a client engagement on
ReqPub, see [../DEPLOY.md](../DEPLOY.md), which is a different document with a
similar name.

## 1. Prerequisites

Have at hand: the Supabase dashboard for the existing project, and push access to the GitHub Pages repo behind reqpub.com. Confirm `config.js` in this folder still contains your project URL and anon key (it was carried over, no change needed unless you rotated keys).

## 2. First-time install

1. **Schema.** Apply `supabase/schema.sql` to a blank database. It is the
   canonical definition and contains every migration already folded in.
2. **Migrations.** A database created from `schema.sql` needs none. A database
   created earlier needs the ordered set; see the table below and
   [MIGRATIONS.md](MIGRATIONS.md).
3. **Verify.** Run `supabase/verify.sql` and read its output. It reports the
   objects it expected and the ones it found.
4. **Functions.** Deploy `mcp` and `seal-receipt` from their generated paste
   files. Both run with verify JWT off; the MCP endpoint authenticates by
   bearer key inside the function body.
5. **Frontend.** Push the tree. The site is served from the repository, so
   there is no build step and what is committed is what runs.
6. **Smoke test.** Open the app, create a record, generate a baseline, and
   confirm the footer version matches `package.json`.
7. **Rollback.** Every migration is idempotent and additive. Roll back by
   deploying the previous tree; no migration needs reversing.

## 3. Upgrade paths

One row per release, oldest first.

| From | To | Steps |
| --- | --- | --- |
| the release before | 2.35.0 | SQL: migrations/0017_update_panel.sql, migrations/0018_updates.sql, migrations/0020_weekly_update.sql. Functions: yes. Push and hard refresh. |
| the release before | 2.47.0 | SQL: migrations/0004_chain.sql. Functions: no. Push and hard refresh. |
| the release before | 2.48.0 | SQL: migrations/0004_chain.sql, migrations/0021_sealing.sql. Functions: no. Push and hard refresh. |
| the release before | 2.51.0 | SQL: migrations/0024_mcp.sql. Functions: no. Push and hard refresh. |
| the release before | 2.52.0 | SQL: migrations/0025_evidence.sql, migrations/0024_mcp.sql. Functions: no. Push and hard refresh. |
| the release before | 2.53.0 | SQL: none. Functions: no. Push and hard refresh. |
| the release before | 2.54.0 | SQL: none. Functions: no. Push and hard refresh. |
| the release before | 2.55.0 | SQL: migrations/0026_book_practice.sql, migrations/0025_evidence.sql. Functions: yes. Push and hard refresh. |
| the release before | 2.56.0 | SQL: migrations/0026_book_practice.sql, migrations/0027_pursuit_lineage.sql. Functions: yes. Push and hard refresh. |
| the release before | 2.57.0 | SQL: none. Functions: yes. Push and hard refresh. |
| the release before | 2.57.1 | SQL: migrations/0028_authz_lockdown.sql, migrations/0027_pursuit_lineage.sql. Functions: yes. Push and hard refresh. |
| the release before | 2.57.2 | SQL: migrations/0028_authz_lockdown.sql, migrations/0029_ssrf_guard.sql. Functions: yes. Push and hard refresh. |

Which migrations are already applied to the production deployment is recorded
in [MIGRATIONS.md](MIGRATIONS.md), not here. Deployment state is not
documentation.

## 4. Operational procedures

**Key rotation.** Follow `SECURITY.md` at the repository root. A retired key
stays published forever; removing it makes every receipt sealed under it
permanently unverifiable while new receipts keep working, which is why the
drill exists.

**Function redeploy.** Regenerate the paste with its bundler, never hand-edit
it, then deploy and confirm the reported version.

**Invite email configuration.** Set the sender and the redirect origin in the
hosting provider's auth settings. ReqPub sends no mail of its own.

**Soak and cleanup.** Practice records are excluded from the Book, the evidence
packs, and webhooks by construction, so they need no cleanup. Smoke-test
records are ordinary records and should be archived when finished.
