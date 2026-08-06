# Security and procurement brief

One page. Every question a risk team asks, the mechanism that answers it, and
the test that proves the mechanism works. Where the answer is "not yet", it
says so on the same line.

| Question | Mechanism | Proof |
| --- | --- | --- |
| Who can read our data? | Row-level security on every table; sensitive writes only through definer functions that stamp identity server-side | `docs/security/AUTHZ_MATRIX.md`, regenerated each build; 31-suite backend chain |
| What can an unauthenticated caller reach? | 17 functions, each gated by a single-purpose token inside its own body | `tests/backend-e2e/authz-matrix.test.mjs` pins the surface to a committed allowlist |
| Can one client see another's records? | Organization isolation at the policy layer, tested from a rival account | Cross-organization refusals across the backend suites |
| Can the audit trail be altered? | Activity and receipt tables accept inserts and refuse updates and deletes by policy and trigger; each row is hash-chained to its predecessor | `tests/backend-e2e/chain.test.mjs`; tampering breaks the chain at the exact seam |
| Can someone forge an entry? | Fixed in C1-001 after we found it ourselves; internal helpers are unreachable from any client role | `docs/security/HARDENING_REPORT.md` C1-001, with reproduction |
| How do we verify a record without you? | Published recipe, published schemas, standalone CLI, two independent RFC 3161 timestamp authorities | `VENDOR_PACK/OFFLINE_VERIFICATION.md`, ten minutes, no account |
| Where is our data? | Managed PostgreSQL and private object storage in the region chosen at creation | `docs/operations/DATA.md` |
| Who else touches it? | Hosting, transactional email, and two timestamp authorities that receive only a hash | `docs/operations/DATA.md` subprocessor table |
| Are signer email addresses in exports? | No. Exports carry the email domain only; no token, key, or address appears in any artifact | Leak greps on every export, pack, packet, and payload |
| How are keys managed? | Private keys exist only as function secrets, never in the repository, database, or logs; public halves published and pinned by key id | `tests/backend-e2e/sealing.test.mjs`; rotation runbook in `SECURITY.md` |
| What happens on an incident? | Severity levels, named roles, containment before diagnosis, 72-hour disclosure for critical findings whether or not legally required | `docs/operations/INCIDENT.md` |
| Can we get everything out? | Evidence pack per project plus account data, in published formats | `docs/operations/DATA.md` export section |
| What about deletion? | Content and personal data deleted; chain hashes retained so the remaining record still verifies. **Decision D3 open with counsel; no destructive deletion code exists** | `docs/operations/DATA.md` |
| Does it use AI on our data? | The platform calls no model API. The intake mapper is deterministic | Grep across four source trees, enforced by `tools/claims-gate.mjs` on every build |
| Will it become another tracker? | No. The never-build list is published with the rule that decides any future field | `docs/OPERATING_MODEL.md` |
| SOC 2? | **Not yet. Engagement not signed.** Control narrative prepared | `VENDOR_PACK/SOC2_STATUS.md` |
| Penetration test? | **Not yet commissioned.** Scope, crown jewels, and rules of engagement written | `VENDOR_PACK/PENTEST_LETTER.md` |
| SSO and SCIM? | **Not built.** No SAML, no OIDC federation, no SCIM. The people who sign hold no accounts at all, so the surface that matters has nothing to federate and nothing to deprovision | `VENDOR_PACK/IDENTITY.md`, and `tests/backend-e2e/token-injection.test.mjs` for the token boundary |
| Uptime and support commitment? | **Undecided.** Verification does not depend on ReqPub being available, which is a property worth stating separately from any SLA | `VENDOR_PACK/SUPPORT_AND_UPTIME.md` |
| Insurance? | **Not obtained.** | `VENDOR_PACK/INSURANCE.md` |

Six rows say not yet. They are on the page for the same reason the findings
report includes our own mistakes: the first question after any omission is
discovered is what else was omitted, and that question is much more expensive
than the omission.
