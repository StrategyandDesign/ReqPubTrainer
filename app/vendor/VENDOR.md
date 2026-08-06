# Third-party code shipped to browsers

Two files. Both are served from our own origin, both are pinned by hash, and
the content security policy on every page permits no third-party script
origin. `tools/supply-chain-gate.mjs` fails the build if any of that stops
being true.

| File | Package | Version | SHA-384 (subresource integrity) | Vendored | Why |
| --- | --- | --- | --- | --- | --- |
| `supabase-js-2.112.1.min.js` | `@supabase/supabase-js` | 2.112.1 | `sha384-0x8XPoHt08aHZj+RHs8ojmhZ5IDsTLjPgblgWdriayWriqv9dic3Vkv1K2+UqgZV` | 2026-08-05 | This client holds the session and mediates every read and write. Loading it from a CDN at a floating major version meant a single malicious publish to the 2.x line would execute with full session authority against every customer at once |
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
