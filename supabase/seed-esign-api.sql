-- ============================================================================
-- ReqPub - seed the "Esign API" worked-example PRD (standalone; touches nothing else)
-- ============================================================================
-- Run ONCE in the Supabase SQL editor, AFTER schema.sql. Re-runnable (idempotent).
-- It targets the org named exactly 'Collection Ventures'. If your workspace is
-- named differently, change the name on the first line of the DO block.
-- Generated from tools/prd-seed-data.mjs; do not hand-edit.
-- ============================================================================

begin;

do $$
declare v_org uuid;
begin
  select id into v_org from orgs where name = 'Collection Ventures' order by created_at limit 1;
  if v_org is null then
    raise exception 'No workspace named "Collection Ventures" was found. Edit the name in this file and re-run.';
  end if;

  delete from projects where org_id = v_org and id = 'prd-esign-api';

  -- Insert the project shells (owned by the workspace; filled drafts, no version).
  insert into projects (id, org_id, name, disc_export) values
    ('prd-esign-api', v_org, 'Esign API', false);
end $$;

-- Scalar answers
insert into project_fields (project_id, field_id, value, rev, updated_by_name, updated_at) values
  ('prd-esign-api', 'ctrl_product', '"Esign API"'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'ctrl_org', '"Collection Ventures"'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'ctrl_owner', '"Micah Canfield"'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'ctrl_status', '"In Review"'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'ov_purpose', '"This document is the requirements record for the Esign API: the API-first electronic-signature service that executes sign-off and seals the result. It is written for the build team and the build agent, and it defines the envelope lifecycle, recipients and fields, the signing ceremony, assurance levels, the tamper-evident ledger, and independent bundle verification. It is the execution layer behind ReqPub sign-off and a standalone product. Where this record is silent, the build escalates to the owner rather than inventing scope."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'ov_vision', '"A signature you can prove without trusting the vendor. Esign API takes a document from upload to a completed, cryptographically sealed bundle that any third party can verify offline. Every envelope carries a hash-chained ledger of who did what and when, and every completed bundle verifies against its own contents even if the service is gone. The promise: the proof outlives the platform."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'ov_problem', '"E-signature is usually a black box: the audit trail lives on the vendor’s servers, and if the vendor disappears or is disputed, the proof is gone. Teams that answer to courts, auditors, and regulators need signatures whose integrity does not depend on the signing vendor staying online or trustworthy. They need an API they can embed, an assurance level they can choose, and a bundle that verifies on its own."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'ov_market', '"Product and advisory teams that already collect approvals and now need legally executed, independently verifiable signatures: ReqPub sign-off first, then agencies, compliance-heavy SaaS, and institutional workflows (corrections, courts, employers) that must show an unbroken chain of custody. The buyer answers to a regulator or a court; the verifiable bundle is the artifact both sides trust."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'context', '"A stateless FastAPI service over a managed Postgres backend and object storage. Documents are PDFs, fields are placed by page coordinate, and signatures are captured by draw, type, or click. The ledger is append-only and hash-chained. The API is the product surface (OpenAPI-documented); a thin hosted signing page is a client of it. Verification must never depend on the service being online."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'sol_solution', '"One service with a clear spine: an issuer uploads a document; an envelope is created with recipients (each a role), fields (each a type placed on a page), and an assurance level; the envelope is sent by a delivery method; each recipient completes a signing ceremony (submit or decline) captured with method and consent; on completion the service seals a bundle (documents, fields, signatures, and the hash-chained ledger) with an RFC 3161 timestamp; and a public verify endpoint validates any bundle against its own contents. A self-sign path lets an issuer sign their own document in one call."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'staged', '"Yes"'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'has_ai', '"No"'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'vulnerable', '"No"'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'consent', '"Every signer is shown the document and an explicit electronic-signature consent (ESIGN and eIDAS intent-to-sign) before any signature is captured, and consent is recorded with the signature as a ledger event. A recipient may decline; a decline is a first-class, recorded outcome, not an error. No signature is captured without an affirmative act tied to the shown document hash."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'retention', '"Envelopes, documents, fields, signatures, and ledger events are retained for the life of the account and any contracted legal-hold period. Completed bundles are immutable and independently verifiable; deleting an envelope preserves the sealed bundle hash and a ledger stub so previously issued proofs still verify. The audit ledger is append-only and retained per the records agreement."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'residency', '"Documents and signatures are stored in the account’s configured region on managed Postgres and object storage. Signed bundles are content-addressed by hash. Timestamping is delegated to an RFC 3161 authority and the timestamp token is stored with the bundle. Cross-border processing for institutional channels is contracted per agreement."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'access', '"Row-level security defaults to deny. An issuer reads only their own envelopes; a recipient reaches only the envelope and fields addressed to them, through a scoped signing token, never the issuer’s other envelopes. Signing tokens are single-purpose, expiring, and bound to one recipient on one envelope. The ledger is writable only by the service (append-only); verification is public and reads only the bundle presented to it. API keys are per-issuer and scoped."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'verify_note', '"A release is accepted when every Must requirement passes its fit criterion in production, the RLS default-deny suite passes, and a sealed bundle verifies independently of the service with zero false-valids and zero false-invalids on the conformance set. Tampering with any byte of a sealed bundle must fail verification."'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'link_repo', '"to confirm"'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'link_board', '"to confirm"'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'link_design', '"to confirm"'::jsonb, 1, 'Seed', now())
