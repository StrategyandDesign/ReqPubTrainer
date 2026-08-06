# Documentation

Start with [ARCHITECTURE.md](ARCHITECTURE.md) for what the system is and why it
is shaped that way. Then [STATUS.md](STATUS.md) for what is open and what is
closed today. Then [security/HARDENING_REPORT.md](security/HARDENING_REPORT.md)
for every security finding, including the ones we caused ourselves. Then the
gates in `../tools/`, which are what keep the rest of these documents honest.

## Normative

These define formats other people implement against. Their paths and section
numbers are printed inside exported artifacts, so they do not move.

| Document | Answers | Audience | Status |
| --- | --- | --- | --- |
| [VERIFY.md](VERIFY.md) | How do I recompute a fingerprint and check a seal without you | Verifier | Current |
| [SPEC.md](SPEC.md) | What exactly is in a bundle, a receipt, a manifest | Integrator | Current |
| [MCP.md](MCP.md) | How does an agent read the record | Integrator | Current |
| [WEBHOOKS.md](WEBHOOKS.md) | What arrives, signed how | Integrator | Current |
| [RECEIVERS.md](RECEIVERS.md) | How do I map a delivery into my own system | Integrator | Current |

## Position and product

| Document | Answers | Audience | Status |
| --- | --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Why is it built this way | Engineer | Current |
| [POSITIONING.md](POSITIONING.md) | What will this never become | Anyone | Current |
| [OPERATING_MODEL.md](OPERATING_MODEL.md) | How is it built, and what do the gates refuse | Reviewer | Current |
| [PRICING.md](PRICING.md) | What does it cost, and what is not included | Buyer | Current |
| [ASSURANCE.md](ASSURANCE.md) | What have third parties verified | Buyer, security | Current |
| [STATUS.md](STATUS.md) | What is open right now | Reviewer | Current |
| [DEPLOY.md](DEPLOY.md) | How do I run an engagement on it | Practitioner | Current |
| [AUDIT.md](AUDIT.md) | What does the trail record | Reviewer | Current |
| [ATTACHMENTS.md](ATTACHMENTS.md) | How are files handled | Engineer | Current |

## Operations

| Document | Answers | Audience | Status |
| --- | --- | --- | --- |
| [operations/INCIDENT.md](operations/INCIDENT.md) | What happens when something goes wrong | Buyer, operator | Current |
| [operations/DATA.md](operations/DATA.md) | What is stored, where, for how long | Buyer, counsel | Current, D3 open |
| [operations/ONBOARDING.md](operations/ONBOARDING.md) | How does a new engineer get running | Engineer | Current |
| [operations/STALE_PATHS.md](operations/STALE_PATHS.md) | What to delete when upgrading to 3.0.0 | Operator | Current |

## Security

| Document | Answers | Audience | Status |
| --- | --- | --- | --- |
| [security/HARDENING_REPORT.md](security/HARDENING_REPORT.md) | What did the adversarial sweep find | Reviewer | Current |
| [security/AUTHZ_MATRIX.md](security/AUTHZ_MATRIX.md) | Who can execute what | Reviewer | Generated each build |

## History

| Directory | Contents |
| --- | --- |
| [decisions/](decisions/README.md) | Architecture decision records, ten of them |
| [releases/](releases/README.md) | One report per release |
| [reviews/](reviews/README.md) | Point-in-time audits, all superseded by STATUS.md |
| [changelog/](changelog/) | Archived 2.x changelog |
