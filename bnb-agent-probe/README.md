# bnb-agent-probe

Bounded Cloudflare Worker + D1 observation layer for BSC marketplace evidence.

WP2 ships the schema, lease, curated manifest, bounded trust8004 client,
single-phase HEADER/SWEEP/PROBE rotation, Free Queue dispatch, kill switch and
sanitized `GET /health`. WP3 is fail-closed to BSC Agent `303779` and the exact
registered Grid endpoint. It refreshes trust8004 metadata, fixes read-only BSC
checks to one fresh block, validates the canonical signed quote, and persists no
signature or raw response. It never creates, funds or executes a job. No Cron
Trigger is active.

The Free profile caps scheduled work at 40 D1 queries per invocation, below the
platform limit of 50. Every statement in `DB.batch()` is counted separately and
three queries are reserved outside the phase budget for a sanitized failure
summary, lease cleanup and the daily ledger.
The atomic Queue completion marker is also included in the reported and
enforced per-invocation total. The minimum accepted budget is 12 queries, which
covers the smallest complete SWEEP plus failure, lease-cleanup and daily-ledger
reserves.
Catalogue responses have their own
16 MiB cap; the smaller seller-response cap is independent.

Cron never executes a phase directly. It publishes one versioned tick to
`WP2_QUEUE`; a batch-size-one consumer deduplicates the timestamp in D1 and runs
one phase. The completion timestamp is committed atomically with phase state, so
a failed delivery can retry while a completed duplicate cannot advance another
phase. At five-minute cadence this projects to 864 nominal operations/day and
1,728 with all three configured retries, below the Free safety ceiling of 8,000.
Those are Queue operations. D1 is budgeted independently at 288 nominal attempts
or 1,152 if every tick reaches all four deliveries. With the configurable Free
defaults `D1_ROWS_READ_PER_RUN=3000` and `D1_ROWS_WRITTEN_PER_RUN=60`, that is
864,000/17,280 rows nominal and 3,456,000/69,120 retry-worst, below the reserved
4,000,000/80,000 daily ceilings.
Every D1 result is checked against the configured row budget. Phase work aborts
after the first result that crosses it and cannot issue another phase query;
because D1 reports row counts after execution, one query can overshoot. Bounded
cleanup remains allowed so a completed phase is not retried merely because lease
release or telemetry failed. Raw 24-hour Analytics therefore remains the quota
gate. A row-budget failure during lease acquisition still performs an
owner-checked release before propagating the error.
If another invocation owns the D1 lease, the message is not acknowledged and is
retried after 240 seconds; completed and stale ticks are acknowledged normally.
The consumer is fixed at one concurrent invocation, and Queue timestamps more
than five minutes ahead of the Worker clock are rejected before phase execution.
Every consumer also declares a 60-second default retry delay for unexpected
phase exceptions. This is separate from the explicit 240-second lease delay and
prevents all automatic retries from being exhausted within a few seconds.

```bash
npm ci
npm run cf-typegen
npm run migrate:local
npm test
npm run typecheck
npm run dry-run
```

Staging remains on the Free profile, declares an empty Cron list, and deploys
with the kill switch enabled. It retains one isolated Queue producer and serial
consumer. Apply its migrations and deploy explicitly:

```bash
npx wrangler d1 migrations apply bnb-agent-probe-staging --remote --env staging
npx wrangler deploy --env staging
```

Because Cron removal can propagate after a deployment, operational trials also
verify the Cloudflare schedules API returns an empty list and the realtime Queue
backlog is zero before enabling work and again after cleanup.
Queue backlog metrics are best-effort and can omit a delayed retry until it is
eligible again. Backlog zero is corroborating cleanup evidence, never proof that
a reusable Queue contains no deferred delivery. Every destructive retry trial
therefore creates a fresh Queue ID and deletes it after evidence capture.

Destructive retry tests use the dedicated `validation` environment, never the
staging D1 or Queue. Its checked-in defaults are Free-sized, contain no Cron
Trigger or secret, and keep `KILL_SWITCH=1` outside a controlled window:

```bash
npx wrangler queues create bnb-agent-probe-validation-20260828
npx wrangler d1 migrations apply bnb-agent-probe-validation-20260828 \
  --remote --env validation
npx wrangler deploy --env validation
```

Record the new Queue ID before every trial; reusing the same name is acceptable
only after Cloudflare confirms the previous ID was deleted. Use a short-lived
`Queues Write` API token for direct test pushes and revoke it when the final
message is accepted. The operator's Wrangler OAuth session may deploy resources,
but its credential is never copied into commands, logs or evidence.

Before a trial, verify the validation schedules and Worker secrets are empty and
staging's selected state fields and row counts match a hashed preflight snapshot.
After collecting Analytics, restore `KILL_SWITCH=1`, remove temporary secrets,
delete the Queue consumer, delete the ephemeral validation Worker, then delete
the Queue itself and confirm its ID is absent from the account list. Retain the
separate validation D1 for audit. This deletion order is required because
Cloudflare refuses to delete a bound Worker or Queue.

