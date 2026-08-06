# SOC 2 Type I: NOT YET ENGAGED

**Status:** no audit firm engaged, no engagement letter signed. Owner item O2.
GA requires the signed engagement letter, not the report.

## Control narrative, prepared from what exists

**Change management.** Every schema change ships as an idempotent fix file
mirrored into the canonical schema, so a fresh install and an upgraded install
converge. CI gates block a release on symmetry, capability freshness, schema
and documentation parity, and the authorization matrix.

**Access control.** Row-level security on every table; sensitive writes only
through definer functions that stamp identity server-side; every function
private unless allowlisted, with the matrix regenerated each build.

**Integrity.** Activity, audit, and receipt tables are insert-only by policy
and trigger. Each activity row is chained to its predecessor.

**Incident response.** `docs/operations/INCIDENT.md`: severity levels, roles, a 72-hour
disclosure commitment for critical findings, and the discipline that security
fixes ship alone with a reproducing test.

**Data lifecycle.** `docs/operations/DATA.md`: what is stored, where, retention including the
twelve-month operational log period, subprocessors, export, and the deletion
procedure with decision D3 open and named.

**Monitoring.** Delivery attempts, MCP audit rows, and the activity trail are
retained and queryable. Alerting is not yet formalized and should be treated as
a gap by the auditor.
