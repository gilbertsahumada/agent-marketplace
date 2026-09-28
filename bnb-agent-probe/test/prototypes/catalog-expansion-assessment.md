# First expansion assessment — 2026-09-28

Base: main 48d510c. Assessment only; no deployed code, migrations, seed,
seller requests, quotes, configuration changes or availability changes.

## Evidence

A one-off, index-range-limited sample of the first 5,000 Mainnet capability
rows found six additional agents with historical compatible requirements:
204789, 212769, 212943, 213036, 213084, 213432.
This is not an exhaustive catalogue inventory and does not prove previous
public availability. None has a recorded capability `lastSuccessAt`.

All six have a current declaration and safe, eligible operational A2A endpoint.
Compatibility is expired. 204789 is `discovered`, with one failure and no
lastErrorCode. The other five are `failed`, with three failures and
`NEGOTIATION_PARAMETERS_UNAVAILABLE` as lastErrorCode. Their requirements
compatibilityErrorCode is null. All observed nextProbeAt dates have passed.
These facts justify discovery revalidation, not unconditional admission.

Read-only D1 diagnostics:

| Operation | Reads | Writes | Duration |
|---|---:|---:|---:|
| Initial 251-row bounded sample | 1,255 | 0 | 29.12 ms |
| 5,000-row bounded historical sample | 10,036 | 0 | 30.75 ms |
| Six explicit candidate keys | 42 | 0 | 0.79 ms |

Plans use the existing capability primary-key index and keyed joins.
The historical sample is one-off discovery overhead, not a proposed cron.
Measurements are different operations, NOT a before/after savings claim.
EXPLAIN requests are separate; no seller contact or remote data writes occurred.

## Local validation

`npm run test:worker -- test/integration/expansion-assessment.test.ts`

Two tests passed with 2,000 and 20,000 unrelated capability rows. Each explicit
six-key lookup is one query, <=100 measured reads, zero writes. Identical IDs in
Testnet are excluded; failed state, future backoff and stored rows are unchanged.
These tests validate lookup cost ONLY, not renewal/seed/consumer cost for an
expanded cohort. Existing 13-agent simulation is not extrapolated as proof.

## Activation gate

Migration 0038 has a CHECK restricting agenda agentKey to the original thirteen.
Code also enforces that allowlist. Do not remove those protections ad hoc or
edit a published migration. Expansion requires a reviewed admission/schema
change, local upgrade-preservation tests and a complete 19-agent 48-hour cost
simulation under the unchanged maintenance budget. Keep existing pilot running
unchanged during this work. New members require fresh protocol/requirements
validation; do not restore failed states just because an old contract exists.

Next implementation: explicit cohort admission with an additive migration and
generation-safe scheduling, preserving pilot tasks, origin fairness and budget.
Do not insert six new keys into 0038 or bypass its CHECK. At release verify backup,
current deployment and configuration; seed only approved keys, honoring leases
and later backoff. No general scan, synthetic quote or budget increase.
