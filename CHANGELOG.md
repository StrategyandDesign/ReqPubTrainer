# Changelog

## Unreleased

Intake heard keywords but not the record's own vocabulary. A program document
written in the record's OWN section labels came back with seven headings
unrecognized, and two of them silently misfiled: Safeguarding response landed
as non-functional requirement rows and Release-specific acceptance notes
landed as stage gates, both ticked by default in the preview.

**Every question label now classifies to its own question.** Classification
gained an exact-label tier derived from the question bank itself, so the
vocabulary the manual dropdown offers is exactly the vocabulary the classifier
hears, and a question rename stays recognized without touching the keyword
map. The colliding keywords were retuned: safeguarding content is never a
generic quality attribute, "Purpose and audience" is purpose rather than a
personas grab, OKRs are delivery rows rather than overview goals, and consent
has its own home. A bare "Risks" heading still stays unplaced. Doctrine is now
executable: a test walks every intake-shaped prompt in the bank and fails the
build if any classifies to a different question.

**Unrecognized sections can now land anywhere content lands.** The "Not
recognized. Choose a home or skip" dropdown offered twelve prose fields and
nothing else, so a mislabeled requirements table could not reach the
requirements table. Every intake-shaped question is now a routing home: prose
homes append exactly as before, and table or list homes run the same
deterministic extractors the classifier uses, with the yield counted next to
the dropdown before anything is written, including the honest zero. Risks and
issues rows allocate their permanent phase-prefixed IDs through the same RPC
as the worksheet's add button; a row that cannot get its ID does not land.

New landing shapes: User segments, Release plan, Objectives and key results,
Risks and issues, People and roles, and the data-section prose answers
(Operating context, Safeguarding response, Consent approach, Retention and
deletion, Data residency, Access control). Eleven new unit checks pin all of
it. The database is unchanged: the same save_field and upsert_row paths carry
every write.

**First construction from a paste-blocks file is one paste.** The PRD
assistant workflow emits one block per destination field under ruled
headings, tables as bare pipe rows with no leading pipe. That whole file now
lands in a single Populate from documents pass: ruled headings normalize to
the field's own label (section numbers and the Paste rows suffix strip),
runs of bare pipe rows become tables for both bulk intake and per-table
Paste rows, the Executed by column survives into requirement and evaluation
rows, an interfaces Description column lands as the requirement, and
unbulleted "Name: description" runs land as persona, people, and segment
rows when every line pairs. Control fields stay a human decision and appear
unplaced rather than guessed. Verified against the real specimen: 25 of its
34 blocks land in one paste, 88 rows and 12 prose answers, with the
remainder shown honestly. Four more unit checks pin the dialect.

## 3.0.1

Two supply chain defects, one of which broke a working feature.

**PDF and Word upload stopped working.** `app/js/main.js` injected the pdf.js
library and mammoth from a public CDN at runtime. v2.57.8 tightened the app
page to `script-src 'self'` and removed that origin, which blocked both
injections, so uploading a PDF or a Word file failed with nothing in the
interface to explain why. The worker had been vendored long before; the
libraries had not. Both are now vendored on our own origin at exactly the
versions the code requested, pinned by hash, and the pdf.js worker already in
`app/vendor` was confirmed byte-identical to the 3.11.174 build so the library
and its worker match.

**The edge functions imported an unpinned dependency.** All eight imported
`@supabase/supabase-js@2` from esm.sh, a floating major version tag, in
functions that hold the service role and seal receipts. A publish to that line
would have executed with those credentials. Pinned to 2.112.1, the same version
vendored for the browser.

The gate that should have caught both read only static script tags in HTML. It
now scans source for scripts injected at runtime, and requires every URL import
to carry an exact version. Both rules were proven by reintroducing the defect.

Deploy: push, then redeploy the eight edge functions so the pinned import takes
effect. The database is unchanged.

## 3.0.0

The release where the documentation, the migrations, and the published claims
each acquired a gate that fails the build when they drift.

This is not a feature release. The freeze that began at 2.57 held. The major
number is justified by breaking path changes and by a change to how assurance
is published, not by anything new the product does.

**Versioning and assurance are now separate axes.** Until this release the
repository defined general availability as a version number, which required a
penetration test, a cryptographic review letter, and a signed SOC 2
engagement. A version number describes software; those three items describe
what third parties have verified, and they move on schedules set by vendors
and budgets. The three requirements are unchanged and are not softened. They
now define the assurance state `Attested GA` in `docs/ASSURANCE.md`. ReqPub is
at `Self-attested` and says so on the page and on the site. The reasoning is
in `docs/decisions/ADR-0001-versioning-and-assurance.md`.

**Migrations became an ordered set with a ledger.** The 29 files are numbered
under `supabase/migrations/`, each ending with an idempotent insert recording
its ordinal, name, and the SHA-256 of its own body, so editing a shipped
migration is detectable and an operator can answer what revision a database is
at with one query. `tests/backend-e2e/migrations.test.mjs` proves that
replaying the chain onto a blank database produces the same schema as
`supabase/schema.sql` alone, compared through `information_schema` and
`pg_catalog` rather than by diffing text: 360 columns, 130 functions, 93
indexes, 59 policies, 142 constraints. It proves the chain is idempotent by
applying it twice.

**The documentation tree was restructured.** Twenty-one documents left the
repository root. `tools/docs-gate.mjs` refuses a new root-level file, an index
that has fallen behind its directory, a title that is its own filename, a
generated file that does not say it is generated, a relative link that does not
resolve, and a backticked repository path that does not resolve. Every path
other people implement against is checked for presence, because moving
`docs/VERIFY.md` would invalidate artifacts already delivered.

