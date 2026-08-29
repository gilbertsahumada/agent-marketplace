# bnb-agent-probe

Bounded Cloudflare Worker + D1 observation layer for BSC marketplace evidence.

WP2 ships the schema, lease, curated manifest, bounded trust8004 client,
single-phase HEADER/SWEEP/PROBE rotation, Free Queue dispatch, kill switch and
sanitized `GET /health`. WP3 is fail-closed to BSC Agent `303779` and the exact
registered Grid endpoint. It refreshes trust8004 metadata, fixes read-only BSC
checks to one fresh block, validates the canonical signed quote, and persists no
signature or raw response. It never creates, funds or executes a job. No Cron
Trigger is active in production. Staging temporarily runs `*/5 * * * *` for the
UTC 2026-08-29 WP2 rehearsal. Its late-format activation capture prevents it
from being the final gate; the repeatable final window is scheduled for UTC
2026-08-31.

The Free profile caps scheduled work at 40 D1 queries per invocation, below the
platform limit of 50. Every statement in `DB.batch()` is counted separately and
four queries are reserved outside the phase budget for a sanitized failure
summary, lease cleanup, the daily ledger and the append-only attempt ledger.
The atomic Queue completion marker is also included in the reported and
enforced per-invocation total. The minimum accepted budget is 13 queries, which
covers the smallest complete SWEEP plus failure, lease-cleanup and daily-ledger
reserves, including the attempt ledger.
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
864,000/17,856 rows nominal and 3,456,000/71,424 retry-worst, below the reserved
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

Run the final evidence flow from this package directory. Export
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `WP2_D1_DATABASE_ID`,
`WP2_QUEUE_ID`, `WP2_SCRIPT_NAME` and `WP2_HEALTH_URL`; credentials are read
from the environment and are never serialized. Every output is create-only.

