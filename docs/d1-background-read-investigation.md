# D1 background reads: measured correction

Local validation only. No deployment, remote migration, seller request, quote,
frequency change, concurrency change or budget increase.

## Scope and integration

The initial index-only proposal failed two acceptance gates. The user authorized
minimal candidate access-path changes and accounting for index write amplification.
The selector now reads disjoint NULL/due-date ranges through partial covering
indexes, then applies the original origin ranking, eligibility, limits and order.
There is no pre-ranking LIMIT. The combined cohort (bootstrap disabled) is unchanged.

Concurrent main PR #154 introduced migration 0029 for Commerce payment tokens.
This PR preserves that change and uses **0030_background_read_indexes.sql** instead.
Apply 0029 and 0030 in order on deployment; 0030 is required before this Worker code.

## Local measurements

Deterministic fixtures use 2,000/20,000 agents, both networks, shared origins,
future/due/NULL dates, suspended rows and fresh ready rows. RPC and queue are mocked.
Each benchmark compares original SQL without new indexes against the proposed code.
Both candidate values and order must match. SQLite ANALYZE and no-statistics cases
are covered. Metrics are D1 meta.rows_read, not logical result counts.

| Fixture | Identity before → after | Empty legacy review before → after |
| --- | ---: | ---: |
| 2k | 4,000 → 20 | 7,204 → 4 |
| 20k | 40,000 → 20 | 72,004 → 4 |

Large-fixture reductions: **99.95%** and **99.994%**. Empty review writes zero rows.
Identity latency was 1→0 ms (2k), 2→0 ms (20k) in the recorded emulator run;
millisecond resolution is too coarse to infer production latency.

| Selector scenario | Pending reads before → after | Maintenance reads before → after | Local ms before → after |
| --- | ---: | ---: | --- |
| 2k Mainnet, sparse, ANALYZE | 190 → 165 | 8,082 → 165 | 0/2 → 1/0 |
| 20k Mainnet, sparse, ANALYZE | 80,802 → 1,605 | 80,802 → 1,605 | 18/19 → 2/2 |
| 2k Testnet, dense, ANALYZE | 8,726 → 2,512 | 9,615 → 5,676 | 2/2 → 1/1 |
| 20k Testnet, dense, no stats | 34,955 → 19,335 | 61,700 → 48,913 | 17/27 → 11/19 |
| 2k Mainnet, bootstrap disabled | combined 8,164 → 7,366 | — | 2 → 1 |

Timings are single local observations, not statistically significant latency claims.
The exact statements, bindings, reads, writes, durations and plans print when running
the benchmark with --silent=false. Global state counters remain unchanged and are
metered separately; this work does not claim to optimize them.

## Why these access paths

Identity discovery previously used a non-covering index and a temporary sort:
`USE TEMP B-TREE FOR ORDER BY`. It now uses:

```
SEARCH catalog_agents USING COVERING INDEX idx_catalog_agents_identity_discovery
  (chainId=? AND indexState=? AND agentKey>?)
```

Legacy rediscovery explicitly uses its detectorVersion-leading partial index.
Without INDEXED BY SQLite still started from all Mainnet identities (72,004 reads).
The eligibility and ordering remain unchanged. Testnet no longer repeats this
Mainnet-only review; subsequent old candidates remain discoverable.

Candidate indexes alone were insufficient. The original 2k pending case regressed
190→7,284 after adding the identity index, and forcing the partial index still
scanned 1,143 rows. Splitting NULL and non-NULL due dates using UNION ALL produces
disjoint index ranges without dropping providers:

```
SEARCH catalog_seller_capabilities USING COVERING INDEX
  idx_catalog_capabilities_pending_due (nextProbeAt=?)
SEARCH catalog_seller_capabilities USING COVERING INDEX
  idx_catalog_capabilities_pending_due (nextProbeAt<?)
```

Maintenance uses the equivalent maintenance index. Origin ranking still requires
sorting; removing that sort is not claimed. Covering columns avoid capability table
lookups while evaluating freshness, transport and ordering.

## Writes and task admission

All new indexes cost writes/storage. An agent insertion adds one index entry.
Eligible capability rows belong to exactly one pending/maintenance index; a legacy
unsupported row can additionally belong to the old-detector index. A measured
pending scheduling update costs **2→3 writes**. The benchmark logs per-index build
reads/writes/duration, and asserts migration preserves rows and index definitions.

The previous Free sweep exceeded its unchanged 60-write limit. Two fixes:
- Skip the redundant identity upsert when the same metadata version was just
  discovered; still persist changed metadata, removed identities, policy changes,
  and the hourly lastSeen refresh. This optimization uses an atomic UPSERT condition.
- Admit whole ingest tasks only when remaining measured row writes cover a
  conservative task allowance and final-state/probe reserves. No configured batch
  size, frequency or quota is changed. A full new four-agent sweep persists its
  discovery and leaves ingest tasks unclaimed for the next invocation.

The allowance is 14 fixed writes plus 20 per declaration, covering identity,
lease/task/admission and endpoint/relation/capability index writes. It is a
conservative scheduling estimate, not a replacement for the actual metered guard.
The phase reserves six writes for summary/phase/queue watermark and probe headroom.
Boundary tests cover 39/40/74 remaining writes for one-declaration tasks.
The Free integration test verifies deferral, unchanged limit and next-run progress.

## TDD and validation

RED evidence retained in history:
- Original identity read ceiling and cross-network isolation failed.
- Index-only candidate plan regressed 190→7,284 reads.
- Existing Free sweep exceeded 60 writes.
- A fresh unchanged identity unnecessarily wrote 3 rows during ingestion.

GREEN coverage includes first/intermediate/final/wrapped identity pages, overlapping
network IDs, empty and later legacy candidates, suspension/ineligible exclusions,
network/cohort selection equivalence, and row admission plus eventual processing.
Existing suites cover concurrent leases, failed sends, retries and per-origin limits.

Before integrating the concurrent payment change: **337 integration tests and
658 unit tests passed**, plus Worker typecheck. Final post-integration results are
reported in the PR update. Fresh databases apply all migrations in test setup;
upgrade tests remove only the proposed indexes and apply the real migration to
populated tables. No existing migration is edited.

## Production evidence: separate series

Prior read-only Insights: identity 2,111,302,334 sampled reads / 5,929 executions;
legacy review 766,414,271 / 2,672, zero writes. Those adaptive samples are not
additive with aggregate D1 metrics. The separate September 19 aggregate was
3,885,591,739 reads / 115,978 queries. Historical production observations motivate
this work, but no production savings can be inferred from local fixtures alone.

## Later release, only with authorization

1. Review/merge; recheck active Worker version, main, target DB/bindings, flags,
   queues and scheduler. Preserve other sessions and remote manual-run controls.
2. Compare ledger/schema; create and verify a recoverable backup.
3. Apply required migrations in order, including 0030, before the new code.
4. Verify schema/config/health. Roll back code if needed, but never drop an index
   while active code names it.
5. Compare equivalent traffic/time windows: reads, writes, query mix, queue delay,
   errors/retries and storage. Keep Insights separate from aggregate totals.

## Reproduce

From bnb-agent-probe:

```
npm run test:worker -- test/integration/d1-background-reads.test.ts --silent=false --reporter=verbose
npm run test:worker
npm run test:unit
npm run typecheck
```
