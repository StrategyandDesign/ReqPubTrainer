# Third-party code shipped to browsers

Four files. All are served from our own origin, both are pinned by hash, and
the content security policy on every page permits no third-party script
origin. `tools/supply-chain-gate.mjs` fails the build if any of that stops
being true.

| File | Package | Version | SHA-384 (subresource integrity) | Vendored | Why |
| --- | --- | --- | --- | --- | --- |
| `supabase-js-2.112.1.min.js` | `@supabase/supabase-js` | 2.112.1 | `sha384-0x8XPoHt08aHZj+RHs8ojmhZ5IDsTLjPgblgWdriayWriqv9dic3Vkv1K2+UqgZV` | 2026-08-05 | This client holds the session and mediates every read and write. Loading it from a CDN at a floating major version meant a single malicious publish to the 2.x line would execute with full session authority against every customer at once |
| `pdf-3.11.174.min.js` | `pdfjs-dist` | 3.11.174 | `sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e` | 2026-08-05 | Reads uploaded PDFs during intake. Loaded from a CDN until v3.0.1, when the tightened policy blocked it and PDF upload stopped working |
| `mammoth-1.8.0.browser.min.js` | `mammoth` | 1.8.0 | `sha384-/cXAMbzovUIKbBERjPmR3SnPTh8siWr5lsvFYj1Uq4XP0yaJUZJmsh0YXyGv5P0y` | 2026-08-05 | Reads uploaded Word files during intake. Blocked by the same change |
| `pdf.worker.min.js` | `pdfjs-dist` worker | see file header | `sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2` | earlier release | A cross-origin worker will not start, so this was always same-origin |

## The rule

The version is in the filename on purpose. An upgrade is then a visible diff
with a new hash, reviewed like any other change, rather than a silent
substitution under a floating tag.

Upgrading: install the exact version from the registry, copy the UMD bundle to
a new versioned filename, recompute the SHA-384, update this table and the
`integrity` attribute on all three pages, delete the old file, and run
`node tools/supply-chain-gate.mjs`. The gate fails until the table and the
files agree.

## What this was before

Until v2.57.8 the Supabase client was loaded from `cdn.jsdelivr.net` at the
floating tag `@2`, with no integrity attribute, on the three pages that hold a
session. The policy on those pages named that origin explicitly. The PDF
worker had been vendored properly long before, with a comment explaining why,
so the harder case was solved and the easier one was missed. Recorded here
rather than quietly corrected, because the failure mode is worth remembering.
