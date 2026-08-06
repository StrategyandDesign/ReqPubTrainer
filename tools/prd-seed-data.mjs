/* ============================================================================
   Stress-test PRD content for the Collection Ventures workspace.
   Each PRD is expressed in the ReqPub answer shape (scalars + lists + rows),
   using the exact field_ids from app/js/domain.js. The generator
   (gen-prd-seed.mjs) turns these into supabase/seed-prds.sql, and the domain
   builders validate that each assembles into a real document.
   ============================================================================ */

/* ---- 1. Fathering Excellence Profile (distilled from the Fathers.com
        Platform Authority Document v1.1) ---- */
export const fathering = {
  id: 'prd-fathering-excellence',
  name: 'Fathering Excellence Profile',
  scalars: {
    ctrl_product: 'Fathering Excellence Profile',
    ctrl_org: 'Collection Ventures',
    ctrl_owner: 'Micah Canfield',
    ctrl_status: 'In Review',
    ov_purpose: 'This document is the authoritative requirements record for the Fathers.com continuing-education and community platform. It is written for the build team (PM, CTO, SWE leads) and the build agent, and it defines the vision, roles, experiences, architecture, data model, engagement mechanics, institutional deployment modes, and the phased build plan. Where this record is silent, the build escalates to the owner rather than inventing scope.',
    ov_vision: 'Make Fathers.com the number-one global platform where fathers assess where they stand, grow with proven material, lock arms with other men, and prove their progress in ways courts, employers, and their own families can trust. The founding belief, unchanged since 1990: when fathers grow, children flourish. North Star: Weekly Active Fathering Actions (WAFA), the count of fathers who log at least one intentional real-world fathering action in a given week. Business North Star: Verified Completions, the unit institutions pay for.',
    ov_problem: 'Fathers lack a trusted way to know where they stand and prove progress. Roughly one in four US children live without a father in the home. Generic parenting apps measure screen time, not fathering, and produce nothing a court, employer, or parole board will accept. The opportunity is a validated instrument plus a proof rail plus real-world brotherhood, three things AI cannot commoditize and men will actually pay for.',
    ov_market: 'About 34.3 million US men have a biological child under 18, within roughly 71 million North American fathers. The client segmentation places about 56 percent of fathers as growth-oriented and 44 percent as at-risk across five segments. Institutional buyers already fund fatherhood programming: corrections, courts, employers, and military and VA channels. The first deployment is free for a 100,000-subscriber onboarding wave, with monetization following immediately.',
    context: 'Mobile-first installable PWA at 390-point width, one primary action per screen. Corrections mode must run fully offline for a class session and sync when connectivity returns. Institutional modes (employer, court, corrections, military) are configuration bundles over one platform, not separate apps. Assessment must never block on the network; the member is the only thing it waits on.',
    sol_solution: 'One platform with a single spine: a validated onboarding assessment (the Keystone Father Profile) that tells every man the truth, a deterministic plan engine that maps his lowest factors to exact modules, region-and-stage-matched Crews of 5 to 8 men with an accountability Anchor, cohort Expeditions that end in a verified completion, a weekly Rhythm of logged real-world actions, a verified-behavior rank ladder (Waypoints), and a signing-and-verification layer (ProofRail) whose records verify independently even if Fathers.com is offline.',
    staged: 'Yes',
    has_ai: 'Yes',
    golden: 'Voice mode is evaluated against a human-labeled set of colloquial answers mapped to the 1-to-5 scale, built during the pilot and stratified by dialect cohort. The knowledge agent is evaluated against a probe set of in-corpus and out-of-corpus questions; every generated response must cite a source module, and out-of-corpus probes must trigger honest deferral plus a content-gap ticket, never an improvised answer.',
    vulnerable: 'Yes',
    safeguard: 'A disclosure of self-harm, harm to others, or domestic violence routes to a trained human within one hour, pauses all gamification and nudges for that member, and surfaces professional resources in-product. The protocol is never punitive and never automated therapy (runbook RB-04, interaction IX-09). Minors are excluded from the platform in every role; child records are life-stage and birth-year band only.',
    consent: 'Research, comparison (self vs observer), and marketing consents are separate records, plain-language, opt-in, and revocable at any time. Research consent is separate from terms acceptance. The self-versus-observer comparison overlay renders only after both the father and the secondary participant accept an identical consent sheet; either revocation removes it immediately.',
    retention: 'Responses and scores are retained while the account lives. Self-serve export (JSON plus PDFs) and account deletion carry a 14-day cooldown; deletion cascades per the retention matrix, with certificates preserved as anonymized verification stubs so previously issued proofs still verify. Corrections records follow the facility agreement and applicable records law. The audit log is retained seven years.',
    residency: 'Primary data is stored and processed in the platform region on the managed Postgres backend. Cross-border processing for institutional channels is contracted per agreement. Voice audio is processed for transcription and discarded by default; transcripts store with the response record.',
    access: 'Row-level security defaults to deny. Members read their own rows; Crew and group visibility flow through membership joins. Assessment scores carry the strictest policy: readable by the member, the scoring service, and consented case access only, and are never visible to employers, courts, corrections officials, or military admins. Institutional roles read only aggregate views with a minimum cohort size of ten. Staff access is scoped by case and logged; production access is break-glass and reviewed monthly.',
    verify_note: 'A release is accepted when every Must requirement for the phase passes its fit criterion in production, the RLS default-deny suite passes, and the phase exit criteria in the build plan hold. ProofRail records must verify independently of Fathers.com systems (the Mars rule) with zero false-valids.',
    link_repo: 'to confirm',
    link_board: 'to confirm',
    link_design: 'to confirm'
  },
  lists: {
    ov_goals: [
      'Grow Weekly Active Fathering Actions (WAFA) week over week as the primary mission metric.',
      'Produce Verified Completions (assessments, Expeditions, courses) as the fundable business unit, reported weekly by channel.',
      'Onboard the 100,000-subscriber wave with assessment completion at or above 75 percent of starters.',
      'Reach Crew join at or above 40 percent of new completers and week-4 Rhythm at or above 45 percent.',
      'Sign at least one institutional channel (employer, court, corrections, or military) with real revenue.'
    ],
    sol_in: [
      'Instrument-agnostic assessment engine that loads the Keystone Father Profile as configuration and runs multi-session, resumable, autosaving intake.',
      'Deterministic personalization engine mapping factor bands and child life-stage to an ordered plan of three active items.',
      'Crews, Anchors, and leader-run groups with Crew-scoped and Anchor-scoped messaging only.',
      'Weekly Rhythm logging, cohort Expeditions, and a verified-behavior Waypoints rank ladder.',
      'ProofRail signing, timestamping, transparency log, and public certificate verification.',
      'Four institutional deployment modes: employer, court, corrections (offline-capable), and military.',
      'Eyes-free voice assessment (later phase) and a grounded knowledge agent behind the plan (later phase).'
    ],
    sol_out: [
      'No infinite-scroll feed; the home screen is a mission board.',
      'No minor accounts and no collection of children’s names, ever.',
      'No open direct messages between strangers; messaging is Crew and Anchor scoped.',
      'No daily platform-wide streak; the Rhythm is weekly, daily cadence only inside Expeditions.',
      'No therapy-speak, clinical claims, or diagnosis; the platform educates and connects, it does not treat.',
      'No dark patterns, no ads, no selling member data, no crypto or tokens.',
      'No chatbot as the front door and no native livestream infrastructure before leader demand proves it.'
    ],
    assume: [
      'The Keystone Father Profile is psychometrically validated and licensed for digital deployment with existing norms and rubrics (owner-confirmed; item count and observer-form rights confirmed at Phase 0 exit).',
      'The 100,000-subscriber onboarding wave exists and converts a meaningful fraction to accounts across the launch arc.',
      'Institutional buyers pay for verified completion and aggregate reporting, not for assessment scores.'
    ],
    depend: [
      'Managed Postgres backend (Supabase-class) with row-level security, realtime, storage, and edge functions.',
      'Managed video platform for on-demand modules and embedded third-party livestreams at launch.',
      'Payment processor with subscription billing, checkout, marketplace payouts, and tax.',
      'ProofRail verification service shared with the studio’s existing verification work.',
      'Instrument owner sign-off for any change to scoring, norms, or item structure.'
    ],
    constrain: [
      'One deployment, domain-modular; no microservices at this audience scale.',
      'The instrument is configuration; zero instrument logic in code.',
      'All working names ship behind config flags for owner rename without code change.',
      'WCAG 2.1 AA and Section 508 globally, because federal channels require it.',
      'Answer-save p95 under 300 ms; the UI never blocks on the network.'
    ]
  },
  rows: {
    ctrl_approvers: [
      { role: 'Owner', name: 'Micah Canfield' },
      { role: 'Product', name: 'Tim Harris' },
      { role: 'CTO / Architecture', name: 'Alon Arad' },
      { role: 'Engineering lead', name: 'Erik Companhone' }
    ],
    seg: [
      { segment: 'Growth-oriented fathers', share: '56%', desc: 'Want a precise next step after the Profile, not a content dump.' },
      { segment: 'At-risk fathers', share: '44%', desc: 'Span crisis-window, corrections, and reentry situations.' },
      { segment: 'Crisis-window fathers', share: 'High value', desc: 'Separation or custody proceedings; need a court-accepted course with proof, fast.' },
      { segment: 'Institutional cohorts', share: 'Funded', desc: 'Employer, court, corrections, and military buyers who pay for verified completion.' }
    ],
    persona: [
      { persona: 'The Busy Professional', needs: 'Multi-session, one-handed mobile, resumable; weekly not daily cadence.' },
      { persona: 'The Auditory Learner', needs: 'Voice assessment and audio-first modules for the commute.' },
      { persona: 'The Crisis-Window Father', needs: 'A court-recognized course with seat-time tracking and public certificate verification.' },
      { persona: 'The Incarcerated or Reentry Father', needs: 'Offline facility delivery, proof usable with parole and child support, and account continuity on release.' },
      { persona: 'The Veteran Father', needs: 'Peer credibility, trauma-informed pacing, no clinical framing, no autoplay of intense material.' },
      { persona: 'The Faith-Driven Group Leader', needs: 'Curriculum sequencing, attendance, and group progress without seeing member scores.' }
    ],
    release: [
      { rel: 'Phase 0 Foundation', obj: 'Repo, environments, schema and RLS, auth, event pipeline, design system, instrument loader, ProofRail skeleton.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase Spine', obj: 'Assess, results, plan, membership; onboard the 100K wave; WAFA dashboard live.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase Brotherhood', obj: 'Crews, Anchors, Rhythm, Expeditions, Waypoints, Campfire, crisis protocol, ProofRail issuance.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase Leaders & Commerce', obj: 'Leader consoles, store and events, court-track course and public verification.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase Institutions A', obj: 'Employer SSO/SCIM and aggregate dashboard; court coordinator portal; SOC 2 evidence begins.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase Institutions B', obj: 'Corrections offline mode and Reentry Bridge; military mode; outcome instrumentation for evaluation.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase Voice', obj: 'Eyes-free voice assessment with grounded clarification and a dialect evaluation harness.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase Guide', obj: 'Grounded knowledge agent behind the plan with mandatory citations and gap tickets.', mvp: 'to confirm', ship: 'to confirm' }
    ],
    components: [
      { name: 'Assessment Engine', owner: 'Erik Companhone', status: 'Planned', desc: 'Instrument-agnostic, multi-session, resumable, idempotent write path.' },
      { name: 'Plan Engine', owner: 'Erik Companhone', status: 'Planned', desc: 'Deterministic factor-to-module mapping; three active items maximum.' },
      { name: 'Community', owner: 'Huy Tran', status: 'Planned', desc: 'Crews, Anchors, groups, threads, moderation, safeguarding.' },
      { name: 'Engagement', owner: 'Huy Tran', status: 'Planned', desc: 'Rhythm, Expeditions, Waypoints, notification discipline.' },
      { name: 'ProofRail', owner: 'Alon Arad', status: 'Planned', desc: 'Signing, RFC 3161 timestamps, transparency log, revocation, public verify.' },
      { name: 'Institutional Modes', owner: 'Andy Lan', status: 'Planned', desc: 'Employer, court, corrections (offline), military configuration bundles.' },
      { name: 'Voice Mode', owner: 'Erik Companhone', status: 'Planned', desc: 'Streaming STT, grounded intent, streaming TTS; tap parity always.' },
      { name: 'Knowledge Agent', owner: 'Erik Companhone', status: 'Planned', desc: 'Retrieval over the vetted corpus; cited generation; no unvetted claims.' }
    ],
    metrics: [
      { metric: 'Answer-save latency', target: 'p95 under 300 ms', method: 'Server-acknowledged timing on the responses write path.' },
      { metric: 'Assessment completion (starters)', target: 'at or above 75%', method: 'Completions divided by starts, per launch cohort.' },
      { metric: 'Crew join rate (new completers)', target: 'at or above 40%', method: 'Crew joins within 7 days of results.' },
      { metric: 'Week-4 Rhythm rate', target: 'at or above 45%', method: 'Members logging in week 4 of membership.' },
      { metric: 'Expedition cohort completion', target: 'at or above 55%', method: 'Completions per enrolled cohort.' },
      { metric: 'Voice semantic mapping accuracy', target: 'at or above 95%', method: 'Against a human-labeled set; below 92% blocks a dialect cohort.' },
      { metric: 'WAFA (North Star)', target: 'up and to the right, weekly', method: 'Distinct fathers logging one intentional action per week.' },
      { metric: 'Verified Completions (Business North Star)', target: 'weekly by channel', method: 'ProofRail-signed records issued.' }
    ],
    fr: [
      { stmt: 'The platform delivers the Keystone Father Profile as one item per screen on a uniform 1-to-5 scale, autosaving every answer and resuming on any device.', fit: 'A member completes the instrument across multiple sessions and devices with no lost answers; save p95 under 300 ms. Test and Demonstration.', pri: 'Must', comp: 'Assessment Engine' },
      { stmt: 'The engine loads an instrument as data (items, sections, dimensions, factors, scale anchors, scoring weights, norm tables, clarifications, observer variant) with no code change per instrument.', fit: 'A 100-item and a 138-item instrument both run from configuration. Inspection and Test.', pri: 'Must', comp: 'Assessment Engine' },
      { stmt: 'On completion the platform scores against the licensed rubric and renders results strengths-first, growth-areas-second, norm-referenced in plain words, never a grade, always ending in the member’s first three actions.', fit: 'Results match the licensed scoring exactly and always present a trail. Inspection and Test.', pri: 'Must', comp: 'Plan Engine' },
      { stmt: 'The plan engine maps the member’s lowest factors and children’s life-stages to an ordered plan of at most three active items (one module, one field action, one Crew or Expedition step).', fit: 'Every member sees exactly three active items derived from mapping tables; recommendation tap-through is measured. Test.', pri: 'Must', comp: 'Plan Engine' },
      { stmt: 'The platform forms Crews of 5 to 8 men matched on child life-stage, region, and situation tags, with an Anchor pairing and a merge offer when a Crew falls below four active men after six weeks.', fit: 'New completers are offered a matched Crew; small Crews trigger a merge. Test and Demonstration.', pri: 'Must', comp: 'Community' },
      { stmt: 'Messaging is Crew-scoped and Anchor-scoped only; leaders broadcast and hold public sessions but cannot direct-message members.', fit: 'No path exists for a leader-to-member DM or a stranger DM. Inspection and Test.', pri: 'Must', comp: 'Community' },
      { stmt: 'The Rhythm records one intentional fathering action per week with optional note, with milestone celebrations at 4, 12, 26, and 52 weeks and a protection pass earned per completed Expedition.', fit: 'One log per week counts; no daily platform streak exists; milestones fire only at the four marks. Test.', pri: 'Must', comp: 'Engagement' },
      { stmt: 'Expeditions run fixed-length cohorts with daily check-ins and Crew visibility, and issue a ProofRail-signed completion record on finish.', fit: 'A completed Expedition produces a verifiable record. Test and Demonstration.', pri: 'Must', comp: 'Engagement' },
      { stmt: 'Waypoints advance rank on verified behavior only (profile complete, first Expedition, sustained Rhythm plus Crew service, capstone), never on purchases.', fit: 'No purchase advances rank; every rank maps to verifiable behaviors. Inspection.', pri: 'Must', comp: 'Engagement' },
      { stmt: 'ProofRail signs each completion record with a hash, RFC 3161 timestamp, course and version, and requirement attestations, appends it to a transparency log, and verifies publicly without a Fathers.com account.', fit: 'A third party verifies a certificate while the platform is offline; revocation is checked on every verify; zero false-valids. Test.', pri: 'Must', comp: 'ProofRail' },
      { stmt: 'Institutional reporting exposes completion, attendance, and certificate validity only, always aggregated with a minimum cohort size of ten; assessment scores are never visible to any institution.', fit: 'No employer, court, corrections, or military view returns an individual score or a sub-ten cohort. Inspection and Test.', pri: 'Must', comp: 'Institutional Modes' },
      { stmt: 'Corrections mode runs a full class session offline, captures attendance and module completion, and syncs verified completions when connectivity returns.', fit: 'A facilitator runs a session with no connectivity and syncs later with no data loss. Demonstration and Test.', pri: 'Must', comp: 'Institutional Modes' },
      { stmt: 'A crisis disclosure in free text routes to a trained human within one hour, pauses all gamification and nudges for that member, and surfaces professional resources, never punitively and never as automated therapy.', fit: 'A seeded disclosure triggers routing within one hour and a gamification pause. Test and Drill.', pri: 'Must', comp: 'Community' },
      { stmt: 'Voice mode delivers the assessment eyes-free with streaming speech, grounded clarification from the curated corpus only, and full tap parity with mid-item switching.', fit: 'End-of-speech to first audio under 1.5 s p90; semantic mapping at or above 95 percent; any member can switch to tap without loss. Test.', pri: 'Should', comp: 'Voice Mode' },
      { stmt: 'The knowledge agent answers only from the vetted corpus with mandatory citations, files a content-gap ticket when coverage is missing, and lives behind the plan rather than as a front-door chatbot.', fit: 'Zero uncited generative claims in the audit sample; out-of-corpus probes defer honestly. Test.', pri: 'Should', comp: 'Knowledge Agent' }
    ],
    nfr: [
      { stmt: 'The assessment write path sustains modeled launch peak (about 420 writes per second) without blocking the UI.', fit: 'A synthetic run at twice modeled peak (10,000 concurrent sessions) holds the save budget. Load test.', pri: 'Must', comp: 'Assessment Engine' },
      { stmt: 'The platform meets WCAG 2.1 AA and Section 508 globally, including keyboard paths, screen-reader labels on the 1-to-5 control, captions, and transcripts.', fit: 'An accessibility audit passes AA on every launch surface. Inspection and Test.', pri: 'Must', comp: 'Assessment Engine' },
      { stmt: 'Console roles require MFA; staff access is least-privilege with break-glass audit; secrets live in a managed vault.', fit: 'No console login without MFA; break-glass reads land in the audit log. Inspection and Test.', pri: 'Must', comp: 'Institutional Modes' },
      { stmt: 'Backup and disaster recovery meet RPO 1 hour and RTO 4 hours with a quarterly restore drill.', fit: 'A restore drill meets the objectives. Test.', pri: 'Must', comp: 'ProofRail' },
      { stmt: 'The assessment path holds 99.9 percent availability during the launch wave.', fit: 'Measured uptime on the assessment path meets the target. Test.', pri: 'Should', comp: 'Assessment Engine' }
    ],
    eval: [
      { dim: 'Voice semantic mapping', metric: 'Colloquial answer to 1-to-5 mapping accuracy against a human-labeled set, stratified by dialect', thresh: 'at or above 95%; below 92% blocks that cohort', exec: 'Agent', comp: 'Voice Mode' },
      { dim: 'Voice grounding guardrail', metric: 'Share of clarification answers drawn only from the curated corpus; out-of-corpus deferral rate', thresh: '100% grounded; improvised interpretation is a hard fail', comp: 'Voice Mode' },
      { dim: 'Knowledge agent hallucination guardrail', metric: 'Uncited generative claims in the audit sample', thresh: 'zero uncited claims', exec: 'Agent', comp: 'Knowledge Agent' },
      { dim: 'Knowledge agent gap handling', metric: 'Out-of-corpus probes that defer honestly and file a gap ticket', thresh: 'at or above 99%', comp: 'Knowledge Agent' }
    ],
    data_entities: [
      { entity: 'Users (father accounts)', sens: 'Personal, no sensitive-category fields' },
      { entity: 'Children records (life-stage and birth-year band only)', sens: 'Minimized; no minor PII' },
      { entity: 'Assessment responses and scores', sens: 'Personal and sensitive; strictest RLS' },
      { entity: 'Consents (research, comparison, marketing)', sens: 'Personal; separate revocable records' },
      { entity: 'Certificates and verification records', sens: 'Personal; public verify exposes initials and compliance only' },
      { entity: 'Crisis and moderation cases', sens: 'Sensitive; trained-human access only' }
    ],
    interfaces: [
      { iface: 'Identity (SSO)', req: 'SAML and OIDC with SCIM for employer seat provisioning', fit: 'Employer members claim seats via SSO; the aggregate wall applies from the first screen.', comp: 'Institutional Modes' },
      { iface: 'Payments', req: 'Subscription billing, course and store checkout, marketplace payouts, tax', fit: 'Membership, courses, store, and leader payouts transact through the processor.', comp: 'Community' },
      { iface: 'Media platform', req: 'On-demand module delivery and embedded third-party livestreams at launch', fit: 'The app never proxies video bytes. Inspection.', comp: 'Community' },
      { iface: 'ProofRail verification service', req: 'Signing, timestamping, transparency log, revocation, public verify endpoint', fit: 'Certificates verify independently of the platform. Test.', comp: 'ProofRail' },
      { iface: 'Court verification', req: 'Public code and QR verification returning course, seat-time compliance, and issue date only', fit: 'A coordinator verifies with no account and no member data beyond the certificate.', comp: 'Institutional Modes' }
    ],
    people: [
      { name: 'Micah Canfield', role: 'Owner; decision authority on instrument, pricing, naming, partners' },
      { name: 'Tim Harris', role: 'Product Manager; phase gatekeeper and scope discipline' },
      { name: 'Alon Arad', role: 'CTO; architecture, ProofRail, security posture' },
      { name: 'Erik Companhone', role: 'SWE lead; assessment engine, plan engine, consoles' },
      { name: 'Huy Tran', role: 'SWE; community, engagement, events, commerce' },
      { name: 'Andy Lan', role: 'SWE; data model, analytics spine, institutional modes' }
    ],
    glossary: [
      { term: 'WAFA', def: 'Weekly Active Fathering Actions; the mission North Star.' },
      { term: 'Verified Completion', def: 'A ProofRail-signed record of a completed assessment, Expedition, or course.' },
      { term: 'Crew', def: 'The 5-to-8-man small group; the retention unit.' },
      { term: 'Anchor', def: 'The paired accountability man inside a Crew.' },
      { term: 'Expedition', def: 'A fixed-length cohort challenge with daily actions.' },
      { term: 'The Rhythm', def: 'The weekly logged intentional fathering action.' },
      { term: 'Waypoints', def: 'The verified-behavior rank ladder.' },
      { term: 'ProofRail', def: 'The signing, timestamping, and verification service.' },
      { term: 'Mars rule', def: 'Proof must verify even if the platform is offline.' }
    ]
  }
};

