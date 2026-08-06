# Deploying ReqPub into a consulting engagement

This document covers running a client engagement on ReqPub: workspaces, roles,
naming, and operating rules. For installing or upgrading the software, see
[operations/RUNBOOK.md](operations/RUNBOOK.md).

Operational doctrine that is not enforceable in code, written down so it is
enforced by deployment. Everything here was verified against the schema; the
one external fact is cited inline.

## The workspace is the confidentiality wall

Internal roles are workspace-wide by construction: `is_project_member`
resolves to org membership, so a Manager or Viewer reads every project in the
workspace. External access is per-project by construction: client contacts
route through `partner_access`, SMEs through per-link tokens.

The deployment rule that follows: **one workspace per client account, never
one workspace spanning multiple clients.** Consulting firms run conflict walls
between clients; a Viewer who can read everything in a multi-client workspace
fails the first security review. A consultant overseeing engagements at three
clients belongs to three workspaces and uses the workspace switcher. A
cross-workspace rollup is deliberately not built; if a senior stakeholder asks
for one, it is a new server-side surface, not a client-side aggregation.

## Who gets which surface

Nobody in a standard engagement structure needs a surface that does not
already exist.

| Persona | Surface | Scope | Writes |
|---|---|---|---|
| Engagement manager (day-to-day owner) | Internal app, Manager role | Workspace-wide | Everything |
| Analysts and associates | Internal app, Manager role | Workspace-wide | Worksheet, discovery, inbox |
| Senior oversight (part-time) | Internal app, Viewer role | Workspace-wide, read + reply | None |
| Client project lead / PMO liaison | Client portal | Assigned projects only | Notes, threads, attachments |
| Client workstream SMEs | Tokened links, no account | Per link | Submissions, replies |
| Client sponsor / steering committee | Present link + client baseline report | Per artifact | None |
| Procurement / security reviewer | SECURITY.md and  | None | None |

The sponsor needs no account: approval slots support manual sign-off
(`approver_user_id` null), the engagement manager records the decision for the
named person, and the provenance trigger stamps who recorded it, server-side.
Self-serve executive sign-off is the e-signature phase.

## Naming

The schema role is `partner` (tables, RPCs, and tests keep that name
permanently). The user interface says **Client contact** and **Client
portal**, because the buyer's firm reserves "Partner" for its owners, and
"give the client a Partner login" is a sentence that misfires in the room.
Copy only; no identifier changed.

## Operating rules

1. **Every version gets named approvers before it goes to review.** The state
   machine blocks Approved while a sign-off is pending, but a version with
   zero slots passes the gate - one manager, alone, no names on the cover.
   The record-health panel and the workspace gaps pill flag any version in
   review with no named approvers (gap) and any approved version with no named
   sign-off (warn). This is the control that lets analysts hold write access
   without a new permission tier. A true Editor role that writes but cannot
   approve is a schema change; it stays deferred until a firm demands it.
2. **One project per requirements record.** Archive superseded projects
   rather than repurposing them; the audit trail is per-project.

## The lane next to the program tracker

Large consulting firms already run collaborative work-management platforms
across engagements. The reference example: Kearney's NEXT partners with
Sensei Labs' Conductor - and precisely: Conductor is Sensei Labs' product (a
Klick subsidiary), shared infrastructure also allied with other
consultancies, not the firm's own platform. It has role-based approvals,
configurable stage gates, audit trails, and time-based locking; do not claim
otherwise. The honest line sits one level deeper: a gate review on a
dashboard is a meeting; a gate on an immutable, fingerprinted baseline is
evidence. The tracker's audit trail lives inside the tracker; the record
verifies outside it, by design. Its objects are projects, tasks, and status -
nothing there owns requirements, fit criteria, or acceptance evidence. That
ground is uncontested and it is this product's. Full doctrine, per-audience
lines, and the one-page visual: `POSITIONING.md` and
`positioning.svg`. Externally, never name the tracker or its vendor.

Never build, on any pull: Gantt, RAG rollups, RAID logs, timelines,
notification engines, auto-advancing workflows, portfolio dashboards. Each
converts the record into a tracker. The weekly update (v2.27.0) is the
sanctioned form and the proof the wall holds, not an exception to it:
every line derives from record truth, nothing is hand-maintained, and the
open-items register cannot be typed into - only the record can change it.
The same test admits the approval advance (v2.28.1): a version's status now
derives from its own sign-off decisions - last approval in, version
Approved - because a pill saying Draft above a row saying Approved was a
hand-maintained status contradicting the record. Deriving status from
decisions is record truth; moving work items along a pipeline is a
tracker. The wall separates those two, not automation from typing.

The risks and issues rows (v2.34.0) are admitted by the same test, and
they are worth spelling out because at first glance they look like the
RAID log the list forbids. They are not, and the difference is not
subtle. A RAID log is a register the platform maintains beside the
record, ages, escalates, and rolls up into a colour; it can drift from
what the parties signed and it forms the platform's own view about
delivery. These rows are worksheet content: a person authors them, the
client signs them, and they freeze into the baseline with everything
else. Read "nothing is hand-maintained" above as what it means - the
weekly update digest has no typed lines - not as a claim that the record
holds no typed content. Every acceptance threshold and every gate in the
product was typed by somebody. The three questions that separate the two
cases, in full in `POSITIONING.md`: who wrote the value, does it
move without an author moving it, and what does it do outside the
baseline. Content answers person, no, and nothing.

The status column on those rows is a fixed list - Open, Mitigating,
Accepted, Closed - rather than a free text box, and that is a doctrine
decision rather than a UI one. Left open, the column fills with Red and
Amber inside a single engagement, and once RAG vocabulary is in the
record somebody will reasonably ask for the rollup that summarizes it.
The words were chosen to describe what the owner is doing, which is
authored fact, instead of how the project is faring, which is a verdict.
Still forbidden over these rows, on any pull: a computed RAG rollup, a
health verdict, a project-status dashboard, and any auto-escalation. The
moment the platform picks the word in that column, the record has become
a party to delivery instead of the evidence of what was agreed.