on conflict (project_id, field_id) do update set value = excluded.value, rev = 1;

-- Repeating rows (lists and tables). k is the permanent per-field id used for FR-/NFR-style numbering.
insert into field_rows (project_id, field_id, k, data, pos, updated_by_name, updated_at) values
  ('prd-esign-api', 'ov_goals', 1, '{"text":"Execute a signature from envelope to sealed bundle through the API with no human step beyond the signer."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'ov_goals', 2, '{"text":"Make every completed bundle verify independently of the service, with zero false-valids."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'ov_goals', 3, '{"text":"Offer a chosen assurance level per envelope, from basic click-to-sign to identity-verified signing."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'ov_goals', 4, '{"text":"Record an unbroken, hash-chained ledger of every envelope event, tamper-evident on verify."}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'ov_goals', 5, '{"text":"Ship as ReqPub’s sign-off execution layer first, then as a standalone embeddable API."}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'sol_in', 1, '{"text":"Envelope lifecycle: create from an uploaded document or with a file in one call, add recipients and fields, send, and track status to completion."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'sol_in', 2, '{"text":"Recipients with roles (signer, approver, viewer) and a routing order; fields placed by type and page coordinate."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'sol_in', 3, '{"text":"Signing ceremony: show the document and consent, capture a signature by draw, type, or click, or record a decline with a reason."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'sol_in', 4, '{"text":"A self-sign path for an issuer signing their own document in a single call."}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'sol_in', 5, '{"text":"Assurance levels selectable per envelope, from basic to identity-verified."}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'sol_in', 6, '{"text":"A hash-chained, append-only ledger and audit-event stream per envelope."}'::jsonb, 6, 'Seed', now()),
  ('prd-esign-api', 'sol_in', 7, '{"text":"A sealed, RFC 3161-timestamped completion bundle and a public verify endpoint that validates it offline."}'::jsonb, 7, 'Seed', now()),
  ('prd-esign-api', 'sol_out', 1, '{"text":"No AI: the service executes and seals signatures, it does not interpret documents."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'sol_out', 2, '{"text":"No in-house certificate authority or timestamp authority; both are delegated to accredited providers."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'sol_out', 3, '{"text":"No document editor; documents arrive as finished PDFs and fields are placed by coordinate."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'sol_out', 4, '{"text":"No open recipient accounts; recipients act through scoped, expiring signing tokens."}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'sol_out', 5, '{"text":"No storage of raw government-ID images beyond the identity step that requires them."}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'sol_out', 6, '{"text":"No claim of qualified (QES) status until the identity and certificate chain is independently accredited."}'::jsonb, 6, 'Seed', now()),
  ('prd-esign-api', 'assume', 1, '{"text":"Documents are provided as PDFs and field coordinates are supplied by the issuer or by ReqPub."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'assume', 2, '{"text":"An accredited RFC 3161 timestamp authority and, for higher assurance, an identity or KYC provider are available as managed services."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'assume', 3, '{"text":"ReqPub is the first integrator and drives the initial envelope and field shapes."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'depend', 1, '{"text":"Managed Postgres backend with row-level security, storage, and edge functions."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'depend', 2, '{"text":"Object storage for documents and sealed bundles, content-addressed by hash."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'depend', 3, '{"text":"An RFC 3161 timestamp authority for bundle sealing."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'depend', 4, '{"text":"An identity-verification provider for advanced and higher assurance levels."}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'depend', 5, '{"text":"A delivery provider (email and SMS) for recipient notifications and signing links."}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'constrain', 1, '{"text":"API-first: every capability is an OpenAPI-documented endpoint and the hosted signing page is a thin client of it."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'constrain', 2, '{"text":"The ledger is append-only and hash-chained; no endpoint edits or deletes a past event."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'constrain', 3, '{"text":"Verification depends only on the bundle, never on the live service (the offline rule)."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'constrain', 4, '{"text":"Every signer action binds to the exact document hash shown at signing."}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'constrain', 5, '{"text":"Signing tokens are single-recipient, single-envelope, and expiring."}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'ctrl_approvers', 1, '{"role":"Owner","name":"Micah Canfield"}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'ctrl_approvers', 2, '{"role":"CTO / Architecture","name":"Alon Arad"}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'ctrl_approvers', 3, '{"role":"Engineering lead","name":"Erik Companhone"}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'ctrl_approvers', 4, '{"role":"Security / Compliance","name":"to confirm"}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'seg', 1, '{"segment":"ReqPub sign-off","share":"First integrator","desc":"Executes and seals approval sign-off on a versioned baseline."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'seg', 2, '{"segment":"Compliance-heavy SaaS","share":"Primary","desc":"Embed signing where an independent audit trail is required."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'seg', 3, '{"segment":"Institutional workflows","share":"Funded","desc":"Courts, corrections, and employers needing a verifiable chain of custody."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'persona', 1, '{"persona":"The integrator (issuer)","needs":"A clean API to create an envelope, place fields, send, and get a sealed bundle back."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'persona', 2, '{"persona":"The signer","needs":"To see the document, consent, and sign by draw, type, or click from a link with no account."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'persona', 3, '{"persona":"The auditor","needs":"A bundle that verifies on its own, with an unbroken hash-chained ledger of every event."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'persona', 4, '{"persona":"The compliance owner","needs":"A chosen assurance level, recorded consent, and retention that satisfies the regulator."}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'release', 1, '{"rel":"Phase 0 Foundation","obj":"Service skeleton, schema and RLS, storage, API keys, health, OpenAPI.","mvp":"to confirm","ship":"to confirm"}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'release', 2, '{"rel":"Phase 1 Envelope & documents","obj":"Upload document, create envelope (and with-file), add recipients and fields, send.","mvp":"to confirm","ship":"to confirm"}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'release', 3, '{"rel":"Phase 2 Signing ceremony","obj":"Consent, submit signature (draw/type/click), decline, status to completion, self-sign.","mvp":"to confirm","ship":"to confirm"}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'release', 4, '{"rel":"Phase 3 Ledger & sealing","obj":"Hash-chained ledger, audit events, RFC 3161 sealed bundle, public verify.","mvp":"to confirm","ship":"to confirm"}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'release', 5, '{"rel":"Phase 4 Assurance","obj":"Identity-verified signing and higher assurance levels; conformance verification set.","mvp":"to confirm","ship":"to confirm"}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'components', 1, '{"name":"Envelope Service","owner":"Erik Companhone","status":"Planned","desc":"Envelope lifecycle and status machine (draft, sent, completed, declined, voided, expired)."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'components', 2, '{"name":"Document Store","owner":"Andy Lan","status":"Planned","desc":"PDF upload, content-addressed storage, field placement by page coordinate."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'components', 3, '{"name":"Recipients & Fields","owner":"Erik Companhone","status":"Planned","desc":"Recipient roles and routing order; typed fields placed per signer."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'components', 4, '{"name":"Signing Ceremony","owner":"Huy Tran","status":"Planned","desc":"Consent, signature capture (draw/type/click), decline, self-sign, scoped tokens."}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'components', 5, '{"name":"Ledger & Audit","owner":"Alon Arad","status":"Planned","desc":"Append-only, hash-chained ledger and audit-event stream per envelope."}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'components', 6, '{"name":"Sealing & Verify","owner":"Alon Arad","status":"Planned","desc":"RFC 3161 timestamped bundle and public offline verification."}'::jsonb, 6, 'Seed', now()),
  ('prd-esign-api', 'components', 7, '{"name":"Assurance & Identity","owner":"to confirm","status":"Planned","desc":"Assurance levels and identity verification for higher tiers."}'::jsonb, 7, 'Seed', now()),
  ('prd-esign-api', 'components', 8, '{"name":"API Platform","owner":"Erik Companhone","status":"Planned","desc":"API keys, rate limits, OpenAPI, hosted signing page, webhooks."}'::jsonb, 8, 'Seed', now()),
  ('prd-esign-api', 'metrics', 1, '{"metric":"Envelope completion rate","target":"measured per issuer","method":"Completed envelopes divided by sent, by integrator."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'metrics', 2, '{"metric":"Bundle verification correctness","target":"zero false-valids, zero false-invalids","method":"Conformance set of valid and tampered bundles run through verify."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'metrics', 3, '{"metric":"Seal integrity","target":"100% of completed bundles carry a valid RFC 3161 token","method":"Inspection of sealed bundles."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'metrics', 4, '{"metric":"Sign submit latency","target":"p95 under 500 ms","method":"Server-acknowledged timing on the sign submit path."}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'metrics', 5, '{"metric":"Ledger continuity","target":"no broken hash chain in any envelope","method":"Chain check across all ledger events."}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'metrics', 6, '{"metric":"Signing-path availability","target":"99.9%","method":"Measured uptime on the submit and verify endpoints."}'::jsonb, 6, 'Seed', now()),
  ('prd-esign-api', 'fr', 1, '{"stmt":"An issuer uploads a PDF document and the service stores it content-addressed by hash, returning a document reference.","fit":"An uploaded document is retrievable by reference and its stored hash matches the bytes. Test.","pri":"Must","comp":"Document Store"}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'fr', 2, '{"stmt":"An issuer creates an envelope either from an already-uploaded document or by uploading a file in the same call.","fit":"Both the create-from-reference and create-with-file paths yield an envelope in draft. Test.","pri":"Must","comp":"Envelope Service"}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'fr', 3, '{"stmt":"An issuer adds recipients to an envelope, each with a role (signer, approver, viewer) and a routing order.","fit":"Recipients persist with role and order; order governs when each is notified. Test.","pri":"Must","comp":"Recipients & Fields"}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'fr', 4, '{"stmt":"An issuer places fields on a document, each with a type (signature, initials, date, text, checkbox) and a page and coordinate, assigned to a recipient.","fit":"Every field renders at its page coordinate for the assigned signer only. Test and Demonstration.","pri":"Must","comp":"Recipients & Fields"}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'fr', 5, '{"stmt":"Sending an envelope transitions it to sent, notifies the first recipients by the chosen delivery method, and issues each a scoped, expiring signing token.","fit":"A sent envelope notifies recipients in routing order; each token opens only that recipient’s view. Test.","pri":"Must","comp":"Envelope Service"}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'fr', 6, '{"stmt":"Before any signature, the signing ceremony shows the exact document and an explicit electronic-signature consent, and records the shown document hash.","fit":"No signature is accepted without a recorded consent bound to the shown document hash. Test.","pri":"Must","comp":"Signing Ceremony"}'::jsonb, 6, 'Seed', now()),
  ('prd-esign-api', 'fr', 7, '{"stmt":"A signer submits a signature captured by draw, type, or click, and the service records the method, the field, the signer, and a timestamp.","fit":"A submitted signature records its method and binds to the field and document hash. Test.","pri":"Must","comp":"Signing Ceremony"}'::jsonb, 7, 'Seed', now()),
  ('prd-esign-api', 'fr', 8, '{"stmt":"A recipient may decline to sign with a reason, and the decline is a recorded, first-class envelope outcome.","fit":"A decline transitions the envelope to declined and appends a ledger event with the reason. Test.","pri":"Must","comp":"Signing Ceremony"}'::jsonb, 8, 'Seed', now()),
  ('prd-esign-api', 'fr', 9, '{"stmt":"An issuer may self-sign their own document in a single call, producing a completed, sealed envelope without an external recipient.","fit":"A self-sign call returns a sealed bundle that verifies. Test.","pri":"Must","comp":"Signing Ceremony"}'::jsonb, 9, 'Seed', now()),
  ('prd-esign-api', 'fr', 10, '{"stmt":"The service records every envelope event (created, sent, viewed, signed, declined, completed) as an append-only, hash-chained ledger entry.","fit":"Each ledger entry references the prior entry’s hash and no endpoint edits or deletes an entry. Inspection and Test.","pri":"Must","comp":"Ledger & Audit"}'::jsonb, 10, 'Seed', now()),
  ('prd-esign-api', 'fr', 11, '{"stmt":"On completion the service seals a bundle of the documents, fields, signatures, and ledger, and stamps it with an RFC 3161 timestamp.","fit":"A completed envelope yields a bundle carrying a valid timestamp token. Test.","pri":"Must","comp":"Sealing & Verify"}'::jsonb, 11, 'Seed', now()),
  ('prd-esign-api', 'fr', 12, '{"stmt":"A public verify endpoint validates a submitted bundle against its own contents and hash chain, without reading live service state.","fit":"A valid bundle verifies offline; a bundle with any byte altered fails; zero false-valids on the conformance set. Test.","pri":"Must","comp":"Sealing & Verify"}'::jsonb, 12, 'Seed', now()),
  ('prd-esign-api', 'fr', 13, '{"stmt":"Each envelope carries an assurance level, and the ceremony enforces the identity requirements of that level before capturing a signature.","fit":"A higher-assurance envelope refuses to complete without the required identity step. Test.","pri":"Should","comp":"Assurance & Identity"}'::jsonb, 13, 'Seed', now()),
  ('prd-esign-api', 'fr', 14, '{"stmt":"The service serves an OpenAPI document and returns structured validation errors for malformed requests.","fit":"The OpenAPI spec is served and a malformed request returns a 422 with field-level detail. Inspection and Test.","pri":"Must","comp":"API Platform"}'::jsonb, 14, 'Seed', now()),
  ('prd-esign-api', 'nfr', 1, '{"stmt":"Every recipient action flows through a single-recipient, single-envelope, expiring signing token; no recipient can reach another envelope.","fit":"A token scoped to one recipient cannot read or act on any other envelope. Test.","pri":"Must","comp":"Signing Ceremony"}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'nfr', 2, '{"stmt":"Row-level security defaults to deny; an issuer reads only their own envelopes and the ledger is writable only by the service.","fit":"A rival issuer reads and writes nothing; no client can append a forged ledger entry. Test.","pri":"Must","comp":"Ledger & Audit"}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'nfr', 3, '{"stmt":"Sealed bundles are immutable and content-addressed, and verification depends only on the bundle, never on live service state.","fit":"A sealed bundle verifies with the service offline. Test.","pri":"Must","comp":"Sealing & Verify"}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'nfr', 4, '{"stmt":"The sign submit and verify paths hold 99.9 percent availability and submit is acknowledged at p95 under 500 ms.","fit":"Measured uptime and latency meet the targets under load. Load test.","pri":"Should","comp":"API Platform"}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'nfr', 5, '{"stmt":"API keys are per-issuer and scoped, and anonymous signing endpoints are rate-limited and input size-capped.","fit":"A flooded signing link is throttled and an oversized upload is rejected. Test.","pri":"Must","comp":"API Platform"}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'data_entities', 1, '{"entity":"Envelopes","sens":"Business; scoped to the issuing account"}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'data_entities', 2, '{"entity":"Documents (PDFs)","sens":"Confidential; content-addressed by hash"}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'data_entities', 3, '{"entity":"Recipients","sens":"Personal; name, email or phone, role"}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'data_entities', 4, '{"entity":"Fields and placements","sens":"Business; per-signer coordinates"}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'data_entities', 5, '{"entity":"Signatures","sens":"Personal and sensitive; method and mark, bound to the document hash"}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'data_entities', 6, '{"entity":"Ledger and audit events","sens":"Sensitive; append-only, hash-chained"}'::jsonb, 6, 'Seed', now()),
  ('prd-esign-api', 'data_entities', 7, '{"entity":"Sealed bundles","sens":"Immutable; verify exposes integrity only"}'::jsonb, 7, 'Seed', now()),
  ('prd-esign-api', 'interfaces', 1, '{"iface":"Timestamp authority","req":"RFC 3161 timestamping of sealed bundles","fit":"Every completed bundle carries a valid timestamp token. Test.","comp":"Sealing & Verify"}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'interfaces', 2, '{"iface":"Identity verification","req":"KYC or identity proofing for advanced and higher assurance","fit":"A higher-assurance envelope cannot complete without a passed identity check. Test.","comp":"Assurance & Identity"}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'interfaces', 3, '{"iface":"Delivery (email and SMS)","req":"Recipient notifications and signing links by the chosen delivery method","fit":"A sent envelope reaches the recipient by the selected channel. Test.","comp":"Envelope Service"}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'interfaces', 4, '{"iface":"Object storage","req":"Document and bundle storage, content-addressed by hash","fit":"A stored object’s hash matches its address. Inspection.","comp":"Document Store"}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'interfaces', 5, '{"iface":"ReqPub","req":"Create an envelope for a version and return a sealed sign-off to the record","fit":"A ReqPub sign-off produces a sealed bundle referenced on the version. Test.","comp":"API Platform"}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'people', 1, '{"name":"Micah Canfield","role":"Owner; decision authority on assurance, providers, and pricing"}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'people', 2, '{"name":"Alon Arad","role":"CTO; sealing, ledger, and security posture"}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'people', 3, '{"name":"Erik Companhone","role":"SWE lead; envelope, recipients and fields, API platform"}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'people', 4, '{"name":"Huy Tran","role":"SWE; signing ceremony and hosted signing page"}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'people', 5, '{"name":"Andy Lan","role":"SWE; document store and data model"}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'glossary', 1, '{"term":"Envelope","def":"The unit of signing: one or more documents, recipients, fields, and a status."}'::jsonb, 1, 'Seed', now()),
  ('prd-esign-api', 'glossary', 2, '{"term":"Recipient","def":"A party on an envelope with a role (signer, approver, viewer) and a routing order."}'::jsonb, 2, 'Seed', now()),
  ('prd-esign-api', 'glossary', 3, '{"term":"Field","def":"A typed input (signature, initials, date, text, checkbox) placed on a document for a signer."}'::jsonb, 3, 'Seed', now()),
  ('prd-esign-api', 'glossary', 4, '{"term":"Assurance level","def":"The identity strength required to sign, from basic click to identity-verified."}'::jsonb, 4, 'Seed', now()),
  ('prd-esign-api', 'glossary', 5, '{"term":"Signature method","def":"How a mark is captured: drawn, typed, or clicked."}'::jsonb, 5, 'Seed', now()),
  ('prd-esign-api', 'glossary', 6, '{"term":"Ledger","def":"The append-only, hash-chained record of every envelope event."}'::jsonb, 6, 'Seed', now()),
  ('prd-esign-api', 'glossary', 7, '{"term":"Bundle","def":"The sealed, timestamped package of documents, signatures, and ledger."}'::jsonb, 7, 'Seed', now()),
  ('prd-esign-api', 'glossary', 8, '{"term":"Self-sign","def":"An issuer signing their own document in a single call."}'::jsonb, 8, 'Seed', now()),
  ('prd-esign-api', 'glossary', 9, '{"term":"Offline rule","def":"A sealed bundle must verify without the service being online."}'::jsonb, 9, 'Seed', now())
on conflict (project_id, field_id, k) do update set data = excluded.data, pos = excluded.pos, rev = 1;

commit;
