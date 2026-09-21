# D1 statistics follow-up after PR #158

## Scope

Local follow-up from `98e5065` (PR #158 merged). Consolidates the snapshot's three
global aggregations into one grouped query. No changes to selection, admission,
leases, cadence, daily budgets, remote configuration or public interfaces.
No migration, index, deployment or resumption is included.

Counts are summed across compatibility groups; timestamps use min/max. Distinct
agents remain counted inside each compatibility group, not summed across
scheduling states. Empty data retains known zero counts and null timestamps;
missing snapshots remain unknown. The existing shared refresh lease is unchanged.

## TDD evidence

- RED: concurrent-refresh test expected one aggregate but observed three before
  the implementation.
- GREEN: one aggregate per refresh, legacy-output equivalence for empty tables
  and multiple endpoints of the same agent across scheduling/compatibility states.
- Existing missing/fresh/stale/error/concurrent snapshot tests remain green.
- The full producer fixtures retain exact selection and budget assertions,
  including the 20,000-agent dense case exceeding the default unit estimate.
- An exploratory repair-index hint failed the healthy-ready scenario: 20,002
  reads at 20,000 agents instead of the proposed <=10 target. That hint was
  removed. The diagnostic fixture remains, asserting no mutations while recording
  its read cost; it is NOT evidence that repair optimization is complete.

## Local measurements

`meta.rows_read` / `meta.rows_written`, deterministic local D1 fixtures, fake queue
and RPC. Both networks, shared origins and sparse/dense due backlogs. Before is
the exact PR #158 producer baseline, not Cloudflare Insights or hourly totals.

| Agents | Backlog | Before reads | After reads | Writes before/after |
| ---: | --- | ---: | ---: | ---: |
| 2,000 | Sparse | 13,998 | 9,998 | 24 / 24 |
| 2,000 | Dense | 31,350 | 27,350 | 276 / 276 |
| 20,000 | Sparse | 139,638 | 99,638 | 24 / 24 |
| 20,000 | Dense | 308,550 | 268,550 | 276 / 276 |

Snapshot aggregation reads fall from 4N to 2N in these fixtures: 80,000 to 40,000
at 20,000 agents. This is a 50% snapshot reduction, NOT a 50% total-cycle saving.
Producer query count decreases by two. Writes and index write overhead are unchanged.
Public health remains 18 reads and zero writes.

The broader sparse fixture includes producer, persisted replay, a real identity
consumer with fake RPC and a synthetic budgeted job unit:

| Agents | Before reads | After reads | Writes before/after |
| ---: | ---: | ---: | ---: |
| 2,000 | 14,054 | 10,054 | 121 / 121 |
| 20,000 | 139,694 | 99,694 | 121 / 121 |

This is not every production consumer or a production billing forecast. Local
duration is logged by the harness, but variable test-host timings are not used
as a latency guarantee. Regression acceptance uses row metadata and behavior.

## Remaining reactivation blockers

- Repair queries still scan broadly in relevant distributions; healthy-ready
  fixtures validate safety, not bounded reads. Partial repair indexes need a
  separate migration and write-cost validation.
- Dense origin ranking remains expensive. No early LIMIT or fairness changes
  were introduced to hide its cost.
- The default 500,000 nano-USD unit reservation is still exceeded by the dense
  20,000-agent producer (546,548 charged). Limits were not increased.
- Daily useful-progress and all-consumer costs must be revalidated before any
  reactivation. Public traffic remains variable and outside this internal cap.

## Verification / eventual release

Worker: 665 unit tests, 414 local D1 integration tests; Worker and root type checks.
Commands: `vitest run --config vitest.config.ts`,
`vitest run --config vitest.worker.config.ts`, `tsc --noEmit`.

PR #158 is merged, but neither it nor this follow-up was deployed in this task.
Release requires separate authorization and the repository's remote-version,
bindings, migration-ledger and pause-preservation checks. This follow-up adds no
migration. Do not unpause cron/queues as part of deployment, and do not infer that
the remote migration ledger or configuration is current from local tests.
