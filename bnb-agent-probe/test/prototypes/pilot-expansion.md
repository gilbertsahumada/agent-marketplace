# Controlled six-agent expansion

Only Mainnet 204789, 212769, 212943, 213036, 213084 and 213432 are added.
No global selector, general backfill, new queue, higher budget, changed freshness
or automatic quote. Original 13 IDs remain valid. Existing original seed URL
still seeds only its original cohort; the new authenticated `/__admin/renewal-pilot/seed-expansion`
is closed unless the existing temporary seed flag is on and the pilot is paused.

## Migration caveat and preservation

0039 is a **new migration, but not strictly additive**: SQLite CHECK constraints
require rebuilding the tiny pilot task table to widen the fixed allowlist.
0038 is untouched. All 19 columns, states, generations, pending publications,
execution fences, failures, timestamps and leases are copied in the migration
transaction. Origin scheduling and source/evidence tables are not rewritten.
There are still the same three task indexes; unknown IDs and Testnet are denied.
Local tests cover upgrade with thirteen tasks across all states, rollback of a
failed atomic migration, original origin preservation, and fresh migration chain.
This caveat must be reviewed before any remote migration; no remote change made.

## TDD and measured comparison

RED: six IDs rejected by existing policy, missing upgrade migration. GREEN:
exact allowlist, preserved original tasks, isolated seed, idempotency, fresh public
requestability after discovery without sample parameters. Buyer hiring remains
unavailable without its own verified quote. Existing failed capability state is
not rewritten to ready; current compatibility/evidence controls requestability.

Both 2,000 and 20,000 unrelated-agent fixtures produced the same measurements:

| 48 hours | Queries | Reads | Writes | Weighted units | Completed | Seller requests |
|---|---:|---:|---:|---:|---:|---:|
| Original 13 | 12,424 | 23,664 | 1,539 | 1,562,664 | 39 | 39 |
| Expanded 19 | 12,830 | 25,582 | 2,247 | 2,272,582 | 57 | 57 |
| Difference | +406 | +1,918 | +708 | +709,918 | +18 | +18 |

Zero quotes in both. Complete invocation metadata includes producer/consumer
admission and reconciliation, not only discovery. Every simulated daily
maintenance ledger stays below the unchanged 15M limit. Each minute publishes
at most one task; all agents have fresh compatibility at the end. This increases
total cost to do more work; it is **not a savings claim** versus the 13-agent pilot.

One-time costs, separately: six-agent seed 20 queries / 109 reads / 29 writes /
29,109 weighted units. Migration of thirteen tasks 7 queries / 873 reads /
126 writes / 126,873 weighted units. Weighted units are reads + 1,000*writes,
not an invoice or conservative admission ledger. No production cost projection
is inferred from these fixtures.

Reproduce: `npm run test:unit`, `npm run test:worker`, `npm run typecheck` in
bnb-agent-probe. Targeted files: pilot-expansion-schema, pilot-expansion-migration,
pilot-expansion, pilot-day-cost. Exact original recurring thresholds are retained;
new cohort has separate measured assertions, no runtime budget changes.

## Release gates — not executed

1. Review/CI and fresh remote main/configuration/bindings/schema checks. If 0039
   is taken by another release, renumber before merge; never edit published SQL.
2. Confirm current maintenance headroom and initial-installation ledger. Preserve
   delivery C's 150M reservation. Verify a recoverable backup. Approve the table
   rebuild explicitly as part of release review.
3. Pause only the pilot and drain in-flight work before schema upgrade. Preserve
   indexation, old queue pauses, STAGING_MANUAL_RUN and other settings. Verify
   row-for-row task and origin preservation, then deploy compatible code with
   pilot still paused. On migration failure, stop; do not seed or resume.
4. Enable temporary seed gate, call only seed-expansion. Require admitted=6 and
   unavailable=0; otherwise investigate, never bypass endpoint/state checks.
   Existing backoff and leases win. Disable seed gate before reactivation.
5. Resume only authorized pilot. Observe actual discovery (not forced quotes),
   budget and public requestability. Sellers may fail: do not promise 19 live.
6. Rollback by pausing pilot; do not downgrade code while new IDs have deliverable
   messages, because old parsers reject them. Preserve agenda data and indexer.

This does not finish delivery C or extend the current observation window.
