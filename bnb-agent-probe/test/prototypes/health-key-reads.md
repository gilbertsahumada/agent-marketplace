# Bounded health runtime reads

Base: main 9dd502850333f48614df36a80e82d0212b2eca30 (PR176).

Production instrumentation observed 336 reads, one query and zero writes for
`/health`. A local fixture reproduces exactly that cost when SQLite statistics
describe a small runtime_state table that subsequently grows. This establishes
a reproducible cause, not proof of the exact remote sqlite_stat1 contents.

The fix requires the existing primary-key index for this bounded lookup. It
does not add an index, migration, cache, scan, telemetry write or query replay.
The ORM still decodes the same schema fields. Health response semantics,
including missing snapshots and historical scheduler errors, are unchanged.

| Runtime rows; stale statistics | Before reads | After reads | Queries before/after | Writes before/after | Weighted units before/after |
|---|---:|---:|---|---|---|
| 336 | 336 | 17 | 1 / 1 | 0 / 0 | 336 / 17 |
| 2,000 | 2,000 | 17 | 1 / 1 | 0 / 0 | 2,000 / 17 |
| 20,000 | 20,000 | 17 | 1 / 1 | 0 / 0 | 20,000 / 17 |

These fixtures have one matching row and 16 requested keys. With fresh or absent
statistics the original lookup already reads 17 rows; the fix preserves that
cost. The fully populated key fixture is bounded by 32 reads. All variants
perform zero writes and preserve every runtime row and timestamp.

RED: three stale-statistics cases exceeded the required 100-read limit with
`SCAN runtime_state`. GREEN: `SEARCH runtime_state USING INDEX
sqlite_autoindex_runtime_state_1 (key=?)`. Tests compare the complete health
response against the original unhinted query on identical data and clock.

Reproduce: `npm run test:worker -- test/integration/health-key-cost.test.ts`.
The existing health unit suite covers sanitized errors and absent snapshots.
Production verification must preserve pilot/indexer flags, queues and budget;
no migration or ANALYZE is required. Capture one health invocation after release
and report its actual metadata rather than extrapolating fixture savings to
the invoice. The separate degraded-status behavior is deliberately unchanged.
