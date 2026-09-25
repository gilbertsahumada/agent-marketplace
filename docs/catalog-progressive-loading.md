# Progressive catalogue loading

## Scope

Frontend only, based on main `835dd389` (#167). No Worker changes, migrations,
background admission, availability extensions or seller calls. Existing cache,
30-second cache lifetime, authenticated buyer-refresh hint and 15-second catalogue
deadline remain unchanged. Detail reads retain their separate timeout.

## Data flow and compatibility

The page normalizes its query once and creates three server promises. Results
start immediately. Facets and availability totals start after that attempt settles,
even if it fails. Suspense leaves share these promises; desktop/mobile counters
and the result summary do not fetch during hydration.

Cards and pagination use only results. Counts have independent loading, failure
and retry states. Missing counts render an em dash, not zero. Empty results do not
await availability totals; additional evaluation information streams later.
Manual retries use a closed resource allowlist and the same query normalizer.
No arbitrary backend URL is accepted. The existing nullable data adapter remains
available to other consumers; this page uses a discriminated internal result.

Navigation replaces old cards and counts with skeletons and disables query controls
until results settle. Query-keyed trees and promise replacement isolate old replies.
Same-query server refresh replaces manual retry data. Browser aborts do not imply
cancellation of D1 reads already started. There is no polling or automatic retry.

Registered Mainnet directory reads and its local proof annotation remain intact.
The marketplace no longer requests unused observations or registry totals.

## Request comparison (uncached logical reads per initial page)

| View | Before | After |
| --- | ---: | ---: |
| Mainnet marketplace | 6 | 4 |
| Testnet marketplace | 4 | 4 |
| Mainnet directory | 4 | 1 |
| Testnet directory | 4 | 1 |

The four marketplace reads are one results page, one canonical facet page
(page 1, limit 1), and two availability pages (page 1, limit 1). A facets retry
does one read; a results retry does one; availability retry does two. Existing
cache hits may reduce actual backend requests. This is not a billing estimate.

## Validation evidence

- Initial RED: new coordination test failed because the independent resource
  coordinator did not exist. Existing route assertions were adapted to promises
  while preserving their filter/network/refresh checks.
- GREEN: 1,529 frontend tests across 165 files, including controlled streaming,
  independent result/count resolution, scoped retries, stale-network response
  isolation, input allowlisting and five distinct failure categories.
- Existing fake-clock adapter tests still accept six-second responses and stop
  at fifteen seconds without automatic retries.
- Type checking and production build passed. Existing SDK dynamic-dependency
  webpack warning remains; no new build failure.
- Local browser checked at desktop 1365×900 and mobile 390×844. Controlled local
  backend returned cards after two seconds and aggregates six seconds later.
  Invalid facet data produced a local error while cards remained usable; retry
  recovered valid counts. Fixture logs showed only a facets request on retry.
- Filter/network navigation showed skeletons and disabled controls; mobile drawer
  retained options and shared counts. No browser console errors observed.

The existing full test suite emits blocked network warnings from unrelated
happy-dom link tests in the sandbox; all assertions pass. No remote D1 load test
or live seller request was used for this validation.

## Release

One commit per file. Re-check origin/main for concurrent work, require CI and
Vercel preview success, then merge through the existing Git integration. Verify
the production commit plus a bounded catalogue/filter smoke check. No Worker
deployment or configuration change is required. Roll back only this delivery
through a revert PR if it regresses production, preserving concurrent changes.

This improves perceived loading and failure isolation. It neither renews quote
evidence nor guarantees availability or a lower D1 bill.
