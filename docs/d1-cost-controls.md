# D1 background cost controls — local evidence, 2026-09-21

Automatic maintenance must remain paused. The 15-minute cadence does not fit the maintenance allocation in three of four measured scenarios, even before consumers execute. These tests establish local behavior, not deployment state or an account-wide spend guarantee. Preserve a remotely set `STAGING_MANUAL_RUN=1`; this document does not authorize deployment or reactivation.

## Release boundary

Final local validation: Worker unit suites 665/665; Worker/D1 integration suites 410/410 (36 suites, 28.86 seconds); affected frontend notification/hire suites 44/44. Frontend and Worker TypeScript checks pass, as does `git diff --check`. A targeted HTTP integration test needed a 30-second first-module-load allowance when running with all 36 suites; it also passes in isolation. Cross-review reproduced and fixed a concurrent refund reopening a closed budget lane, a missing-row emergency close, and an implicit-range deferred message that could not be parsed on replay. RPC exceptions now persist identity backoff even without a prior snapshot, without advancing the failed page's cursor or creating identity evidence.

This PR does not deploy, merge, change remote cron/queue settings, recover expired messages, or modify the hackathon submission branch. No schema changes or migrations are introduced: snapshots, UTC ledgers, cadence leases, identity backoff and deferred work reuse `runtime_state`. No new indexes or corresponding index-maintenance writes are introduced. Additional writes shown below are application/control writes against the existing indexes.

Local configuration explicitly enables cost controls but pauses both new lanes (`BACKGROUND_COST_CONTROLS_ENABLED=1`, `BACKGROUND_MAINTENANCE_PAUSED=1`, `BACKGROUND_JOBS_PAUSED=1`). The minute cron remains a design declaration, not authorization to restore the remote trigger. Legacy behavior is tested with controls explicitly disabled; activation tests opt into controls and specify pause states. A remotely enabled manual-run pause must remain preserved.

Background notification HTTP calls carry an internal marker originating only from the authenticated runner. The Worker authenticates the private API before applying the jobs budget. Ordinary buyer-triggered notifications and public reads are not delayed by this background marker. Their variable cost is outside this ledger, not free. If settlement of a notification cannot proceed, existing sending/uncertain fencing remains durable for later recovery.

Deferred queue messages contain only parsed queue-work fields and retain original timestamps. Persistence and verification precede acknowledgement; replay is at-least-once with conditional leases/deletion. Necessary deferral storage remains chargeable after quota exhaustion: preventing message loss is not a promise to cap all control/storage costs. Warm processes remember denial deadlines; cold processes consult the durable UTC latch. Neither allows work before the deadline. Cold denied admissions still incur a conservative 2,000 nanoUSD control charge.

Frontend polling changes are deliberately deferred. Polling and public cache misses during a pause can continue to cost D1 reads while displayed evidence becomes stale. Background pause does not mean zero database activity.

Before any separately authorized release: compare the current remote Worker version, bindings, flags, queue settings and migration ledger with the approved commit; reconcile other sessions; create and verify a recoverable backup; confirm that no new migration dependency has appeared; preserve remote pauses and manual-run state. Deploy only after that review, then verify health, effective configuration and comparable metric windows. Reactivation is a separate decision and remains blocked by the capacity findings below.

## Accounting and coverage

