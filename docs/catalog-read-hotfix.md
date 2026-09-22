# Catalog read hotfix — 2026-09-22

## Scope and evidence

Public catalog only: combine five status facet scans with the existing status
aggregate, and add a numeric primary-key seek to the page's job history join.
Keep its original text equality as a guard: `0003`, `4x`, whitespace, decimal
and exponent IDs must not acquire associations. Counts remain distinct and
chain-scoped. No schema/migration or admission-policy changes in this hotfix.

Local D1, fixed clock, simulated network:

| Measurement | Before | After |
| --- | ---: | ---: |
| History join, 20,000 jobs per chain, two chains, duplicate/noncanonical events | 180,018 reads | 17 reads |
| Full facets request, 2,000 agents/4,000 endpoints/32,000 observations | 240,088 reads / 21 queries | 235,687 reads / 16 queries |
| Unfiltered list | 12,090 reads | 12,090 reads |
| Hireable list | 4,000 reads | 4,000 reads |
| A2A list | 26,677 reads | 26,677 reads |
| MCP/live list | 45,302 reads | 45,302 reads |

History plan changes from `idx_commerce_jobs_status (chainId=?)` to
`sqlite_autoindex_commerce_jobs_1 (chainId=? AND jobId=?)`; retains the hire agent
index and DISTINCT handling. Regression test first failed the <200-read ceiling
at 180,018. Facet test first failed with six standalone agent counts instead of
one. Both now pass. Facet savings are modest (1.8% in this fixture), not a claim
that global aggregates are solved. These are local scenarios, not production
billing forecasts.

Cache containment: staging catalog TTL 30 → 300 seconds. Existing canonical
query keys, network separation and authenticated fresh reads stay unchanged.
Repeated-read integration test confirms a warm entry avoids D1. Public catalog
information may lag up to five minutes; quotes/transactions are not cached by
this change. Cache is not a global budget or a guaranteed tenfold saving.

Validation: 666 unit tests, 431 integration tests, typecheck and diff check.
No live vendor requests. Remote preflight read only the migration ledger and
index metadata (149 rows read, zero writes); all 35 migrations present.

## Release

Base main includes #159/#161, not the rejected #160/#162 experiments. Deploy
to the actual app backend `bnb-agent-probe-staging`, D1
`6fbeea3e-4516-4c4e-a5c4-392cb067198a`. Preserve active remote vars, secrets,
bindings, queue settings and empty cron through a generated local release
overlay; do not deploy repository cron defaults. Add the merged background
cost controls with both maintenance/jobs pause flags set to 1. Preserve
STAGING_MANUAL_RUN's current value. Both queue deliveries must remain paused.
No migrations to apply, hence no database rewrite/backup export required.

Before upload, compare active version/settings/queue states again. After deploy,
verify health, catalog response/cache reuse, active version, all preserved vars,
secret binding names, DB, empty cron and both delivery_paused values. No quote,
funding, manual scheduler run or unpause. Roll back code if smoke fails while
retaining safe remote configuration and pauses. Daily economic impact requires
a later equivalent traffic/time-window comparison, not immediate extrapolation.
