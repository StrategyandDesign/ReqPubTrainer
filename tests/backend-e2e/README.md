# Backend e2e harness

Runs the full v1→v2 story on a real embedded Postgres: Supabase shims (auth/realtime),
the v1 schema, a seeded v1 dataset, then `schema.sql`, `migrate.sql` (twice, proving
idempotence), `verify.sql`, and 47 functional checks across every RPC as manager,
partner, and anonymous SME.

```bash
npm i            # once, installs embedded-postgres + pg (dev only)
npm run test:backend
```

`shim.sql` and `seed-v1.sql` are test fixtures only - never deploy them.
`v1-backend.sql` is a frozen copy of the v1 schema the migration reads from.