The nominal D1 rates are $0.001 per million rows read and $1.00 per million rows written, verified against [Cloudflare's official D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). Thus one read costs 1 nanoUSD and one write 1,000 nanoUSD. Paid allowances are not deducted from this conservative internal ledger. This is a D1 row-cost model, excluding Workers, Queues, RPC and other services. Free-plan daily quotas and per-invocation limits remain separate constraints; nominal USD headroom does not override them.

The ledger allocates 25,000,000 nanoUSD/day ($0.025): jobs 10,000,000 and maintenance 15,000,000. Every admission reserves an estimate plus 5,000 nanoUSD for admission/settlement/emergency-close overhead. Successful units refund unused work estimate, but retain the 5,000 overhead charge. Failures retain the work reservation; missing or invalid metadata closes the lane. Cost metadata arrives after SQL execution, so a single statement can overshoot; this is an admission control, not a hard billing ceiling. Denied calls also write accounting state: callers must defer until the returned deadline rather than poll repeatedly.

Public HTTP reads, including catalogue cache misses, do not use this background ledger. Their cost must be budgeted separately.

The $1/month additional-D1 target is a planning reference, not a Cloudflare spending cap. A nominal $0.025/day background allowance corresponds to $0.75 over 30 days before public traffic, storage, unavoidable control work, or statement overruns. Account Insights samples, hourly analytics and these local row measurements are different datasets and are not added together as equivalent totals.

## What changed

`/health` reads runtime keys, including a versioned capability snapshot, in one query. Missing/corrupt/future snapshots expose null counts and `statsStatus=missing`; stale snapshots keep their values and timestamp. Existing scheduler errors remain visible. Refresh performs the three global aggregations at most once per 15 minutes through an atomic lease; a failed refresh preserves the prior snapshot and cooldown. Queue summaries read that snapshot by key instead of counting capabilities again. Their historical `pending` meaning remains discovered-only; health includes discovered, stale and failed.

Global scheduling repairs can run once before both network selectors. Selector ordering and selected identities are unchanged in equivalence tests. Health and snapshot changes do not remove all catalogue-sized scans: the snapshot itself and selectors still scale with data distribution.

## Reproducible local profile

Run from `bnb-agent-probe`:

```sh
./node_modules/.bin/vitest run --config vitest.worker.config.ts test/integration/background-cost-measurements.test.ts test/integration/capability-stats.test.ts test/integration/catalog-capability.test.ts
```

Fixtures have 2,000 or 20,000 agents/capabilities, 10% Testnet, 100 shared origins, and either all capabilities due or only IDs ending in 01/02 due. They use local D1 migrations and `ANALYZE`. Mainnet limits are bootstrap 40, maintenance 4/concurrency 2; Testnet bootstrap 1/concurrency 1. Synthetic empty evidence tables are not representative of a complete production database.

The measured cycle includes global repairs, snapshot refresh, both selectors and claims, sweep counters, cadence admission, and budget reservation/settlement. Queue sends are stubs; consumers, identity indexing, Trust8004 ingestion, job recovery, token backfill, and shared-discovery projection are excluded. Those costs would add to the results. This is a complete catalogue-producer cycle, not a complete backend cycle.

The baseline reconstructs the previous cycle from git `cbb1b0876b34f5ff2c7cfeb43d0be0e51b4b61da`: unchanged selectors, repairs per network, and the original state-count query after each network. New snapshot lookups are excluded from baseline accounting. Prior health numbers below measure its three global aggregates only, excluding its small runtime lookup. Current counts come from D1 `meta.rows_read`/`meta.rows_written`, including indexes.

| Capabilities / due cohort | Baseline cycle reads / writes | Current cycle reads / writes | Current charged nanoUSD |
| --- | ---: | ---: | ---: |
| 2,000 / sparse | 13,989 / 15 | 13,998 / 24 | 39,996 |
| 2,000 / all | 31,341 / 267 | 31,350 / 276 | 309,348 |
| 20,000 / sparse | 139,629 / 15 | 139,638 / 24 | 165,636 |
| 20,000 / all | 308,541 / 267 | 308,550 / 276 | 586,548 |

The full refresh cycle itself is slightly more expensive than baseline. Savings come from reduced frequency and eliminating repeated HTTP scans, not from claiming that this cycle became cheaper. Prior health aggregates read 8,000/80,000 rows; current health reads 18 rows, zero writes, at both sizes. Independent tests cover missing, fresh and stale snapshots under a 100-row ceiling.

One isolated local run also captured the sum of D1 `meta.duration` across statements. These timings are illustrative, not assertions or performance targets; they exclude RPC, queue delivery, application work and much of the test runtime. A recorded 0 ms reflects timer precision, not zero work.

| Capabilities / cohort | Baseline producer D1 ms | Current producer D1 ms | Old health aggregates D1 ms | Current health D1 ms |
| --- | ---: | ---: | ---: | ---: |
| 2,000 / sparse | 6 | 4 | 1 | 0 |
| 2,000 / all | 10 | 10 | 2 | 0 |
| 20,000 / sparse | 11 | 24 | 10 | 0 |
| 20,000 / all | 62 | 72 | 12 | 1 |

This release adds no indexes and no migrations: schema/index deployment cost is zero. The existing indexes, including the baseline background-read indexes, remain in the fixtures. D1 write measurements include their ongoing maintenance cost. Snapshot, cadence, budget and deferral records reuse `runtime_state`; their additional writes are included in the appropriate profile.

### Extended lifecycle evidence

An additional profile persists a real deferred identity message, replays it through `replayDeferred`, executes the catalogue producer, then dispatches the replayed message through `worker.queue` and the real `runIdentityIndex`. Only the registry RPC reader is stubbed; local D1, budget admission/settlement, SQL, identity writes and final ACK are real. Twenty Mainnet identities are stored and no Testnet identities appear. A separate jobs-lane unit performs a real insert/read/update on a synthetic point record. That unit checks lane accounting, **not** the real commerce indexer or notification lifecycle.

| Stage | 2,000 sparse reads / writes | 20,000 sparse reads / writes |
| --- | ---: | ---: |
| Durable deferral, including accounting | 3 / 5 | 3 / 5 |
| Catalogue producer plus one actual deferred replay | 14,003 / 26 | 139,643 / 26 |
| Identity queue consumer, 20 successful identities | 44 / 84 | 44 / 84 |
| Synthetic jobs point unit | 4 / 6 | 4 / 6 |
| Total across these separate invocations | 14,054 / 121 | 139,694 / 121 |

Nominal observed D1 cost is $0.000135054 and $0.000260694 respectively, before allowances; these numbers are physical row cost, not conservative ledger charges. Identity executes 48 statements including its 40-statement write batch, leaving little Free-plan per-invocation headroom. The total of 83 statements spans separate invocations and must not be compared as one request against that limit.

In the same isolated timing run, this wider profile summed to 6 ms at 2,000 and 20 ms at 20,000. Stage sums were deferral 1/0 ms, producer with replay 5/19 ms, identity consumer 0/1 ms, and synthetic jobs 0/0 ms, respectively. The original producer comparison table excludes deferred replay and consumers; this wider table explicitly includes one replay and one identity consumer. Neither is a production latency estimate.

The extended fixture contains one deferred row and no existing identity/hire history. It does not establish cost with a large deferred or priority backlog. Its replay is the real helper but excludes the scheduler's additional replay-window lease. Seller probe consumers, real chain indexers, notification recovery, ingest, and all other emitted consumers remain unmeasured. The consumer profile is deliberately representative, not a claim to have exercised every background path or a complete production day. No production quota was increased for this profile.

Behavioral RED/GREEN evidence: health first failed because absent snapshots returned zero and lacked freshness; queue-summary first failed because it counted live rows rather than returning unknown snapshot fields. Both passed after implementation. Numerical calibration initially displayed actual D1 measurements through failing assertions; that calibration is distinct from the behavioral regressions. The final six measurement cases assert the captured counts and independently verify that the existing 500,000 estimate rejects the 20,000/all-due producer.

Focused validation completed: health 28/28; snapshot integration 5/5; capability integration 28/28; final measurement profile 6/6. The measured run took 11.44 seconds overall, including setup and transformations; aggregate SQL timings above are a different metric. Type checking passed. Broader release-suite results should be recorded separately after all concurrent edits settle.

One idle minute currently still enters the budget wrapper before cadence rejects work: 5 reads, 2 writes, 2,005 observed nanoUSD, but 5,002 charged nanoUSD. Each newly admitted full cycle has 9 more physical writes than baseline in this fixture. The actual configured 500,000 work estimate fails with an overrun at 20,000/all-due; a diagnostic-only 14,000,000 estimate was used to measure that complete cycle. No production limit was increased.

## Daily capacity and release decision

Assuming the same workload repeated for 96 cycles/day plus 1,344 idle minute ticks, projected maintenance ledger charges are:

| Fixture | Charged USD/day | Fits $0.015 maintenance lane? |
| --- | ---: | --- |
| 2,000 / sparse | $0.010562304 | Yes, before consumers and other maintenance |
| 2,000 / all | $0.036420096 | No |
| 20,000 / sparse | $0.022623744 | No |
| 20,000 / all | $0.063031296 | No; also exceeds per-unit estimate |

These are scenario projections, not traffic forecasts: real queues, due-state changes and larger evidence histories can change cost. The idle overhead alone charges $0.006722688/day under this schedule. All-due measured cycles issue 107 D1 statements, exceeding the Workers Free limit of 50 queries per invocation; consult [official D1 limits](https://developers.cloudflare.com/d1/platform/limits/). Larger budget estimates do not solve either constraint.

Before reactivation: measure the deployed data distribution and complete producer-plus-consumer lifecycle; avoid repeated charged budget admission for idle cadence windows; partition or materially reduce expensive work; select a cadence/batch size whose daily aggregate leaves room for jobs and public traffic. Verify that denied work is durably deferred and that a heavy cycle cannot lose selected work after an accounting overrun. Re-run numerical tests if schema, indexes, batch sizes or cadence changes. Keep maintenance paused until that evidence fits the agreed allowance.
