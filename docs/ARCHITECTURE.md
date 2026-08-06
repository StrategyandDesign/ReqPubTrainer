# ReqPub v2 architecture

The design and the reasoning behind it, in dependency order: the concurrency model, the data model, security, realtime, external collaboration, migration, and the limits we accept knowingly.

## 1. The concurrency model

v1 failed under nine editors because of two compounding properties: whole-object writes (every save shipped an entire array or answers object) and stale reads (no realtime, cache-first opens). Any two concurrent writers overwrote each other's whole object, and because reads were stale, the overwrite was the norm. The audit that preceded this rebuild counted the read-modify-write anti-pattern in roughly eighteen places.

v2 adopts the model that Figma and Linear each arrived at independently for structured documents: server-ordered, property-level last-write-wins with explicit conflict detection, not a CRDT. Figma's engineering write-up describes rejecting OT as unnecessary and letting the server define event order. Linear has described its sync engine as server-sequenced, field-level LWW for structured fields, with an embedded CRDT reserved for freeform rich text. A PRD worksheet is structured fields (named sections, discrete rows), which is exactly the case where property-level resolution is the accepted approach. The rule of thumb from the sync-engine literature: property-level conflicts want LWW with detection; character-level co-typing in one span wants a CRDT. We have the former.

Concretely:

**Scalar fields** (`project_fields`) carry an integer `rev`. The only write path is the `save_field` RPC: `UPDATE … WHERE rev = $base`. Zero rows updated means someone else saved first: the RPC returns their value, author, and rev, and the client resolves it deliberately. If you are mid-typing that field, your text is kept and re-submitted on the winner's rev (you also get a notice naming the other editor); if you had left the field, the newer save is accepted and shown. Either way, nothing is ever silently destroyed; the losing write is *known* to have lost. This is Fowler's Optimistic Offline Lock, applied per field so the collision surface is a single question, not the document.

**Repeating rows** (`field_rows`) make adds INSERTs, so simultaneous adds cannot overwrite each other; the failure that ate notes and requirements in v1 is structurally impossible. Each row keeps the same rev-checked update rule. Requirement identity (`FR-003`) derives from a per-field counter `k` allocated inside the insert RPC under an advisory lock: concurrent adds get distinct, permanent numbers, and deleting a row never renumbers the rest (soft delete preserves the sequence).

**Versions** are allocated by `create_version` under a per-project advisory lock: `seq = max + 1` and the label math happen server-side, so two managers clicking Generate at once produce v1.4 and v1.5, never two v1.4s (a v1 data-loss bug from colliding snapshots).

**Durability.** Every write is awaited. Transient failures (network, 5xx, 429) retry with exponential backoff; the save state is always visible (saving / saved / offline / failed-with-Retry), and the page warns before unload while anything is unflushed. v1's fire-and-forget `console.warn` writes are gone.

