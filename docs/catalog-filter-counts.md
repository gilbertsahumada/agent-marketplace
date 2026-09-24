# Optional catalogue filter counts

## Scope

Follow-up to #165, based on main at e2ae3fd. Restore numeric sidebar facets without making a counts failure hide valid catalogue rows. No migrations, remote D1 queries, seller probes, pause changes, TTL changes or deployment were performed for this change.

## Implementation

- Fetch optional counts separately from the cards, using canonical page 1 / limit 1 for reuse across pagination. Preserve search, network and filter scope. Unknown counts remain unavailable, not fabricated zeroes.
- Combine four facet groups in one SQL aggregate. Materialize reusable per-agent evidence; return one aggregate row instead of transferring the complete endpoint catalogue to JavaScript.
- Each facet excludes its own selected values and retains the other groups, as before.
- Reachability follows agent-specific observations, including expiry, just like the actual filter. A shared endpoint's global projection must not give an unverified agent another agent's evidence.
- Quote eligibility is unchanged. Restoring counts does not restore expired seller verification or make agents available to quote.

## Local validation

Deterministic D1 fixtures: two endpoints and eight observations per endpoint per agent; controlled clock, no real seller calls. Measurements cover the complete Worker catalogue response, not only the aggregate.

| Fixture | Before reads | After reads | Before queries | After queries |
| --- | ---: | ---: | ---: | ---: |
| 2,000 agents, facets | 235,687 | 223,687 | 16 | 12 |
| 20,000 agents, facets | Not measured | 2,182,084 | Not measured | 12 |

The measured reduction at 2,000 agents is 5.1%. The large-fixture response performs zero writes. Inline snapshots enforce measured totals. The existing public-route budget guards remain in place.

RED: the original implementation violates the regression asserting that facets no longer read the catalogue-wide `SELECT declaration.agentKey` projection. GREEN: the SQL aggregate passes that guard and the 2,000 / 20,000-agent consumption assertions. A first materialization without shared evidence and a globally ranked observation variant were rejected because they increased reads.

Coverage includes shared-endpoint isolation, exact expiry, genuine quote failures, first-time compatible sellers, search-scoped counts, multi-select protocols/categories, both networks, and optional-count failure/null handling in the page.

Validation commands:

```sh
# worker directory; local D1 only
npm run test:worker
npm run test:unit
npm run typecheck
# application directory
npm test -- --run
npm run typecheck
```

## Limitations and release

This is a modest query improvement, not a solved D1 budget. A cold large-catalogue aggregate still reads millions of rows. The separate counts request adds a request compared with the emergency no-counts page. Existing caching bounds repeated identical URLs, but different filters/searches and explicit freshness requests can still cause cold scans. No production cost or latency claim follows from these local fixtures.

The page still awaits the optional request's existing timeout; this is failure isolation, not independently streamed counters. A slow counts response can delay the page but cannot turn a successful cards response into the catalogue-unavailable screen.

Before release, inspect concurrent remote deployments and configuration. Deploy the compatible Worker change before the frontend that requests facets again, preserve all pauses and queue/cron settings, and verify one representative cold response and a cache hit. Do not repeatedly scan production to benchmark. If the optional request still exceeds its timeout, show unknown counts and investigate further rather than increasing timeouts or reactivating probes. No schema migration is introduced here.
