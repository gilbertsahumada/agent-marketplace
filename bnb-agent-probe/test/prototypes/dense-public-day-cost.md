# Frozen 24-hour public read/write economics

Local experiment only. No remote D1, seller, quote, cron or queue was contacted.
Workload `dense-public-day-workload.json` was written before running the test;
SHA256 `2120b6bef1ad1957dd6061e454fcab938e08210f8432c9122d71215f4551a17e`.

Reproduce:

```sh
npm run test:worker -- test/integration/dense-public-day-cost.test.ts --disableConsoleIntercept
```

## What is measured

Both implementations receive the same freshly seeded enriched catalogue, source
events, clock and queries. A uses frozen public readers and **removes every B
projection trigger and its new observation index** for recurring writes. B
restores those objects and enables dense maintenance. A is not charged B's
maintenance writes. No source event is omitted from B to make it cheaper.

The test executes all 96 quarter-hour cycles, rather than multiplying a sample.
Each mutation group executes nine source statements: timestamp/schedule updates,
capability renewal, fresh observation, late observation, duplicate observation,
unchanged capability state, existing job status and existing quote-attempt
status. This does not request any new quote. Each public operation compares
cards, facets and summary deeply against A. Final source counts and state
aggregates must also match. Public queries must write zero rows.

Representative traffic has one group of mutations and one cold public traversal
per cycle, rotating hiring, evaluation and filtered evaluation. The adverse
case has 16 mutation groups per cycle and only one cold traversal in the day.
Only the representative case has the agreed >=50% weighted reduction gate;
the adverse case is deliberately retained even if cost increases.

All counts come from D1 metadata. Weighted units are reads + 1,000 × writes,
including index and trigger writes. Fixture construction, historical backfill,
DDL setup, parity assertions and source-audit queries are outside the recurring
day totals; they are validation/bootstrap costs, not omitted application work.
Their release admission is a separate requirement. This benchmark does not
include background scheduling or claim that C's full-day gate has passed.

## Interpretation

The break-even count divides the measured extra mutation cost by the average
cold-traversal read saving in that same scenario, rounded up. It assumes that
specific mutation volume and observed query/state mix. It is not a traffic
forecast, a universal threshold, a cache estimate or a production invoice.
Cached reads may perform no D1 work at all and therefore cannot amortize new
projection writes through D1 savings.

## Measured results

All four cases passed on 2026-09-26 in 320.85 seconds. Both representative cases
pass the 50% weighted reduction gate with matching responses and source progress.
All 96 cycles were executed in every case; no sample was extrapolated.

| Agents / workload | Before reads | After reads | Before writes | After writes | Before weighted | After weighted | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2,000 representative | 17,895,551 | 1,081,228 | 2,950 | 3,785 | 20,845,551 | 4,866,228 | −76.66% |
| 20,000 representative | 173,838,270 | 9,175,626 | 2,784 | 3,534 | 176,622,270 | 12,709,626 | −92.80% |
| 2,000 write-heavy | 357,592 | 220,593 | 46,122 | 58,923 | 46,479,592 | 59,143,593 | +27.25% |
| 20,000 write-heavy | 2,910,814 | 306,995 | 46,464 | 59,434 | 49,374,814 | 59,740,995 | +20.99% |

Representative traversal requests decrease from 288 (three resources × 96) to
96 combined operations. Both versions perform 96 mutation groups. Adverse cases
perform 1,536 groups and one traversal (three resources versus one). The duplicate
observation attempts are present in both; both retain the same unique events.

At the measured query/state mix, mutation overhead is amortized after **5 / 1**
cold traversals for the representative 2k / 20k cases, respectively. The adverse
cases require **49 / 5**, respectively. These are scenario-specific break-even
calculations, not a minimum traffic guarantee. The adverse increase is a real
tradeoff and remains in the evidence.

Raw results, separate public-read and mutation costs, request counts and local
elapsed times are in `dense-public-day-cost.json`. These results validate this
local B public workload only. Production CPU/memory, schema release safety,
bootstrap admission and 48-hour normalized production savings remain separate
requirements; C's background workload is not validated by this result.
