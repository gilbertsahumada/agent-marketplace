# bnb-agent-probe

Bounded Cloudflare Worker + D1 observation layer for BSC marketplace evidence.

WP2 ships the schema, lease, curated manifest, bounded trust8004 client,
single-phase HEADER/SWEEP rotation, Free Queue dispatch, kill switch and
sanitized `GET /health`. PROBE remains an explicit no-network placeholder until
WP3. No Cron Trigger is active.

The Free profile caps scheduled work at 40 D1 queries per invocation, below the
platform limit of 50. Every statement in `DB.batch()` is counted separately and
two queries are reserved for a sanitized failure summary plus lease cleanup.
The Queue deduplication claim is also included in the reported and enforced
per-invocation total.
Catalogue responses have their own
16 MiB cap; the smaller seller-response cap is independent.

Cron never executes a phase directly. It publishes one versioned tick to
`WP2_QUEUE`; a batch-size-one consumer deduplicates the timestamp in D1 and runs
one phase. At five-minute cadence this projects to 864 Queue operations/day,
below the configured Free safety ceiling of 8,000.

```bash
npm install
npm run cf-typegen
npm run migrate:local
npm test
npm run typecheck
npm run dry-run
```

Staging remains on the Free profile, has no Cron Trigger, and deploys with the
kill switch enabled. It retains one isolated Queue producer and consumer. Apply
its migrations and deploy explicitly:

```bash
npx wrangler d1 migrations apply bnb-agent-probe-staging --remote --env staging
npx wrangler deploy --env staging
```

Controlled nominal measurements may call `POST /__admin/run-scheduled` only
while `DEPLOYMENT_ENV=staging`, `STAGING_MANUAL_RUN=1`, `KILL_SWITCH=0` and
`SHARED_SECRET` is installed. The route requires the matching Bearer
credential, has no CORS, and is hidden unless every guard passes. Production
fixes `DEPLOYMENT_ENV=production`; nominal staging fixes
`STAGING_MANUAL_RUN=0`. Restore both staging guards and remove the temporary
secret immediately after measurement.
