/* ============================================================================
   ReqPub v2 - the starter help library
   Authored for one persona: a requirements or engagement manager running
   client work under a senior partner, opening this platform for the first
   time. Built on the instructional doctrine the help system was researched
   on: task-oriented minimalism. Verb-first titles, one job per topic, short
   declarative bodies, the reason before the mechanism, and an explicit next
   action. Walkthroughs never exceed five steps and anchor only to registry
   keys. Managers load this library from Help Studio and then own every
   word: it seeds as ordinary editable topics, nothing special about them.
   ========================================================================= */

export const HELP_LIBRARY = [
  {
    title: 'Start here: what this platform is',
    routes: ['*'], audience: 'all', sort_order: 10,
    body_md: 'ReqPub produces one thing: a signed, versioned record of what was agreed. You author everything. The platform computes nothing, grades nothing, and never edits your words.\n\nThe loop you will live in: fill the worksheet, generate a baseline, collect approvals, share the link, publish a weekly update. Every artifact carries a fingerprint so anyone can verify it later, offline, forever.\n\n**Do next.** Open a project and read its Health tab. It shows what the record still needs, and every signal clears the moment you fix the gap.',
    steps: [],
  },
  {
    title: 'Create your first record',
    routes: ['projects'], audience: 'all', sort_order: 20,
    body_md: 'Name it, pick a starting point, press New project.\n\n**Blank** starts the guided worksheet from the first question. **Product requirements** and **Consulting engagement** preload the right section set. **Documents** builds the record from files you already have. **Clone** copies a finished record\u2019s structure.\n\nNothing you pick here is permanent except the name. Document type can change on the worksheet, and sections appear and disappear based on your answers.',
    steps: [
      { anchor_key: 'projects.new', title: 'Name it and create', body_md: 'Type the product or engagement name, pick a starting point below, then press this button.' },
    ],
  },
  {
    title: 'Build the worksheet fast: paste what already exists',
    routes: ['workspace'], audience: 'all', sort_order: 30,
    body_md: 'Do not re-key a document that already exists in Word, Excel, or PDF text. Paste it.\n\nThe intake mapper reads headings and places content into the right sections: requirements with IDs and fit criteria land as rows, lists land as lists, prose lands in its section. Anything it cannot place with confidence waits in a review tray for you to place by hand. Unplaced beats misplaced, and nothing you already wrote is ever overwritten.\n\n**Do next.** Open a section, paste a block of source text, and review what landed before accepting.',
    steps: [],
  },
  {
    title: 'The two lenses: Specification and Delivery',
    routes: ['workspace'], audience: 'all', sort_order: 40,
    body_md: 'One record, two working views.\n\n**Specification** holds what you are building: overview, users, requirements, verification. **Delivery** holds how the engagement runs: phase, objectives and key results, risks and issues, weekly updates.\n\nSwitch lenses at the top of the worksheet. Same record underneath, so nothing is duplicated and nothing can drift.',
    steps: [
      { anchor_key: 'ws.lens', title: 'Switch the lens', body_md: 'Specification for the what, Delivery for the how. Click to switch. The record underneath is one.' },
    ],
  },
  {
    title: 'Run the engagement: phase, OKRs, risks',
    routes: ['workspace'], audience: 'all', sort_order: 50,
    body_md: 'On the Delivery board, three structures carry the engagement.\n\n**Engagement phase** states where the work stands. Advancing it offers, never performs, a one-click tag of finished key results to the phase you are leaving, so history stays under its tab.\n\n**Objectives and key results** are the outcomes. Mark a key result Done yourself; the platform never marks it for you. A blank phase means the current one.\n\n**Risks and issues** carry a permanent ID stamped with the phase letter, a status you author, and an owner by name. Rows feed the weekly update exactly as written.',
    steps: [
      { anchor_key: 'ws.phase', title: 'The phase control', body_md: 'Set where the engagement stands. Changing it offers to tag done key results to the phase being left. Your click, your call.' },
    ],
  },
  {
    title: 'Generate a baseline, and what the fingerprint means',
    routes: ['workspace'], audience: 'all', sort_order: 60,
    body_md: 'A baseline freezes the record at a version number. From that moment the document, its fingerprint, and everything a client sees from it render from the frozen snapshot, not the working draft.\n\nThe fingerprint is a hash of the exact content. Anyone holding the document can recompute it and confirm nothing changed, without an account, without this platform even existing. That is the product: an agreement that can be verified later by someone who trusts nobody.\n\n**Do next.** When the Health tab shows zero gaps, generate. Approvals and signatures bind to baselines, never to drafts.',
    steps: [
      { anchor_key: 'ws.generate', title: 'Generate the version', body_md: 'Freezes the record as the next version. Approvals, signatures, and client links bind to this, not to the draft.' },
    ],
  },
  {
    title: 'Collect approvals and signatures',
    routes: ['workspace'], audience: 'all', sort_order: 70,
    body_md: 'Approvals are roles you define on the worksheet: Owner, Product, Architecture, whoever must sign off. Each approval is recorded against a specific version and stamped to whoever records it.\n\nFor a binding signature, send an e-sign request from the version. The signer gets a link, signs on screen, and the signed record carries their name, the timestamp, and the fingerprint they signed. Signatures bind baselines and stage gates only. Nothing is ever signed weekly by design; scarcity is what keeps a signature worth something.',
    steps: [],
  },
  {
    title: 'Share with your client, and what they can see',
    routes: ['workspace'], audience: 'all', sort_order: 80,
    body_md: 'Share issues a link, and the link is the whole client experience: no account, no login, no app.\n\nA document link renders the baseline you chose. A weekly update link renders exactly the board you published. Issue links to a named person and their notes and questions come back attributed to your inbox; a link issued to nobody is read only, because an unattributed post on the record is worse than none.\n\nRevoke a link and it dies everywhere, immediately. What you shared stays in the record\u2019s history.',
    steps: [
      { anchor_key: 'doc.share', title: 'Share from here', body_md: 'Pick the version, name the recipient, send the link. Named recipients can write back; anonymous links read only.' },
    ],
  },
  {
    title: 'The weekly update loop',
    routes: ['workspace'], audience: 'all', sort_order: 90,
    body_md: 'Once a week, tell the client what happened, in your own words, frozen at publish.\n\nCompose pulls the current board: phase, key results, risks with their IDs and statuses. You author the Key Updates and Key Questions lines yourself. Set the recipient by name. Publish, and the link renders that exact board forever; next week\u2019s update is a new link, and the archive keeps them all.\n\nA published update is evidence. There is no delete, only withdraw, which keeps it on the record and marks it withdrawn.',
    steps: [
      { anchor_key: 'doc.updates', title: 'Open the Updates tab', body_md: 'The weekly loop lives here. Open it, press Compose: it pulls the board as it stands, you author the key lines, set the recipient, publish. Frozen at publish, forever.' },
      { anchor_key: 'ws.phase', title: 'Check the phase first', body_md: 'The update leads with the phase. Confirm it states where the work actually stands before you publish.' },
    ],
  },
  {
    title: 'Read the Health tab like a pilot, not a report card',
    routes: ['workspace'], audience: 'all', sort_order: 100,
    body_md: 'Health is a preflight checklist, computed fresh every time you open it and written nowhere.\n\nA **gap** blocks a credible baseline: a required section empty, an approval role missing. A **warning** is worth a look: an approval without a named sign-off, unresolved to-confirm placeholders. Fix the thing and the signal is simply gone; there is no history of signals, no score, no grade, because the platform never judges the record, it only states what is missing.\n\n**Do next.** Clear gaps before generating. Warnings are your judgment call.',
    steps: [],
  },
  {
    title: 'Versions, changes, and reading history',
    routes: ['workspace'], audience: 'all', sort_order: 110,
    body_md: 'Every baseline is permanent. The Versions tab lists them. Changes shows what moved between any two of them. The version picker on the document redraws any baseline exactly as it was.\n\nWhen a client asks what changed since they signed, open Changes between their version and now and read it to them. When someone says the document moved under them, compare the fingerprints and the argument is over.',
    steps: [],
  },
  {
    title: 'Print and export: one standard, every document',
    routes: ['workspace'], audience: 'all', sort_order: 120,
    body_md: 'Print / save PDF renders every document through one standard: a cover with the labeled meta rail, version, status, fingerprint, and approvals, then each section opening its own page under a SECTION heading, with a running head throughout.\n\nWord and Markdown exports carry the same content for teams that must edit elsewhere. The PDF is the presentation of record; two prints of the same approved version read the same.',
    steps: [],
  },
  {
    title: 'Upload a record-form PRD and it places itself',
    routes: ['projects', 'workspace'], audience: 'all', sort_order: 130,
    body_md: 'A document written in record form, requirement IDs like AS-01, an action label, a plain statement, a Done means fit criterion, and a MUST or SHOULD with release and verification, uploads and places itself.\n\nEach record lands as one functional requirement row with the ID preserved, the criterion in fit, the priority mapped, the release in Component. Never build sections land in constraints, open items in decisions, defined terms in the glossary. What the mapper cannot place with confidence waits in the review tray for your hand.',
    steps: [],
  },
  {
    title: 'People, roles, and workspaces',
    routes: ['*'], audience: 'manager', sort_order: 140,
    body_md: 'Managers write and administer. Viewers read what has been shared with them. Invite someone by email from Workspace settings. The invite claims itself the first time they sign in, and they land straight in the workspace that invited them.\n\nThe workspace switcher is in the account menu, top right. Client contacts and experts never need an account. They work entirely through the links you send.',
    steps: [
      { anchor_key: 'nav.account', title: 'The account menu', body_md: 'Switch workspace, open settings, invite people, and see which build you are on.' },
    ],
  },
  {
    title: 'What this platform will never do',
    routes: ['*'], audience: 'all', sort_order: 150,
    body_md: 'Worth sixty seconds, because it is why the record is trusted.\n\nNo health verdicts on your work. No auto-generated status. No editing of your words. No computed rollups presented as fact. No deleting published evidence, only withdrawing it in the open. Every value a client ever sees was typed by a person and frozen at publish.\n\nWhen a client asks why they should trust a ReqPub document, that list is the answer.',
    steps: [],
  },
  {
    title: 'Help, hiding it, and getting it back',
    routes: ['*'], audience: 'all', sort_order: 160,
    body_md: 'Press ? anywhere for this panel. Topics are scoped to the screen you are on. Hide any topic for yourself, or hide the beacon entirely; both are personal and follow you across devices, and ? always brings help back.\n\nManagers write and edit every topic in Help Studio, including this one.',
    steps: [],
  },
  {
    title: 'Work at speed: the palette and the keys',
    routes: ['*'], audience: 'all', sort_order: 170,
    body_md: 'The fastest people here barely touch the mouse.\n\n**The command palette** opens with Cmd K or Ctrl K: jump to any project, tab, or action by typing a few letters. **?** opens help anywhere. **Esc** closes whatever is on top, panel, walkthrough, or modal, one layer at a time.\n\nOn the worksheet, the lens chips switch views in one click, and every row control works by keyboard once focused.\n\n**Do next.** Press Cmd K, type the first letters of a project, press Enter. That round trip is the habit that makes the rest feel slow.',
    steps: [],
  },
  /* ---- The craft tier: judgment, not location. Grounded in the worked-
     example tradition (show a weak and a strong version side by side), the
     EARS requirement shape, and the fit-criterion discipline this platform's
     own placeholders already teach. Novice to specialist is learned here. */
  {
    title: 'What a PRD is for, and why fit criteria exist',
    routes: ['*'], audience: 'all', sort_order: 200,
    body_md: 'A PRD is not a description. It is a set of promises precise enough to be checked.\n\nEvery requirement therefore has two halves: the promise, and the check. The check is the fit criterion, the measurable condition that settles, without argument, whether the promise was kept. A requirement without one is an opinion wearing a suit.\n\nThat is why this platform will not let a requirement feel finished without its fit line, and why signatures bind to baselines: people sign checkable promises, not vibes.\n\n**Do next.** Open any requirement row and read its fit criterion aloud. If two reasonable people could disagree about whether it passed, it is not done.',
    steps: [],
  },
  {
    title: 'Write a requirement that can be tested',
    routes: ['workspace'], audience: 'all', sort_order: 210,
    body_md: 'The shape that works: when X happens, the system does Y, within Z.\n\n**Weak.** The system should handle errors gracefully. Nobody can test graceful.\n\n**Strong.** When a save fails, the system shows a retry within two seconds and records no completion. A trigger, a behavior, a bound. Anyone can test it, which means anyone can sign it.\n\nOne requirement per row. If your statement contains and, it is usually two promises hiding in one line, and the second one will be the one that slips.\n\n**Do next.** Find a row containing the word appropriately, gracefully, or robust. Rewrite it with a trigger and a bound.',
    steps: [],
  },
  {
    title: 'The fit criterion clinic',
    routes: ['workspace'], audience: 'all', sort_order: 220,
    body_md: '**Before.** Users can find documents easily.\n\n**After.** A first-time user locates a named document in under thirty seconds. Test.\n\n**Before.** The report looks professional.\n\n**After.** The printed report matches the golden reference: cover, section per page, running head. Inspection.\n\nThe pattern: a number or an observable state, a subject who could fail, and the method that settles it, Test, Inspection, or Demonstration. End every fit line with the method, so the verification plan writes itself.\n\n**Do next.** Take your weakest fit line and give it a number, a subject, and a method.',
  },

  {
    title: 'Priority is a promise: Must means it',
    routes: ['workspace'], audience: 'all', sort_order: 230,
    body_md: 'Must means the release does not ship without it. Say it rarely and mean it every time. A document where everything is Must has no priorities, only anxiety, and the reader knows it.\n\nShould means it ships unless it threatens the date, a real category, not a polite Must. Could is a genuine option. Won\u2019t is the most underused word in requirements: writing down what you are not building is how scope arguments end before they start.\n\n**Do next.** Count your Musts. If more than half the document is Must, demote until the word regains its meaning.',
    steps: [],
  },
  {
    title: 'Scope it so it can be signed',
    routes: ['workspace'], audience: 'all', sort_order: 240,
    body_md: 'A document gets signed when the reader can see its edges.\n\nIn scope and Out of scope are the edges: short, concrete, and honest. An empty Out of scope tells a client you have not thought about what you are declining, and they will assume everything.\n\nUnknowns are not failures, they are open items: write to confirm in place, and the Health tab counts them so nothing silently hardens into a promise. Decisions record what was chosen and why, so the argument never has to happen twice.\n\n**Do next.** Add one honest line to Out of scope. It is the cheapest trust you will build today.',
    steps: [],
  },
  {
    title: 'The practice engagement',
    routes: ['projects'], audience: 'all', sort_order: 210,
    body_md: 'A practice record is a rehearsal, never evidence. Set at creation and immutable afterward, it watermarks every surface, produces zero webhook deliveries, is refused by the evidence pack, and never appears in the Book export.\n\nStart one from the **Practice engagement** template: engagement mode, practice set, and the project opens on the Document tab ready for intake.\n\n**Sample intake for a training run.** Paste this into Populate from documents and review what lands:\n\nObjective: stand up a working acceptance record for the Riverbend rollout.\nFR-001 The intake form captures name, site, and shift with required validation.\nFR-002 A supervisor approves each submission before it posts.\nFR-003 The weekly export lists submissions by site with totals.\nAcceptance: the client signs baseline 1.0 after review of FR-001 to FR-003.',
    steps: [],
  },
];
