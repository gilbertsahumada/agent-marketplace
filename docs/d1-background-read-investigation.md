# D1 background reads: blocked draft, not release-ready

Base: `ef11d979cea93712cddc5bdd077c8a15568b891e` (main).
All measurements below use isolated Miniflare D1, a fixed clock and simulated
RPC/queue. No seller requests, remote migrations, configuration changes or
deployments were performed. Do not merge or deploy this draft.

## Proven improvements

| Fixture | Identity before / after | Empty legacy review before / after |
| --- | ---: | ---: |
| 2,000 agents | 4,000 / 20 | 7,204 / 4 |
| 20,000 agents | 40,000 / 20 | 72,004 / 4 |

Large-fixture reductions are 99.95% and 99.994%, respectively. Empty review
writes zero rows. These are statement-level `meta.rows_read`, not requests or
production savings. Identity timings in the measured local run were 1→0 ms
(2k), 2→0 ms (20k); D1's millisecond resolution is too coarse to claim a latency
improvement. The reusable meter records duration and writes for each statement.

The identity baseline uses the original query without the network filter and
without new indexes. RED also proves that the original Mainnet indexer attempted
two Testnet-only identities. The fix adds `chainId=56`; its covering index gives:

```
SEARCH catalog_agents USING COVERING INDEX idx_catalog_agents_identity_discovery
  (chainId=? AND indexState=? AND agentKey>?)
```

The baseline uses a non-covering index plus `USE TEMP B-TREE FOR ORDER BY`.
The legacy partial index alone did not change the optimizer's join order:
72,004 reads remained. Explicit `INDEXED BY idx_catalog_capabilities_legacy_inputs`
was necessary to achieve 4 reads. Consequently migration 0029 MUST precede code.
Testnet no longer invokes this Mainnet-only review. No completion marker is
introduced: a candidate inserted/changed after an empty review is still revisited.

## Blocking counterexamples

Selection SQL is unchanged. All variants select identical messages in identical
order. However, after local `ANALYZE`, the identity index changes other query plans:

| Fixture / indexes | Pending reads | Maintenance reads |
| --- | ---: | ---: |
| 2k baseline | 190 | 8,082 |
| 2k identity only | 7,284 | 7,284 |
| 2k candidate indexes only | 164 | 8,082 |
| 2k all proposed indexes | 7,284 | 7,284 |
| 20k baseline | 80,802 | 80,802 |
| 20k identity only | 72,804 | 72,804 |
| 20k candidate indexes only | 80,802 | 80,802 |
| 20k all proposed indexes | 72,804 | 72,804 |

The 2k baseline pending query uses the existing queue index with a due-date range;
with the identity index it instead joins into capabilities via their primary key.
The regression test deliberately remains RED (7,284 > 190). Do not remove the
assertion, omit `ANALYZE`, or compare only the favorable large fixture.
Initial unanalysed fixtures also showed candidate indexes ignored; index presence
does not establish useful selection. The maintenance index is not yet justified.
Covering candidate indexes in this draft are experimental, not a release proposal.

An existing integration test also fails:
`keeps an all-new Free sweep page inside the row budget` observes **63 writes
against a limit of 60** during ingestion. No budget was increased. A measured
single pending-row scheduling update costs 2 writes before / 3 after indexes,
both 0 ms at the emulator's resolution. Index entries add real write costs.
The 20k identity/legacy experiment grew the DB from 19,816,448 to 21,934,080 bytes
with the initial narrow candidate indexes; the final covering variants are wider,
so this earlier size measurement is not their storage estimate.

## Validation performed and remaining

- Initial RED: identity read ceilings and cross-network isolation fail on original code.
- Current identity and legacy read ceilings pass at both sizes.
- Late legacy discovery, excluded suspended/ineligible rows and current detectors pass.
- Identity first/intermediate/final/wrapped pages and overlapping network IDs pass.
- Fresh DB: normal integration setup applies every migration including 0029.
- Existing DB: fixtures drop new indexes then apply the actual 0029 statements;
  all rows remain and four index definitions exist.
- Worker unit suite: **658/658 passed**, including budget tests.
- Worker integration suite: **327/329 passed**; the two failures are the selection
  read counterexample and the existing Free ingestion write-budget guard above.
- Worker TypeScript check and whitespace diff check pass.
- Existing capability integration tests cover leases, send failures, retries,
  per-origin limits, alternating cohorts and Testnet queue propagation.

Not complete: broader distribution/network performance matrix, full migration
rollback/reapply assertions, final index-by-index write/storage justification,
and an all-green affected suite. Preserve these acceptance gates.

## Required next decision

The planned index-only candidate optimization has not met its acceptance gate.
Investigate a minimal explicit candidate access path (keeping origin ranking,
eligibility, limits and ordering), and account for index write amplification in
the ingestion budget model. Both need review of scope; do not silently raise
budgets, change batches/concurrency/frequency, or ship this migration as-is.

## Production evidence is a separate series

Prior read-only Insights observation: identity query 2,111,302,334 sampled reads
over 5,929 executions; legacy review 766,414,271 over 2,672 executions, zero writes.
Those adaptive Insights figures are NOT additive with hourly/daily D1 totals.
For example the separate daily aggregate for September 19 was 3,885,591,739 reads
over 115,978 queries. These historical observations motivate investigation;
they are not local benchmark results or a production savings forecast.

## Later release procedure (requires authorization)

1. Resolve all RED gates; review and merge the final PR.
2. Re-check remote main, active Worker version, target DB/bindings, flags, queues
   and scheduler. Reconcile other sessions; preserve remote manual-run settings.
3. Compare migration ledger and actual schema; create and verify a recoverable backup.
4. Apply required additive migration before deploying code that names its index.
5. Verify schema/config/health and restore previous code if rollout fails; do not
   drop indexes while code explicitly references them.
6. Compare equivalent traffic/time windows, reads and writes, query mix, queue
   delay, retry/error rates and index storage. Keep Insights and aggregate totals
   separate. Only then report observed production impact.

## Reproduce locally

From `bnb-agent-probe`:

```
npm run test:worker -- test/integration/d1-background-reads.test.ts --silent=false --reporter=verbose
npm run test:worker
npm run test:unit
npm run typecheck
```

The benchmark prints statement metadata and query plans; a failing selection
ceiling is expected in this draft, not an accepted regression.
