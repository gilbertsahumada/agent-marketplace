# Production combined handler: local D1 cost gates

Measured 2026-09-26 against the frozen enriched 2,000/20,000-agent fixtures and source-reader reference. This exercises `src/routes/catalog-combined.ts`, the production classifier through Drizzle, both readiness checks, and real local checkpoint/backfill completion. No remote traffic or deployment.

| Fixture | Query | Before reads | After reads | Reduction | After writes |
| --- | --- | ---: | ---: | ---: | ---: |
| 2,000 | Hiring | 128,190 | 13,666 | 89.34% | 0 |
| 2,000 | Evaluation | 169,012 | 13,525 | 92.00% | 0 |
| 2,000 | Evaluation + protocol/category/reachability | 195,045 | 13,575 | 93.04% | 0 |
| 20,000 | Hiring | 1,221,818 | 116,625 | 90.45% | 0 |
| 20,000 | Evaluation | 1,631,632 | 116,398 | 92.87% | 0 |
| 20,000 | Evaluation + protocol/category/reachability | 1,869,721 | 116,497 | 93.77% | 0 |

Each old three-resource operation executes 13 SQL statements; the new one-resource handler executes 12, including readiness. SQL statement count is not HTTP request count. Cards, facets and summary match the frozen reference exactly; the response contains only these three keys, without prototype diagnostics. All fixed 20,000-agent ceilings and the 2,000-agent 80% requirement pass. Query plans and per-query reads are in the adjacent JSON.

## Standalone resource gates

The expanded run (`catalog-combined-production-cost-evidence.expanded.json`) also tests the production facets and summary handlers. Each performs exactly three SQL statements: two readiness lookups and one classification, with no page enrichment and zero writes. Mainnet reads are 11,439 at 2,000 agents and 114,331 at 20,000 agents, below 44,737/218,208 respectively. Both Testnet handlers read 82 rows in these fixtures. Outputs match the frozen reference. Explicitly removing planner statistics after capturing both frozen baselines preserves all 20,000-agent figures and both networks' outputs.

An initial expanded attempt changed planner statistics after the 2,000-agent fixture, before capturing the 20,000-agent frozen baseline; its owned local Worker became CPU-bound and was interrupted. Its result is not accepted evidence. The corrected run captures both reference baselines before the adversarial statistics pass, matching the established benchmark sequencing. Both interrupted processes were verified exited; the corrected run passed and exited normally. No thresholds or reference queries were changed.

## Backfill measurement boundaries

The `construction` field in the JSON records only `beginPublicCurrentBackfill` and subsequent current-projection steps, after fixture ingestion and sparse-projection completion. It is **not** the total migration or historical-load cost. Source triggers already maintained rows during fixture ingestion; the measured backfill deliberately revisits and verifies them. Table/index construction, fixture ingestion writes, sparse-history construction and release-level failed-attempt reserves are excluded and remain separate release gates.

- 2,000 agents: 94,008 reads, 4,351 writes, 826 statements.
- 20,000 agents: 929,211 reads, 43,050 writes, 8,026 statements.

The 200-million-unit fixture admission is local-only test setup, not authorization to raise a production budget. No projection-ready checkpoint is fabricated. Readiness setup is excluded from public per-request figures but the request's own readiness checks are included.

## Remaining limitations

These figures prove local cold-query gates, not production invoice savings or the 48-hour production criterion. D1 durations are local emulator measurements. Cache-hit behavior belongs to the outer Worker cache path, not this direct-handler benchmark: it must remain before the handler to preserve zero-D1 hits. Checkpoint/DDL invalidation requires a corresponding cache-release strategy; adding a D1 readiness lookup to every cache hit would violate that requirement.

The production handler still materializes operational classification per cold request. The separate endpoint-only runtime experiment covers four bounded concurrent requests at observed cardinalities, but does not guarantee peak memory for arbitrary metadata or longer bursts. Registry is intentionally rejected by this new operation and retains its existing paginated reader. No memory/CPU billing reduction is inferred from SQL reads alone.

Reproduce: `npx vitest run --config vitest.worker.config.ts test/integration/catalog-combined-cost.test.ts --reporter=json --outputFile=/private/tmp/catalog-combined-cost-report.json`. Each test's `meta.d1Cost` contains the inspectable evidence. Companion classifier parity tests and TypeScript checks also passed.