Exact correctness comes from D1 completion markers keyed by `scheduledTime`;
adaptive Queue and Workers metrics only corroborate delivery and resource use.
Each D1 result also contributes its `meta.rows_read` and `meta.rows_written` to
`daily_budget_YYYYMMDD`, keyed by the invocation's UTC start date. `/health`
uses one bounded `runtime_state` query and never scans `probe_targets`; target
counts are deliberately unavailable on this public endpoint. It exposes only
the validated current-day allowlist and becomes degraded when scheduling is
active without valid daily telemetry, or when `updatedAt` is older than three
Cron intervals (minimum 15 minutes). A scheduler error newer than the latest
healthy phase also degrades the endpoint. Row fields are explicitly
named `BeforeLedger` because they omit the ledger's own write; this operational
reconciliation does not replace raw per-database and account Cloudflare D1
Analytics for the quota gate.
The clean retry and two-round records are in
`../evidence/wp2-retry-remote-clean-2026-08-28.json` and
`../evidence/wp2-default-rounds-2026-08-28.json`.
They close the remote HEADER/SWEEP retry, resource and two-round gates only.
The WP3 implementation and local Workerd gates are present, including complete
EIP-191 (8 subrequests) and ERC-1271 (10 subrequests) paths through D1,
trust8004, BSC RPC, Agent Card and A2A. Its controlled remote Grid probe and
nominal staging evidence remain pending. Timeout, response-cap and redirect
failures are deterministic Workerd gates: the candidate Worker does not contain
fault injection and the real Grid seller is never modified to manufacture a
failure. Expected seller failures are persisted and rotate normally; unexpected
infrastructure exceptions leave phase and priority unchanged for Queue retry. The
24-hour D1 gate runs only after those pass, against the complete staging
candidate for a full `00:00–24:00 UTC` quota day. Continuous scheduling stays
disabled until both gates pass.

Controlled nominal measurements may call `POST /__admin/run-scheduled` only
while `DEPLOYMENT_ENV=staging`, `STAGING_MANUAL_RUN=1`, `KILL_SWITCH=0` and
`SHARED_SECRET` is installed. The route requires the matching Bearer
credential, has no CORS, and is hidden unless every guard passes. It only
publishes one versioned tick to `WP2_QUEUE`; the serial Queue consumer performs
all phase work and writes `last_queue_scheduled_time`. The request body cannot
select a phase or timestamp. Production
fixes `DEPLOYMENT_ENV=production`; nominal staging fixes
`STAGING_MANUAL_RUN=0`. Restore both staging guards and remove the temporary
secret immediately after measurement.

Before opening the window, the deployed version must match the candidate and
the following read-only checks must pass:

```bash
npx wrangler deployments status --env staging --json
npx wrangler secret list --env staging
npx wrangler d1 migrations list bnb-agent-probe-staging --remote --env staging
npx wrangler d1 info bnb-agent-probe-staging --json
npx wrangler queues info bnb-agent-probe-staging
npx wrangler queues consumer list bnb-agent-probe-staging
```

Cloudflare's schedules API must return an empty list and Queue backlog must be
zero before and after the window; Wrangler configuration alone is not evidence
of remote trigger state. Install the public BSC RPC URL and the random
administrative credential without placing either value in shell history or an
evidence file:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/bnb-agent-probe-staging/schedules"
curl --fail --silent --show-error \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/queues/$WP3_QUEUE_ID/metrics"
```

Store both raw JSON responses, including their capture timestamps, without the
request headers. The exact Workers Analytics GraphQL document is versioned in
`../evidence/wp2-default-rounds-2026-08-28.json`; the Queue operations and
backlog documents are in `../evidence/wp2-retry-remote-2026-08-28.json`.
Reuse them with the WP3 deployment version, Queue ID and bounded UTC interval
instead of reconstructing a dashboard value.

For the no-job invariant, record the BSC block immediately before enqueue and
immediately after Queue completion. Query `eth_getLogs` for Commerce
`0xEa4DAa3100A767e86FDed867729ae7446476EBA6` over that inclusive range with the
OR-list of topic0 values below, and retain the raw RPC response:

```text
JobCreated  0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9
BudgetSet   0x869e2577b006bf47ee981cf6fec2e25583548081c14b98deab587f77b5068038
JobFunded   0xbdb056de345bfeadca7c9fd7df6430bdb83c677c8eefbb601dff56f34d3dac52
```

With `WP3_FROM_BLOCK_HEX`, `WP3_TO_BLOCK_HEX` and a read-only
`BSC_LOGS_RPC_URL` set, capture the interval without embedding credentials in
the JSON:

```bash
jq -n --arg from "$WP3_FROM_BLOCK_HEX" --arg to "$WP3_TO_BLOCK_HEX" '{
  jsonrpc:"2.0", id:1, method:"eth_getLogs", params:[{
    fromBlock:$from, toBlock:$to,
    address:"0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
    topics:[["0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9",
      "0x869e2577b006bf47ee981cf6fec2e25583548081c14b98deab587f77b5068038",
      "0xbdb056de345bfeadca7c9fd7df6430bdb83c677c8eefbb601dff56f34d3dac52"]]
  }]
}' | curl --fail --silent --show-error -H 'content-type: application/json' \
  --data-binary @- "$BSC_LOGS_RPC_URL"
```

The RPC used for this audit must support `eth_getLogs`; the public BNB endpoint
used by the probe may not. Any unrelated global event in the interval is kept
with its transaction hash and classified, never discarded. The probe passes
only when it emitted no transaction and no event is attributable to it.

```bash
npx wrangler secret put BSC_RPC_URL --env staging
npx wrangler secret put SHARED_SECRET --env staging
```

Drive `header → sweep → probe` with one authenticated enqueue at a time and
wait for `/health` plus the D1 Queue marker after each tick. Never update
`next_scheduler_phase` or seed a target manually in remote D1. If Grid is not
yet present, PROBE synthesizes only the exact allowlisted pair, verifies it live
through trust8004 and atomically inserts or reactivates it before persisting the
observation; unavailable metadata produces no target write. Cleanup is a
nominal redeploy (`KILL_SWITCH=1`, `STAGING_MANUAL_RUN=0`) followed by
`npx wrangler secret delete SHARED_SECRET --env staging`; `BSC_RPC_URL` may
remain because it grants no custody and scheduled work stays disabled.
