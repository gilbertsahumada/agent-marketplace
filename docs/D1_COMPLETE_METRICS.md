# D1 invocation measurement — first release

Base: `b00e4337923e83fd0ca386b4fe785fab7e244ab0` (PR171).

## Cause and correction

Drizzle D1 selected-row readers use `raw()`, which preserves positional and
duplicate columns but does not expose D1 metadata. Do not replay a query to
measure it, and do not change raw's semantics globally.

Public catalogue readers now execute named, complete table projections with
`all()` and schema decoders. The declaration/endpoint join has explicit unique
aliases. Flat primitive jobs/event projections explicitly alias expressions.
Runtime-state and observation readers also retain metadata. There are no new
database writes, migrations, cache lifetimes, or public API changes.

## RED / GREEN evidence

Run from `bnb-agent-probe`:

```sh
npm run typecheck
npm run test:unit
npm run test:worker -- test/integration/public-read-metrics.test.ts test/integration/invocation-metrics-native.test.ts test/integration/public-projected-routes.test.ts test/integration/commerce-routes-hardening.test.ts test/integration/orm.test.ts
```

| Case | Before | After | Meaning |
| --- | --- | --- | --- |
| Missing-agent detail, native D1 | 8 queries, 5 unmeasured, totals unknown | Complete metadata, zero unmeasured | Deterministic RED reproduced before implementation |
| Populated cards/combined/facets/summary/detail | Native raw loses metadata | Complete metadata; response parity assertions | 30-agent mixed-network fixture with shared endpoints and jobs |
| Jobs/list/detail/summary/activity/events | Selected rows use raw | Complete metadata; response parity assertions | Same filters, identifiers and pagination |
| Native arbitrary raw | Positional columns | Unchanged, explicitly incomplete | Duplicate names, numeric aliases and empty results tested |
| Failed/missing metadata | Unknown | Unknown | Never reported as zero |
| Telemetry persistence | None | None | Logs only |

This release improves measurement, not query efficiency. It does not claim a
production saving. Query bodies/parameters, wallet identifiers and message
payloads are not logged. Errors remain incomplete if D1 does not return metadata.

## Log interpretation

`d1.public.invocation` and `d1.background.invocation` carry
`accountingScope=invocation_total`. Index-only scheduled work is
`index.producer`; homogeneous index queue batches are `index.consumer` with the
chain when unambiguous. Other background work stays explicitly `scheduled` or
`queue`, not falsely attributed to indexing.

Invocation totals already include budget controls: never add nested budget
diagnostics to them. Only compare complete records of equivalent operations,
networks, cache outcomes and release versions. Unknown values are not zero.

## Release gate and remaining work

Check remote main, active Worker version/configuration/bindings and migration
ledger/schema before deployment. Preserve the active ERC-8183 queue, its cron,
all existing pauses, budgets and STAGING_MANUAL_RUN. This release requires no
migration. Repository defaults are not a substitute for remote configuration.

The isolated 13-agent discovery-only renewal pilot remains a separate release.
No pilot, general scheduler or quote probe is enabled by these changes. Deployment
creates a measurement cutpoint; do not splice records into PR171's old window.
