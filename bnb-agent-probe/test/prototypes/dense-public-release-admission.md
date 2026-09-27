# Dense public projection: local release-admission review

Status: **not admitted for remote execution**. Reviewed only local artifacts on 2026-09-26. No remote queries, migrations, probes or configuration changes were performed by this reviewer. The parent subsequently supplied one newly authorized aggregate; its cost and population are incorporated below.

## Latest alternative: endpoint-only tuple backfill

The all-agent dense design below is retained as rejected evidence. The newer endpoint-only prototype stores current declarations only; agents without declarations remain available through the existing directory/source path. It does not truncate the registry to meet the budget.

The local cardinality-shaped tuple backfill now measures **661,605 reads, 43,849 writes and 6,159 queries**, including setup (28 queries) and 1,022 backfill/verification steps (6,131 queries). Physical nominal units are **44,510,605 ($0.044510605)**. This fixture matches agent/declaration counts and fan-out, but does not reproduce real capability/observation payloads; do not label the number a production bill or complete workload estimate.

Admission is separate: 1,020 populated pages of at most forty declaration tuples, one terminal empty page, then verification. `1,021 × 80,000 + 2,000,000 = 83,680,000` reserved units (**$0.08368**). The measured largest populated page is 43,249 physical units in this fixture. A forty-tuple page avoids the earlier forty-agent fan-out uncertainty; payload-sensitive source costs still need coverage.

| Latest planning allocation | Units | Nominal USD |
| --- | ---: | ---: |
| B evidence/metrics base, C and both authorized aggregate reads | 158,908,169 | 0.158908169 |
| Endpoint-only resumable admission | 83,680,000 | 0.08368 |
| **Combined reserved planning total** | **242,588,169** | **0.242588169** |
| **Unallocated part of the $0.25 cap** | **7,411,831** | **0.007411831** |

**Still not admitted:** the remaining allowance must cover unmeasured remaining DDL, recoverable backup/verification, source variation and failure/restart allowance. Per-stage helpers do not themselves enforce a combined initiative ledger. The current estimate leaves little margin; no implicit cap increase is authorized.

The chain-leading typed primary key `(agent_chainId INTEGER, agent_agentKey TEXT, endpointKey TEXT)` avoids a second index and its roughly forty-thousand-row build/write cost. Local shadow measurements preserve results, reduce Testnet operational reads from 40,946 to 358, and do not regress registry reads. Registry joins and trigger pair lookups must include the leading chain key. Agent mutation triggers must use `OLD.chainId` when deleting old rows, including chain changes.

Cross-review originally found that `initializeEndpointCheckpoint` used `INSERT OR IGNORE`, so rebuilding an empty table could retain an earlier complete marker. That local defect is now fixed and regression-tested: bootstrap invalidates coverage before DDL and retains prior charges. The production helper follows the same rule (see the validation section below). This does not authorize a production rebuild or replace the release lock and exact schema preflight.

The remainder records the earlier dense alternative and its failure; its figures must not replace this endpoint-only allocation or be added to it as if both constructions were planned.

## Sources and units

- `/private/tmp/d1-bc-cardinalities-20260925.json`: one production aggregate captured 2026-09-25 22:04:23 UTC; 359,534 reads, zero writes. It establishes source counts at that instant, not a payload replica or current counts.
- `/private/tmp/d1-b-cardinality-profile-20260925.json`: local synthetic source arrangement matched to those aggregate counts; evidence/metrics projection B, before the dense extension.
- `/private/tmp/bnb-d1-origin-agenda/bnb-agent-probe/docs/discovery-backfill-local-profile.json`: local C initialization, 40,769 declarations, 34,078 eligible contexts and 218 origins.
- `dense-public-backfill.test.ts`: local one-endpoint-per-agent fixtures and asserted physical metadata. These are not production measurements.
- `dense-public-backfill.ts`: current prototype admission estimator and checkpoint algorithm.
- `/private/tmp/d1-dense-admission-cardinalities-20260926.json`: additional aggregate captured by the parent; 626,610 reads, zero writes, separately accounted below.