```bash
set -euo pipefail

FULL_SHA=131d0a23f18a7328754378530ea3120245d233cc
SHORT_SHA=${FULL_SHA:0:12}
MEASURED_VERSION_ID=d1ee751a-b77d-4fc6-afed-864e631383af
EXPECTED_ETAG=80a1f8dac1e5949583dd29d7d9ee60a789007822bd646a5c8b1216f7437bcf23
UTC_DATE=2026-08-31
WINDOW_START="${UTC_DATE}T00:00:00.000Z"
WINDOW_END=2026-09-01T00:00:00.000Z
MIN_TERMINALITY_END=2026-09-01T00:15:00.000Z

# Safe state, before installing Cron or enabling either switch:
npm run evidence:wp2-control -- preflight ../evidence/raw/preflight.json

rollback_activation() {
  local status="$1"
  trap - ERR INT TERM
  set +e
  npx wrangler deploy --env staging --keep-vars \
    --var PRODUCER_KILL_SWITCH:1 --var KILL_SWITCH:1 \
    --message "git_commit=${FULL_SHA}" --tag "git-${SHORT_SHA}-activation-abort"
  curl --fail-with-body -X DELETE \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WP2_SCRIPT_NAME}/schedules/%2A%2F5%20%2A%20%2A%20%2A%20%2A"
  curl --fail-with-body \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WP2_SCRIPT_NAME}/schedules" \
    | jq -e '.success == true and (.errors | length == 0) and .result.schedules == []'
  curl --fail-with-body \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WP2_SCRIPT_NAME}/settings" \
    | jq -e '
        any(.result.bindings[]; .name == "PRODUCER_KILL_SWITCH" and .text == "1")
        and any(.result.bindings[]; .name == "KILL_SWITCH" and .text == "1")
      '
  exit "$status"
}
trap 'rollback_activation $?' ERR
trap 'rollback_activation 130' INT
trap 'rollback_activation 143' TERM

# Re-promote the exact measured version, then install only */5 * * * *.
# Stop if its versions-view etag is not EXPECTED_ETAG.
test "$(npx wrangler versions view "$MEASURED_VERSION_ID" --env staging --json | jq -r '.resources.script.etag')" = "$EXPECTED_ETAG"
npx wrangler versions deploy "${MEASURED_VERSION_ID}@100%" --env staging --yes \
  --message "WP2 final UTC gate activation"
curl --fail-with-body -X PUT \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '[{"cron":"*/5 * * * *"}]' \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WP2_SCRIPT_NAME}/schedules"

# Activate before the 23:55Z pre-window tick and capture the control state.
npm run evidence:wp2-control -- activation ../evidence/raw/activation.json

# After the 23:55Z tick completes, capture the phase anchor. Both files must
# exist before the first measured tick at 00:00Z.
npm run evidence:wp2-window-start -- ../evidence/raw/window-start.json
trap - ERR INT TERM

# Immediately after the 23:55 tick and before 24:00Z: producer off,
# consumer on, then Cron removed. Stop if the new version etag changes.
DRAIN_DEPLOY_LOG=$(mktemp)
npx wrangler deploy --env staging --keep-vars \
  --var PRODUCER_KILL_SWITCH:1 --var KILL_SWITCH:0 \
  --message "git_commit=${FULL_SHA}" --tag "git-${SHORT_SHA}-drain" \
  | tee "$DRAIN_DEPLOY_LOG"
DRAIN_VERSION_ID=$(sed -n 's/.*Current Version ID: //p' "$DRAIN_DEPLOY_LOG" | tail -1)
rm "$DRAIN_DEPLOY_LOG"
[[ "$DRAIN_VERSION_ID" =~ ^[a-f0-9-]{36}$ ]]
test "$(npx wrangler versions view "$DRAIN_VERSION_ID" --env staging --json | jq -r '.resources.script.etag')" = "$EXPECTED_ETAG"
curl --fail-with-body \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WP2_SCRIPT_NAME}/settings" \
  | jq -e '
      any(.result.bindings[]; .name == "PRODUCER_KILL_SWITCH" and .text == "1")
      and any(.result.bindings[]; .name == "KILL_SWITCH" and .text == "0")
    '
curl --fail-with-body -X DELETE \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WP2_SCRIPT_NAME}/schedules/%2A%2F5%20%2A%20%2A%20%2A%20%2A"
npm run evidence:wp2-control -- drain ../evidence/raw/drain.json

# At/after MIN_TERMINALITY_END, keep the consumer enabled until the literal D1
# ledger reconciles all 288 ticks and the Queue REST backlog is zero.
WINDOW_START_MS=$(node -p 'Date.parse(process.argv[1])' "$WINDOW_START")
WINDOW_END_MS=$(node -p 'Date.parse(process.argv[1])' "$WINDOW_END")
npx wrangler d1 execute bnb-agent-probe-staging --remote --env staging --json \
  --command "SELECT COUNT(DISTINCT scheduledTime) AS scheduled_ticks FROM scheduler_attempts WHERE scheduledTime >= ${WINDOW_START_MS} AND scheduledTime < ${WINDOW_END_MS}" \
  | jq -e '.[0].results[0].scheduled_ticks == 288'
npx wrangler d1 execute bnb-agent-probe-staging --remote --env staging --json \
  --command "SELECT scheduledTime FROM scheduler_attempts WHERE scheduledTime >= ${WINDOW_START_MS} AND scheduledTime < ${WINDOW_END_MS} GROUP BY scheduledTime HAVING SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) != 1" \
  | jq -e '.[0].results | length == 0'
curl --fail-with-body \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/queues/${WP2_QUEUE_ID}/metrics" \
  | jq -e '.success == true and (.errors | length == 0) and .result.backlog_count == 0 and .result.backlog_bytes == 0'
npm run evidence:wp2-ledger -- \
  ../evidence/raw/scheduler-attempts.json "$WINDOW_START" "$WINDOW_END"

# Choose a real cutoff after the minimum grace and the checks above, then capture
# Queue/Workers Analytics while the consumer remains enabled. The validator
# proves that the final attempt and DeleteMessage precede this cutoff.
TERMINALITY_END=$(node -p 'new Date().toISOString()')
npm run evidence:wp2-analytics -- \
  ../evidence/raw/analytics "$UTC_DATE" "$TERMINALITY_END"
jq -e '
  [.response.data.viewer.accounts[0].queueTerminalOperations[]
    | select(.dimensions.actionType == "DeleteMessage")] as $deletes
  | ([$deletes[].count] | add) == 288
    and all($deletes[]; (.dimensions.outcome | ascii_downcase) == "success")
' ../evidence/raw/analytics/queue.json

# Only after the Analytics terminality check, disable the consumer too.
CLEANUP_DEPLOY_LOG=$(mktemp)
npx wrangler deploy --env staging --keep-vars \
  --var PRODUCER_KILL_SWITCH:1 --var KILL_SWITCH:1 \
  --message "git_commit=${FULL_SHA}" --tag "git-${SHORT_SHA}-cleanup" \
  | tee "$CLEANUP_DEPLOY_LOG"
CLEANUP_VERSION_ID=$(sed -n 's/.*Current Version ID: //p' "$CLEANUP_DEPLOY_LOG" | tail -1)
rm "$CLEANUP_DEPLOY_LOG"
[[ "$CLEANUP_VERSION_ID" =~ ^[a-f0-9-]{36}$ ]]
test "$(npx wrangler versions view "$CLEANUP_VERSION_ID" --env staging --json | jq -r '.resources.script.etag')" = "$EXPECTED_ETAG"
curl --fail-with-body -X DELETE \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WP2_SCRIPT_NAME}/schedules/%2A%2F5%20%2A%20%2A%20%2A%20%2A"
curl --fail-with-body \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WP2_SCRIPT_NAME}/schedules" \
  | jq -e '.success == true and (.errors | length == 0) and .result.schedules == []'
npm run evidence:wp2-control -- cleanup ../evidence/raw/cleanup.json
npm run evidence:wp2-deployment -- \
  ../evidence/raw/deployment.json "$WP2_SCRIPT_NAME" "$FULL_SHA" \
  "$MEASURED_VERSION_ID" "$DRAIN_VERSION_ID" "$CLEANUP_VERSION_ID"
npm run evidence:wp2-build -- \
  "../evidence/wp2-d1-24h-${UTC_DATE}.json" "$WINDOW_START"
npm run evidence:wp2-24h -- "../evidence/wp2-d1-24h-${UTC_DATE}.json"
npm run check
```

