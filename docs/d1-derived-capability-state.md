# Derived capability state — no periodic repair writes

## Scope and dependency

Based on PR #159, commit `020837a`. Does not include #160 or its indexes.
No migration, new index, cadence/budget change, merge, deployment or resumption.
The submission branch and other sessions are untouched.

## Implementation and compatibility

`effective-capability.ts` provides a pure projection and equivalent SQL predicates.
Expired ready evidence becomes stale; missing expiry becomes discovered. Stale
evidence is ready only with both expiries in the future, compatibility, prior
success, zero failures and no error. Failed/suspended/unsupported states are never
rehabilitated by elapsed time. This projection is applied before endpoint ranking,
to public filtering/counting/detail, quote endpoint selection, background selection
and delayed queue consumers. Buyer-specific verified quotes remain mandatory.

Both repair UPDATEs and every production invocation are removed. Successful probes,
failures, discovery, administrative actions and queue claims still write real events.
`nextProbeAt` remains authoritative: an expired capability cannot erase an active
lease or accelerate a backoff. Legacy future schedules stay future. `updatedAt`
does not change merely because time passed; ties formerly affected by repair-time
timestamps can therefore order differently, without changing ranking rules.

The SQL due ranges retain their covering indexes. Stale rows needing failure
details use primary-key lookups instead of widening those indexes. Testnet keeps
its identity slice first through CROSS JOIN, preventing the new predicates from
causing the planner to expand endpoints before filtering the network.

Snapshot payload version is now 2. Existing runtime keys and refresh lease are
retained to avoid duplicate scans during rollout. Version-1 snapshots are unknown
until the next authorized refresh; health never computes replacement aggregates.
Public API shapes and UI text/layout are unchanged. Snapshot freshness is still
15 minutes, not a claim that historical counts remain current after expiry.

## TDD and verification

- The prior policy did not restore still-valid stale evidence without a repair.
  The regression now passes with usable endpoint/requirements evidence present.
- 768 deterministic rows exercise SQL/TypeScript state and ready-predicate parity,
  expiry boundaries/nulls, restoration blockers and both networks.
- List, facets and detail agree before/after expiry with no cron or capability
  writes. Public evidence still cannot prepare a buyer hire by itself.
- Expired capabilities are selected without rewriting state; future leases/backoffs
  remain untouched. Still-valid stale evidence is skipped by selectors and delayed
  consumers without seller calls. Existing concurrency, retry, fairness, publishing,
  durable deferral and buyer-quote suites remain included.
- D1 fixtures use fake queue/RPC/consumers only, with no real seller requests.
- Final validation: 666 unit tests + 430 D1 integration tests (1,096 total),
  Worker/root TypeScript checks and diff checks. The internal skipRepairs option
  is removed with the repair function; no public interface changes.

## Measured costs against #159

Local D1 metadata, not Insights or billing forecasts. Complete producer cycles:

| Agents / backlog | Before reads | After reads | Writes unchanged |
| --- | ---: | ---: | ---: |
| 2,000 / sparse | 9,998 | 5,598 | 24 |
| 2,000 / dense | 27,350 | 23,349 | 276 |
| 20,000 / sparse | 99,638 | 55,638 | 24 |
| 20,000 / dense | 268,550 | 228,549 | 276 |

Sparse producer/replay/identity-consumer/synthetic-job fixture at 20,000 agents:
99,694 -> 55,694 reads, unchanged 121 writes. No repair-specific reads or writes
remain. No index construction or additional index write overhead exists.

Public route baseline was captured by running the same seeded harness directly
on unchanged #159. The new tests require reads <= each baseline and zero writes:

| Route | 2,000-agent baseline ceiling | 20,000-agent baseline ceiling |
| --- | ---: | ---: |
| Catalog | 3,451 | 30,452 |
| Hireable filter | 5,501 | 50,502 |
| Facets | 61,463 | 610,464 |
| Agent detail | 15 | 15 |

All four pass. Health stays <=100 reads (18 in the producer fixture).
Public facets remain substantial work: lack of regression is not low cost.

### 96-cycle simulation

The identical harness was first run on #159, then on this implementation. It
advances a UTC clock through 96 fifteen-minute maintenance cycles, includes real
budget/control queries, queued messages, a simulated successful consumer, a
synthetic independent job unit and health reads. Budgets are NOT raised. Pending
messages are retained when admission fails, with published=consumed+pending.
This is not all production consumers, 1,440 real job runs or production traffic.

Weighted units use the existing model: reads + 1,000 × writes. Public health reads
are reported separately from background cost. Example results:

| Scenario | Before units | After units |
| --- | ---: | ---: |
| 2,000 / four expirations | 2,313,398 | 1,721,406 |
| 2,000 / mass expiry | 13,269,853 | 4,924,718 |
| 20,000 / four expirations | 14,497,108 | 10,361,406 |
| 20,000 / mass expiry | 80,353,480 | 14,547,087 |

Empty and mass-restoration scenarios also pass strict before/after savings checks
at both sizes. In the 20,000 mass-expiry case, 49 maintenance cycles complete and
47 are denied; 49 simulated messages remain pending. The old mass write exceeded
its reservation on the first cycle. This is bounded progress, not clearing backlog.
Host-local timings are logged but are not production latency commitments.

## Remaining release blocker

The dense producer still charges 506,547 against its default 500,000 reservation.
Selection-by-origin remains the next optimization. Passing these economic checks
does not authorize reactivation or guarantee a monthly bill.

Before any separately authorized release, inspect active Worker/version, bindings,
remote configuration and migration ledger; preserve manual-run and all pauses.
This change requires no migration. Neither this PR nor its dependency was deployed
in this task. PR #160 remains a draft record of the rejected index approach.