/* ---- 2. ReqPub Platform (the platform the team is building on, described as
        a PRD: what is done, and the next phase: SOC 2 and e-signature) ---- */
export const reqpub = {
  id: 'prd-reqpub-platform',
  name: 'ReqPub Platform',
  scalars: {
    ctrl_product: 'ReqPub Platform',
    ctrl_org: 'Collection Ventures',
    ctrl_owner: 'Micah Canfield',
    ctrl_status: 'In Review',
    ov_purpose: 'This document is the working requirements record for ReqPub itself: the platform the team uses to turn discovery into a versioned, approved, testable requirements record. It states what has already shipped (so the team edits from reality) and what remains for the next phase (SOC 2 Type II and e-signature execution with cryptographic sealing). It is the record the team stress-tests the platform against.',
    ov_vision: 'The requirements record your client approves. ReqPub takes a project from discovery to an approved, testable baseline where every version is numbered, every approval is named, and every export carries its own history. When someone asks what was agreed, you open the record. The terminal promise is a sign-off that is cryptographically sealed to the exact baseline signed, so the document proves itself.',
    ov_problem: 'Projects fail at "that’s not what we agreed," not at the build. Requirements live in decks, documents, and email threads; reconstructing who approved what, when, and what changed since the client last saw it burns senior hours and goodwill. Teams need a single record that moves with the scope and defends itself under review.',
    ov_market: 'Advisory and product teams whose work is reviewed, contested, and approved: consulting engagement teams, agencies, and internal product groups working with external subject-matter experts and client contacts. The buyer answers to a client and to procurement; the record is the artifact both trust.',
    context: 'A static frontend (installable, no build step) on a managed Postgres backend with row-level security, realtime, and edge functions. Deployed on GitHub Pages against Supabase. Used live by internal teams (managers and viewers), external SMEs with no account (tokened links), and client contacts who manage SMEs (a portal). Multiplayer editing must survive nine or more concurrent editors without lost writes.',
    sol_solution: 'A relational requirements platform: every shared structure is rows, not a JSON blob, so concurrent adds cannot overwrite each other; every scalar field carries a revision so stale writes are detected and resolved rather than clobbered; version numbers are allocated server-side; approvals are a real state machine with named, server-stamped sign-off; sharing is section-scoped and brand-carrying; and every export carries its own history on the cover. The next phase seals that export cryptographically and executes sign-off by e-signature.',
    staged: 'Yes',
    has_ai: 'No',
    vulnerable: 'No',
    consent: 'External reviewers (SMEs) act through tokened links with no account; they see only the curated, section-scoped brief the team publishes, never fit criteria, schedules, or internal notes. Client contacts (the portal role) see only the published brief of projects granted to them. All external participation is on the record with names and timestamps.',
    retention: 'Every project, version, comment, and approval is retained for the life of the workspace. Versions are immutable baselines. The activity log is append-only and written by the database itself. Managers can archive a project; an administrator can restore it. Export to Word, PDF, and Markdown is available at any time.',
    residency: 'Data is stored and processed in the Supabase project region. The public anon key ships in the client by design; all protection rests on row-level security and the rev-checked RPCs.',
    access: 'Row-level security scopes every table to the organization. Managers write; viewers read everything and reply in threads; client contacts (the portal role) reach only assigned projects through the portal. One workspace serves one client account; the workspace is the confidentiality wall; SMEs reach only tokened briefs. Worksheet fields and rows are writable only through rev-checked SECURITY DEFINER RPCs; write is revoked from the audit-only tables. Approval provenance is stamped from the signed-in user and cannot be forged.',
    verify_note: 'A capability is accepted when it passes its fit criterion in production and is covered by the automated suite (221 unit tests, 316 backend checks on a real Postgres). The SOC 2 requirement is accepted only when independently audited; the sealing requirement only when a sealed export verifies against its exact baseline independently of the platform.',
    link_repo: 'github.com/StrategyandDesign/ReqPub',
    link_board: 'to confirm',
    link_design: 'reqpub.com'
  },
  lists: {
    ov_goals: [
      'Let a full team edit one requirements document at once with zero lost writes.',
      'Make every version numbered, every approval named, and every export self-documenting.',
      'Let external SMEs and client contacts review and approve from a link with no account.',
      'Reach SOC 2 Type II certification before the first enterprise contract renewal.',
      'Execute sign-off by e-signature, cryptographically sealed to the exact baseline signed.'
    ],
    sol_in: [
      'Relational requirements model with permanent requirement IDs and per-field revisions.',
      'Live multiplayer editing with presence, per-field conflict detection, and durable retried saves.',
      'Immutable, server-numbered version baselines with a change diff by requirement ID.',
      'A real approval state machine with named, server-stamped sign-off and a gate on Approved.',
      'Section-scoped, brand-carrying sharing: SME review links, client portal, and read-only presentation links.',
      'A designed, co-branded PDF and Word export carrying version, status, approvals, and history.',
      'Validated template starts, record-health signals, one-click promotion from discovery, and a fingerprinted client baseline report.',
      'An append-only audit trail written by the database.'
    ],
    sol_out: [
      'No per-seat pricing model in the product; pricing is per project.',
      'No AI authoring of requirements; the platform structures human judgment, it does not replace it.',
      'No public claims of SOC 2 or e-signature until each ships and is verified.'
    ],
    assume: [
      'Supabase (Postgres, Auth, RLS, Realtime, Storage, Edge Functions) is the backend of record.',
      'The internal team is trusted staff; external parties are untrusted by default.',
      'Managed e-signature and timestamping services exist for the next phase rather than being built in-house.'
    ],
    depend: [
      'Supabase project with row-level security and the rev-checked RPC layer.',
      'GitHub Pages hosting for the static frontend.',
      'A managed e-signature provider and an RFC 3161 timestamp authority for the sealing phase.',
      'An independent auditor for the SOC 2 Type II examination.'
    ],
    constrain: [
      'Static frontend, no build step; ES modules and one CDN dependency only.',
      'Content Security Policy with no inline scripts.',
      'All racy writes flow through server-side rev-checked RPCs; no direct client writes to worksheet tables.',
      'Every change ships with regression tests; the suite stays green.'
    ]
  },
  rows: {
    ctrl_approvers: [
      { role: 'Owner', name: 'Micah Canfield' },
      { role: 'Engineering', name: 'to confirm' },
      { role: 'Security / Compliance', name: 'to confirm' }
    ],
    seg: [
      { segment: 'Internal engagement teams', share: 'Primary', desc: 'Author and own the requirements record; answer to a client.' },
      { segment: 'Subject-matter experts', share: 'External', desc: 'Review and approve from a link with no account.' },
      { segment: 'Client contacts', share: 'External', desc: 'Manage SMEs on the client side and relay requests through a portal.' }
    ],
    persona: [
      { persona: 'The engagement lead', needs: 'A record that answers with them: numbered baselines, named approvals, defensible change history.' },
      { persona: 'The subject-matter expert', needs: 'To weigh in once, on the record, from a link, without new software.' },
      { persona: 'The downstream builder', needs: 'Approved, testable requirements with fit criteria and permanent IDs.' },
      { persona: 'The procurement reviewer', needs: 'Isolated data, role-based access, an append-only audit log, and exportable records.' }
    ],
    release: [
      { rel: 'Phase 1 Relational core (shipped)', obj: 'Rebuild from key-value to relational: rev-checked fields, insert-based rows, server-numbered versions, migration.', mvp: 'shipped', ship: 'shipped' },
      { rel: 'Phase 2 Live collaboration (shipped)', obj: 'Presence, per-field conflict resolution, durable retried saves, live document follow, presentation mode.', mvp: 'shipped', ship: 'shipped' },
      { rel: 'Phase 3 Approvals & audit (shipped)', obj: 'Approval state machine with named sign-off, append-only activity trail, provenance trigger.', mvp: 'shipped', ship: 'shipped' },
      { rel: 'Phase 4 Sharing & brand (shipped)', obj: 'Section-scoped SME links, client portal, per-PRD brand logo, designed co-branded PDF, read-only presentation link.', mvp: 'shipped', ship: 'shipped' },
      { rel: 'Phase 5 Record health & client deliverable (shipped)', obj: 'Validated template starts, baseline-readiness signals, one-click promotion from discovery with source attribution, fingerprinted client baseline report.', mvp: 'shipped', ship: 'shipped' },
      { rel: 'Phase 6 SOC 2 Type II (next)', obj: 'Controls, evidence collection, and an independent Type II examination.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase 7 E-signature & sealing (next)', obj: 'Execute sign-off by e-signature and cryptographically seal each export to the exact baseline signed.', mvp: 'to confirm', ship: 'to confirm' }
    ],
    components: [
      { name: 'Relational core', owner: 'Engineering', status: 'Shipped', desc: 'Projects, fields, rows, versions; rev-checked RPCs; RLS; kv migration.' },
      { name: 'Live collaboration', owner: 'Engineering', status: 'Shipped', desc: 'Presence, conflict resolution, durable saves, live doc follow, presentation mode.' },
      { name: 'Approvals & audit', owner: 'Engineering', status: 'Shipped', desc: 'Approval state machine, named sign-off, append-only activity trail.' },
      { name: 'Sharing & brand', owner: 'Engineering', status: 'Shipped', desc: 'Section-scoped links, client portal, brand logo, designed PDF, presentation link.' },
      { name: 'Record health & deliverables', owner: 'Engineering', status: 'Shipped', desc: 'Template starts, readiness signals, discovery promotion with attribution, fingerprinted client baseline report.' },
      { name: 'SOC 2 compliance', owner: 'Security / Compliance', status: 'Planned', desc: 'Control set, evidence automation, independent Type II examination.' },
      { name: 'E-signature & sealing', owner: 'Engineering', status: 'Planned', desc: 'E-signature execution and cryptographic sealing of exports to their baseline.' }
    ],
    metrics: [
      { metric: 'Concurrent editors without lost writes', target: '9 or more', method: 'Multi-writer concurrency simulation against the rev-checked RPCs.' },
      { metric: 'Save durability', target: '100% confirmed or visibly failed', method: 'Every write awaited, retried on transient failure, surfaced in the save indicator.' },
      { metric: 'Approval integrity', target: 'no Approved while a sign-off is pending', method: 'Backend check on the version status state machine.' },
      { metric: 'Share scoping', target: 'zero internal fields in any external payload', method: 'Payload-build tests asserting fit criteria never appear.' },
      { metric: 'Backend regression suite', target: '290 checks green on every change', method: 'Embedded-Postgres end-to-end run in CI.' },
      { metric: 'SOC 2 Type II', target: 'certified (next phase)', method: 'Independent auditor report; published only when live.' },
      { metric: 'Sealed sign-off', target: 'export verifies to its exact baseline (next phase)', method: 'Cryptographic verification independent of the platform.' }
    ],
    fr: [
      { stmt: 'The platform stores every shared collection as rows so two people adding requirements at the same moment both persist with distinct permanent IDs.', fit: 'Nine simultaneous adds yield nine rows with unique requirement IDs. Test.', pri: 'Must', comp: 'Relational core' },
      { stmt: 'Every scalar field carries a revision; a save based on a stale revision is detected and resolved by name rather than silently overwriting.', fit: 'A stale write returns the current value and author; the loser is never destroyed silently. Test.', pri: 'Must', comp: 'Relational core' },
      { stmt: 'Version numbers are allocated server-side under a lock, and each baseline is an immutable snapshot with a change diff by requirement ID.', fit: 'Two managers generating at once produce distinct version numbers; diffs list added, modified, and removed by ID. Test.', pri: 'Must', comp: 'Relational core' },
      { stmt: 'Live presence shows who is editing which field, edits stream into the rendered document as they are typed, and every save is confirmed, retried on transient failure, or shown as failed.', fit: 'Two editors see each other’s presence and edits; a dropped network retries without loss. Demonstration and Test.', pri: 'Must', comp: 'Live collaboration' },
      { stmt: 'Approvals are a state machine (Draft, In review, Approved, Changes requested) with named approvers, and a version cannot read Approved while any approver is pending.', fit: 'Attempting to approve with a pending approver is refused; sign-off is stamped from the signed-in user. Test.', pri: 'Must', comp: 'Approvals & audit' },
      { stmt: 'An append-only audit trail records every version, status change, approval decision, build-tag change, and inbound submission with a name and timestamp, unmodifiable from the app; edit attribution is server-stamped on every field and row, and baselines are immutable snapshots.', fit: 'The activity log and the versions table refuse direct writes through the application role. Inspection and Test.', pri: 'Must', comp: 'Approvals & audit' },
      { stmt: 'Sharing is section-scoped and brand-carrying: SME review links, a client portal, and read-only presentation links, each showing only the sections the team selected and the assigned collaborator logo, never internal fields.', fit: 'An unselected section is absent from the share payload; fit criteria never appear. Test.', pri: 'Must', comp: 'Sharing & brand' },
      { stmt: 'Exports to PDF and Word carry a designed, co-branded cover with version, status, approval history, and revision record.', fit: 'A printed and a Word export both carry the cover metadata and the assigned logo. Demonstration.', pri: 'Must', comp: 'Sharing & brand' },
      { stmt: 'A read-only presentation link renders the branded record with no review form and no account, pointing at a specific published version so what a recipient opens is fixed.', fit: 'Any role can copy a link that opens the record read-only; it cannot be edited. Test.', pri: 'Must', comp: 'Sharing & brand' },
      { stmt: 'A new project can start from a validated template - product requirements, consulting engagement charter, or baseline assessment - whose fields load through the same rev-checked RPCs as live editing.', fit: 'Every template validates against the question bank, assembles into a well-formed document through the real builders, and applies scalars before rows in authored order. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'The record surfaces its own readiness - Must requirements without a fit criterion, missing AI evaluation where AI is declared, safeguarding gaps, unowned components, untagged requirements, an approved version with no published brief, versions in review or approved without named approvers, unresolved placeholders - and its accumulation: promoted inputs incorporated in the approved baseline, and the last client-visible change.', fit: 'Each signal is a deterministic predicate over the record; accumulation counts derive only from the latest approved snapshot. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'Discovery entries and inbox submissions promote in one click into numbered requirements or decisions, each back-linked to its source, and the next version note attributes additions to their origin.', fit: 'A promoted entry carries its FR-/DEC- id under the existing manager-only policy, and the generated change note names the source. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'A client baseline report composes the executive summary, exactly the client-safe brief content, and the revision record behind a cover carrying a SHA-256 fingerprint of the exact baseline, with the recipe restated on the document.', fit: 'The fingerprint recomputes identically from the stored snapshot, changes if any byte changes, and the report never carries fit criteria or internal fields. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'When a consulting engagement declares AI, acceptance criteria enter the charter as a numbered section with contiguous renumbering, and can be deliberately shared in a brief as dimension, metric, and threshold - while functional-requirement fit criteria remain internal absolutely.', fit: 'An engagement with AI assembles a contiguous 1..9 charter with acceptance as section 3; a default brief never carries thresholds; an opted-in brief carries dimension, metric, and threshold only. Test.', pri: 'Must', comp: 'Sharing & brand' },
      { stmt: 'The Changes view renders, for every modified requirement, the exact columns that changed with their prior and current text, so a version diff is evidence rather than a changelog.', fit: 'Per-column before and after is reported for FR, NFR, EVAL, and IR rows; bookkeeping keys never report as changes. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'A printed baseline carries the baseline\'s own date and, when approved, the date of the last sign-off; the print date is footer metadata, so two prints of one approved version read the same.', fit: 'Cover dates come from the version record and its approval decisions, not from the clock. Inspection.', pri: 'Must', comp: 'Sharing & brand' },
      { stmt: 'One click on a stored baseline produces the implementation package for the build team: requirements.json with permanent ids, statements, fit criteria, priority, component, promotion source, and attested recorder; acceptance.md as a testable checklist; CHANGES.md with per-column before-and-after against the prior baseline; the full document; and a README carrying the same SHA-256 fingerprint as the client baseline report - in a dependency-free, deterministic archive.', fit: 'The five files build purely from the stored snapshot, and the archive round-trips through an independent reader with recomputed CRC-32s and byte-identical output per baseline. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'A project opens on Record health once it has a baseline and on the document before one exists, and every workspace tab carries an ambient gaps count linking to Health.', fit: 'The landing rule is a pure function under test; the pill shows the deterministic signal count and is absent at zero. Test and Inspection.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'The client baseline report carries a Record of engagement: versions, named sign-offs, and the client\'s own inputs incorporated in this baseline, listed by permanent id and source. Counts only, every number pointing at rows; statements stay behind the share-scoping boundary.', fit: 'The block renders only when provided, lists ids with their sources, and caps at twelve with a remainder count. Test.', pri: 'Must', comp: 'Sharing & brand' },
      { stmt: 'A baseline can be generated as a named stage gate, and the record\'s readiness state at the moment of generation is stored inside the immutable snapshot - the gate name renders as the cover eyebrow and a workspace pill, and the cover and Verification section carry the stored state.', fit: 'snapshot.gate and snapshot.health ride inside the jsonb create_version stores verbatim; live signals remain derived and never stored; two prints of one baseline carry identical evidence. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'One click on a baseline produces the gate packet: gate name, criteria state at the baseline, the per-column change evidence since the prior baseline, the named approvals, and the fingerprint with its recipe - with honest fallbacks when the gate is unnamed or the baseline predates evidence capture.', fit: 'The packet composes purely from stored snapshots and prints through the existing cover; a soft gate, never a hard block. Test.', pri: 'Must', comp: 'Sharing & brand' },
      { stmt: 'A stage-gated engagement starter ships a gate plan - gate, criteria, deciding role, target date - as worksheet content that prints, diffs, and versions like content, entering the charter as a numbered section with contiguous renumbering while plain charters stay byte-identical.', fit: 'The gate plan validates against the question bank, applies through the rev-checked RPCs, and renumbers the charter deterministically in every shape. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'Every AI acceptance criterion is anchored to a named eval set with its sampling rule, and the signed thresholds travel machine-readable: the implementation package carries an acceptance block (id, dimension, metric, threshold, eval set) and the named approvals as record-state with the latest decision date, explicitly labeled so the fingerprint claim stays exact - the fingerprint covers the baseline, the approvals block reports the record.', fit: 'A threshold without a named set renders as to confirm on every surface; acceptance and approvals blocks appear in requirements.json only when their content exists. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'The platform earns SOC 2 Type II certification covering security, availability, and confidentiality.', fit: 'An independent auditor issues a Type II report; the claim is published only once the report is in hand. Independent audit.', pri: 'Should', comp: 'SOC 2 compliance' },
      { stmt: 'A manager sends a token-keyed signature request on an exact baseline; the signer\'s own browser verifies the stored fingerprint before signing; a typed name with recorded consent lands as a normal approval row with timestamp and audit trail; and the same link remains the signer\'s archive copy - a recorded electronic signature, stated plainly as not yet cryptographic sealing.', fit: 'The request lifecycle (create, context, sign, decline, revoke) is manager-gated and token-scoped; the approval row links both ways; direct table writes are revoked; every event lands in the activity trail. Test.', pri: 'Must', comp: 'E-signature & sealing' },
      { stmt: 'A blank record populates from pasted or uploaded documents through a deterministic mapper: headings segment, keywords classify, bullets and tables land in the right row shapes with their source stamped, unrecognized sections wait for a human decision, and a filled answer is never overwritten - previewed before a single write, applied through the same rev-checked path as typing.', fit: 'The mapper is pure and fully unit-tested; txt and md read exactly, docx converts to Markdown so headings and bullets classify, pdf extracts text lines; the plan reports every kept field; imported requirement rows carry Import provenance. Test.', pri: 'Must', comp: 'Relational core' },
      { stmt: 'A weekly client update publishes from the record: the asks, the movement, and the open items all derive from approvals, signatures, gates, health signals, and the activity trail; a manager picks and may reword, adds one editorial sentence and at most one stamped note, and publishes. Published updates are immutable at the grant, live forever at a token link, and withdrawable but never edited. No hand-maintained status register exists anywhere in the product.', fit: 'Every open item carries a derivation key; direct writes to the updates table are revoked; the token page renders the frozen payload; a withdrawn link says so. Test.', pri: 'Must', comp: 'Relational core' },
      { stmt: 'An SOW exhibit exports from any baseline: the acceptance table the client signs (dimension, metric, threshold, eval set), the functional and non-functional requirements with fit criteria and priorities, the recorded sign-offs, a signature table for the agreement, and the fingerprint with its recipe. Bracketed fields are for counsel; every other line derives from the record. The exhibit makes no claim beyond what the record contains.', fit: 'The exhibit renders the acceptance rows, requirement tables, and recorded sign-offs from the snapshot; carries the full SHA-256 and recipe; states plainly when no sign-offs exist; contains no tracker vocabulary. Test.', pri: 'Must', comp: 'Exports' },
      { stmt: 'A new record starts from documents as a first-class path: the creation screen offers Documents beside the starter templates; choosing it opens the project straight into Populate from documents, where the deterministic mapper previews exactly where every section lands and writes nothing without approval.', fit: 'The Documents chip renders on creation; the project opens with the intake panel open; the mapper, preview, and apply are the shipped intake engine unchanged. Test.', pri: 'Must', comp: 'Worksheet' },
      { stmt: 'A requirements list pastes into rows in bulk: a list or a table copied from Word or Excel parses through the same deterministic extraction as intake (named headers map, headerless tables read by content, MoSCoW letters expand, IDs stay as prefixes), previews the parsed rows, and adds them only on approval. Input is capped at 256 KB.', fit: 'An Excel-copied table with or without headers lands as rows with fit criteria and priorities; the preview states the count; nothing is added without the approve click; oversize input truncates. Test.', pri: 'Must', comp: 'Worksheet' },
      { stmt: 'The worksheet is keyboard-first for experts without hijacking typing: j and k walk the questions, Enter opens the current question, Alt+Enter adds a row to the question being edited, ? shows the shortcut sheet, and the command palette lists the recently edited questions on top.', fit: 'Accelerators fire only outside editable fields except the modifier chords; the recent list caps at eight; the sheet lists every shortcut. Test.', pri: 'Must', comp: 'Worksheet' },
      { stmt: 'One client email holds exactly one partner identity per workspace: a unique index on organization and lower-cased email, preceded by a merge that keeps the oldest row, lifts its login link and profile text from the rows it absorbs, unions their project grants, and repoints every note before deleting anything. The portal lists each project once regardless.', fit: 'A second identity for the same email in the same workspace is refused; the same email in another workspace is allowed; the merge leaves no note unattributed; the project list returns one card even with the index dropped and a duplicate present. Test.', pri: 'Must', comp: 'Client portal' },
      { stmt: 'A note and a discovery entry are each stamped with the baseline that was current when they were written, and every version card lists what was filed against it, read only. The stamp is metadata about a note and never content in a baseline: snapshots hold answers and sections only, and promotion stays the single path by which a note becomes part of the agreement.', fit: 'Discovery entries carry version_seq like comms; a later baseline does not re-stamp earlier notes; no note text appears in any snapshot; the version card offers no control that adds a note to a baseline. Test.', pri: 'Must', comp: 'Relational core' },
      { stmt: 'The published update link is a view onto the record: every pending and completed signature on its baseline, each opening its own signature page; read-only links to the baselines already published in presentation mode with the fingerprints already recorded; and a comment box that files a message attributed to the named recipient. It mints no tokens, computes no fingerprints, and authorizes nothing.', fit: 'Reading the panel creates no shares; a baseline with no recorded fingerprint returns empty rather than an invented one; a comment lands as an external-origin note filed at the baseline the update reported on and moves no version status, approval, or signature; a link issued to nobody refuses comments instead of filing them anonymously. Test.', pri: 'Must', comp: 'Relational core' },
      { stmt: 'Risks and issues are authored worksheet content - the risk or issue, its impact, a named owner, and a status the author picks - printing, diffing, versioning, and traveling in the baseline exactly like the gate plan. The platform never computes a rollup, a health verdict, or a project status from them.', fit: 'The rows render as a numbered charter section and travel in the snapshot; the status column is a fixed authored list carrying no RAG vocabulary; no derived aggregate over these rows exists anywhere in the product. Test.', pri: 'Must', comp: 'Record health & deliverables' },
      { stmt: 'Firm templates and clone-from-record start a new record from standing structure only: organization, document type, non-functional requirements, and the glossary; never client content. A manager saves and reviews templates; members apply them; every template shows its last-reviewed date at the moment of use. The server caps name length, payload size, and templates per organization; reads pass RLS; writes pass RPCs only.', fit: 'The whitelist holds on save and on apply; a member cannot write; an outsider sees nothing; the reviewed date renders on the creation chip; direct table writes are revoked. Test.', pri: 'Must', comp: 'Worksheet' },
      { stmt: 'Each export is cryptographically sealed to the exact baseline signed, so a sealed document verifies independently even if ReqPub is offline.', fit: 'A sealed export verifies against its baseline hash without the platform; tampering fails verification. Test.', pri: 'Should', comp: 'E-signature & sealing' }
    ],
    nfr: [
      { stmt: 'Racy writes flow only through server-side rev-checked RPCs; direct client writes to worksheet tables are revoked.', fit: 'The authenticated role cannot write project_fields or field_rows directly. Test.', pri: 'Must', comp: 'Relational core' },
      { stmt: 'Row-level security scopes every table to the organization, with the strictest policy on approvals and the audit trail.', fit: 'A rival-org user reads and writes nothing; approval provenance cannot be forged. Test.', pri: 'Must', comp: 'Approvals & audit' },
      { stmt: 'The frontend ships a Content Security Policy with no inline scripts and escapes every interpolation.', fit: 'A security review finds no script-injection vector. Inspection.', pri: 'Must', comp: 'Live collaboration' },
      { stmt: 'Every change ships with regression tests and the suite stays green (221 unit, 316 backend checks).', fit: 'CI runs both suites on every push. Test.', pri: 'Must', comp: 'Relational core' },
      { stmt: 'Version baselines are immutable at the table: direct insert, update, and delete are revoked from the application role, and the build tag moves only through a manager-gated, size-capped, audit-logged definer function.', fit: 'A project manager\'s direct UPDATE to snapshot, status, label, or created_at is refused at the grant; version_set_build refuses non-managers and oversized tags and writes an activity row. Test.', pri: 'Must', comp: 'Approvals & audit' },
      { stmt: 'Anonymous endpoints are rate-limited and input is size-capped.', fit: 'Flooding a share link is throttled; oversized input is rejected. Test.', pri: 'Should', comp: 'Sharing & brand' }
    ],
    interfaces: [
      { iface: 'Supabase backend', req: 'Postgres, Auth, RLS, Realtime, Storage, Edge Functions', fit: 'All data and auth flow through the managed backend. Inspection.', comp: 'Relational core' },
      { iface: 'GitHub Pages', req: 'Static hosting of the frontend at reqpub.com', fit: 'The site deploys from the main branch. Inspection.', comp: 'Live collaboration' },
      { iface: 'E-signature provider', req: 'Identity-bound signature execution with audit metadata (next phase)', fit: 'A sign-off records signer identity, intent, and timestamp. Test.', comp: 'E-signature & sealing' },
      { iface: 'Timestamp authority', req: 'RFC 3161 timestamping for sealed exports (next phase)', fit: 'A sealed export carries a trusted timestamp. Test.', comp: 'E-signature & sealing' }
    ],
    people: [
      { name: 'Micah Canfield', role: 'Owner; product direction and approvals' },
      { name: 'Collection Ventures team', role: 'Nine-person team stress-testing the platform as managers, viewers, client contacts, and SME reviewers' }
    ],
    glossary: [
      { term: 'Baseline', def: 'An immutable, numbered snapshot of the requirements at a point in time.' },
      { term: 'Rev-checked save', def: 'A write accepted only if it is based on the current revision of a field.' },
      { term: 'Section-scoped share', def: 'A published brief containing only the sections the team selected.' },
      { term: 'Presentation link', def: 'A fixed, read-only, branded view of a published version.' },
      { term: 'Fingerprint', def: 'SHA-256 over the canonical JSON of {label, seq, snapshot} for a version; identifies the exact baseline an export was produced from. Not a signature or timestamp.' },
      { term: 'Readiness signal', def: 'A deterministic gap computed from the record itself, such as a Must requirement without a fit criterion. Derived, never stored.' },
      { term: 'Client contact', def: 'The client-side portal role (schema name: partner): per-project access to published briefs, notes, and attachments.' },
      { term: 'Recorded by', def: 'The server-stamped identity of whoever last wrote a row - an attestation beside free-text claims like a decision\'s owner.' },
      { term: 'Sealed export', def: 'An export cryptographically bound to the exact baseline signed (next phase).' },
      { term: 'SOC 2 Type II', def: 'An independent examination of security controls over a period (next phase).' }
    ]
  }
};

/* ---- 3. Esign API (the e-signature execution and sealing service behind
        ReqPub sign-off, described from its OpenAPI surface) ---- */
export const esign = {
  id: 'prd-esign-api',
  name: 'Esign API',
  scalars: {
    ctrl_product: 'Esign API',
    ctrl_org: 'Collection Ventures',
    ctrl_owner: 'Micah Canfield',
    ctrl_status: 'In Review',
    ov_purpose: 'This document is the requirements record for the Esign API: the API-first electronic-signature service that executes sign-off and seals the result. It is written for the build team and the build agent, and it defines the envelope lifecycle, recipients and fields, the signing ceremony, assurance levels, the tamper-evident ledger, and independent bundle verification. It is the execution layer behind ReqPub sign-off and a standalone product. Where this record is silent, the build escalates to the owner rather than inventing scope.',
    ov_vision: 'A signature you can prove without trusting the vendor. Esign API takes a document from upload to a completed, cryptographically sealed bundle that any third party can verify offline. Every envelope carries a hash-chained ledger of who did what and when, and every completed bundle verifies against its own contents even if the service is gone. The promise: the proof outlives the platform.',
    ov_problem: 'E-signature is usually a black box: the audit trail lives on the vendor’s servers, and if the vendor disappears or is disputed, the proof is gone. Teams that answer to courts, auditors, and regulators need signatures whose integrity does not depend on the signing vendor staying online or trustworthy. They need an API they can embed, an assurance level they can choose, and a bundle that verifies on its own.',
    ov_market: 'Product and advisory teams that already collect approvals and now need legally executed, independently verifiable signatures: ReqPub sign-off first, then agencies, compliance-heavy SaaS, and institutional workflows (corrections, courts, employers) that must show an unbroken chain of custody. The buyer answers to a regulator or a court; the verifiable bundle is the artifact both sides trust.',
    context: 'A stateless FastAPI service over a managed Postgres backend and object storage. Documents are PDFs, fields are placed by page coordinate, and signatures are captured by draw, type, or click. The ledger is append-only and hash-chained. The API is the product surface (OpenAPI-documented); a thin hosted signing page is a client of it. Verification must never depend on the service being online.',
    sol_solution: 'One service with a clear spine: an issuer uploads a document; an envelope is created with recipients (each a role), fields (each a type placed on a page), and an assurance level; the envelope is sent by a delivery method; each recipient completes a signing ceremony (submit or decline) captured with method and consent; on completion the service seals a bundle (documents, fields, signatures, and the hash-chained ledger) with an RFC 3161 timestamp; and a public verify endpoint validates any bundle against its own contents. A self-sign path lets an issuer sign their own document in one call.',
    staged: 'Yes',
    has_ai: 'No',
    vulnerable: 'No',
    consent: 'Every signer is shown the document and an explicit electronic-signature consent (ESIGN and eIDAS intent-to-sign) before any signature is captured, and consent is recorded with the signature as a ledger event. A recipient may decline; a decline is a first-class, recorded outcome, not an error. No signature is captured without an affirmative act tied to the shown document hash.',
    retention: 'Envelopes, documents, fields, signatures, and ledger events are retained for the life of the account and any contracted legal-hold period. Completed bundles are immutable and independently verifiable; deleting an envelope preserves the sealed bundle hash and a ledger stub so previously issued proofs still verify. The audit ledger is append-only and retained per the records agreement.',
    residency: 'Documents and signatures are stored in the account’s configured region on managed Postgres and object storage. Signed bundles are content-addressed by hash. Timestamping is delegated to an RFC 3161 authority and the timestamp token is stored with the bundle. Cross-border processing for institutional channels is contracted per agreement.',
    access: 'Row-level security defaults to deny. An issuer reads only their own envelopes; a recipient reaches only the envelope and fields addressed to them, through a scoped signing token, never the issuer’s other envelopes. Signing tokens are single-purpose, expiring, and bound to one recipient on one envelope. The ledger is writable only by the service (append-only); verification is public and reads only the bundle presented to it. API keys are per-issuer and scoped.',
    verify_note: 'A release is accepted when every Must requirement passes its fit criterion in production, the RLS default-deny suite passes, and a sealed bundle verifies independently of the service with zero false-valids and zero false-invalids on the conformance set. Tampering with any byte of a sealed bundle must fail verification.',
    link_repo: 'to confirm',
    link_board: 'to confirm',
    link_design: 'to confirm'
  },
  lists: {
    ov_goals: [
      'Execute a signature from envelope to sealed bundle through the API with no human step beyond the signer.',
      'Make every completed bundle verify independently of the service, with zero false-valids.',
      'Offer a chosen assurance level per envelope, from basic click-to-sign to identity-verified signing.',
      'Record an unbroken, hash-chained ledger of every envelope event, tamper-evident on verify.',
      'Ship as ReqPub’s sign-off execution layer first, then as a standalone embeddable API.'
    ],
    sol_in: [
      'Envelope lifecycle: create from an uploaded document or with a file in one call, add recipients and fields, send, and track status to completion.',
      'Recipients with roles (signer, approver, viewer) and a routing order; fields placed by type and page coordinate.',
      'Signing ceremony: show the document and consent, capture a signature by draw, type, or click, or record a decline with a reason.',
      'A self-sign path for an issuer signing their own document in a single call.',
      'Assurance levels selectable per envelope, from basic to identity-verified.',
      'A hash-chained, append-only ledger and audit-event stream per envelope.',
      'A sealed, RFC 3161-timestamped completion bundle and a public verify endpoint that validates it offline.'
    ],
    sol_out: [
      'No AI: the service executes and seals signatures, it does not interpret documents.',
      'No in-house certificate authority or timestamp authority; both are delegated to accredited providers.',
      'No document editor; documents arrive as finished PDFs and fields are placed by coordinate.',
      'No open recipient accounts; recipients act through scoped, expiring signing tokens.',
      'No storage of raw government-ID images beyond the identity step that requires them.',
      'No claim of qualified (QES) status until the identity and certificate chain is independently accredited.'
    ],
    assume: [
      'Documents are provided as PDFs and field coordinates are supplied by the issuer or by ReqPub.',
      'An accredited RFC 3161 timestamp authority and, for higher assurance, an identity or KYC provider are available as managed services.',
      'ReqPub is the first integrator and drives the initial envelope and field shapes.'
    ],
    depend: [
      'Managed Postgres backend with row-level security, storage, and edge functions.',
      'Object storage for documents and sealed bundles, content-addressed by hash.',
      'An RFC 3161 timestamp authority for bundle sealing.',
      'An identity-verification provider for advanced and higher assurance levels.',
      'A delivery provider (email and SMS) for recipient notifications and signing links.'
    ],
    constrain: [
      'API-first: every capability is an OpenAPI-documented endpoint and the hosted signing page is a thin client of it.',
      'The ledger is append-only and hash-chained; no endpoint edits or deletes a past event.',
      'Verification depends only on the bundle, never on the live service (the offline rule).',
      'Every signer action binds to the exact document hash shown at signing.',
      'Signing tokens are single-recipient, single-envelope, and expiring.'
    ]
  },
  rows: {
    ctrl_approvers: [
      { role: 'Owner', name: 'Micah Canfield' },
      { role: 'CTO / Architecture', name: 'Alon Arad' },
      { role: 'Engineering lead', name: 'Erik Companhone' },
      { role: 'Security / Compliance', name: 'to confirm' }
    ],
    seg: [
      { segment: 'ReqPub sign-off', share: 'First integrator', desc: 'Executes and seals approval sign-off on a versioned baseline.' },
      { segment: 'Compliance-heavy SaaS', share: 'Primary', desc: 'Embed signing where an independent audit trail is required.' },
      { segment: 'Institutional workflows', share: 'Funded', desc: 'Courts, corrections, and employers needing a verifiable chain of custody.' }
    ],
    persona: [
      { persona: 'The integrator (issuer)', needs: 'A clean API to create an envelope, place fields, send, and get a sealed bundle back.' },
      { persona: 'The signer', needs: 'To see the document, consent, and sign by draw, type, or click from a link with no account.' },
      { persona: 'The auditor', needs: 'A bundle that verifies on its own, with an unbroken hash-chained ledger of every event.' },
      { persona: 'The compliance owner', needs: 'A chosen assurance level, recorded consent, and retention that satisfies the regulator.' }
    ],
    release: [
      { rel: 'Phase 0 Foundation', obj: 'Service skeleton, schema and RLS, storage, API keys, health, OpenAPI.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase 1 Envelope & documents', obj: 'Upload document, create envelope (and with-file), add recipients and fields, send.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase 2 Signing ceremony', obj: 'Consent, submit signature (draw/type/click), decline, status to completion, self-sign.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase 3 Ledger & sealing', obj: 'Hash-chained ledger, audit events, RFC 3161 sealed bundle, public verify.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Phase 4 Assurance', obj: 'Identity-verified signing and higher assurance levels; conformance verification set.', mvp: 'to confirm', ship: 'to confirm' }
    ],
    components: [
      { name: 'Envelope Service', owner: 'Erik Companhone', status: 'Planned', desc: 'Envelope lifecycle and status machine (draft, sent, completed, declined, voided, expired).' },
      { name: 'Document Store', owner: 'Andy Lan', status: 'Planned', desc: 'PDF upload, content-addressed storage, field placement by page coordinate.' },
      { name: 'Recipients & Fields', owner: 'Erik Companhone', status: 'Planned', desc: 'Recipient roles and routing order; typed fields placed per signer.' },
      { name: 'Signing Ceremony', owner: 'Huy Tran', status: 'Planned', desc: 'Consent, signature capture (draw/type/click), decline, self-sign, scoped tokens.' },
      { name: 'Ledger & Audit', owner: 'Alon Arad', status: 'Planned', desc: 'Append-only, hash-chained ledger and audit-event stream per envelope.' },
      { name: 'Sealing & Verify', owner: 'Alon Arad', status: 'Planned', desc: 'RFC 3161 timestamped bundle and public offline verification.' },
      { name: 'Assurance & Identity', owner: 'to confirm', status: 'Planned', desc: 'Assurance levels and identity verification for higher tiers.' },
      { name: 'API Platform', owner: 'Erik Companhone', status: 'Planned', desc: 'API keys, rate limits, OpenAPI, hosted signing page, webhooks.' }
    ],
    metrics: [
      { metric: 'Envelope completion rate', target: 'measured per issuer', method: 'Completed envelopes divided by sent, by integrator.' },
      { metric: 'Bundle verification correctness', target: 'zero false-valids, zero false-invalids', method: 'Conformance set of valid and tampered bundles run through verify.' },
      { metric: 'Seal integrity', target: '100% of completed bundles carry a valid RFC 3161 token', method: 'Inspection of sealed bundles.' },
      { metric: 'Sign submit latency', target: 'p95 under 500 ms', method: 'Server-acknowledged timing on the sign submit path.' },
      { metric: 'Ledger continuity', target: 'no broken hash chain in any envelope', method: 'Chain check across all ledger events.' },
      { metric: 'Signing-path availability', target: '99.9%', method: 'Measured uptime on the submit and verify endpoints.' }
    ],
    fr: [
      { stmt: 'An issuer uploads a PDF document and the service stores it content-addressed by hash, returning a document reference.', fit: 'An uploaded document is retrievable by reference and its stored hash matches the bytes. Test.', pri: 'Must', comp: 'Document Store' },
      { stmt: 'An issuer creates an envelope either from an already-uploaded document or by uploading a file in the same call.', fit: 'Both the create-from-reference and create-with-file paths yield an envelope in draft. Test.', pri: 'Must', comp: 'Envelope Service' },
      { stmt: 'An issuer adds recipients to an envelope, each with a role (signer, approver, viewer) and a routing order.', fit: 'Recipients persist with role and order; order governs when each is notified. Test.', pri: 'Must', comp: 'Recipients & Fields' },
      { stmt: 'An issuer places fields on a document, each with a type (signature, initials, date, text, checkbox) and a page and coordinate, assigned to a recipient.', fit: 'Every field renders at its page coordinate for the assigned signer only. Test and Demonstration.', pri: 'Must', comp: 'Recipients & Fields' },
      { stmt: 'Sending an envelope transitions it to sent, notifies the first recipients by the chosen delivery method, and issues each a scoped, expiring signing token.', fit: 'A sent envelope notifies recipients in routing order; each token opens only that recipient’s view. Test.', pri: 'Must', comp: 'Envelope Service' },
      { stmt: 'Before any signature, the signing ceremony shows the exact document and an explicit electronic-signature consent, and records the shown document hash.', fit: 'No signature is accepted without a recorded consent bound to the shown document hash. Test.', pri: 'Must', comp: 'Signing Ceremony' },
      { stmt: 'A signer submits a signature captured by draw, type, or click, and the service records the method, the field, the signer, and a timestamp.', fit: 'A submitted signature records its method and binds to the field and document hash. Test.', pri: 'Must', comp: 'Signing Ceremony' },
      { stmt: 'A recipient may decline to sign with a reason, and the decline is a recorded, first-class envelope outcome.', fit: 'A decline transitions the envelope to declined and appends a ledger event with the reason. Test.', pri: 'Must', comp: 'Signing Ceremony' },
      { stmt: 'An issuer may self-sign their own document in a single call, producing a completed, sealed envelope without an external recipient.', fit: 'A self-sign call returns a sealed bundle that verifies. Test.', pri: 'Must', comp: 'Signing Ceremony' },
      { stmt: 'The service records every envelope event (created, sent, viewed, signed, declined, completed) as an append-only, hash-chained ledger entry.', fit: 'Each ledger entry references the prior entry’s hash and no endpoint edits or deletes an entry. Inspection and Test.', pri: 'Must', comp: 'Ledger & Audit' },
      { stmt: 'On completion the service seals a bundle of the documents, fields, signatures, and ledger, and stamps it with an RFC 3161 timestamp.', fit: 'A completed envelope yields a bundle carrying a valid timestamp token. Test.', pri: 'Must', comp: 'Sealing & Verify' },
      { stmt: 'A public verify endpoint validates a submitted bundle against its own contents and hash chain, without reading live service state.', fit: 'A valid bundle verifies offline; a bundle with any byte altered fails; zero false-valids on the conformance set. Test.', pri: 'Must', comp: 'Sealing & Verify' },
      { stmt: 'Each envelope carries an assurance level, and the ceremony enforces the identity requirements of that level before capturing a signature.', fit: 'A higher-assurance envelope refuses to complete without the required identity step. Test.', pri: 'Should', comp: 'Assurance & Identity' },
      { stmt: 'The service serves an OpenAPI document and returns structured validation errors for malformed requests.', fit: 'The OpenAPI spec is served and a malformed request returns a 422 with field-level detail. Inspection and Test.', pri: 'Must', comp: 'API Platform' }
    ],
    nfr: [
      { stmt: 'Every recipient action flows through a single-recipient, single-envelope, expiring signing token; no recipient can reach another envelope.', fit: 'A token scoped to one recipient cannot read or act on any other envelope. Test.', pri: 'Must', comp: 'Signing Ceremony' },
      { stmt: 'Row-level security defaults to deny; an issuer reads only their own envelopes and the ledger is writable only by the service.', fit: 'A rival issuer reads and writes nothing; no client can append a forged ledger entry. Test.', pri: 'Must', comp: 'Ledger & Audit' },
      { stmt: 'Sealed bundles are immutable and content-addressed, and verification depends only on the bundle, never on live service state.', fit: 'A sealed bundle verifies with the service offline. Test.', pri: 'Must', comp: 'Sealing & Verify' },
      { stmt: 'The sign submit and verify paths hold 99.9 percent availability and submit is acknowledged at p95 under 500 ms.', fit: 'Measured uptime and latency meet the targets under load. Load test.', pri: 'Should', comp: 'API Platform' },
      { stmt: 'API keys are per-issuer and scoped, and anonymous signing endpoints are rate-limited and input size-capped.', fit: 'A flooded signing link is throttled and an oversized upload is rejected. Test.', pri: 'Must', comp: 'API Platform' }
    ],
    data_entities: [
      { entity: 'Envelopes', sens: 'Business; scoped to the issuing account' },
      { entity: 'Documents (PDFs)', sens: 'Confidential; content-addressed by hash' },
      { entity: 'Recipients', sens: 'Personal; name, email or phone, role' },
      { entity: 'Fields and placements', sens: 'Business; per-signer coordinates' },
      { entity: 'Signatures', sens: 'Personal and sensitive; method and mark, bound to the document hash' },
      { entity: 'Ledger and audit events', sens: 'Sensitive; append-only, hash-chained' },
      { entity: 'Sealed bundles', sens: 'Immutable; verify exposes integrity only' }
    ],
    interfaces: [
      { iface: 'Timestamp authority', req: 'RFC 3161 timestamping of sealed bundles', fit: 'Every completed bundle carries a valid timestamp token. Test.', comp: 'Sealing & Verify' },
      { iface: 'Identity verification', req: 'KYC or identity proofing for advanced and higher assurance', fit: 'A higher-assurance envelope cannot complete without a passed identity check. Test.', comp: 'Assurance & Identity' },
      { iface: 'Delivery (email and SMS)', req: 'Recipient notifications and signing links by the chosen delivery method', fit: 'A sent envelope reaches the recipient by the selected channel. Test.', comp: 'Envelope Service' },
      { iface: 'Object storage', req: 'Document and bundle storage, content-addressed by hash', fit: 'A stored object’s hash matches its address. Inspection.', comp: 'Document Store' },
      { iface: 'ReqPub', req: 'Create an envelope for a version and return a sealed sign-off to the record', fit: 'A ReqPub sign-off produces a sealed bundle referenced on the version. Test.', comp: 'API Platform' }
    ],
    people: [
      { name: 'Micah Canfield', role: 'Owner; decision authority on assurance, providers, and pricing' },
      { name: 'Alon Arad', role: 'CTO; sealing, ledger, and security posture' },
      { name: 'Erik Companhone', role: 'SWE lead; envelope, recipients and fields, API platform' },
      { name: 'Huy Tran', role: 'SWE; signing ceremony and hosted signing page' },
      { name: 'Andy Lan', role: 'SWE; document store and data model' }
    ],
    glossary: [
      { term: 'Envelope', def: 'The unit of signing: one or more documents, recipients, fields, and a status.' },
      { term: 'Recipient', def: 'A party on an envelope with a role (signer, approver, viewer) and a routing order.' },
      { term: 'Field', def: 'A typed input (signature, initials, date, text, checkbox) placed on a document for a signer.' },
      { term: 'Assurance level', def: 'The identity strength required to sign, from basic click to identity-verified.' },
      { term: 'Signature method', def: 'How a mark is captured: drawn, typed, or clicked.' },
      { term: 'Ledger', def: 'The append-only, hash-chained record of every envelope event.' },
      { term: 'Bundle', def: 'The sealed, timestamped package of documents, signatures, and ledger.' },
      { term: 'Self-sign', def: 'An issuer signing their own document in a single call.' },
      { term: 'Offline rule', def: 'A sealed bundle must verify without the service being online.' }
    ]
  }
};

/* ---- Fathering Baseline Assessment (Phase 1) ----
   The live deployment content, mapped section-for-section from
   FC-REQ-001 (Fathers.com Platform, Baseline Father Profile Assessment).
   Not part of PRDS: it is deployed by tools/gen-fathering-deploy.mjs into the
   existing Fathering project as an approved v1.1, not seeded as an example. */
export const fatheringBaseline = {
  id: 'prd-fathering-baseline',   // fallback id only; the deploy rebuilds the existing project in place
  name: 'Fathering Baseline Assessment',
  scalars: {
    ctrl_product: 'Fathering Baseline Assessment',
    ctrl_org: 'National Center for Fathering',
    ctrl_owner: 'Micah Canfield',
    ctrl_status: 'Approved',
    ov_purpose: 'This document specifies the requirements for the Fathers.com Platform. Its first phase delivers the Baseline Father Profile Assessment, the validated self-report instrument that gives a father an objective starting point and a plan. It is the authoritative record of what Phase 1 must do and how acceptance is judged. Its audience is the product owner, the engineering team, the data and privacy reviewer, and the sponsor at the National Center for Fathering, together with the review and traceability process managed in ReqPub. Part I states the product without implementation detail; Part II states the requirements, each with a measurable fit criterion.',
    ov_vision: 'Fathers.com equips any father to become measurably more present. It replaces vague encouragement with a validated baseline, a clear growth focus, and a personalized ninety-day plan, delivered at no cost by a nonprofit and available on any phone. Over time the platform extends into classes, certificates, peer circles, and programs for specific fathers, but the baseline is the front door: the moment a man learns where he actually stands and what to do next.',
    ov_problem: 'Father absence and disengagement carry well-documented costs to children, and most fathers who want to do better have no objective, non-judgmental way to know where they stand or what specifically to change. Advice is generic, self-assessment is guesswork, and formal instruments are locked inside clinical or academic settings. The Baseline Father Profile Assessment closes that gap by giving any father a private, validated read on four dimensions of engaged fatherhood and a concrete plan built from his own result. It matters now because the instrument exists, the delivery platform is built, and the reach of a nonprofit with established distribution makes scale realistic.',
    ov_market: 'The addressable population is the tens of millions of fathers of minor children in the United States, reached both directly and through the National Center for Fathering’s existing channels: faith communities, employers, fatherhood programs, and public agencies. The instrument’s value as an objective, court-neutral baseline also opens referral channels where an accountable, verifiable starting point is useful. Phase 1 targets the direct-to-father and partnered-group segments, where friction is lowest and the baseline stands on its own.',
    context: 'The assessment runs in a web browser on a phone, tablet, or desktop, with no app install. Fathers frequently take it on a personal phone over a mobile connection, in a single sitting or across a short break, so the flow must be responsive, resumable, and tolerant of intermittent connectivity. Because the content is personal and self-reflective, the setting is assumed private to the father, and the platform never exposes one father’s data to another.',
    sol_solution: 'The Baseline Father Profile Assessment is the delivery of the Keystone Father Profile: a validated self-report instrument that measures four domains of engaged fatherhood, Involvement, Consistency, Awareness, and Nurturance. A father answers a fixed set of items on a defined response scale. A deterministic scoring engine converts those responses into a score for each domain on a common 0 to 100 scale, a single overall baseline, the father’s strongest domain, and his growth focus, which is the domain with the largest opportunity to improve. From the growth focus the platform generates a ninety-day plan. The result and plan are private to the father. The core of the product is a measurement, not a generative guess: scoring is a fixed function of the responses and a versioned scoring model, so the same responses under the same model always produce the same result, which is what makes a baseline defensible. The model is architected as configuration plus a pure scoring function, kept strictly separate: the item bank, domains, scales, key directions, optional weights, normalization parameters, growth-focus rule, and plan mapping are one versioned configuration object that changes scoring with no code deployment and a full audit record; scoring is a pure function of (responses, model version); and every stored result carries the item-bank and model versions used, so a result computed a year ago can still be explained, recomputed, and defended.',
    staged: 'Yes',
    has_ai: 'Yes',
    golden: 'The golden dataset pairs computed results with the facts a correct summary must and must not state, curated from vetted sources. An automated harness runs each candidate build against it and reports grounding, accuracy, latency, and guardrail metrics; a build below any EVAL threshold does not ship. A red-team set probes for hallucination, unsafe handling of distress, and sycophancy, with human review before and after release. This method applies to any release that introduces a generative result summary (FR-027); Phase 1 scoring itself is deterministic and verified by test against labeled fixtures, not by evaluation.',
    vulnerable: 'Yes',
    safeguard: 'If a father’s responses meet a defined distress signal (to confirm), the system surfaces a non-clinical support resource without blocking the father and without diagnosing; no diagnostic language appears. The response is verified by demonstration and red-team review, and reviewed by a clinical or policy owner. The product makes no clinical diagnosis, label, or treatment recommendation anywhere.',
    consent: 'The platform obtains and records informed consent, with a timestamp, before it collects any assessment response; no response is stored without it. Individual results are never sold or shared with any third party; sharing an individual result to a referring organization requires a separate, explicitly specified consent flow that is out of scope for Phase 1.',
    retention: 'A father can delete his assessment data at any time; on confirmed request his responses, results, and plan are removed and the removal is confirmed. Retention beyond deletion follows a stated policy (to confirm). A father can retake the assessment, producing a new dated result without overwriting prior ones, and can view his result history.',
    residency: 'Assessment data is classified and handled as sensitive personal data. Personal data is encrypted in transit (TLS) and at rest. Data is stored in the region defined by the residency requirement (to confirm).',
    access: 'A father’s responses, scores, and plan are private to his account and readable only by it; per-father isolation is enforced by row-level security at the database, not only the interface, so cross-account reads are denied even on direct database access. Administrators see only aggregate participation and score distributions, never an individual father’s answers or scores; any authorized access to individual data is logged. The platform does not knowingly process the data of minors.',
    verify_note: 'Every requirement carries a fit criterion. Deterministic requirements are verified by test, inspection, or demonstration. Probabilistic or AI components are verified by evaluation against a golden dataset with the stated threshold. Safety requirements are verified on a red-team or scenario set with human review. Phase 1 is accepted when every Must requirement passes its fit criterion and every applicable evaluation criterion meets its threshold.',
    link_repo: 'to confirm',
    link_board: 'to confirm',
    link_design: 'FORGE design system, on the production platform'
  },
  lists: {
    ov_goals: [
      'G1. Give a father a valid, private baseline across the four fatherhood domains in a single sitting of about twenty minutes.',
      'G2. Translate every baseline into a concrete ninety-day plan mapped to the father’s largest growth opportunity.',
      'G3. Protect the father’s data absolutely: private to his account, never sold, his to delete.',
      'G4. Deliver the assessment reliably on a phone with no app install and minimal friction.',
      'G5. Make scoring reproducible and auditable, so a result can be explained and defended under scrutiny.'
    ],
    sol_in: [
      'Capturing informed consent and creating or signing in to a father’s account.',
      'Presenting the assessment items and capturing responses, with pause and resume.',
      'Deterministic scoring: domain scores, overall baseline, strength, and growth focus.',
      'Generating and presenting a ninety-day plan mapped from the growth focus.',
      'Private storage of results and plan, result history, retake, and self-service deletion.',
      'Loading the item bank and scoring model from versioned configuration.',
      'Administrator visibility into aggregate participation and score distributions only.'
    ],
    sol_out: [
      'Classes, certificates, peer circles, the veterans program, e-signature, and payments. These are later phases and are not specified here.',
      'Any clinical diagnosis, label, or treatment recommendation. The assessment is a developmental baseline, not a clinical instrument.',
      'Coaching by a human, live chat, or case management.',
      'Sharing an individual father’s results with any third party, including a referring organization, without a separate, explicitly specified consent flow.',
      'Non-English localization in Phase 1.'
    ],
    assume: [
      'The Keystone Father Profile is a validated instrument with an established item bank and scoring model, owned by a psychometric authority who signs off on any change.',
      'Fathers self-report in good faith; the instrument’s design, not enforcement, handles ordinary response bias.',
      'Fathers are adults; the platform does not knowingly collect data from minors.',
      'A father completes the assessment on a single account he controls.'
    ],
    depend: [
      'Supabase for authentication, the Postgres database, row-level security, and file storage.',
      'Vercel for hosting and delivery of the web application.',
      'A transactional email provider for passwordless sign-in links.',
      'The versioned item bank and scoring model, maintained by the psychometric owner.'
    ],
    constrain: [
      'Nonprofit budget and a static-site-plus-Supabase architecture; no bespoke server infrastructure in Phase 1.',
      'Consent and privacy obligations for sensitive personal data.',
      'Accessibility to WCAG 2.1 AA.',
      'No clinical diagnosis or claim may be made by the product.',
      'English only in Phase 1.'
    ]
  },
  rows: {
    ctrl_approvers: [
      { role: 'Product', name: 'Micah Canfield' },
      { role: 'Engineering', name: 'Alon Arad' },
      { role: 'Data and Privacy', name: 'to confirm' },
      { role: 'Sponsor', name: 'Dr. Ken Canfield' }
    ],
    seg: [
      { segment: 'Individual fathers', share: 'Primary', desc: 'A father seeking an honest read on his fathering and a plan to improve.' },
      { segment: 'Partnered groups', share: 'High', desc: 'Churches, teams, and fatherhood programs that run the baseline with their men.' },
      { segment: 'Referred fathers', share: 'Medium', desc: 'Fathers directed by a program or agency who need an objective starting point.' },
      { segment: 'Administrators', share: 'Enabling', desc: 'National Center for Fathering staff who steward content and see aggregate results only.' }
    ],
    persona: [
      { persona: 'The growth-minded father', needs: 'An honest, private read on where he stands, and a small number of concrete next steps he can actually keep.' },
      { persona: 'The referred father', needs: 'A neutral, non-judgmental starting point that respects his privacy and does not feel like a test he can fail.' },
      { persona: 'The group leader', needs: 'A simple way for the men in his group to take the baseline, and a way to see participation without seeing anyone’s answers.' },
      { persona: 'The content steward', needs: 'Confidence that the instrument and its scoring are correct, versioned, and changeable without a code release.' }
    ],
    release: [
      { rel: 'Phase 1 Baseline Assessment (MVP)', obj: 'A father can consent, take the assessment, receive a scored baseline and a ninety-day plan, and manage his own data.', mvp: 'to confirm', ship: 'to confirm' },
      { rel: 'Later phases (context only)', obj: 'Classes and the learning library, verifiable certificates, peer circles, and audience-specific programs. Each carries its own requirements document and is out of scope here.', mvp: 'to confirm', ship: 'to confirm' }
    ],
    metrics: [
      { metric: 'Assessment completion rate', target: '≥ 70% of starters finish (to confirm)', method: 'Ratio of completed to started assessments, from lifecycle events.' },
      { metric: 'Time to complete', target: 'Median ≤ 20 minutes', method: 'Elapsed time from first item to completion, from lifecycle events.' },
      { metric: 'Scoring correctness', target: '100% agreement with the reference model on golden fixtures', method: 'Automated scoring tests against labeled fixtures on every release.' },
      { metric: 'Plan generation', target: '100% of completed baselines produce a matched plan', method: 'Automated test; monitored rate of completions without a plan, target zero.' },
      { metric: 'Privacy incidents', target: 'Zero cross-father data exposure', method: 'Access-control tests and incident log.' }
    ],
    fr: [
      { stmt: 'A father creates an account or signs in before any result is stored.', fit: 'An authenticated session exists and each stored result is bound to that account. Test.', pri: 'Must' },
      { stmt: 'The system records informed consent before it collects any assessment response.', fit: 'A consent record with a timestamp exists before the first item is answered; no response is stored without it. Test.', pri: 'Must' },
      { stmt: 'The system presents the assessment as the set of items defined by the active item-bank version, in the defined order.', fit: 'The items presented match the active item-bank version in identity, count, and order. Test.', pri: 'Must' },
      { stmt: 'Each item captures a response on the item’s defined response scale.', fit: 'A response within the defined scale is captured and stored per item; required items cannot be left blank. Test.', pri: 'Must' },
      { stmt: 'A father can pause and later resume without losing responses.', fit: 'On resume, previously captured responses are restored and the father continues from the next unanswered item. Test.', pri: 'Must' },
      { stmt: 'The system shows progress through the assessment.', fit: 'A progress indicator reflects answered items over total items and updates as items are answered. Test.', pri: 'Should' },
      { stmt: 'The system computes a score for each of the four domains from the item responses per the scoring model.', fit: 'For each labeled fixture, the four domain scores equal the reference values. Test.', pri: 'Must' },
      { stmt: 'Reverse-keyed items are reverse-scored before aggregation.', fit: 'For a fixture containing reverse-keyed items, the computed domain scores equal the reference values. Test.', pri: 'Must' },
      { stmt: 'Each domain score is normalized to a common 0 to 100 scale.', fit: 'Every domain score lies within 0 to 100 and equals the reference normalized value for each fixture. Test.', pri: 'Must' },
      { stmt: 'The system computes a single overall baseline as the defined composite of the domain scores.', fit: 'For each fixture, the overall baseline equals the reference composite. Test.', pri: 'Must' },
      { stmt: 'The system identifies the growth focus as the domain with the largest opportunity per the scoring model.', fit: 'For each fixture, the identified growth focus equals the reference selection, including the defined tie-break. Test.', pri: 'Must' },
      { stmt: 'The system identifies the father’s strongest domain.', fit: 'For each fixture, the identified strength equals the reference selection. Test.', pri: 'Should' },
      { stmt: 'The system generates a ninety-day plan mapped from the growth focus.', fit: 'The plan returned for a given growth focus equals the plan configured for that domain. Test.', pri: 'Must' },
      { stmt: 'The results view presents the four domain scores, the overall baseline, the strength, the growth focus, and the plan.', fit: 'Every presented value equals the corresponding stored result value. Inspection and test.', pri: 'Must' },
      { stmt: 'A father’s result and plan are readable only by that father’s account.', fit: 'A request from any other account for the result is denied by row-level security. Test.', pri: 'Must' },
      { stmt: 'A father can retake the assessment, producing a new result without overwriting a prior one.', fit: 'A retake creates a new dated result; prior results remain retrievable. Test.', pri: 'Should' },
      { stmt: 'Each stored result records the item-bank version and scoring-model version used.', fit: 'Every stored result carries both version identifiers. Test.', pri: 'Must' },
      { stmt: 'The assessment is completable on a mobile browser.', fit: 'The full flow, from consent to results, completes on a 375-pixel-wide viewport. Test.', pri: 'Must' },
      { stmt: 'A father can view his result history.', fit: 'Prior results are listed by date and each can be opened. Test.', pri: 'Could' },
      { stmt: 'A father can delete his assessment data.', fit: 'On confirmed request, the father’s responses, results, and plan are removed and the removal is confirmed. Test.', pri: 'Must' },
      { stmt: 'If a father’s responses meet a defined distress signal (to confirm), the system surfaces support resources without blocking or diagnosing.', fit: 'On the defined signal, a non-clinical support resource is shown and the father may continue; no diagnostic language appears. Demonstration and red-team review.', pri: 'Should' },
      { stmt: 'The item bank and scoring model are loaded from versioned configuration, not embedded in code.', fit: 'Publishing a new configuration version changes items or scoring with no code deployment, and the change is recorded. Inspection and test.', pri: 'Must' },
      { stmt: 'An administrator sees only aggregate participation and score distributions, never an individual father’s answers or scores.', fit: 'Administrator views return counts and aggregates; individual raw responses and scores are not returned. Test.', pri: 'Must' },
      { stmt: 'The system records assessment lifecycle events: started, completed, scored.', fit: 'Each event is recorded with a timestamp for the father’s own record and for aggregate metrics. Test.', pri: 'Should' },
      { stmt: 'On completion the system shows a confirmation and a path to the result.', fit: 'A confirmation is shown and the result is reachable from it. Test.', pri: 'Must' },
      { stmt: 'The product presents no clinical diagnosis, label, or treatment recommendation.', fit: 'No output asserts a diagnosis; results and plan language pass a documented content review. Inspection.', pri: 'Must' },
      { stmt: 'An optional plain-language summary of the result may be generated; if produced by a generative model it is grounded to the father’s computed scores.', fit: 'The summary states no score or fact that contradicts the computed result; verified per EVAL-001. Evaluation.', pri: 'Should' }
    ],
    nfr: [
      { stmt: 'The application responds to a user action within 2 seconds at the 95th percentile.', fit: 'Measured response time is under 2 seconds at the 95th percentile. Test.', pri: 'Must' },
      { stmt: 'Scoring is deterministic and reproducible.', fit: 'The same responses under the same scoring-model version always produce identical scores. Test.', pri: 'Must' },
      { stmt: 'Personal data is encrypted in transit and at rest.', fit: 'All transport uses TLS; data at rest is encrypted by the platform. Inspection.', pri: 'Must' },
      { stmt: 'Per-father data isolation is enforced at the database, not only the interface.', fit: 'Row-level security denies cross-account reads even on direct database access. Test.', pri: 'Must' },
      { stmt: 'The assessment and results meet WCAG 2.1 AA.', fit: 'An accessibility audit records no Level A or AA violations on the assessment and results flow. Inspection.', pri: 'Must' },
      { stmt: 'The interface is usable on small screens.', fit: 'All controls are operable and legible at a 360-pixel width. Test.', pri: 'Must' },
      { stmt: 'No response is lost across a pause, refresh, or transient disconnect.', fit: 'After each event, all prior responses are present on resume. Test.', pri: 'Must' },
      { stmt: 'Service availability meets the stated target.', fit: 'Monthly availability at or above 99.5% (to confirm), from uptime monitoring.', pri: 'Should' },
      { stmt: 'The system supports the target concurrent load.', fit: 'The assessment completes within performance targets at (to confirm) concurrent fathers. Test.', pri: 'Should' },
      { stmt: 'The item bank and scoring model are maintainable as data.', fit: 'A change to items or scoring is made and released by editing versioned configuration only. Inspection.', pri: 'Must' },
      { stmt: 'Scoring-model and item-bank changes are auditable.', fit: 'Every configuration version records who changed it, when, and what changed. Inspection.', pri: 'Must' },
      { stmt: 'The application runs on current evergreen browsers.', fit: 'The flow passes on the current and prior major versions of the supported browsers. Test.', pri: 'Should' },
      { stmt: 'Non-English localization.', fit: 'N/A for Phase 1. English only.', pri: "Won't" }
    ],
    eval: [
      { dim: 'Grounding to the computed result', metric: 'Share of generated summaries whose stated scores and facts are numerically consistent with the father’s computed result, on the golden set. Automated numeric-consistency check.', thresh: '100% (zero fabricated or contradictory scores)', exec: 'Agent' },
      { dim: 'No clinical or diagnostic claim', metric: 'Count of summaries asserting a diagnosis, disorder, or clinical label on a labeled adversarial set. Classifier plus human review.', thresh: '0 violations', exec: 'Mixed' },
      { dim: 'Safety on distress inputs', metric: 'Count of unsafe or harmful outputs on a red-team set of distress-indicating results. Human review.', thresh: '0 unsafe outputs' },
      { dim: 'No sycophancy against the data', metric: 'Count of summaries that affirm a father’s incorrect self-characterization in contradiction of his scores, on an adversarial set. Human review.', thresh: '0 (to confirm)' }
    ],
    data_entities: [
      { entity: 'Father accounts', sens: 'Personal; identity and sign-in only' },
      { entity: 'Assessment responses', sens: 'Sensitive personal data; strictest row-level security' },
      { entity: 'Domain scores, overall baseline, strength, growth focus', sens: 'Sensitive; private to the father' },
      { entity: 'Ninety-day plan', sens: 'Personal; private to the father' },
      { entity: 'Consent records', sens: 'Personal; separate, timestamped, before collection' },
      { entity: 'Lifecycle events (started, completed, scored)', sens: 'Personal for the father; aggregated for metrics' },
      { entity: 'Aggregate participation and score distributions', sens: 'Aggregate only; the sole administrator view' }
    ],
    interfaces: [
      { iface: 'Platform identity', req: 'Authenticate fathers through the platform identity system (passwordless link or password)', fit: 'Authentication succeeds through the identity system. Test.' },
      { iface: 'Transactional email', req: 'Deliver passwordless sign-in links', fit: 'A requested sign-in link is delivered and functions. Test.' },
      { iface: 'Platform database', req: 'Persist results and responses with row-level security', fit: 'Data is written and read only within the father’s access scope. Test.' },
      { iface: 'Hosting platform', req: 'Deliver the web application from the production host', fit: 'The application loads and functions from the production host. Demonstration.' },
      { iface: 'Configuration source', req: 'Read the active item bank and scoring model at runtime', fit: 'The active configuration version is loaded and identified on each result. Inspection.' },
      { iface: 'Analytics', req: 'Record product and usage lifecycle telemetry (destination to confirm)', fit: 'Lifecycle events are recorded to the analytics destination. Test.' },
      { iface: 'Generative summary service', req: 'If used, integrate behind a server boundary that holds its credentials', fit: 'No model credential is present in the browser; the summary is requested through a server function. Inspection.' }
    ],
    people: [
      { name: 'Micah Canfield', role: 'Product owner' },
      { name: 'Alon Arad', role: 'Engineering' },
      { name: 'to confirm', role: 'Data and privacy reviewer' },
      { name: 'Dr. Ken Canfield', role: 'Sponsor, National Center for Fathering' },
      { name: 'to confirm', role: 'Psychometric owner of the instrument and scoring model' }
    ],
    glossary: [
      { term: 'Baseline', def: 'A father’s scored starting point across the four domains, plus the overall composite.' },
      { term: 'Domain', def: 'One of the four measured dimensions: Involvement, Consistency, Awareness, Nurturance.' },
      { term: 'Growth focus', def: 'The domain with the largest opportunity to improve; drives the plan.' },
      { term: 'Keystone Father Profile', def: 'The validated instrument delivered by the Baseline Father Profile Assessment.' },
      { term: 'Fit criterion', def: 'The measurable condition that defines acceptance of a requirement.' },
      { term: 'Golden dataset', def: 'A trusted, labeled set of inputs and expected outcomes used to verify probabilistic components.' },
      { term: 'Row-level security', def: 'Database rules that restrict each row to its owner, enforced below the interface.' },
      { term: 'MoSCoW', def: 'Priority scheme: Must, Should, Could, Won’t.' },
      { term: 'Item bank', def: 'The versioned set of assessment items and their scoring attributes.' },
      { term: 'Reverse-keyed item', def: 'An item whose scale is inverted before aggregation.' }
    ]
  }
};

export const PRDS = [fathering, reqpub, esign];