Use the agreed nominal planning model `units = reads + 1,000 × writes`, with one unit equal to one nano-USD. The common cap is 250,000,000 units ($0.25). This review reuses that model; it is not a new tariff verification, invoice prediction or spending guarantee. A control allowance is a reservation, not another measured database write.

## Existing source-shaped estimates, separated by delivery

| Component | Physical reads | Physical writes | Additional control allowance | Planning units | Nominal USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| B source-observation index | 15,859 | 7,856 | 0 | 7,871,859 | 0.007871859 |
| B evidence/metrics backfill and verification | 369,788 | 294 | 100,000 | 763,788 | 0.000763788 |
| **B before dense extension** | **385,647** | **8,150** | **100,000** | **8,635,647** | **0.008635647** |
| C two-phase initialization | 237,378 | 138,799 | 10,250,000 | 149,286,378 | 0.149286378 |
| Already-observed cardinality read, included conservatively | 359,534 | 0 | 0 | 359,534 | 0.000359534 |
| **Subtotal, excluding dense extension** | | | | **158,281,559** | **0.158281559** |

The later authorized aggregate adds **626,610 units ($0.000626610)**. Updated subtotal: **158,908,169 units ($0.158908169)**. Remaining shared allowance before dense initialization, backup, remaining DDL, validation and operational margin: **91,091,831 units ($0.091091831)**. These local estimates are not a claim that this amount has been charged remotely.

## Dense experiment: physical work versus reservation

For the tested one-endpoint-per-agent distribution, including initialization and all resumable steps:

- Reads: `23.25 × agent_count + 18`.
- Writes: `1.075 × agent_count + 22`.
- Current fixed reservation: `(ceil(agent_count / 40) + 1) × 200,000 + 1,000,000`. The extra page is the empty terminal page; verification is separate.

| Local fixture | Physical reads | Physical writes | Physical nominal units | Reserved units |
| --- | ---: | ---: | ---: | ---: |
| 2,000 agents | 46,518 | 2,172 | 2,218,518 | 11,200,000 |
| 20,000 agents | 465,018 | 21,522 | 21,987,018 | 101,200,000 |

**Do not add the 20,000-agent fixture cost to the production-shaped subtotal and label that sum a production estimate.** The populations and source distributions differ. As an explicit admission stress scenario only, that fixture's reservation plus the updated subtotal is 260,108,169 units, exceeding the shared cap by 10,108,169 units ($0.010108169). Its smaller physical measurement does not override the admission policy. Committing admission before the data batch adds one query, two reads and one write per step relative to the earlier prototype; failed and abandoned admissions now remain charged.

At the current fixed estimator, the updated remaining allowance fits at most 449 populated pages plus one empty page and verification: **17,960 agents**, before reserving anything for excluded operational costs. This is a planning threshold, not a recommendation to truncate the backfill.

## Exact missing evidence before admission

The newer aggregate resolves the prior population gap: Mainnet has 183,220 agents and Testnet 286, totaling **183,506 agents**. Current declarations total 40,588 + 179 = **40,767**; sentinels total 147,990 + 190 = **148,180**; expected dense rows total **188,947**. Maximum current endpoints per agent is 12 on Mainnet and 7 on Testnet. The backfill scans all agents, not only hiring agents or C-eligible contexts.

At forty agents per page, the current estimator requires `ceil(183506/40) = 4,588` populated pages, one terminal empty page, and verification: **918,800,000 units ($0.9188) for dense admission alone**. Combined with the updated subtotal this is **1,077,708,169 units ($1.077708169)**, before remaining excluded costs. It exceeds the common cap by **827,708,169 units ($0.827708169)**. This is a reservation-policy result, not a measured production bill. The current design is unequivocally blocked for admission; the one-endpoint fixture's physical formula must not be extrapolated to this different distribution as an override.

Minimum remaining local work:

