# Production-code public day, local D1

2026-09-26. Reproduction: `npm run test:worker -- test/integration/public-current-day-cost.test.ts --disableConsoleIntercept`.

**4/4 passed in 352.67 seconds**, with 96 actual cycles per scenario and unchanged frozen workload/thresholds. Baseline A uses the frozen pre-B reader and removes both sparse/current trigger sets and the observation index before measuring mutations. B uses the real combined route, real 0036 sparse triggers, real 0037 guarded UPSERT triggers, and the admitted transactional current-projection backfill. No prototype maintenance is installed.

All returned cards/facets/summary and final source progress match. Public reads cause zero writes. The fixed workload contains both networks but requests Mainnet publicly; the separate Testnet range-read savings are not claimed here.

| Agents / scenario | A reads | B reads | A writes | B writes | A weighted units | B weighted units | Reduction |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2k representative | 17,895,551 | 1,073,876 | 2,950 | 3,601 | 20,845,551 | 4,674,876 | 77.5737% |
| 20k representative | 173,838,270 | 9,122,955 | 2,784 | 3,351 | 176,622,270 | 12,473,955 | 92.9375% |
| 2k write-heavy | 357,592 | 237,971 | 46,122 | 55,989 | 46,479,592 | 56,226,971 | **−20.9713%** |
| 20k write-heavy | 2,910,814 | 323,894 | 46,464 | 56,501 | 49,374,814 | 56,824,894 | **−15.0888%** |

Weighted units = reads + 1,000 × writes. Both representative cases exceed the unchanged 50% gate. The adverse cases remain more expensive and are deliberately retained. Representative workloads execute 96 mutation groups and 96 cold traversals; adverse workloads execute 1,536 mutation groups and one cold traversal. No lower progress is counted as an optimization.

Break-even cold traversals at the same mutation volume/query mix: 4/1 for representative 2k/20k, 38/4 for adverse 2k/20k. This model does not apply to cache hits with zero D1 cost or other production traffic mixes.

## Initial construction, separately measured

Current-projection real backfill including its readiness, reservation and verification controls:

| Agents | Queries | Reads | Writes | Weighted units |
|---|---:|---:|---:|---:|
| 2,000 | 826 | 94,008 | 4,351 | 4,445,008 |
| 20,000 | 8,026 | 929,208 | 43,051 | 43,980,208 |

These are not added to recurring daily totals. They exclude sparse0036 construction, DDL, fixture setup and equivalence audits, and do not replace the shared release admission limit. Both repeated scenarios produced identical construction counters.

## Scope

This is the **B public/read and source-write day**, not the full C producer/consumer/scheduler day. Production public readiness lookups and construction budget controls are included; actual C queue execution, scheduling reservations and background retries are not represented by the fixture. Observations are local simulated source writes, not real seller requests. The production-code migration/ingest regression separately preserves its 94-write limit.

Source hashes and detailed receipts are in the adjacent JSON. Earlier prototype receipts remain untouched. Tests and typecheck passed locally; no remote query, deployment, reactivation or claimed production invoice saving occurred. The 48-hour production comparison remains a separate gate.
