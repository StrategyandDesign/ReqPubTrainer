# Audit of the advisor's website copy, version 2

Every factual claim in the proposed copy was checked before any of it went on
the page. Three claims would have been false the day they shipped, one
statistic does not verify, and one arithmetic table has a category error that a
client-side finance reader would find in a minute.

## Verified, and now published

**McKinsey outcome-based fees.** Verified. Michael Birshan, McKinsey's
managing partner for the UK, Ireland and Israel, told reporters at a London
media event in November 2025 that about a quarter of the firm's global fees
come from outcome-based pricing. Published with two qualifications the
advisor's draft did not carry: it is attributed to what the firm has said, and
the page notes that firms describe these figures at media events rather than
in audited disclosures. A number stated more confidently than its source
states it is a number waiting to be corrected in public.

**RAND, more than eighty percent of AI projects fail.** Verified, and the
hedge matters. RAND's own wording is "by some estimates," and the finding
comes from interviews with sixty-five practitioners rather than a measured
population. The page now carries both the hedge and the method. The version
that was already live carried neither.

**Every seat included, no per-seat math.** True. There is no seat-count column
and no seat-limit function.

**No accounts for approvers.** True, and pinned by
`tests/backend-e2e/token-injection.test.mjs`.

**No third-party script source.** True as of v2.57.8, and pinned by
`tools/supply-chain-gate.mjs`.

**The gate packet in one click.** True. `app/js/exports.js` builds it.

## Does not verify, and was corrected on the page

**"Gartner forecasts 585 billion dollars of AI services spending in 2026."**
Not found. Gartner's published 2026 figures are 2.59 trillion dollars of total
AI spending, revised up from 2.52 trillion in January, and 64 billion dollars
for AI platforms and models. No 585 billion services figure surfaced in any
Gartner release.

This one is worth pausing on: **that number was already live on the site.** It
did not arrive with this draft. It has been published, unsourced and
unverifiable, and it sat on the page through every claims-gate pass because the
gate checks that claims name artifacts and tests, not that third-party
statistics are real. Replaced with the verified total and attributed.

## Would have been false on the day it shipped, and was held back

**Section 15, the whole proof section.** It says "a real sealed record is
published below" and "our own transcript of running it, on real production
output, is published with the timings." Neither exists. There is no
`reference/` directory and no a verification transcript, which does not exist and is not planned under the freeze. It also
says "drop the pack on our verification page," and `verify.html` accepts a
baseline bundle, not an evidence pack.

Publishing that section would have put three false statements on the most
trust-dependent page of the site, aimed at exactly the reader most likely to
check. Held until the reference record exists and the verification page accepts
a pack. Those are build items, not copy.

**"One click produces the exhibit," in sections 9 and 14.** The change exhibit
is not built. What exists is the underlying evidence: exact requirement-level
diffs between approved baselines, attributed and dated. The page describes what
exists.

**"Named source escrow," in the enterprise tier.** Escrow is drafted and
unexecuted, with no agent engaged, and `VENDOR_PACK/ESCROW.md` says so. Selling
it as a tier inclusion would contradict our own vendor pack. Removed from the
tier, and `../PRICING.md` records why.

## The arithmetic table has a category error

The proposed table totals six lines into "cost of one unresolved definition"
and compares it to the price. Two of those lines are not the client's cost.
"Work done outside the baseline, found late, $100,000" is scope the firm
recovers and the client pays. "Acceptance and payment delayed fifteen days,
$6,600" is a cost-of-capital effect on the firm's cash, not the client's
spend.

Presenting a hundred thousand dollars the client pays as a hundred thousand
dollars the client saves, in a table headed "the cost," is the kind of thing a
finance reader finds immediately and never forgets. The arithmetic adds
correctly to $274,600. The labelling does not survive contact with the person
it is aimed at.

Held pending a rewrite that separates what the client avoids from what the firm
recovers, and says which reader each column is for. That was correct in the
advisor's earlier document and was lost in this one.

## Prices

Published as decided, with a source of truth. `../PRICING.md` now holds every
figure, and the claims gate fails the build if a dollar amount appears on the
site that is not in that file. Proven by publishing an unlisted figure and
watching the gate refuse it.
