# ../operations/INCIDENT.md: How ReqPub responds when something goes wrong

One page, because a runbook nobody finishes reading is not a runbook.

## Severity

**S1 Critical.** Customer data exposed across an organization boundary, a
signing key compromised, a forged record accepted as genuine, or the record
layer unavailable with no workaround. Response begins immediately, at any
hour.

**S2 High.** A security control failing without confirmed exposure, a
verification path broken, or acceptance flows unavailable. Response begins
within four business hours.

**S3 Medium.** A defect with a workaround, degraded performance, or a
non-security control failing. Next business day.

**S4 Low.** Cosmetic or documentation defects. Next release.

## Roles

**Incident lead.** One person, named at the start, who owns the decision and
the communication. The lead does not also do the fixing if that can be
avoided.

**Technical responder.** Investigates and patches.

**Communicator.** Writes to affected organizations. On a small team this is
the lead, stated explicitly rather than assumed.

## The sequence

1. **Contain** before diagnosing. Revoke the key, disable the endpoint, close
   the surface. A contained incident with an unknown cause beats an
   uncontained one with a theory.
2. **Preserve.** The activity trail and chain are insert-only, so nothing is
   deleted during response. Capture the state before changing it.
3. **Assess.** Which organizations, which records, what was reachable, and for
   how long. Write the answer down even when it is "we do not yet know".
4. **Fix and prove.** The patch ships with a test that reproduces the failure
   first and passes after. A fix without a reproduction is a guess.
5. **Notify.** See below.
6. **Write it up.** A dated entry naming the finding, its severity, what was
   exposed, what was done, and what changed permanently. The C1 hardening
   report is the model.

## The disclosure commitment

**What affected organizations are told:** what happened in plain language,
which of their records were involved, what was reachable and by whom, what was
done, and what changed so it does not recur.

**When:** for S1, within 72 hours of confirmation, and sooner if the
organization must act. For S2, within five business days. If assessment is
incomplete at the deadline, the notice goes out anyway, stating what is known
and when the next update comes. A delayed complete notice is worse than a
prompt partial one.

**Who:** every organization whose data was involved, whether or not disclosure
is legally required. If ReqPub cannot determine whether a specific
organization was affected, it is treated as affected.

**Publicly:** for any finding rated S1 or S2 with confirmed exposure, a public
entry once affected customers have been notified and a fix has shipped.

## Patch discipline

Security fixes ship as their own release with no features attached, so a
customer can read one changelog entry and know exactly what changed. The fix
file is idempotent, the schema mirror is updated in the same release so a fresh
install is not vulnerable, and a permanent test pins the finding closed. A
security release is never bundled with unrelated work.

## Reporting a vulnerability

Report to the address published in the vendor pack. ReqPub commits to
acknowledging within two business days, giving an assessment within five, and
crediting the reporter unless they prefer otherwise. ReqPub does not pursue
researchers acting in good faith who avoid customer data, avoid degrading the
service, and give a reasonable window before disclosure.
