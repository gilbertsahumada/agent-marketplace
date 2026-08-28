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

## Data access convention

Runtime queries go through the Drizzle layer in `src/db/orm.ts`, whose row
types are derived from `src/db/schema.ts` so schema drift breaks compilation
instead of failing inside a hand-written SQL string at runtime. Two deliberate
exceptions stay raw D1 SQL: the scheduler lease
(`src/lib/scheduler-lease.ts`), whose contention semantics must be auditable
as exact SQL, and the query-budget wrapper (`src/db/query-budget.ts`), which
counts statements at the binding level and therefore also covers everything
Drizzle executes. New phase or route code must not add raw `prepare()` calls
outside those two files; existing raw call sites migrate to `db/orm.ts` as
they are next touched.