**Static analysis landed and found two real defects.** ESLint reported
`loadProject` and `go` as undefined in `app/js/main.js`. Both would have thrown
at runtime; the second sat in the pursuit promotion path, after the child
record had already been created. Both fixed.

**Published figures are read from a record.** `tests/COUNTS.json` is written by
the suites, and the claims gate fails when the site or the README disagrees
with it.

### Pricing, presented as tiers

The pricing section was a flat list of rows. It is now a three-card grid for
the tiers most programs land on, with the program tier carried visually, and a
two-card band below for the enterprise tier and the drawdown agreement. Each
card states its program size band, its price, and what it includes. Every
figure is still bound to `docs/PRICING.md` by the claims gate, and no
inclusion appears that the pricing file does not already state.

The four pricing tags now sit on one line above 640 pixels and wrap below it.

The create card gained a floor: the practice control sat flush against the
panel below it, so the two read as one block.

The sourcing footnote under the outcome section is removed. The sentence above
it already attributes the figures to the firms themselves, which is the
attribution that matters; the footnote repeated it in smaller type.

### Upgrading deletes files

This is the first release that moves and renames rather than only adding, and
an archive cannot express a deletion. A repository upgraded by extracting the
archive holds both trees at once, and continuous integration fails on the first
push at the documentation gate, which refuses the old documents at the root.
That is the gate working, not a defect, and the failure names every file.

`docs/operations/STALE_PATHS.md` lists all 53 paths to delete: 22 root
documents that moved under `docs/`, 29 migrations renamed with ordinals, and
two generated artifacts moved under `dist/`.

### Five findings from review, and one the review uncovered

`docs/operations/MIGRATIONS.md` had twenty of twenty-nine rows showing a
comment rule instead of a description, because the harvester took the first
comment line and that line is a row of equals signs. It now skips rules,
product names, pre-rename filenames, and trailing version stamps. Zero rows
carry a rule and zero name an old filename.

The nine index ADRs had truncated filenames, one carrying a semicolon, and
five shared a word-for-word consequences paragraph. Renamed to full slugs.
`docs/decisions/README.md` now states plainly that one record argues a decision
made here and the rest are indexes into `docs/ARCHITECTURE.md`, and each index
says so at the top rather than presenting itself as fresh argument.

`.DS_Store` was committed at the repository root and was the first line of the
manifest. Removed, ignored, and the documentation gate now refuses operating
system artifacts by name; it had been skipping every dotfile as configuration.

The assurance link pointed at a Markdown file, which a static host serves as
raw text. It now points at the documentation page, which links to rendered
views. The gate refuses a served page that links straight at a Markdown file.

The edge functions were unlinted: 1,258 lines of TypeScript in the two places
that hold a service role. They are linted now, with a parser that reads
annotations, at zero errors.

**And the finding that came out of fixing those.** The security section on the
landing page was truncated mid-word, with a stray closing tag welded to a
fragment of the pricing section, left by an earlier scripted edit. Every gate
passed on it. Contrast was fine, the copy was fine, the claims were fine, and
the page was broken. The documentation gate now checks tag balance on every
served page and refuses text welded onto a closing tag.

### Pricing presentation

The tier cards inherited centred text from a rule left behind by the single
card the section used to be, while the list markers stayed pinned to the left
edge. The result was a column of squares floating away from the text they
belonged to. The stale rule is gone, the cards are left-aligned, the markers
are check marks that sit on the first line of each item, and the price is
separated from what it includes by a rule rather than by whitespace alone.

The two larger commitments now sit under a label that says what they are,
instead of reading as two cards that missed the grid above them.

The pull quote under the outcome section is removed.

### Pricing presentation, and symbols

The tier cards inherited the centred section heading, which put the tick marks
in the middle of each card with the text wrapped around them. Cards now read
left to right like every other block of text on the page, the inclusions sit
under a rule with real spacing, and the flag on the program tier is a badge on
the card edge rather than a full-width bar. Its colour moved to the darker
brand so white text on it clears AA at 8.72 to 1, and the pair is now checked
by the design gate.

Figures use symbols where a reader expects them: program size bands read $5M
and $25M, the fixed-price line reads $85,000 rather than the number spelled
out, the Gartner figure reads $2.59 trillion, and the RAND finding reads 80%.

The pull quote under the outcome section is removed, along with the rule that
styled it.

### What an outside review changed

An independent reviewer ran the suites, reproduced the counts exactly, and
reported two things worth acting on.

The backend chain needed a locale nobody had checked for. `embedded-postgres`
hard-codes `en_US.UTF-8` because it reads initdb's output to know when the
cluster is ready, and on an image without that locale the only way through was
editing a file inside `node_modules`. The maintainer's image has the locale, so
the defect was invisible from here. `npm run test:backend` now checks first and
prints the fix instead of failing inside initdb with a message that does not
name the cause.

And the wider one: nothing in this repository is ever executed in a browser.
Roughly 470 kilobytes of interface code is covered by syntax parsing, by view
functions called as functions, and by a symmetry audit, none of which clicks
anything. Static analysis found two calls to functions that did not exist in
August, one in the pursuit promotion path, and no suite would have caught
either. That is now named on `docs/ASSURANCE.md` where a buyer reads it, and
recorded as an open item in `docs/STATUS.md`. It is not fixed. Saying 1,405
checks pass without saying this would be the kind of claim this repository
exists to refuse.

Deploy: apply nothing. The schema is unchanged. Push, delete the paths in
`docs/operations/STALE_PATHS.md`, and hard refresh.

## Earlier releases

The complete 2.x history is archived in
[docs/changelog/v2.md](docs/changelog/v2.md). Nothing was removed.
