# Decisions

Ten records. **One of them, ADR-0001, argues a decision that was made here.**
The rest are indexes: the argument already exists in `docs/ARCHITECTURE.md` or
in a gate's comment header, and these records point at it and add the status
and consequences fields that those documents do not carry. They are short on
purpose, and they are not a substitute for reading the architecture document.

| ADR | Decision | Kind | Record |
| --- | --- | --- | --- |
| ADR-0001 | Versioning and assurance are separate axes | Argued here | [ADR-0001-versioning-and-assurance.md](ADR-0001-versioning-and-assurance.md) |
| ADR-0002 | Server-ordered field-level last-write-wins rather than a CRDT | Index into ARCHITECTURE.md | [ADR-0002-server-ordered-last-write-wins.md](ADR-0002-server-ordered-last-write-wins.md) |
| ADR-0003 | Text primary keys on projects to preserve v1 share links | Index into ARCHITECTURE.md | [ADR-0003-text-primary-keys-on-projects.md](ADR-0003-text-primary-keys-on-projects.md) |
| ADR-0004 | Row-level security with SECURITY DEFINER helpers | Index into ARCHITECTURE.md | [ADR-0004-rls-with-definer-helpers.md](ADR-0004-rls-with-definer-helpers.md) |
| ADR-0005 | Broadcast from the database on private channels | Index into ARCHITECTURE.md | [ADR-0005-broadcast-from-the-database.md](ADR-0005-broadcast-from-the-database.md) |
| ADR-0006 | Accountless tokened links rather than seats for external parties | Index into ARCHITECTURE.md | [ADR-0006-accountless-tokened-links.md](ADR-0006-accountless-tokened-links.md) |
| ADR-0007 | A fingerprint identifies content; the receipt establishes signer and time | Argued here | [ADR-0007-fingerprint-identifies-content.md](ADR-0007-fingerprint-identifies-content.md) |
| ADR-0008 | No model API is called anywhere in the product | Argued here | [ADR-0008-no-model-api-in-the-product.md](ADR-0008-no-model-api-in-the-product.md) |
| ADR-0009 | Ordered migrations with a ledger | Argued here | [ADR-0009-ordered-migrations-with-a-ledger.md](ADR-0009-ordered-migrations-with-a-ledger.md) |
| ADR-0010 | Every published claim requires an artifact and a named test | Argued here | [ADR-0010-every-claim-needs-an-artifact-and-a-test.md](ADR-0010-every-claim-needs-an-artifact-and-a-test.md) |