1. The needed population dimensions are now supplied. Preserve their exact aggregate and capture time; no additional production cardinality query is needed for this decision.
2. Run the resumable dense initializer against a source-shaped local fixture, including endpoint fan-out, declaration-only and sentinel agents, existing evidence and capabilities. Include DDL, trigger installation, page/checkpoint controls, both EXCEPT verification directions and restarts.
3. Validate that the per-page estimate safely admits representative maximum fan-out and that verification fits its estimate. Forty agents is not a bound of forty projection rows. Do not silently raise the shared cap or substitute physical cost for reservations.
4. Establish one shared admission allocation for B base, dense B, future C, backup/verification, remaining migrations and variance. Independent helpers each receiving the full $0.25 would not enforce the initiative cap.
5. Bound backup and schema-verification cost and verify a recoverable backup before remote migration. None has been established by these local artifacts.
6. Meter failed and rejected attempts. The prototype now commits its conservative admission separately before the atomic page. Failed data batches, abandoned invocations and pre-admitted CAS losers retain charges; retry requires a new reservation. Refused-attempt reads still cost money, so an external controller must avoid unbounded retry loops.

## Concurrency and current-policy review

- UPDATE guards now compare copied fields using SQLite `IS NOT`, including identity keys and projection version. This preserves NULL transitions while avoiding projection rewrites for ingestion/scheduling-only changes. Shared endpoint policy is not copied and remains joined live.
- Trigger replacement is now one atomic batch, eliminating the previously identified partial trigger-installation window.
- Page claim, absolute replacement and cursor advancement share one batch; conservative admission commits separately beforehand. Revision/text CAS and per-attempt tokens prevent stale workers from replacing a later page; the final marker removes the active token. A later worker can cause the first caller to return `raced` after its own committed page, but it cannot erase that committed progress. Both pre-admitted contenders may remain charged, by design.
- Reinitialization invalidates prior complete coverage before DDL and retains prior reserved units. The documented single-bootstrap-owner requirement remains relevant; reader readiness is not a substitute for a deployment lock or version/schema verification.
- Bidirectional verification compares current sources, not an earlier captured page. Future reader activation must depend on this verified dense coverage **and** the underlying evidence/metrics projection coverage. The current experiment is not itself a release migration or production reader gate.

Conclusion: the local evidence supports continued implementation. It does **not** yet support admitting the dense B extension remotely or declaring the shared B/C $0.25 budget satisfied.
# Production backfill helper validation (local, September 26)

The production helper `src/catalog/public-current-backfill.ts` now supersedes
the prototype's physical-cost estimate for this cardinality fixture. It uses
the existing Drizzle transaction boundary and preserves all failed admission
charges. New-build initialization invalidates coverage before caller-owned DDL,
without refunding charges. A public readiness check reads one checkpoint key;
the caller must also check sparse coverage. Infrastructure and sparse readiness
are checked during each admitted step and again atomically before approval.

Measured deterministic cardinality fixture (183,506 agents, 40,767 current
declarations; **not a replica of production evidence payloads**):

| Segment | Reads | Writes | Queries |
| --- | ---: | ---: | ---: |
| Checkpoint initialization and projection DDL | 2 | 16 | 28 |
| 1,022 steps, including infrastructure and admission controls | 769,039 | 43,833 | 8,175 |
| Total | 769,041 | 43,849 | 8,203 |

Weighted physical cost is **44,618,041 units**; maximum populated-page cost is
43,354 units, below the unchanged 80,000-unit reservation. The reserved total
remains **83,680,000 units**, so the prior shared admission estimate remains
242,588,169 units and its unallocated margin 7,411,831 units. This is not release
authorization: backup, remaining release work and contingency still need an
admission decision. The extra production controls cost 107,436 reads compared
with the earlier prototype total; they are included, not treated as free.

Reproduction: `npm run test:worker -- test/integration/public-current-backfill.test.ts --disableConsoleIntercept`.
All 13 tests passed, including real batch rollback, duplicate concurrent tokens,
single remaining reservation, rebuild failure, malformed checkpoint, lost
infrastructure at verification, cross-network source updates and exact coverage.
Drizzle conversion preserved the same measured reads, writes and query count.
