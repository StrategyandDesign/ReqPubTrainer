# Security

## Write semantics, stated plainly

Client writes retry only on transient failures (timeouts, 5xx, network
loss) with exponential backoff; definitive errors return immediately. A
response lost at the network layer after a successful write means retries
are at-least-once. Field and row writes are safe under this: they go
through rev-checked server RPCs, so a replay is rejected as stale. Direct
inserts without a natural unique key (approval slots) can, rarely, duplicate
on a lost response; slots are manager-visible and manager-editable, and the
provenance trigger stamps every row, so a duplicate is evident and
removable, never silent. Project creation deduplicates by key.

Brand logos are accepted only as data:image URIs (png, jpeg, gif, webp,
svg+xml), size-capped, and the whitelist is enforced at every render
surface (workspace preview, external brief, printed exports), with all
attributes escaped.

## Reporting

Report suspected vulnerabilities privately to the workspace owner (see the
repository contact). Do not open public issues for security reports. Include
reproduction steps and, where relevant, the org and project involved. You will
get an acknowledgment, and fixes ship as a schema and/or frontend release with
notes in CHANGELOG.md.

## Model, in brief

Full detail lives in `docs/ARCHITECTURE.md` §3. The essentials:

- Every table carries row-level security scoped to the organization. Membership
  checks run through SECURITY DEFINER helpers to avoid RLS recursion.
- Worksheet fields and rows cannot be written directly: the rev-checked RPCs
  (`save_field`, `upsert_row`, `delete_row`) are the only mutation path, so
  concurrency checks and size ceilings cannot be bypassed by a modified client.
- Team identity on messages and team notes is stamped server-side from the
  signed-in user's profile; a client-supplied name is ignored.
- Anonymous endpoints (SME submissions, request intake, SME replies) are token
  gated with 144-bit random tokens and rate limited per project, request, and
  thread. Share-link payloads are curated subsets that never contain fit
  criteria, schedules, or internal notes.
- Share tokens cannot be hijacked across organizations: publishing a link is
  fenced to the caller's own org and project.
- The invite email function verifies, under the caller's own identity, that they
  have already added the recipient to a workspace they manage (a row visible to
  them only under the manager-scoped policy) before sending, so it cannot be used
  to email arbitrary addresses.
- Realtime channels are private. Members receive and send; client contacts (the `partner` role) receive
  only; anonymous visitors have no channel access. Database state is never
  writable through realtime.
- The `activity` table is append-only (no update or delete policies exist) and
  is written by SECURITY DEFINER functions.
- A version's baseline fingerprint is SHA-256 over the canonical JSON (object
  keys sorted, arrays in order, UTF-8) of `{label, seq, snapshot}` as stored.
  It identifies the exact baseline an export was produced from and recomputes
  from the stored row alone; it is NOT a signature or a trusted timestamp -
  cryptographic sealing is the e-signature phase, and no sealing claim is made
  before it ships.
- The frontend ships a CSP with no inline scripts, escapes every interpolation
  through a single helper, and holds no secret beyond the public anon key.

## The update-token trust model (v2.35.0)

A weekly update link is a bearer credential presented by an anonymous
browser. Its powers are enumerated and server-enforced; nothing on the page
grants what the token does not.

The token GRANTS: reading its own update's frozen payload and dashboard
board; reading and rev-checked writing of the one private note kept for that
link; opening threads and replying on that link's own threads, always
attributed to the named recipient the link was issued to; reading signature
status by name, role, and state; receiving a live signing token ONLY for the
signature request addressed to the recipient's own email (the v2.34.2 rule);
and reading the baseline history panel.

The token REFUSES: any other link's note (no read path exists, in either
direction); posting into any other link's thread or any non-update
conversation (the comm must belong to THIS token's update, checked
server-side); any signer's token other than the recipient's own, and any
signer's email at all; anonymous posts (a link issued to nobody accepts
none); and every direct table write, since `updates`, `update_notes`, and
`row_id_seq` revoke DML from the client roles and the RPCs are the only
path. A wrong token returns null, the same shape as nothing, so probing
leaks no existence signal. Thread and note bodies are length-capped
server-side and thread creation is rate-limited per link.

