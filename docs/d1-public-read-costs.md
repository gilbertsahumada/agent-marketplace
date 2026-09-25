# Public D1 reads: delivery A measurements

Measured locally on 2026-09-25, starting from `631709b`. All numbers below are D1 `meta.rows_read` / `meta.rows_written` from the local Worker emulator, not estimates of production traffic. No remote database, seller, RPC, deployment, scheduler or queue operation was used. Existing baseline snapshots were retained unchanged.

[Machine-readable evidence](d1-public-read-costs.json) includes the exact reproduction command, fixture limitations, before/after metadata and D1 durations. The profiles print the same JSON records when rerun. Durations are sums of local D1 statement time, not end-to-end frontend latency, and are not regression thresholds. The original pre-edit route baseline did not capture per-query duration; those values are not invented retrospectively.

## What A changes

- `GET /catalog-summary?chain=56|97` returns `{ schemaVersion: 2, apiVersion, chainId, generatedAt, counts: { hiring, evaluation } }`. Chain defaults to 56. Other query keys are rejected. One aggregate query computes both scopes; no page selection, enrichment, or write.
- `GET /catalog-facets` accepts the existing catalogue filters, excluding pagination and the old `facets` toggle. It returns `{ schemaVersion: 2, apiVersion, chainId, generatedAt, facets }`. The legacy facet predicates, self-exclusion rules, and serialization are shared, not reimplemented. One aggregate query; no count/page/enrichment queries or writes.
- The frontend reads one page, then starts one facets request and one summary request. It retains progressive rendering, separate error states/retries, the 30-second process cache and authenticated fresh reads. It does not fall back to expensive list requests when a counter fails.
- Completed-job filtering now supplies the numeric `(chainId, jobId)` seek predicate and retains the original textual equality guard. Detail job aggregation and batched provider lookup are optimized separately in the same delivery.
- Legacy public list/detail contracts remain available. No new table, index, migration, persistent counter, or background writer is introduced in A.

## Frozen original-route baseline and RED

Before editing catalogue production code:

```sh
cd bnb-agent-probe
npm run test:worker -- test/integration/d1-read-profile.test.ts -t 'D1 read profile at catalogue scale' --reporter=verbose
```

Fixture: 2,000 agents, 4,000 endpoints and 32,000 observations. All measured public requests wrote zero rows.

| Original request | SQL statements | Rows read |
|---|---:|---:|
| `/catalog-agents` | 11 | 12,090 |
| `/catalog-agents?status=hireable` | 2 | 4,000 |
| `/catalog-agents?status=a2a` | 11 | 26,677 |
| `/catalog-agents?status=mcp&reachability=live` | 11 | 45,302 |
| `/catalog-agents?facets=true` | 12 | 223,687 |
| `/catalog-agent/100042` | 12 | 287 |

The existing 20,000-agent fixture snapshot also passed unchanged: **2,182,084 reads / 12 statements / 0 writes** for the legacy list-with-facets request. The baseline run had 3 passing tests and 1 skipped cron test, 10.21 seconds.

The new counter parity/validation tests ran against unchanged production code first: 27 failed because `catalogSummaryResponse` and `catalogFacetsResponse` did not exist. Frontend resource/feed tests also ran first: 12 failed and 1 passed, because the new exports were missing and four listing calls were still made. These RED runs preceded the implementation, not a snapshot update.

## Full cold frontend request comparison

`d1-read-profile.test.ts` now additionally compares the entire former frontend sequence (results + list-with-facets + hiring list + evaluation list) with the new sequence (results + facets + summary). It checks result parity and zero writes. Both sequences bypass caches and use the same chain, scope, filters and fixture. The legacy routes still exist, so the comparison is executable rather than only a saved number.

| Agents | Scope | Before requests / SQL / rows read | After requests / SQL / rows read | Read reduction |
|---|---|---:|---:|---:|
| 2,000 | hiring | 4 / 17 / 20,212 | 3 / 4 / 14,002 | 30.72% |
| 2,000 | evaluation | 4 / 34 / 240,107 | 3 / 13 / 231,687 | 3.51% |
| 20,000 | hiring | 4 / 17 / 200,212 | 3 / 4 / 140,002 | 30.07% |
| 20,000 | evaluation | 4 / 34 / 2,342,504 | 3 / 13 / 2,262,084 | 3.43% |

At 20,000 agents, summary costs **80,000 reads / 1 SQL**, hiring facets **20,002 / 1 SQL**, and evaluation facets **2,115,997 / 1 SQL**. Each writes zero rows.

Important fixture limitation: each agent has two endpoints and eight historical observations per endpoint, but **no compatible seller capabilities**. Hiring is therefore empty and evaluation contains all 20,000 agents. The hiring percentage must not be presented as a production-populated hiring result. The fixture also has no commerce job history; the job-history regression below measures that independently. These measurements do not establish a production daily cost forecast.

## Completed-job seek regression

`catalog-counter-routes.test.ts` seeds 20,000 jobs on each of networks 56 and 97. It covers duplicate events, canonical job IDs, leading zeroes, trailing text, leading whitespace, decimal/exponent forms, NULL and a funded but non-completed job.

The test also executes the frozen pre-fix textual join against the same fixture and compares the complete aggregate row:

| Query | Rows read | Rows written |
|---|---:|---:|
| Original text-only completed-job facet predicate | 160,138 | 0 |
| Numeric seek + original text guard | 146 | 0 |
| Numeric seek + original text guard after `ANALYZE` | 155 | 0 |

