# Testnet quote availability investigation — 2026-09-11

## Conclusion

The deployed queue consumer rejects every Testnet capability-probe message before
it reaches requirements discovery. Its identity validator accepts only
`eip155:56:<id>`, while the producer correctly queues `eip155:97:<id>`.
The exception is `WP2_QUEUE_MESSAGE_INVALID`. This is a Worker defect, not evidence
that the sampled sellers cannot quote.

The local fix changes that validator to accept exactly chains 56 and 97. It does
not relax endpoint validation, modify admission policy, create buyer quotes, or
change API shapes. Nothing has been deployed or written to remote storage.

## Read-only evidence

The local application's configured feed origin is
`https://bnb-agent-probe-staging.gilbertsahumada.workers.dev` (the environment name
does not mean it is isolated from the public application). Public catalog reads,
Cloudflare script/settings/schedule/queue GETs, and D1 SELECT/PRAGMA queries were
used. No seller was contacted and no remote probe was triggered.

- Catalog snapshot: Mainnet 29 hiring / 32,073 evaluation; Testnet 0 hiring / 78
  evaluation. Counts are observations, not permanent acceptance expectations.
- Active version: `d02b7ab3-8336-4c30-8a8d-c4421603f2df`, version 137, uploaded
  2026-09-08 21:55:03 UTC. No Git commit annotation was available, so a complete
  deployed-to-source commit identity is not claimed.
- Downloaded active script confirmed the same failing expression:
  `/^eip155:56:[1-9]\d{0,19}$/` in the `catalog_capability_probe` dispatch guard.
- DB binding: `bnb-agent-probe-staging`, ID
  `6fbeea3e-4516-4c4e-a5c4-392cb067198a`. All 32 local migrations are applied;
  no missing or remote-only migration names. Actual capability-table columns
  include compatibility state, hash, timestamps, error and provenance fields.
- Effective flags: `CATALOG_TESTNET_ENABLED=1`, `CATALOG_PROBE_ENABLED=1`,
  `CATALOG_V2_WRITES_ENABLED=1`, `CATALOG_V2_READS_ENABLED=1`, both kill switches
  `0`, `STAGING_MANUAL_RUN=0`. Testnet RPC secret binding exists; value not read out.
- Cron: every minute. Quote queue: `bnb-agent-catalog-quotes-staging`, with this
  Worker as producer and consumer, batch size 1, concurrency 2, max retries 3,
  retry delay 60 seconds. These are configured values, not observed error counts.

### Minimal sanitized samples

All three rows remained `discovered` / compatibility `pending`, with null
`compatibilityCheckedAt`, `lastAttemptAt`, and compatibility/quote error fields.
Their public endpoint observations were `protocol_valid` and `platform_reachable`.

| Testnet agent | Initial nextProbeAt | Subsequent nextProbeAt |
| --- | --- | --- |
| 2284 | 1789132412162 | 1789133064449 |
| 2285 | 1789132602737 | 1789132908011 |
| 2286 | 1789132469024 | 1789132846384 |

For every sampled row, `nextProbeAt = updatedAt + 300000`: the producer's
five-minute lease. Renewed leases show the agents are being selected; the script
guard explains why the consumer cannot reach discovery. Individual historical
queue error logs and delivery counts were not captured. No claim is made about
which additional seller-specific errors will appear after this blocker is fixed.

## TDD evidence

Baseline: 20 discovery/policy unit tests and 22 capability/provenance integration
tests passed after connecting the worktree to the existing Worker dependencies.
The initial missing dependency error was a local test-environment issue, not a
product failure.

RED: a new test calls `createWorker().queue()` with an injected verifier. Chain 56
passed, chain 97 failed with `WP2_QUEUE_MESSAGE_INVALID` before verifier invocation.
The queue suite had 1 failure / 19 passes. This boundary was absent from the older
tests, which separately tested Testnet enqueueing and the capability runner.

GREEN: after the one-line fix, all 20 queue tests passed, including rejection of
chain 1, noncanonical chain 097, zero IDs and malformed IDs.

The new isolated-D1 integration case follows the real producer → queue dispatcher
→ capability runner → compatibility persistence → catalog response. A valid
synthetic schema without sample parameters makes Testnet requestable with zero
quote requests; the colliding Mainnet ID stays pending. Hiring total and requestable
facet both become 1, evaluation becomes 0, and `canPrepareHire` remains false.
This fixture is synthetic, not a captured seller response or delivery evidence.

Additional cases cover failed queue publication and retry, discovery timeout and
invalid schema. Existing suites cover evidence expiry, unsupported/ineligible
endpoints, suspension preservation, duplicate claims, origin budgets, backoff and
buyer-bound authorization. No assertion treats listing or compatibility as proof
of delivery quality.

Final verification: 61 unit tests across six suites and 29 isolated Worker tests
across three suites passed (90 total); `npm run typecheck` passed. Run from
`bnb-agent-probe`:

```sh
npm run test:unit -- test/queue.test.ts test/catalog-evidence-policy.test.ts test/catalog-compatibility.test.ts test/testnet-policy.test.ts test/testnet-discovery.test.ts test/negotiation-discovery.test.ts
npm run test:worker -- test/integration/catalog-capability.test.ts test/integration/negotiation-provenance.test.ts test/integration/catalog-hiring-filters.test.ts
npm run typecheck
```

## Release handoff — not executed

1. Review and publish the local fix/tests on `codex/post-hackathon-improvements`;
   leave `codex/hackathon-submission` unchanged at `cc9bd3a`.
2. Before any authorized release, re-read current remote version, configuration,
   branches and migration state; another session may have changed them. Preserve
   all remote settings, including any subsequent `STAGING_MANUAL_RUN=1`.
3. No migration or cadence increase is required by this fix. Do not bypass
   compatibility checks or manually mark agents hireable.
4. After deployment authorization and release, let ordinary scheduled leases
   expire and work retry. Do not bulk replay messages or reset DB states by default.
5. Verify that Testnet messages reach discovery and persist either a compatible
   result or an explicit seller error. Only valid compatible sellers should move
   to hiring. Confirm Mainnet behavior is unchanged. A renewed compatibility check
   does not guarantee these particular live sellers will pass.

Remaining unknown: the real schema/negotiation response of the three sellers,
intentionally not probed. The investigation proves and fixes the blocking dispatch
defect locally, not end-to-end production quote or delivery success.