Revocation is whole: a withdrawn update returns only the withdrawn marker,
and the note, the threads, the new-post paths, and the reply tokens the page
handed out all die with it. The threads themselves remain on the record for
the team; what dies is the outside credential.

Stated honestly on the page and here: the recipient's notes are scoped to
the link's token, NOT encrypted at rest. A database administrator can read
them. The words on the dashboard say exactly that, and no stronger claim is
made anywhere.

## Independent audit

Before external review the code passed two independent adversarial audits (SQL/RLS
and frontend/XSS) run against the actual code. Findings and fixes are recorded in
`docs/AUDIT.md`; the hardening fixes ship with regression tests in the backend
suite (215 checks).

## Accepted residual risks

Documented deliberately rather than hidden:

- `style-src 'unsafe-inline'` remains in the CSP (the UI uses inline style
  attributes). Script injection is the XSS vector that matters and is closed.
- A signed-in org member can send client broadcasts on project channels; other
  clients treat them as view hints only, and the database rejects any write
  that does not pass the rev-checked RPCs. Members are trusted internal staff.
- Supabase project administrators can alter data with SQL, outside the
  in-app audit trail. That boundary belongs to Supabase access control:
  restrict dashboard access accordingly.
- Uploads are virus-scanned only when a scanner (`SCAN_URL`) is configured. With
  none set, a file stores flagged `unscanned`; a scanner error stores `error`
  unless `SCAN_FAIL_CLOSED` is enabled. Configure a private scanner (for example a
  self-hosted ClamAV REST service) and `SCAN_FAIL_CLOSED` in production; see
  `docs/ATTACHMENTS.md`.
- The `attachment-upload` function reflects a permissive CORS origin. It
  authorizes by bearer JWT (team, client contact) or the SME reply token, not by
  cookies, so a cross-origin request carries no ambient authority and CORS is not
  its trust boundary; a leaked token would be the concern. `send-invite`
  restricts its origin to the app URL.

## Retired keys stay published, permanently

Found by the C3.2 rotation drill, which is executed on every build by
`tests/rotation-drill.test.mjs` rather than described here and hoped for.

When a signing key is rotated, the retired key **remains in
`reqpub-keys.json` forever**, marked `"status": "retired"` with the date it
was retired. It is never removed, and its `kid` is never reused.

The reason is the failure the drill reproduces. A receipt names the key that
signed it by id. An outsider verifying that receipt fetches the published key
set, finds that id, and checks the signature. Remove the retired key from the
set and every receipt sealed under it becomes unverifiable, permanently, while
every receipt sealed under the new key continues to verify. The mistake is
therefore invisible in normal testing: the current path is healthy and only
history is destroyed.

The drill proves four properties on real Ed25519 keys:

1. A receipt sealed before rotation verifies after rotation, against the
   retired key.
2. A receipt sealed after rotation verifies against the active key.
3. Removing the retired key from the published set destroys the old receipt
   and leaves the new one working.
4. Publishing a different key under the same `kid` does not verify, because
   pinning is by key material, not by name.

### The rotation procedure

1. Generate the new keypair. Load the private half into function secrets under
   a new `kid`. Never reuse a `kid`.
2. Add the new key to `reqpub-keys.json` with `"status": "active"`, and change
   the previous entry to `"status": "retired"` with `retiredAt`. Do not remove
   anything.
3. Countersign the updated key file with the timestamp authorities, as with any
   published artifact.
4. Deploy the seal function so new receipts carry the new `kid`.
5. Verify one receipt sealed before the rotation and one sealed after, using
   only the published key file and `openssl`, as an outsider would. If either
   fails, roll back and stop.

A key is only ever removed from the published set if it was compromised, in
which case removal is not enough: every receipt sealed under it must be
disclosed as untrustworthy under `docs/operations/INCIDENT.md`, because a compromised key
cannot distinguish a genuine seal from a forged one.
