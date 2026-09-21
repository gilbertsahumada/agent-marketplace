# Provider selection experiment — BLOCKED, do not deploy

## Decision

The proposed query-only materialization strategy is rejected. It preserves
selected messages in the measured cases but increases D1 reads in all 36 cases.
There is no production code change in this PR. Do not merge this as a performance
improvement or resume background processes on the strength of these results.

Base: main 6632f989807cb849a95a6458aca9afb6ec069699, containing #159 and #161.
No #160 indexes, schema changes, migrations, budget/cadence changes, remote seller
requests, deployment or reactivation. Other-session changes and submission stay
untouched.

## Reproduction and RED evidence

The test-only baseline freezes the enqueue selector from that commit. The
test-only experiment replaces per-candidate origin reservation checks with:
eligible AS MATERIALIZED -> distinct origins -> available origins -> ranking.
Both retain the original range/network access paths, effective-state predicate,
cohorts, limits, ranking and atomic claims.

Each run starts from a freshly seeded identical database and controlled clock.
Both networks run in the same order so origin reservations remain shared.
Fixtures span 2,000/20,000 agents; empty/sparse/dense backlog; shared/unique/skewed
origins; with and without planner statistics. Each test compares exact messages
and queue summaries, selector reads/writes and whole enqueue reads/writes.

The first run used the real acceptance assertions (no read regression and 20%
savings for dense/shared 20k). All 36 cases failed on cost, not output parity.
After that gate failed, production was restored byte-for-byte and the experiment
was isolated to tests. The committed tests certify this rejection explicitly:
their passing status is NOT GREEN for the optimization criteria.

Run from bnb-agent-probe:

```sh
./node_modules/.bin/vitest run --config vitest.worker.config.ts test/integration/provider-selector-cost.test.ts
```

The harness logs complete plans, query counts, duration, selected messages and
summary metrics. Sanitized captured measurements are in
d1-provider-selection-measurements.json; representative plans for dense/shared
20k with statistics are in d1-provider-selection-plans.txt.

## Measurements

Selector-only rows read, both networks and cohorts, with planner statistics:

| Agents | Backlog / origins | Original | Experiment | Change |
| --- | --- | ---: | ---: | ---: |
| 2,000 | empty / shared | 1,214 | 1,216 | +2 |
| 2,000 | sparse / shared | 1,578 | 1,726 | +9.4% |
| 2,000 | dense / shared | 19,203 | 27,561 | +43.5% |
| 20,000 | empty / shared | 12,014 | 12,016 | +2 |
| 20,000 | sparse / shared | 15,618 | 17,026 | +9.0% |
| 20,000 | dense / shared | 188,403 | 268,401 | +42.5% |
| 20,000 | dense / unique | 228,003 | 347,997 | +52.6% |
| 20,000 | dense / skew | 188,011 | 248,021 | +31.9% |

The four selector queries write zero rows. Whole enqueue writes are unchanged
between implementations; dense/shared 20k writes 264 rows in this isolated
harness. That harness excludes the surrounding maintenance statistics/budget
controls: its totals must not be presented as the complete producer cycle.
Host-local durations are recorded, not a production latency guarantee.

Plans show scans of the materialized eligible set, a temporary DISTINCT B-tree,
materialization of available origins, an automatic covering index for the join,
and the original ranking/sorting work still present. Deduplicating origin checks
does not offset this additional work, including when every agent has its own
origin. Missing statistics do not reverse the result.

## Validation and deliberately incomplete acceptance

- 666 unit tests and 466 integration tests pass, including 36 rejection cases.
- Worker type checking and diff checks pass.
- No production source changed; the existing daily profile and public-route cost
  tests run against unchanged production, NOT against the rejected experiment.
- No new 96-cycle experiment, full economic acceptance, or exhaustive concurrency
  comparison is claimed: the mandatory single-cycle no-regression gate already
  failed, so that extension stopped.
- Existing leases, retries, buyer quotes, health and public-route suites remain
  unchanged. Their success does not validate a production replacement selector.
- The existing dense complete-cycle reservation blocker (506,547 vs 500,000)
  remains unresolved. No limit was increased and no adverse fixture removed.

## Next decision

Do not deploy this experiment. A different query-only design needs a new measured
hypothesis; this result does not prove all SQL rewrites are impossible. A persisted
provider scheduling structure is outside the authorized scope and would need a
separate design/approval covering its writes, synchronization and migration.
Keep remote pauses. This draft is evidence and a reproducible cost gate, not a
release candidate.