The order is part of the gate. Preflight and activation cannot be reconstructed
after the first tick. Drain proves `PRODUCER_KILL_SWITCH=1` with
`KILL_SWITCH=0`; cleanup proves both are `1`. Each control snapshot also binds
the Free plan, 5-minute cadence, 40-query/D1 row budgets, 5-second seller
timeout, response caps, Queue/D1 resources and absence of `SHARED_SECRET`.
Preflight, activation and cleanup require zero Queue backlog. Drain records the
literal backlog and may be nonzero while the consumer finishes pending retries.

Do not poll D1, call `/health`, invoke the staging admin route or run any other
Worker/D1 diagnostic during the measured UTC day. Those reads and invocations
would enter the same account-wide D1/Workers Analytics being measured. The only
direct D1 evidence reads are `window-start` before `00:00Z` and the ledger after
`24:00Z` plus terminality grace. During the day, observe only non-invasive
Cloudflare control-plane status; investigate anomalies after the window unless
runtime safety requires an immediate producer barrier.

`evidence:wp2-window-start` requires `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `WP2_D1_DATABASE_ID` in the process environment.
Run it after the final pre-window tick and before the first UTC-day tick. It
writes atomically with create-only semantics, preserves account/database/query
provenance plus the literal D1 API response, and never serializes the token. The
same snapshot must show that `last_queue_scheduled_time` is the immediately
preceding tick; request start and completion must both fall inside the final
five-minute interval before the UTC window. This proves scheduler emission and
the persisted phase boundary, not Queue terminality. The final ledger and
`DeleteMessage` reconciliation separately prove terminality for the 288 ticks
inside the UTC window.

The final validator parses and reconciles the hashed raw D1, Workers, Queue,
deployment and timestamped control-plane responses. It keeps the 288 scheduled
ticks separate from the UTC quota cohort so retries crossing midnight are
explicit, requires one terminal Queue message and the exact phase rotation per
tick from the persisted starting phase, checks account-wide Queue usage, and
requests Queue evidence through an actual terminality cutoff no earlier than
`00:15Z` and no earlier than the final attempt or successful delete.
The measured deploy must use `--message git_commit=<40-char SHA>` and
`--tag git-<first 12 chars>`; `deployment.json` preserves the literal
`wrangler versions view "$VERSION_ID" --env staging --json` response plus
requested script/version IDs. Drain deployments use the same message and bundle,
with a suffixed tag such as `git-<SHA12>-drain`; their literal version responses
are recorded too. Workers metrics include every authenticated measured or drain
version, while Queue reconciliation still rejects any extra producer message.
An authenticated drain-version invocation with zero subrequests and no matching
write is treated as a blocked producer: its CPU still counts, but it does not
invent a 289th message.

Because inactive
Queues need not emit a new Analytics bucket, the last emitted zero backlog is
paired with timestamped REST backlog zero after the cutoff.
The five Analytics responses and `analytics-manifest.json` are first written to
a sibling temporary directory and promoted with one atomic directory rename.
The manifest binds one capture ID and the SHA-256 of every response; incomplete
or mixed capture directories are rejected before artifact construction.
The starting phase comes from a hashed raw D1 read captured within five minutes
before the first UTC tick. Producer CPU is derived only from complete Workers
groups matched to all 288 `WriteMessage` operations with zero subrequests;
ambiguous or incomplete attribution fails closed.
The Workers query ends at the same post-midnight terminality cutoff as Queue,
so drain-version retries cannot escape CPU, memory, version or error accounting.
Every spill-out ledger attempt must have an authenticated consumer sample within
one second of its `startedAt`; requesting the wider interval without that bucket
is insufficient evidence. Matching consumes `sum.requests` capacity. Separately,
each message whose completed terminal attempt finishes at or after the window end
consumes one successful `DeleteMessage` bucket at or after that completion's
`finishedAt` (allowing one second for Analytics timestamp rounding); this includes
attempts that cross midnight, while retries do not invent extra deletes.

Staging remains on the Free profile and retains one isolated Queue producer and
serial consumer. Outside the exact 24-hour gate it declares an empty Cron list
and deploys with the kill switch enabled. Apply its migrations and deploy
explicitly:

```bash
npx wrangler d1 migrations apply bnb-agent-probe-staging --remote --env staging
# Use the pinned FULL_SHA and SHORT_SHA from the final-gate runbook above.
# Do not substitute the operator checkout's current HEAD.
npx wrangler deploy --env staging \
  --message "git_commit=${FULL_SHA}" --tag "git-${SHORT_SHA}"
