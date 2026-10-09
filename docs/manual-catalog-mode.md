# Request-driven catalogue (2026-10-08)

The operator stopped automatic work. The application Worker has no cron;
indexing, jobs, maintenance and the renewal pilot are paused. All four queue
deliveries are paused, preserving pending messages. The hourly GitHub
`Submission uptime` workflow is disabled and no longer has a schedule. The
thread's recurring monitor remains paused. ERC-8183 indexing consequently stops
advancing; historical indexed jobs remain readable. Nothing resumes automatically.

The 18 Mainnet offers that were requestable at the change are pinned in
`bnb-agent-probe/src/catalog/manual-catalog.ts`, by agent identity, endpoint and
minimum successful requirements-check timestamp. Time alone no longer removes
these offers from `Available to quote`. This is an operator-maintained offer,
not a claim that the endpoint has been reverified today.

- Original evidence timestamps and 24-hour expiry are unchanged; stale evidence
  remains stale. No evidence or capability rows are rewritten for this change.
- Current declarations, supported protocols, suspension, unusable requirements
  and newer endpoint failures still block negotiation. Replacement endpoints,
  other agents and Testnet do not inherit the exception.
- Public observations never enable `canPrepareHire`. The buyer must discover
  current requirements, request their own signed quote, verify it and execute
  the existing wallet flow. Seller failure is not hidden or compensated.
- Website/API requests still read D1 and buyer actions can write their own
  evidence. Caches are unchanged. Bots and external monitors can make requests;
  pausing our automatic jobs is not a promise of zero billing without visitors.
- No migrations, backfills, budget increases, automatic seller checks or quotes.

## Validation

RED: an expired pinned endpoint previously returned `check_availability`.
GREEN: all 18 remain requestable after a simulated year, while freshness and
hire permission remain unchanged. SQL/TypeScript parity covers all 18 offers,
other networks, replacement endpoints, suspension, unsupported/unusable schemas,
old checks, unsafe endpoints and subsequent failure. Integrated cards, counters
and detail agree without public writes or timestamp changes.

680 Worker unit tests passed; affected catalogue integration tests, public
read cost gates with 2,000/20,000 agents, type checking and production bundle
passed locally. The change adds no D1 query or telemetry writes. The existing
cost gates are preserved, not a new claim of production savings. Remote pause
verification checked cron, all queue pauses and unchanged non-pause bindings,
including `STAGING_MANUAL_RUN`. Release requires rechecking this state; version
upload/deployment must not synchronize triggers or queue consumers.
