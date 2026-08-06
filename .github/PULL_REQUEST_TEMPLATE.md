## What this changes

## Checklist

- [ ] `npm run ci` exits 0
- [ ] `npm test` and `npm run test:backend` exit 0
- [ ] `npx eslint .` reports zero errors
- [ ] If the suites changed, `npm run counts` was run and `tests/COUNTS.json` is committed
- [ ] If the schema changed, the migration is numbered under `supabase/migrations/` and the replay test still passes
- [ ] If a claim was added, it names an artifact that exists and a test that proves it
- [ ] `CHANGELOG.md` has an entry
