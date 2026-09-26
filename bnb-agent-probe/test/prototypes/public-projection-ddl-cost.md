# Projection DDL admission evidence

Local D1 measurements for migrations 0036 and 0037, using an empty source and 8,000 synthetic observations. No remote requests or backfill. The adjacent JSON preserves statement-level metadata. Reproduce with `npx vitest run --config vitest.worker.config.ts test/integration/public-projection-ddl-cost.test.ts`.

| Source observations | DDL and ledger/preflight reads | Writes | Weighted units | History-index reads | Index writes | Index units |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 164 | 44 | 44,164 | 2 | 1 | 1,002 |
| 8,000 | 166 | 44 | 44,166 | 16,113 | 8,001 | 8,017,113 |

Weighted units are reads + 1,000 × writes, not the internal conservative charge or a billing prediction. Fixed work includes all migration statements except the history index, creating a synthetic Wrangler-style ledger, inserting its two entries, and one schema and one ledger inspection. The actual test migration ledger is preserved. Fixture setup/teardown and result assertions are outside these measurements.

An external 250,000-unit allowance for this fixed work is more than 5.6 times the observed fixed cost. It excludes the history index, both backfills, global bootstrap/verification, other control queries, and failed-attempt allowance; those require separate admission. This is a local estimator, not a hard cap or proof of remote cost.

For the index, the local conservative admission estimate is `(3 × source rows + 250)` reads and `(source rows + 10)` writes. The measured build reads approximately twice the source rows. An exploratory `2 × rows + 100` estimate missed 13 reads of overhead in the populated fixture and was rejected; no pre-existing optimization gate was weakened. A larger or differently shaped source must retain margin and be checked against actual metadata. Empty projection tables after installation confirm no hidden historical backfill occurred.

Validation: two local tests passed; Worker TypeScript check passed. No migration, deployment, or reactivation was performed.
