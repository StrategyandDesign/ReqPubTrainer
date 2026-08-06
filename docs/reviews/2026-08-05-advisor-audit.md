# Independent audit of the advisor specification

The document dated 5 August 2026 was audited against the repository rather
than read. Every factual claim in it was checked. This records what was true,
what was stale, what was wrong, what was built in response, and what was
refused and why.

The short version: **one finding in it is serious, real, and now fixed.** Four
items were already shipped and would have been paid for twice. Two of its
claims about this repository are false. Several items are good ideas that
cannot be built without a decision only the owner can make.

## Verified true, and acted on

**Item 3, third-party script in the authentication context. Confirmed, and it
was the most serious open defect in the product.** `app/index.html`,
`login/index.html`, and `signup/index.html` each loaded
`@supabase/supabase-js` from `cdn.jsdelivr.net` at the floating tag `@2`, with
no integrity attribute, and each page's content security policy named that
origin explicitly. That script holds the session token and mediates every read
and write. A single malicious publish to the 2.x line would have executed with
full session authority against every customer at once.

The advisor's sharpest observation is also correct: `app/vendor/` already
contained a vendored PDF worker with a comment explaining why a cross-origin
worker will not start. The harder case had been solved and the easier one
missed.

Fixed. The client is vendored at exactly 2.112.1 with the version in the
filename, pinned by SHA-384, served same-origin, and `script-src` is now
`'self'` on all three pages. Ten further pages that carried no policy at all
now carry one. Recorded as C1-007.

**Item 1, second half. Confirmed.** `claims-gate.mjs` and `copy-gate.mjs` were
never wired into CI. A gate that only runs when someone remembers is not a
gate. Both are now blocking steps, along with the new supply chain gate.

**Item 2, the underlying mechanism. Correct, and better than what existed.**
The four stale homepage claims it names were already corrected in v2.57.7, but
its proposal to bind published numbers to repository truth was a genuinely
better idea than correcting them by hand. Built: `scripts/record-counts.mjs`
writes what the suites actually prove into `tests/COUNTS.json`, and the claims
gate now fails when a figure on the site disagrees, when the version stamp
drifts, or when the recorded counts are older than the newest test. It caught
a live drift on its first run: the site said v2.57.6 where the repository said
v2.57.7.

**Item 11, the identity answer. Correct in full, including the advice not to
build SAML.** `VENDOR_PACK/IDENTITY.md` written, leading with what is missing.

**The RAND statistic. Verified.** RAND's own wording is hedged, "by some
estimates, more than 80 percent of AI projects fail, twice the rate of failure
for IT projects that do not involve AI", and the study is qualitative, built
on interviews with 65 data scientists. If it goes on the site it carries that
hedge and that citation, or it does not go on the site.

## False as stated

**Item 1, first half.** The document says `reqpub-keys.json` does not exist and
that the claims gate fails with one violation. Both are wrong for this
repository. The file exists at the root, contains two public keys and no
private material, and the claims gate passes. The audit basis is v2.57.4 and
the file predates it.

**Appendix check counts.** It records 571 frontend and 794 backend. The
measured figures are 605 and 785, now written to `tests/COUNTS.json` by a
script rather than asserted by anyone.

## Already shipped, and would have been paid for twice

- **Item 4, storage probing.** Shipped in v2.57.5:
  `tests/backend-e2e/storage-probing.test.mjs`, 17 checks, which found and
  fixed C1-006, an infected attachment that was labelled blocked and served
  anyway.
- **Item 6, the completeness sweep.** Shipped in v2.57.5:
  `tests/completeness-audit.test.mjs`, 23 checks across an empty and a
  populated organization. The advisor's version is more thorough on the role
  axis and its matrix artifact is a good idea worth taking later.
- **Item 5, the rotation drill.** Shipped in v2.57.5:
  `tests/rotation-drill.test.mjs`, 11 checks on real Ed25519 keys, which found
  that the runbook never said a retired key must stay published. The restore
  drill remains open and needs console credentials.
- **Item 7, offline verification.** Partly shipped: a real production receipt
  was verified offline and failed the published schema on exactly one field,
  recorded as C2-001. The remaining step needs artifacts exported through the
  interface.

## Refused, with reasons

**Items 8, 9, 24: new features under a declared freeze.** The Change Order
Exhibit, the rebuilt browser verifier, and the economics calculator are all
features. Phase B freeze permits fixes, tests, documentation, and copy. The
Change Order Exhibit in particular is a strong idea and its argument for why
it is record content rather than a tracker is sound, but shipping features
under a freeze either means the freeze was not real or the exception is
recorded deliberately. That is an owner decision, not an engineering one.

**Items 20 and 24: the prices.** The five tiers, from $7,500 to $750,000, are
the advisor's invention. Nothing in the repository derives them and nothing
verifies them. Publishing a price binds the company commercially, and the
claims gate would then bind every figure on the site to a file of numbers that
nobody with authority chose. `../PRICING.md` should exist and the mechanism
proposed for it is right. Its contents are for the owner to set.

**Item 10, the reference record.** Running ReqPub on ReqPub is the best idea in
the document and it resolves a problem the GA readiness report had called
unsolvable. It requires authoring a real record in production and routing it
through real named approvals. Approvals cannot be fabricated, which is the
entire point of the product, so this one needs a person.

**Item 25, the serving changes.** Its instruction not to add a build step is
correct and the reasoning is exactly right: the absence of a build chain means
what is in the repository is what runs in the browser, and the verification
story depends on that correspondence. Nothing else in the item is urgent.

## What this audit adds that the document missed

The homepage version stamp had already drifted again by the time the audit
ran, one release after being corrected by hand. That is the argument for the
COUNT mechanism stated better than either of us stated it: a number corrected
by a person drifts at the next release, and a number bound to a gate does not.
