# Endpoint-only public day: independently measured

Date: 2026-09-26. Local prototype only; not production release approval.

The endpoint-only physical projection contains current declarations, not sentinel rows for agents without endpoints. The registry reader retains those agents through its source join. This report is a new run of the frozen workload, not inherited dense-projection measurements.

## Reproduction and controls

Run `npm run test:worker -- test/integration/endpoint-only-day-cost.test.ts --disableConsoleIntercept` from `bnb-agent-probe`. Result: **4/4 passed in 313.85 seconds**. The corrected run executed all 96 cycles for every scenario; no cost extrapolation replaced execution. An initial incorrectly typed classifier adapter was aborted and excluded.

The workload is `dense-public-day-workload.json`, SHA-256 `2120b6bef1ad1957dd6061e454fcab938e08210f8432c9122d71215f4551a17e`. Fixtures and source mutations are identical for A and B, with both networks. A uses frozen reference readers and excludes B projection triggers and its observation index, so its write cost is genuinely pre-projection. B uses current-declaration triggers, the explicit operational/registry classifier adapter, and the combined public reader.

Representative load has 96 mutation groups and 96 cold public traversals. The adverse case has 1,536 groups but only one cold traversal. Queries rotate hiring, evaluation and filtered evaluation. Mutations include current and late observations, duplicate inserts, no-op updates, capability renewals, scheduling-only changes, existing jobs and quote-attempt updates. No quotes or seller requests are made.

Every public result, facet and summary matches A; source progress matches after the day. Public reads perform zero writes. Fixture preparation, historical construction, schema changes and equivalence audits are excluded from recurrent application totals and require separate initial-cost admission.

## Measured before/after

Cost units are reads + 1,000 × writes; they are not an invoice estimate.

| Agents / workload | A reads | B reads | A writes | B writes | A units | B units | Weighted reduction |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2,000 representative | 17,895,551 | 1,076,020 | 2,950 | 3,785 | 20,845,551 | 4,861,020 | 76.6808% |
| 20,000 representative | 173,838,270 | 9,125,103 | 2,784 | 3,534 | 176,622,270 | 12,659,103 | 92.8327% |
| 2,000 write-heavy | 357,592 | 213,985 | 46,122 | 58,923 | 46,479,592 | 59,136,985 | **−27.2322%** |
| 20,000 write-heavy | 2,910,814 | 299,912 | 46,464 | 59,434 | 49,374,814 | 59,733,912 | **−20.9805%** |

Both representative cases exceed the required 50% saving with equal useful progress. The adverse cases **cost more**, because maintaining projections adds writes while there are too few reads to amortize them. This limitation is retained, not hidden or converted into a pass claim.

At the same measured mutation volume and cold query mix, break-even cold traversals per day are 5 and 1 for representative 2k/20k, and 49 and 5 for write-heavy 2k/20k. This divides additional mutation cost by mean observed cold-read saving and rounds upward. Cache hits with zero D1 work do not amortize projection writes; different production mixtures require new evidence.

## Scope and outstanding validation

Exact counters, query counts, local timings and measured source hashes are in `endpoint-only-day-cost.json`. Typechecking passed before measurement and again after the integrating owner corrected a concurrent UUID argument typing error in the new endpoint-only backfill test. Diff whitespace checks and all four receipt arithmetic checks passed.

The measured combined-reader hash predates an optional seventh diagnostics argument added by the integrating owner. Its default is true and the six-argument behavior used here is unchanged; no new hash is substituted into the historical receipt.

This validates the public-day economic gate locally, not the separate background/C day, initial migration admission, production runtime limits, readiness coverage, or the 48-hour production comparison. No deployment, remote query, migration or process reactivation was performed.
