# D1 repair indexes — draft, economic gate NOT approved

## Status and scope

Dependent on PR #159 (`020837a`). No merge, remote migration, deployment or
reactivation. No changes to cadence, budgets, selection, API or evidence policy.
The worktree is isolated; the submission branch and other sessions are untouched.

The two partial indexes and expression-based repair query are functionally
validated. **They are not approved for rollout:** mass expiry and mass restoration
increase the weighted daily cost. This draft preserves the implementation and
reproducible evidence; green functional tests do not mean the economic gate passed.

## TDD and query plans

RED: healthy-ready fixtures read 4,000 / 40,000 rows at 2,000 / 20,000 agents,
against a <=20 target, with no modifications. GREEN: 4 reads, zero writes.
Also covered stale rows with one expired or null evidence date.

Unhinted EXPLAIN QUERY PLAN selects:

- `idx_catalog_capabilities_restorable (<expr>>?)`
- `idx_catalog_capabilities_ready_expiry (capabilityExpiresAt<?)`

No INDEXED BY hint is necessary in the measured distributions. The restoration
expression is scalar `MIN(capabilityExpiresAt, compatibilityExpiresAt)`: either
null input yields null and cannot qualify, exactly like the former pair of >
comparisons. Expiry remains inclusive (`<=`). Index predicates exclude suspended
and failed rows from restoration and retain all existing eligibility conditions.

The new additive migration is `0031_capability_repair_indexes.sql`. Existing
indexes remain unchanged. Tests apply all migrations to a fresh local database,
then separately remove only the new indexes and apply the new migration over
populated pre-index tables. The declared Drizzle schema contains both indexes.

## Measurements and failed economic gate

D1 local `meta.rows_read` / `meta.rows_written`; weighted cost uses the same
planning units as the existing budget: one per read, 1,000 per write. These are
not Cloudflare Insights, invoice totals or a production savings forecast.

At 20,000 agents, expiry-only repair measurements:

| Candidates | Before reads | After reads | Before writes | After writes |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 40,000 | 4 | 0 | 0 |
| 4 | 40,004 | 19 | 16 | 20 |
| 20,000 | 60,000 | 80,002 | 80,000 | 100,000 |

The 24-hour simulation advances a controlled clock through 96 fifteen-minute
cycles, with the first cycle performing the repairs and healthy evidence otherwise
valid for two days. No external arrivals are silently assumed or excluded from
an alleged full-production forecast.

With 20,000 simultaneous expirations, daily weighted cost is **83,860,000 before
versus 100,080,382 after** (~19% worse), excluding one-time index construction.
The test records `approved=false`. Mass restoration also fails the daily gate.
Empty and four-candidate scenarios pass at both fixture sizes. Inserts, expiry
updates and state transitions all have measured additional index writes.

Construction is measured separately: for the 2,000 ready-row fixture, 6,042 reads
and 2,002 writes. It is not amortized away or included as steady-state savings.
The harness logs per-query durations; these local host timings are diagnostic,
not a production latency commitment.

Complete producer fixture versus PR #159, with no repair candidates:

| Agents / backlog | Before reads | After reads | Writes unchanged |
| --- | ---: | ---: | ---: |
| 2,000 / sparse | 9,998 | 6,002 | 24 |
| 2,000 / dense | 27,350 | 23,354 | 276 |
| 20,000 / sparse | 99,638 | 59,642 | 24 |
| 20,000 / dense | 268,550 | 228,554 | 276 |

The broader sparse producer/replay/identity-consumer/synthetic-job fixture falls
from 99,694 to 59,698 reads at 20,000 agents, still 121 writes. It does not cover
all production consumers. Dense producer reservation still overruns the default
500,000 estimate (506,552 charged); limits were not raised.

## Validation

- Exact comparison of all repaired columns with legacy queries, including dates,
  nulls, equality boundaries, both networks, failures, suspended states and missing
  prior success; concurrent execution and idempotence.
- Sparse and mass expiration/restoration, migration costs, expression query plans,
  index write overhead and explicit economic pass/fail results.
- Full local Worker suites: 665 unit + 424 D1 integration tests; type checks.
- Existing candidate order, shared repair count, origin limits, leases, publication
  failures, cadence and budget tests remain in the full suite.

## Next step and release constraints

Do not merge/deploy these indexes as an approved cost fix while the economic gate
fails. Next investigation must reduce avoidable state/index write amplification
or demonstrate a justified workload threshold; do not silently remove the mass
scenario or increase budgets. Selection-by-origin optimization remains separate.

Only after economic approval and explicit release authorization: inspect the
active Worker, bindings, remote configuration and migration ledger; verify a
recoverable backup; apply migration before code; verify schema and health; keep
cron/queues and manual-run controls paused. No remote state was checked or changed
by these local tests. A later rollback must account for index write overhead,
not only revert the Worker code.
