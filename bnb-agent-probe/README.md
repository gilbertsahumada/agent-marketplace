# bnb-agent-probe

Bounded Cloudflare Worker + D1 observation layer for BSC marketplace evidence.

WP1 ships the schema, lease, curated manifest, kill switch and sanitized
`GET /health`. It intentionally contains no active Cron Trigger and does not run
HEADER, SWEEP or PROBE phases yet.

The Free profile caps scheduled work at 40 D1 queries per invocation, below the
platform limit of 50. Every statement in `DB.batch()` is counted separately and
one query is reserved for lease cleanup. Catalogue responses have their own
16 MiB cap; the smaller seller-response cap is independent.

```bash
npm install
npm run cf-typegen
npm run migrate:local
npm test
npm run typecheck
npm run dry-run
```

Staging remains on the Free profile, has no Cron Trigger, and deploys with the
kill switch enabled. Apply its migrations and deploy explicitly:

```bash
npx wrangler d1 migrations apply bnb-agent-probe-staging --remote --env staging
npx wrangler deploy --env staging
```
