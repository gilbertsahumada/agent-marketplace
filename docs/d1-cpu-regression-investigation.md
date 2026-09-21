# D1 CPU regression investigation — 2026-09-21

## Priority and scope

Highest-priority release blocker for the read-cost reduction. No remote writes,
deployments, probes, quotes, scheduler changes or seller requests were performed
in this investigation. Work is isolated on `codex/d1-cpu-regression`.

The historical dominant costs remain identity discovery and legacy compatibility
rediscovery (see `d1-background-read-investigation.md`). Query executions and rows
read are different metrics: fewer returned rows do not imply fewer billable reads.
No dollar savings or post-release production savings are claimed here.

## Evidence

The verified local backup contains 182,339 identities (182,055 Mainnet / 284
Testnet), 34,034 capability rows, 2,860 endpoints and 40,683 agent-endpoint links.
Its SQLite planner statistics are partial: some endpoint/join indexes have old
statistics while identity/capability indexes do not. The original fixtures
covered no statistics and complete ANALYZE, but not this mixed state.

The attempted release selected capability date ranges with INDEXED BY. That
forces an index, **not the join order**. In the reproduced plan SQLite starts
with current Mainnet identities, then repeatedly scans the due-date capability
index for each joined identity. The agent key is not the leading column of that
index, so the lookup is not a cheap key lookup. This produces multiplicative
work even with a small final LIMIT, which is applied after ranking.

Local reproduction of this defect is confirmed. Its consistency with the remote
CPU resets is strong evidence, but the remote error did not identify a specific
SQL statement; this does not prove that no other concurrent workload contributed.

## TDD

A new deterministic D1 integration test seeds 2,000 / 20,000 synthetic agents,
sets due work, runs ANALYZE, removes only identity/capability statistics and reloads
the planner. No production identities or buyer data enter the fixture.

RED at 2,000 agents: one selector read **1,809,683 rows**, exceeding the 60,000
ceiling. The same mixed statistics exposed a legacy-rediscovery regression:
an empty lookup read 9,004 / 90,004 rows instead of remaining constant.

Correction:

- Mainnet due ranges remain outermost, with keyed lookups anchored using CROSS
  JOIN plus the same ON predicates. Eligibility, ordering, limits and leases
  are unchanged. No early LIMIT discards origins.
- Testnet keeps the original unconstrained query. Its small network slice can
  use agent-key lookups instead of scanning global Mainnet capability ranges.
  This is an access-path choice, not a different availability policy.
- Legacy rediscovery likewise anchors the selective old-detector range before
  identity/endpoint lookups. Its empty lookup is bounded to <=10 D1 reads.
- Bootstrap-disabled selection retains the original SQL path.
- Benchmark baseline reconstruction removes both the range rewrite and join
  anchors, so baseline measurements do not accidentally include the fix.

## Same-backup comparison

The queries were captured from the real scheduler with a fixed clock
(`2026-09-20T22:22:00Z`), no-op D1 responses and a queue that cannot send. They
were then executed on a disposable local SQLite copy of the verified backup.
All variants start from the same data. A progress handler interrupts execution
at 20 million VM steps; writes used for the legacy lookup are rolled back.

These are **approximate SQLite VM instructions**, sampled every 1,000 steps,
not D1 `rows_read`, invoice amounts or remote latency measurements.

| Query | Original, before indexes | Attempted release | Local correction |
| --- | ---: | ---: | ---: |
| Mainnet pending | 4,025,000 | interrupted at 20,000,000 | 1,808,000 |
| Mainnet maintenance | 3,597,000 | interrupted at 20,000,000 | 1,243,000 |
| Testnet pending | 6,000 | 12,112,000 | 5,000 |
| Testnet maintenance | 6,000 | 8,330,000 | 5,000 |
| Empty legacy lookup | 2,330,000 | <1,000 | <1,000 |

Ordered result digests match the original query for all four selectors. The
backup's two Mainnet cohorts returned one and two candidates; Testnet returned
none at this fixed instant. Synthetic suites additionally exercise populated
Testnet cohorts, alternating order, shared origins, expiry and publication errors.

Removing INDEXED BY, materializing the range and refreshing statistics were also
examined locally. A simple global range fix still made the tiny Testnet selection
more expensive than its previous network-specific plan; the final correction
therefore preserves that original path. No ANALYZE was executed remotely.

## Validation and next release

Run from `bnb-agent-probe`:

```sh
npm run typecheck
npm run test:worker -- test/integration/d1-background-reads.test.ts
npm run test:worker
npm run test:unit
```

The benchmark includes identity/empty-rediscovery savings, partial statistics,
rare-network distributions, dense/sparse due rows and original selection order.
Final local validation: **347 integration tests, 662 unit tests, typecheck and
diff whitespace checks passed** (1,009 tests total).
No new migration is required; the four indexes from the previous release already
exist. Do not remove or rename applied migrations.

Before another authorized release: review this small correction, recheck current
main and active remote configuration, then verify health and both catalogs. Only
then compare equal-duration production read/write/error windows, reporting the
token-backfill workload separately. If costs require immediate containment,
pausing or reducing nonessential discovery needs an explicit operating decision;
this investigation did not change cadence or queue processing.
