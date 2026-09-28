# Fixed Mainnet discovery renewal pilot

Base: PR175 measurement, merged into main b595bc5. Only the 13 approved agent keys can be inserted, enforced in code and migration 0038. No previous migration is edited. The broader agenda draft is not deployed.

## Safety and behavior

- Default paused; seed endpoint also disabled. Seed requires bearer authentication, pause, cost controls and explicit temporary seed enablement.
- Indexing remains independent; the old queues and general maintenance remain paused.
- Dedicated queue, batch/concurrency one; global durable 60-second producer window, one admitted task per window, per-origin execution lock/quota.
- Discovery checks protocol and negotiation requirements. There is no call to quote creation or hiring. GET responses are shared only within a single validation; MCP discovery may use protocol POSTs, never a negotiation tool call.
- Successful evidence lasts 24h; next validation is deterministic at 22–23h. Later capability backoff wins. Evidence renewed during queuing causes deferral, not another vendor request.
- Durable pending publications retain run ID after ambiguous send. Generations, execution fences, source guards and leases reject duplicates and late results. Evidence and completion commit atomically.
- Existing maintenance budget only: no increase and no jobs borrowing. Unknown accounting fails closed. ACK after a budget deferral is safe because the durable agenda retains the work.
- Empty cycles perform bounded index/key reads and zero writes. No historical catalogue scan or backfill. Seed chooses one current eligible endpoint per approved ID.

## Measured before/after

| Scenario | Queries | Reads | Writes | Weighted units | Completed |
|---|---:|---:|---:|---:|---:|
| Pilot paused (before) | 0 | 0 | 0 | 0 | 0 |
| 48h, 2,000 unrelated agents | 12,424 | 23,664 | 1,539 | 1,562,664 | 39 |
| 48h, 20,000 unrelated agents | 12,424 | 23,664 | 1,539 | 1,562,664 | 39 |
| New empty schema only | 6 | 10 | 8 | 8,010 | N/A |

Weighted units = reads + 1,000 × writes, not invoice or internal conservative reservation. Both full simulations use the real producer and consumer including admission, reconciliation and ACK, with simulated seller HTTP. All 13 are fresh at the end; 39 seller requests, no quotes. Each daily maintenance ledger remains below the unchanged 15M allowance. JSON evidence is adjacent. Seed/release controls are separate and must be measured at release.

The earlier execution-only diagnostic omitted 39 consumer preflight checks: 156 reads. That is corrected, not claimed as savings. Removing an unused generic-backfill marker saves 2,958 queries with unchanged reads. No percentage improvement is claimed against disabled work.

## RED/GREEN and validation

Tests caught raw prepare calls outside the ORM boundary, stale commit self-invalidation, missing simulated protocol URL and omitted consumer accounting. Those were corrected. Additional tests cover unsupported IDs/networks, concurrent producers/consumers, expired leases, ambiguous publication, newer evidence, removed declarations, suspension, vendor failure, invalid requirements, backoff and exhausted maintenance budget. Public contracts and buyer quote checks are unchanged.

The six added sqlite_master objects increase historical prototype DDL construction by exactly six reads. Three old test files explicitly account for this fixed setup cost; runtime query thresholds, trigger costs, backfill-page limits and budgets are unchanged. This is installation overhead, not recurring public regression.

Reproduce with `npm run typecheck`, `npm run test:unit`, and `npm run test:worker` inside bnb-agent-probe. Fresh migration-chain integration tests and a SQLite upgrade test verify additive schema and preserved existing objects/data. DDL measurement test isolates installation from seed and public history.

## Release gates

1. Verify current main, deployment, database binding, migration ledger and effective flags/queues. Preserve concurrent changes. CI and diff review must pass.
2. Verify a recoverable backup. Reserve conservative installation overhead against the existing release ledger without reducing the 150M reserved for C; do not perform a historical backfill.
3. Apply only 0038 and verify objects. Create dedicated queue paused. Deploy with pilot/seed disabled, preserving all remote configuration and indexer settings.
4. Temporarily enable authenticated seed while pilot stays paused. Require admitted=13, unavailable=0 and check bounded work dates/budget; otherwise do not activate.
5. Disable seed, activate only pilot flag and dedicated queue. No synthetic quote, forced early renewal or budget increase.
6. Validate publication and actual discovery via sanitized logs; establish a separate 48h observation. Rollback by pausing only pilot flag/queue, preserving agenda data/indexer/public catalogue.

PR175 deployment cut the PR171 observation near 2026-09-28 10:24 UTC. Do not merge versions or turn partial old metadata into a savings percentage. Pilot production renewals remain unverified until observed; local simulation does not complete the production observation or delivery C.
