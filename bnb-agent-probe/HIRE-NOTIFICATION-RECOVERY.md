# Funded hire notification recovery

The marketplace persists a verified funded job before contacting its seller. The
Worker stores one record per chain/job. Repeated requests cannot replace its
buyer, agent or quote binding. Concurrent runners claim a two-minute lease;
expired leases recover after process termination. A fenced dispatch is never
sent again automatically. Unknown delivery outcomes are checked against the
chain and move to attention after six total attempts. Pre-dispatch outages retry
with exponential delay, bounded at one hour. No buyer wallet transaction is part
of recovery.

An agent without a notify_funded skill is recorded as awaiting the agent, without
claiming it received a notification or actually watches the chain. Delivery and notification are separate statuses.
An uncertain request may require operator coordination with the seller; this
implementation does not assume external sellers support idempotent resends.

## Release

Follow AGENTS.md's deployment audit and backup requirements. Check the active
Worker, exact database/bindings, migration ledger and remote settings first.
Migration 0028_hire_notifications.sql must be applied after prior migrations,
with a verified recoverable backup, before enabling this feature.

Deploy the Worker and app code with recovery disabled. Configure the same new
HIRE_NOTIFICATION_RUNNER_SECRET in both services, and set the Worker's
HIRE_NOTIFICATION_RUNNER_ORIGIN to the exact HTTPS application origin.
Enable HIRE_NOTIFICATION_RECOVERY_ENABLED=1 in both services only after verifying
the migration and authenticated callback. Existing chain-specific hiring flags
remain authoritative. STAGING_MANUAL_RUN=1 and scheduler kill switches suppress
automatic ticks; preserve these controls and do not resume them implicitly.

For a controlled manual tick, run the root scripts/run-hire-notification-recovery.ts
with the origin and secret supplied through the environment. Each tick checks up
to three due jobs. This sends seller notifications for eligible queued jobs but
does not create/fund jobs or request wallet signatures.

## Verification and limits

Tests cover duplicate enqueues, conflicting bindings, isolated chains, lease
expiry, stale dispatch fences, pre-send lookup failure, uncertain send recovery,
delivery reconciliation, expiry and retry exhaustion. Exercise an actual funded
Testnet job after activation and verify the persisted row and UI across a reload.

Existing jobs are not silently enrolled: the buyer's notification request must
reach the service and pass verification once. A browser closed before that
request, or an unavailable quote/store on the first request, requires resuming
the existing hire. Once enqueued, recovery no longer depends on the browser.
Funding transactions must never be repeated to repair a notification.

Disable HIRE_NOTIFICATION_RECOVERY_ENABLED in both services to stop new dispatch
and automatic recovery while preserving all rows for reconciliation.