**The residual, stated honestly:** two people typing in the *same* scalar field in the same window converge to the later writer, with the earlier writer notified and the blast radius held to one field. Presence ("Ana is editing this field") makes that a social non-event rather than a data race. Character-level merging inside one field would require Yjs and a build step; it is deliberately out of scope, and the architecture leaves room for it (a single field's storage could switch to a CRDT column without touching anything else).

## 2. Data model

Everything shared is rows in Postgres; nothing user-visible lives in a JSON blob keyed by org anymore.

- `projects`: one row per PRD. `id` stays **text** to preserve v1 ids, and with them every share link and client-contact assignment in the wild.
- `project_fields`: one row per scalar answer (`project_id, field_id` PK, `value jsonb`, `rev`, author attribution).
- `field_rows`: one row per repeating item (requirements, personas, metrics, goals), with `k` (permanent identity), `pos` (ordering), `rev`, soft `deleted`.
- `versions`: immutable baselines. seq, label, full snapshot (answers + rendered sections), build tag, and a **status state machine** (`draft → in_review → approved / changes_requested`) enforced in `version_set_status`.
- `version_approvals`: approver slots per version. A slot is either assigned to a team member (`approver_user_id`) or a free-text name for a manual sign-off. The gate is real: `approved` is refused while any approver is pending. Decisions run through `approval_decide`, which authorizes a manager on any slot but a member only on their own assigned slot (in-app routing, no email); the provenance trigger stamps `decided_by` from `auth.uid()` either way, so a sign-off is always attributed to whoever made it. `my_open_approvals()` returns the caller's pending slots on in-review versions, driving the dashboard "waiting on you" flag. (Of the tools surveyed, Productboard, Jira Product Discovery, and Confluence, none ships a native approval gate; Aha! is the exception. This is deliberate white space.)
- `comms`: every communication (app feedback, brief reviews, SME input, client-contact notes, team/meeting notes) in one table with `origin`, unified status (`new / in_review / actioned / closed`), version linkage, promotion tracking, a human-readable `ref` for client-contact (`partner`-origin) notes, and optionally a `reply_token` for accountless SME threads.
- `messages`: threaded replies on any `comm` or `request`, with `author_kind` (team / partner / sme). Insert-only.
- `attachments`: metadata for files uploaded by the team, client contacts, and seated SMEs (org, project, thread, uploader, name, type, size, storage path, scan status). Bytes live in a private Storage bucket; this table is the audit anchor. Every row is written by a `SECURITY DEFINER` RPC that the upload edge function calls only after a virus scan.
- `input_requests`: tokened "ask an SME" links with prompt, due date, status.
- `discovery_entries`: the research log.
- `read_marks`: per-user read receipts (v1 stored these org-wide, which was simply wrong).
- `user_profiles`: display names for attribution and presence.
- `activity`: the audit trail. Insert-only (no update/delete policies exist), written by SECURITY DEFINER triggers and RPCs, so the log cannot be edited from the app at all. This mirrors the Palantir action-log posture: history survives even the person who made it.

**Document types.** A project's `ctrl_type` field selects how the same answers assemble: the default (and every migrated project, which carries no value) is the full product requirements specification; the alternative is a consulting engagement. This is not a second data model or a second worksheet. The section list already carries per-section conditions (the mechanism that shows the AI sections only when the project has AI); engagement mode reuses exactly that, gating the software-specific sections off the worksheet, and `assemble` branches to `assembleEngagement`, which renders a clean, contiguously numbered engagement record (objective, success metrics, scope and approach with workstreams, assumptions, stakeholders, decisions, glossary, revision) from the shared fields. Each engagement section reuses its counterpart's section key, so anchors, jump-to-section, versioning, approvals, and exports all work unchanged. Because the default is unset, the requirements path is provably identical for every existing project; `tests/engagement.test.mjs` asserts byte-for-byte equality between an unset and an explicitly-requirements document.

## 3. Security model

Row-level security on every table; membership checks run through `SECURITY DEFINER` helper functions (`is_org_member`, `is_org_manager`, `is_project_partner`) to avoid RLS recursion, the pattern proven in v1 and kept.

- Managers write; Viewers read everything and may post comms/replies (their inserts are constrained to their own identity: `author_user = auth.uid()`).
- Racy structures cannot be written directly at all. No INSERT/UPDATE policies exist on `project_fields` or `field_rows`; the RPCs are the only path, so rev checks cannot be bypassed by a creative client.
- Messages inserts verify the parent belongs to the same org (no cross-org thread injection).
- Client contacts (the `partner` role) touch nothing directly; their surface is a small set of RPCs that scope every query to `partner_access` rows for `auth.uid()`.
- SMEs have no account. Share and reply tokens are 144-bit random URL-safe strings generated server-side (`gen_random_bytes`), not guessable hashes; payloads served to them are curated subsets built by the app (`buildSharePayload`) that never include fit criteria, schedules, or internal notes. Legacy v1 hash tokens continue to resolve because the rows were migrated, but all new tokens are random.
- Anonymous endpoints are rate limited server-side: 60 submissions per project per origin per hour, 30 per input request per hour, 30 replies per SME thread per hour, and 40 file uploads per project per hour. Publishing a share is fenced to the caller's own org and project, so a colliding or guessed token belonging to another workspace is refused rather than overwritten.
- Team identity is server-stamped: when a signed-in member writes a team message or team note, the author name is taken from their profile, not from the request. External viewers therefore cannot be shown words under a teammate's forged name.
- Uploaded files are scanned in an edge function before storage when a scanner is configured (see `ATTACHMENTS.md`), stored in a private bucket reachable only through short-lived signed URLs, capped at 25 MB and an allow-list of document/image types, and re-validated in the database on insert. Infected files are rejected and never stored.
- Input has ceilings: 256 KB per worksheet answer and 128 KB per row enforced in the RPCs, 20 KB per comm or message body enforced by CHECK constraints on new writes.
- The frontend ships a CSP with no inline scripts, escapes every interpolation through one `esc()` helper, and holds no secrets beyond the public anon key.

## 4. Realtime and presence

Change fan-out uses **Broadcast-from-Database**: AFTER-triggers on the collaborative tables (fields, rows, versions, comms, input requests, discovery, attachments, messages, approvals) call `realtime.broadcast_changes()` onto `proj:<project_id>` (and `org:<org_id>` for the project list). Supabase's own guidance now recommends broadcast over `postgres_changes` for multi-subscriber scale: `postgres_changes` re-evaluates RLS per subscriber per change and is the likelier bottleneck at nine-plus editors. Channels are **private**: RLS policies on `realtime.messages` admit org members and assigned partners only.

Clients apply incoming events idempotently: fields/rows accept only newer `rev`s (which also makes self-echoes no-ops), inserts dedupe by id, and nothing ever overwrites a locally dirty or focused field, so realtime can never fight your own typing.

Presence rides the same project channel: each client tracks `{user, name, focused field}` (state, not keystrokes, per Supabase guidance). The UI renders workspace avatars and a per-question "X is editing" chip, which converts the one remaining same-field race into something people see coming.

Channel rights are asymmetric: org members receive and send (presence requires send); partners receive only. Clients treat incoming payloads as view updates, and nothing received over a channel can reach the database except through the rev-checked RPCs, so a forged broadcast can at worst repaint a screen until the next fetch.

Trigger failure safety: every broadcast call is wrapped so a realtime outage can never fail a write; the audit logger likewise.

## 5. External collaboration

Three tiers, matching how the surveyed tools converge (paid makers, scoped free collaborators, zero-friction reviewers), plus the partner layer none of them model:

- **SMEs (no account):** brief review, app testing, and input-request pages served by token. Every submission returns a private reply token, so the SME bookmarks the page and has a two-way thread with the team (`sme_thread` / `sme_reply`), no login ever. A seated SME also gets a durable per-PRD workspace reached by one stable link that resumes the same thread across versions and devices. v1 SMEs fired feedback into a void.
- **Client contacts (account; schema role `partner`):** a portal listing assigned projects with the latest *published* brief, their notes as live threads (each carrying a stable `PN-n` reference), and direct reply. Client-contact identity is server-derived, never client-asserted.
- **Team:** managers and viewers, with viewers deliberately able to participate in conversation while remaining unable to touch the document.

Client contacts and seated SMEs can also attach documents to their threads. Uploads are scanned when a scanner is configured, stored privately, and land in the team's inbox and a per-PRD file roll-up; see `ATTACHMENTS.md`.

**Update recipients (v2.35.0).** A weekly update link is issued to one named person with a role (Client or Partner) and renders a one-screen dashboard of authored content frozen at publish: the engagement phase the team set, the objectives and key results they wrote, and the risk and issue rows they wrote, each with a permanent phase-prefixed ID (`D01`, `V02`) allocated server-side per project, field, and phase letter under an advisory lock and never reused, so deleting a row cannot renumber the rest. The phase tab strip renders one authored answer against the fixed option order; nothing on the board is computed by the platform, no rollup, no verdict, no derived status (`POSITIONING.md`; that line is load-bearing). The recipient gets two capabilities on their link. Private notes: one rev-checked scratch document scoped to the link's token, readable and writable through the token RPCs only, with no table read policy even for org members. Threads: a question, comment, or request for information opens a real thread ON the existing comms spine, deliberately not a new table. The decision: one spine means one inbox, one `last_ext_at` / `team_seen_at` signal, one activity trail, one reply surface, and a team reply written in the app appears on the recipient's link with zero new notification machinery; a parallel messaging system would have meant a second inbox to forget. The thread is attributed to the token's named recipient (a link issued to nobody accepts no posts), stamped to the update's baseline via `version_seq`, given a `UQ-n` reference off the shared per-project counter, resolved to a client-contact row on email when one exists, and reachable at a minted reply token like any external thread. Withdrawing an update kills the whole grant: the page, the notes, the threads, and the reply tokens the page handed out.

## 6. Migration

`migrate.sql` decomposes every kv blob into rows: index to projects; answers to fields and rows (`_k` becomes `k`, so requirement IDs survive; `__k_*` counters are superseded by server allocation, verified to continue the sequence); versions, snapshots, builds, and document status to `versions`; feedback and notes (plus `partner_notes`, deduplicated by legacy id) to `comms` with their threads to `messages`; noteReqs to `input_requests`, adopting the legacy share token so old links keep working; submissions that no manager ever saw are recovered into the inbox. Everything is keyed on primary keys or `legacy_id` with `ON CONFLICT DO NOTHING`, idempotent by construction and proven idempotent in the e2e suite. v1 tables are read, never written.

## 7. Verification

Three layers, all in the repo and all green at delivery. Counts are current as of this release; the suites themselves are the source of truth.

1. Pure document pipeline: `tests/domain.test.mjs` (15: builders, IDs, diffing, brief redaction, summary math, decision log), `tests/share.test.mjs` (10: section-scoped share payloads and selection/display alignment), `tests/msgdedup.test.mjs` (5: optimistic/realtime message dedupe), `tests/engagement.test.mjs` (10: the engagement charter assembles from the shared fields, the software sections are gated off, anchors resolve in both modes, and the requirements path is proven byte-for-byte identical whether the document type is unset or set to requirements).
2. `tests/sync.test.mjs` (12): the real client engine against a mock server implementing the RPC contracts. Nine simultaneous adders, cross-field and same-field races (both focus cases), keystroke coalescing, transient-failure retry, generate collisions, remote-delete-while-editing, realtime idempotence.
3. `tests/backend-e2e/` (204): a genuine embedded Postgres with Supabase shims. `run.mjs` (79) runs a full v1 seed (two orgs), schema, migration twice, and every core RPC exercised as manager, viewer, partner, rival-org manager, and anonymous SME, including the adversarial set (cross-org share-token takeover attempt, anonymous rate-limit trip, forged team-name rejection, oversize-payload rejection, and viewer RLS under the `authenticated` database role). The feature suites add brand overlay (12), the durable SME workspace (16), attachments (18: type/size/infected guards, authorization resolvers, RLS, rate limit), partner-note references and backfill (10), approver assignment and self-approval authorization (18: only the assigned member or a manager may decide a slot, provenance attributes self-approval correctly, the approve gate holds, and the roster picker is member-scoped), seed-data integrity (19: three worked-example PRDs assemble and the standalone seed adds one without disturbing the rest), and the rebuild-in-place deploy (21: retitle, full erase of SME/partner interchanges, content replacement, and an approved v1.1 with named approvers, leaving other projects untouched and idempotent on re-run), and the team-level new-reply flag (11: an external post or reply flags a thread, any teammate opening it clears it for everyone, team notes and the empty SME shell never flag, and a viewer may clear it while an outsider may not).

`npm test` runs layers 1 and 2 with node only. `npm run test:backend` runs layer 3 on an embedded Postgres. The per-suite counts above are historical; the suites print their own totals and CHANGELOG.md carries the current release's numbers.

**Independent verification and the no-drift gate (v2.35.0).** A baseline exports as a verification bundle: one JSON file holding exactly what the fingerprint covers (`label`, `seq`, `snapshot`) plus the recorded fingerprint, built by `app/js/verifybundle.js`. Three consumers, one recipe, and a gate that keeps them honest. The public page (`verify.html`) recomputes the hash fully client-side by importing the SAME `canonicalJson` and `sha256Hex` from `core.js` that produced the fingerprint, so the page can never drift from the app. The standalone CLI (`tools/reqpub-verify.mjs`) deliberately imports nothing from ReqPub: it is reimplemented from `VERIFY.md` alone, as proof that the published recipe suffices to verify a baseline without the platform. CI runs `tests/verify-cli.test.mjs` as its own named step: it builds a bundle with the current export code and asserts the CLI agrees byte for byte, canonical stream and verdict both. If the spec and the implementation ever part ways, that gate fails and the release does not ship. What a match proves, stated on every surface: the snapshot reproduces the fingerprint exactly. What it does not prove: who produced it or when; the fingerprint is not a signature and not a trusted timestamp, and no sealing claim is made before the e-signature phase ships.

## 8. Known limits

Same-field simultaneous typing is last-writer-wins with notice (see §1). Supabase Realtime delivery is at-least-once and unordered across tables; the rev/id idempotence rules absorb this. The activity trail records app-level actions, not raw SQL run by a project admin in the Supabase dashboard (nothing client-side can close that; it is Supabase's boundary). Exports use the browser's print engine for PDF, a deliberate zero-dependency choice. Virus scanning depends on an external scanner being configured; with none configured, uploads are stored and clearly flagged as unscanned rather than blocked (configurable to fail-closed).

## Module sizes and the split threshold

main.js is the event-dispatch and orchestration layer and is the largest
module by design: one delegated click switch, one change switch, and the
async handlers that compose data calls into renders. The seam for a split
is already visible (dispatch, handlers, document-meta builders). v2.26.0
held the line the deferral drew: both new capabilities landed their logic
as modules - intake.js pure and unit-pinned, e-sign in schema RPCs and the
view layers - and main.js grew only delegated handlers and one hash route.
v2.26.1 kept the shape: the pdf line-joining and the markdown unescape are
pure intake.js exports with their own unit checks; main.js gained the two
library loaders and the ingestion branches, nothing more. v2.27.0 again:
the whole weekly-update derivation is update.js, pure and unit-pinned;
main.js gained one route and the delegated handlers. v2.28.0 the same:
the PDF table geometry, header inference, and HTML-to-markdown conversion
are pure intake.js exports with a frozen real-geometry fixture; main.js
only changed what it hands them (fragment coordinates, mammoth HTML).
The split itself remains scheduled for the first feature that restructures
routing or dispatch, when its tests ship with it - not as a cosmetic
refactor before an external review, where restructuring risk exceeds
reading cost. Every other module
stays under a quarter of its size, and pure logic lives in domain, health,
exports, implpkg, and zipstore, where the unit suites pin it.

Firm templates (schema section 17, v2.30.0) store an org's standing
structure (organization, document type, NFRs, glossary) as jsonb behind
RLS reads and RPC-only writes; the app applies them, and clones, through
the same rev-checked field and row RPCs as live editing, so a template is
just a replayed edit session, never a second write path.
