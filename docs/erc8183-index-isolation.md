# ERC-8183 index-only release

This release isolates execution; it does not authorize raising budgets, changing
quote availability, applying projection migrations, or resuming agent probes.

## Controls

- `BACKGROUND_INDEX_ONLY=1` opts into exclusive indexing. Cost controls must be `1`.
- `BACKGROUND_INDEX_PAUSED` must explicitly be `0` to admit indexing. Missing or
  other values pause it. Existing jobs/maintenance pause flags remain unchanged.
- `COMMERCE_INDEX_QUEUE` is a dedicated producer binding. The index-only producer
  refuses to fall back to the shared queue. Keep the two existing queues paused.
- Provision a dedicated consumer with batch size 1 and concurrency 1. Start paused.
- `STAGING_MANUAL_RUN=1` continues to prevent automatic work. Preserve its remote value.
- `COMMERCE_INDEX_ENABLED` and existing kill switches still apply.
- The index-only producer skips notifications, identity/protocol/capability checks,
  automatic quotes and automatic token backfill, even if their own flags are enabled.
- Consumer admission allows only `index_range` and `index_jobs`. Other parsed
  messages are durably deferred before ACK; persistence failure leaves them unacked.
- Deferred replay filters index tasks before its existing five-message limit and
  does not remove unrelated jobs. It remains metered and can scan a deferred lane;
  this is not a claim of constant-cost replay over arbitrary backlogs.
- Jobs budget, reservations, settlement and denial backoff remain unchanged.

## Recovery semantics

Cursor-driven messages read from persisted cursor + 1 to the safe head in bounded
windows. Data and cursor writes remain atomic. Missing cursors initialize at the
safe head: they do NOT reconstruct earlier history. Gaps before an existing cursor
require a separately reviewed explicit range. Message expiry does not erase chain
logs, but RPC history availability and budget can prevent or delay recovery.

Explicit range continuations prefer the dedicated queue when bound. Normal cursor
messages do not recursively enqueue history; later scheduled ticks make progress.
Do not feed an explicit historical range into the initial single-batch experiment.

## Validation

TDD baseline: three new isolation tests failed, sixteen existing background-worker
tests passed. Initial implementation: nineteen passed. Additional coverage checks
mixed deferred work, budget exhaustion, manual-run protection and missing dedicated
bindings. Run background-worker, deferred-background, background-budget, cadence,
commerce-index and commerce-index-hardening suites, then full Worker suite/types.

## Release sequence (not executed by adding this document)

1. Refresh remote main, deployed version, bindings, queue settings and effective
   variables. Compare the migration ledger/schema; this release adds no migrations.
   Preserve unrelated session work and all existing remote controls.
2. Review PR and CI. Provision the dedicated queue and its paused consumer only;
   do not resume either existing queue. Build deployment configuration from verified
   remote configuration plus this new binding/consumer, not stale repo defaults.
3. Deploy reviewed code with index-only mode enabled and index pause enabled,
   cron empty, existing queues paused. Verify health and effective configuration.
4. Re-read cursors and available jobs budget. Confirm RPC configuration without
   exposing credentials. Record cursor, budget and source version as baseline.
5. With cron still empty, unpause only the dedicated consumer and index admission;
   send exactly one cursor-mode `index_range` message for one configured network.
   No explicit backfill or old shared-queue replay in this first experiment.
6. Inspect logs/summary, cursor, actual read/write charge, errors and duplicates.
   If failure, denial or ambiguous completion occurs, pause the dedicated consumer
   and index admission. Do not increase budgets or blindly resend.
7. Only after that gate passes, enable the existing minute cron with index-only mode.
   It will publish only cursor indexing plus bounded index-only deferred replay.
   Keep both old queues paused and existing jobs/maintenance pause flags unchanged.
8. Update monitoring to separate indexing from public reads. Capture progress and
   budget consumption; no repeated catalogue requests for monitoring. UI must not
   claim 'up to date' without an observed safe-head comparison.

Rollback: pause the dedicated consumer and index admission, remove the new cron,
then restore the reviewed previous Worker version/configuration if necessary.
Never reset cursors, delete deferred work, or revert unrelated sessions' changes.