Before `ANALYZE`, `EXPLAIN QUERY PLAN` uses `sqlite_autoindex_commerce_jobs_1 (chainId=? AND jobId=?)`. Afterwards it uses `idx_commerce_jobs_status (chainId=? AND status=? AND jobId=?)`. Both seek the full job identity rather than scanning the network history. The regression checks the two key predicates and a strict **<200 read** ceiling, without requiring a particular index when both plans are efficient.

`catalog-job-read-cost.test.ts` separately compares the frozen original queries with the new queries on identical data, including canonical deduplication. Statistics are explicitly reset between scenarios rather than inherited from the preceding fixture.

| Operation / statistics | Before reads | After reads | Before / after D1 ms |
|---|---:|---:|---:|
| Detail history | 180,018 | 17 | 9 / 0 |
| 25 providers, 20,000 jobs, absent | 20,001 | 50 | 2 / 0 |
| 25 providers, 20,000 jobs, complete | 50 | 50 | 0 / 0 |
| 25 providers, 20,000 jobs, partial | 20,001 | 50 | 2 / 0 |
| 25 providers, 50,000 jobs, absent | 50,001 | 50 | 3 / 0 |
| 25 providers, 50,000 jobs, complete | 50 | 50 | 0 / 0 |
| 25 providers, 50,000 jobs, partial | 50,001 | 50 | 3 / 1 |

All cases write zero rows and return identical results. Complete statistics already produce an efficient original provider plan: this change prevents the demonstrated regression when statistics are absent or partial, rather than claiming savings in every planner state. Zero-duration entries reflect local timer rounding, not zero CPU cost. The provider query uses the already existing primary-key index, not a newly paid write index.

## Compatibility and cache gates

The new aggregate tests cover mainnet and testnet, testnet execution enabled/disabled, exact compatibility expiration, endpoint sharing without evidence sharing, removed identities, identities without operational declarations, an empty catalogue, combined filters, and malformed inputs rejected before any D1 query. Facets are compared family-by-family with the old route. Each new aggregate must execute exactly one query with zero writes and no page ordering/limit/window projection.

`catalog-counter-cache-routes.test.ts` verifies the actual Worker routes: a configured warm cache hit performs **0 D1 queries/reads/writes**; a valid authenticated refresh bypasses the cache, executes one aggregate, and returns `no-store`; invalid refresh credentials do not bypass the cache. The logs do not expose query text or the refresh secret. A cache is not a permanent cost guarantee: expiry, eviction, different keys/regions, and authorized fresh requests still require cold work. No cache behavior or quote-admission policy was expanded by A.

## Telemetry limitation

The per-invocation wrapper must preserve the native D1 `raw()` return shape and execute it only once. Reconstructing raw arrays from `Object.values(all.results)` loses duplicate columns, reorders numeric column names, and loses `columnNames` when there are no rows. Drizzle's installed D1 driver uses native `raw()` for typed selects and does not expose a public adapter carrying both positional columns and D1 metadata.

Therefore the invocation telemetry reports missing native-raw consumption explicitly: total `rowsRead`/`rowsWritten` are unknown (`null`), alongside known partial totals and unmeasured-query counts. It must never present an incomplete invocation as zero or complete. `all`, `run`, and `batch` results with valid metadata remain measured; the new summary/facets operations use `db.all` and remain fully measured. The exact local `d1-meter` regression profiles and independent platform analytics remain separate sources of evidence. A does **not** claim complete production per-invocation read attribution for every Drizzle request.

## Reproduction

```sh
# Worker emulator: public parity, cache, job joins and cost profiles
cd bnb-agent-probe
npm run test:worker -- test/integration/catalog-counter-routes.test.ts test/integration/catalog-counter-cache-routes.test.ts test/integration/catalog-job-read-cost.test.ts test/integration/catalog-hiring-filters.test.ts
npm run test:worker -- test/integration/d1-read-profile.test.ts -t 'D1 read profile at catalogue scale'
npm run typecheck

# From repository root: frontend contracts and progressive resource behavior
cd ..
npm test -- --run tests/catalog-resources.test.ts tests/catalog-counter-feed.test.ts tests/catalog-candidate-feed.test.ts tests/catalog-read-errors.test.ts tests/catalog-section-route.test.ts tests/catalog-streaming.test.tsx tests/progressive-catalog.test.tsx tests/pr40-review-route.test.tsx
npm run typecheck
```

The emulator needs its local TCP port; it does not require permission to contact a remote D1 database. The original snapshots must not be refreshed to hide a regression.

## Delivery gates: A is not B

A removes redundant page/enrichment work and the demonstrated job scans without adding persistent writes. Its local public contracts, new operation shape, cache behavior and tested request costs can be verified independently. It does not require resuming any scheduler or queue.

**B's ≥90% reduction of complete cold reads at 20,000 agents is not met.** Evaluation facets still read the historical observations and dominate the remaining total. B must implement and backfill compact current facts, preserve identity/endpoint/network/expiry and late-event semantics, test concurrent updates, and prove the full-request target across the agreed populated scenarios. Its daily economic gate must include incremental maintenance/backfill writes and the real mix of cache misses, refreshes and mutations; a read-only microbenchmark cannot prove that gate.

Before any deployment, reconcile the active configuration, migrations and release exactly as required in `AGENTS.md`. The repository's staging cron and `STAGING_MANUAL_RUN` defaults are not evidence of the current remotely paused settings. Preserve the active manual-run guard, cron pause and both queue pauses; A authorizes none of them to resume.