```

Record the `Current Version ID` printed by deploy. After the drain and cleanup
deploys print their IDs, build the create-only composite raw directly:

```bash
npm run evidence:wp2-deployment -- \
  ../evidence/raw/deployment.json bnb-agent-probe-staging "$FULL_SHA" \
  "$MEASURED_VERSION_ID" "$DRAIN_VERSION_ID" "$CLEANUP_VERSION_ID"
```

The command executes `wrangler versions view <id> --env staging --json` for each
ID, verifies the full commit annotation and identical script etag, and only then
atomically publishes the literal responses. Assign each `*_VERSION_ID` from the
corresponding Wrangler deploy output; no ID is inferred from list order.

Because Cron removal can propagate after a deployment, operational trials also
verify the Cloudflare schedules API returns an empty list and the realtime Queue
backlog is zero before enabling work and again after cleanup.
Queue backlog metrics are best-effort and can omit a delayed retry until it is
eligible again. Backlog zero is corroborating cleanup evidence, never proof that
a reusable Queue contains no deferred delivery. Every destructive retry trial
therefore creates a fresh Queue ID and deletes it after evidence capture.

For a controlled-window shutdown, set `PRODUCER_KILL_SWITCH=1` immediately after
the final scheduled tick and remove the Cron. Keep `KILL_SWITCH=0` while the
consumer drains retries. Only after the terminality grace, ledger reconciliation
and zero-backlog checks may `KILL_SWITCH` return to `1`. The final control-plane
evidence must show both switches at `1`; removing the Cron alone is not a
producer barrier because trigger propagation is eventual.

```bash
npx wrangler deploy --env staging --keep-vars \
  --var PRODUCER_KILL_SWITCH:1 --var KILL_SWITCH:0 \
  --message "git_commit=${FULL_SHA}" --tag "git-${SHORT_SHA}-drain"
DRAIN_VERSION_ID="<Current Version ID from Wrangler>"
curl --fail-with-body -X DELETE \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/bnb-agent-probe-staging/schedules/%2A%2F5%20%2A%20%2A%20%2A%20%2A"
curl --fail-with-body -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/bnb-agent-probe-staging/schedules"

# Only after the terminality gate:
npx wrangler deploy --env staging --keep-vars \
  --var PRODUCER_KILL_SWITCH:1 --var KILL_SWITCH:1 \
  --message "git_commit=${FULL_SHA}" --tag "git-${SHORT_SHA}-cleanup"
CLEANUP_VERSION_ID="<Current Version ID from Wrangler>"
# Repeat the DELETE and GET above; the final GET must return success=true,
# errors=[] and result.schedules=[].
```

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
WP3 is complete. The controlled remote `header → sweep → probe` rotation ended
in `quote_verified` for Grid 303779 with 8 PROBE subrequests, 10 D1 queries,
2,635 ms wall time, no Queue retry and no matching Commerce job/funding event in
the bounded BSC block range. The versioned records are
`../evidence/wp3-grid-303779-2026-08-28T21-12-31Z.json` and
`../evidence/wp3-grid-303779-analytics-raw-2026-08-28.json`. Complete EIP-191
(8 subrequests) and ERC-1271 (10 subrequests) paths pass through D1, trust8004,
BSC RPC, Agent Card and A2A. Timeout, response-cap and redirect failures remain
deterministic Workerd gates: the candidate Worker contains no fault injection
and the real Grid seller is never modified to manufacture a failure. Expected
seller failures are persisted and rotate normally; unexpected infrastructure
exceptions leave phase and priority unchanged for Queue retry. The remaining
promotion gate is WP2's full `00:00–24:00 UTC` D1/account Analytics window
against this complete candidate. Continuous scheduling stays disabled until it
passes.

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
