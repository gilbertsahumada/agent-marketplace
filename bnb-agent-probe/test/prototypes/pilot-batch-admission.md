# Bounded pilot admission — local validation

Base: main / PR178, aad8514d. No deployment or remote admission performed.

## Behaviour

- Authenticated, temporarily enabled POST `/__admin/renewal-pilot/admit` accepts
  only `{batchId, agentIds}` (1–10 canonical Mainnet IDs, no URLs or extra fields).
  Requires the pilot paused and the existing seed gate enabled. The gate stays
  closed in production until a reviewed release; this is not a public API.
- Durable registry, at most 29 members including the original 19. SQL foreign
  keys enforce membership. Atomic registry + outbox insertion prevents partial
  admissions. Full capacity produces skips, not lost or replaced tasks.
- At most one new candidate per origin per batch. Repeat requests retain leases,
  backoff and same-context work. No global recurring selector is enabled.
- Initial discovery uses a reduced maintenance admission ceiling, leaving
  8,990,000 units of headroom (29 × two 155,000 reservations) for renewals.
  This is planning headroom, not a guarantee against unlimited failures or
  unexpectedly expensive queries. The maintenance lane remains 15,000,000.
- A protected-floor denial does not close the renewal lane. Initial work is
  durably deferred to the next UTC day; duplicate deliveries cannot move it.
  Initial failures remain in the initial cohort until discovery succeeds.
- Discovery checks protocol and requirements, never synthetic quotes. Evidence
  policy and buyer-owned quote requirement are unchanged. General queues stay off.
- The safety cap is deliberately 29, not unlimited growth. Further expansion
  beyond 29 needs a separately reviewed capacity/budget change. This version
  removes per-ID releases within that cap, not every future capacity release.

## Reproducible measurements

Local D1, simulated network, fixtures with 2,000 and 20,000 unrelated agents.
Both sizes produce the same recurring measurements. All metering is complete.
Weighted units = reads + 1,000 × writes; these are not invoices.

| 48h workload | Queries | Reads | Writes | Weighted units | Successful checks |
|---|---:|---:|---:|---:|---:|
| PR178 reference, 19 agents | 12,830 | 25,582 | 2,247 | 2,272,582 | 57 |
| New code, same 19 | 12,887 | 25,639 | 2,247 | 2,272,639 | 57 |
| New code, 29 agents | 13,609 | 28,773 | 3,426 | 3,454,773 | 87 |

The same-workload overhead is exactly one keyed read/query per consumer (57).
Extra work for 29 costs more; it is NOT presented as savings. Simulated daily
maintenance ledgers remain below their unchanged ceiling. Three checks per
agent cover first discovery and subsequent renewals; all final evidence is fresh.

| One-time operation | Queries | Reads | Writes | Weighted units |
|---|---:|---:|---:|---:|
| Admit 10 (including budget controls) | 52 | 907 | 83 | 83,907 |
| Migrate 19 tasks to registry | 9 | 938 | 192 | 192,938 |
| Sample 250 rows, 249 valid declarations, local | 1 | 1,498 | 0 | 1,498 |

Migration failure injection rolls back the rebuild and preserves all task fields.
DDL construction fixtures read two additional sqlite_master objects (registry
and unique index); their expected setup cost is updated by exactly two reads.
Recurring public-query thresholds and source-trigger costs are unchanged.

RED: registry schema test failed before migration0040 existed. GREEN: registry,
admission, auth/input, concurrent requests, capacity, idempotence, headroom,
durable deferral, migration rollback and local discovery/renewal tests pass.
The complete Worker run initially found six historical DDL/cost expectations;
the affected 21-test rerun passed after explicit schema-accounting corrections.
Final complete-suite rerun passed: 80 files / 691 Worker tests (576.77 seconds).
The final safety/selection rerun also passed all 13 tests, including the added
suspension and cross-network case. Types and 677 unit tests passed; staging
package dry run passed (no deployment). CI on the final PR head remains a
release gate; local success is not a deployment or remote admission.

## Candidate assessment and limitations

An initial remote read-only 5,000-row sample was unexpectedly expensive:
512,740 reads, 0 writes, 212.09 ms. It was not scheduled or repeated. Do not
copy that query into cron. The replacement uses a 250-row indexed cursor and
keyed LEFT JOINs; it retains missing declarations so pagination cannot stall.
Three bounded remote pages measured 1,500 / 1,501 / 1,501 reads, zero writes;
EXPLAIN checks were separate. These are different page sizes, not a normalized
before/after savings claim. Local tests cover missing and valid declarations.

Shortlist from the bounded pages: 213433, 213483, 2138, 2147, 2151, 2156.
They represent six distinct origins, not ten. Their requirements compatibility
is currently unavailable; safe declared endpoints are only candidates, NOT
proof of availability. No seller was contacted and no candidate was admitted.
Preserve the unfiltered page/cursor and remaining candidates; this sample does
not claim exhaustive coverage or that other agents are unsuitable.

## Release / rollback gates

1. Pass final suites and CI; reconcile remote main, active Worker and migration
   ledger. Preserve remote configuration and all other sessions' work.
2. Verify recoverable backup and available installation balance, preserving C's
   150M reserve. Admit conservative migration cost separately; never raise a cap
   silently. Migration0040 rebuilds the small work table; it is not purely additive.
3. Pause/drain only the pilot, snapshot its tasks/origins, apply0040 and verify
   exact preservation. Deploy compatible code with the admission gate closed.
4. If release is approved, open the temporary gate while paused, admit only the
   reviewed shortlist, inspect returned admitted/skipped IDs, close the gate,
   restore only the authorized pilot. Do not force ten or fabricate availability.
5. Observe actual checks, public results and complete costs. Keep the original
   monitor deadline; split versions. No remote load tests or automatic quotes.
6. On regression pause only the pilot. Retain registry/tasks/evidence; do not
   destructively roll back the schema or resume old code against new members.

Full catalogue admission / delivery C and production renewal evidence are not
completed by this local implementation.
