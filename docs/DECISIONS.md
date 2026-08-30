# Active Decision Log

Private working record for material scope and architecture decisions. Historical
implementation detail remains recoverable from Git and merged pull requests; this
file records only decisions that still govern the submission.

| Date | Decision | Status | Rationale | Trade-off |
| --- | --- | --- | --- | --- |
| 2026-08-12 | Use trust8004 APIs as the sole catalogue source and keep BSC as the only marketplace chain | Active | Reuses infrastructure operated by this team while preserving a clean server-to-server boundary | Catalogue completeness and freshness remain explicit; critical facts require direct BSC verification |
| 2026-08-12 | Use ERC-8183 as the non-custodial hiring rail | Active | Provides quote, escrow, delivery and dispute lifecycle with onchain evidence | Wallet UX, `$U` funding and settlement timing add complexity |
| 2026-08-24 | Operate exactly one deterministic Grid reference seller | Active | Grid lacked a verified seller and blocked an end-to-end Mainnet demonstration | It must remain labelled marketplace-operated testing/reference supply, not an official BNB or third-party agent |
| 2026-08-24 | Keep Mainnet buyer custody in an injected EIP-1193 wallet | Active | The browser signs every buyer transaction and the server never receives the buyer key | Mainnet hiring requires explicit user signatures and sufficient BNB plus exact `$U` budget |
| 2026-08-24 | Treat BSC as authoritative for financial and lifecycle facts | Active | A database or snapshot can become stale; contract state and confirmed receipts prove the job | Presentation requires reconciliation and visible freshness instead of trusting persisted status alone |
| 2026-08-24 | Treat the seven-day OptimisticPolicy window as a submission risk | Active | A submitted job cannot become `COMPLETED` before the configured window expires without rejection | Job `56662` remains valid `SUBMITTED` evidence until settlement becomes eligible around 2026-09-03T00:40:26+02:00 |
| 2026-08-25 | Reuse the Testnet seller signer on Mainnet under separate server-only Production variables | Active by operator decision | Simplifies operation of the single-purpose seller | Increases cross-chain blast radius; keep funding gas-only, sweep earnings and rotate after 2026-09-23 |
| 2026-08-26 | Make Evidence Passport and bounded `Validate my agent` the visible validation layer | Deployed; visual iteration pending | Separates declared, observed, onchain and derived evidence without inventing one opaque reliability score | The Passport is explicitly an indexed snapshot, not current Worker reachability or quote freshness; validation never auto-assigns categories, promotes a seller or enables Hire |
| 2026-08-27 | Adopt a hybrid ERC-8183 evidence architecture: trust8004 indexes universal onchain facts; the marketplace stores only its own observations | Accepted with staged implementation | A portable job history belongs in the existing multichain trust8004 index, while quotes, probes, sanitized results and product telemetry are true only because the marketplace observed them | The portable ledger/indexer remains frozen until 2026-09-10; additive marketplace observations and marketplace-caused receipts are permitted immediately under the safeguards below. Point reads remain public and free; x402 applies to volume products. A first-party authenticated service tier is preferred over making the marketplace depend on Circle Gateway |
| 2026-08-27 | Keep the marketplace catalogue monotonic across rebuilds | Active | A transient third-party outage is an observation, not proof that an agent ceased to exist | Failed probes remain visible as `unreachable` with the last good observation; removal requires an explicit source or curation decision |
| 2026-08-27 | Freeze trust8004 production deployments through 2026-09-23 | Active | The submitted marketplace still depends on the deployed `/api/v2` compatibility surface during judging | Trust8004 changes and namespace migration wait until after the evaluation window |
| 2026-08-27 | Implement the BSC observation layer as one bounded Cloudflare Worker + D1 scheduler | Accepted; Free-first amendment below | A D1 lease and fixed per-run request budget are compatible with distributed Worker invocations and make overlap, rate use and cursor progress testable | Free runs exactly one phase per Queue invocation; only the multi-phase Paid pipeline requires an explicit Paid-plan change and separate staging gates |
| 2026-08-27 | Stop WP1 and recalculate observation-layer storage and cadence | Resolved 2026-08-28 by the Free-first profile | The reviewed reproducible snapshot found 21,210 A2A/ERC-8183 declarants and 21,213 candidate endpoints, above the 5,000 sizing gate; it retained aggregate counts but not the 16 ERC-8183 IDs | The global funnel remains snapshot-backed; live targets start from the versioned curated inventory and add ERC-8183 declarations observed by HEADER. Historical declarants are not claimed live until a versioned ID artifact exists; no full rescan runs inside Workers Free |
| 2026-08-28 | Make Workers Free the mandatory default until payment is explicitly approved | Accepted | Free has 10 ms CPU, 50 external subrequests per invocation, and daily D1 quotas; the previous Paid assumptions could terminate scheduled runs even when wall time remained | `CLOUDFLARE_WORKERS_PLAN=free` is the code default, `KILL_SWITCH=1` remains independent, Free uses one phase per run and 20% D1 quota reserve; Paid requires an explicit config change plus staging measurements before enabling cron |
| 2026-08-28 | Complete WP1 with a separate Free staging Worker and D1, disabled by default | Active baseline | The schema, lease, health contract and curated inventory pass local/runtime tests and require an isolated deployment target before WP2 traffic exists | The default is `KILL_SWITCH=1` with no Cron. WP2 may temporarily enable the exact staging gate after its preflight; production remains disabled |
| 2026-08-28 | Reserve 20 % of the D1 per-invocation query limit before WP2 | Active | D1 Free has a hard limit of 50 queries per Worker invocation and local Miniflare allowed 60, so row budgets and local green tests cannot prevent a staging-only failure | Free rejects configurations above 40 queries; every batch statement is counted, the phase preflights before writes, and four queries remain outside the phase budget for a sanitized error summary, lease release, attempt ledger and daily ledger |
| 2026-08-28 | Bound Free SWEEP by detail-request budget | Active | The live-set cursor contains agent IDs and trust8004 exposes the observed detail route per ID; the former default of 25 would require 25 upstream requests despite a budget of 4 | Free defaults `SWEEP_LIMIT=4`, requires it to be no greater than `TRUST8004_REQUESTS_PER_RUN`, and keeps Paid disabled until its separate promotion gate |
| 2026-08-28 | Harden WP2 from independent review with TDD regressions | Active; query floor superseded by the 2026-08-29 WP4 ORM recalculation | Review reproduced mutable-OFFSET skips, incomplete IPv6 policy, hidden phase failures, unsafe D1 bind sizing and invalid zero budgets despite the initial green suite | SWEEP pages the monotonic set of all persisted eligible target IDs; HEADER chunks bounded statements and skips/counts invalid items; failures and allowlisted metrics reach `/health`; executable limits are non-zero. The original 13-query floor was raised to 22 after full ORM migration |
| 2026-08-28 | Keep WP2 cron disabled until the Free CPU gate is demonstrated | Resolved by Queue isolation | Direct Cron HEADER=1 measured 21,364 µs initially, 16,336 µs after reducing D1 work and 16,508 µs after lazy loading; a ten-run series returned one cold sample at 14,962 µs and eight warm samples below 10,000 µs, so the required cold/P99 Free gate fails | Cron no longer executes a phase. It only publishes a versioned tick to a Free Queue; the consumer owns the 30 s CPU allowance. Staging remains `KILL_SWITCH=1` with no Cron Trigger after each trial |
| 2026-08-28 | Isolate WP2 phases behind Cloudflare Queues on Free | Active | Queue consumers are available on Free with a 30 s default CPU limit. At five-minute cadence, 288 ticks/day project to 864 nominal Queue operations and 1,728 with three retries per tick, below the executable 8,000-operation safety ceiling; the remote HEADER=1 and SWEEP=1 trial succeeded at 16,747 µs and 15,107 µs respectively | Adds one staging Queue and at-least-once delivery handling. Batch size is exactly one; a tick is marked complete atomically with phase state, failed deliveries remain retryable, lease contention requests retry after 240 s without ack, and stale/completed ticks are rejected after the lease. D1 attempts are budgeted separately at 288 nominal/1,152 retry-worst. Production cadence remains disabled until defaults, two Queue rotations, memory/D1 daily gates and WP3 pass |
| 2026-08-28 | Make Queue scheduling serial and validate remote state explicitly | Active | A controlled staging retry found a previously enqueued Cron tick after the config declared no schedules; a second preflight showed backlog zero before a new push exposed a delayed retry. Eventual trigger propagation, best-effort backlog metrics and at-least-once delivery make deploy output or one empty metric insufficient evidence | Root and staging declare `crons: []`, consumers use `max_concurrency=1`, and messages more than five minutes in the future are rejected. Every destructive retry trial uses a fresh validation Queue ID and deletes it after evidence capture; drain timing never authorizes reuse. Memory closes on `memoryUsageBytesP999 < 100663296`; D1 requires a controlled 24 h window and two live rounds require `sweepRound +2` |
| 2026-08-28 | Use an isolated validation Worker, Queue and D1 for destructive retry trials, with a 60-second automatic retry delay | Active | A fresh remote trial proved lease and phase-exception redelivery, but first exposed that the implicit zero-delay consumer setting exhausted retries 0–3 in about three seconds. The isolated database also prevents controlled failures or delayed messages from contaminating staging evidence | Every environment declares `retry_delay=60`; the lease-contention path still requests 240 seconds explicitly. Each destructive trial uses a fresh Queue ID and deletes its consumer, temporary Worker and Queue after evidence capture; D1 remains for audit. Failed-phase summaries count attempted upstream requests. The isolated run passed duplicate suppression and advanced `sweepRound` from 0 to 2 with Free defaults, but production cadence remains disabled until WP3 and the real D1 24-hour gate pass |
| 2026-08-28 | Make D1 daily sizing retry-aware and defer the final 24-hour gate until WP3 | Active | The former 10,000/250 per-run defaults fit nominal traffic but could project 11.52 million reads and 288,000 writes if all four Queue delivery attempts reached D1; measuring the WP2 PROBE placeholder would also understate the final candidate | Free defaults are 3,000 reads and 60 phase writes per attempt; two telemetry rows make the executable projection 864,000/17,856 nominal and 3,456,000/71,424 retry-worst, inside the 4 million/80,000 safety ceilings. Every D1 result contributes `meta.rows_read`/`rows_written` to a UTC daily ledger, while an append-only attempt ledger reconciles Queue delivery number and outcome. The final gate still uses raw database and account Cloudflare Analytics for a full 00:00–24:00 UTC staging day because local ledgers omit their own writes and unrelated account usage |
| 2026-08-28 | Make the final WP2 day independently reproducible and safely reversible | Active for the 2026-08-31 UTC gate | Adaptive Analytics cannot prove 288 exact Cron ticks or distinguish retries, and Cron propagation plus delayed Queue delivery makes a config diff insufficient evidence | Staging records every delivery append-only under `(messageId, attempt)` with a `scheduledTime` index, requires one terminal Queue message per tick and cyclic HEADER → SWEEP → PROBE order anchored by a raw D1 phase read immediately before the window, and reconciles the tick and UTC quota cohorts in both directions. The verdict parses SHA-256-bound D1/Workers/Queue/deployment/control raw evidence, including account-wide Queue operations, complete producer request attribution from Workers/WriteMessage timestamps plus subrequests, wall P95 and Queue evidence requested through the actual cutoff. The temporary `*/5` schedule is removed after `23:55Z`; with the consumer still active, cleanup waits for at least `00:15Z`, D1 reconciliation, 288 successful deletes and zero corroborating REST backlog. Staging Queue, consumer and D1 are retained |
| 2026-08-29 | Keep the final WP2 UTC day free of observer traffic | Active for the 2026-08-31 UTC gate | Direct Wrangler D1 reads, `/health` calls and manual Worker invocations enter the same account-wide D1/Workers Analytics used by the Free quota gate, so per-tick monitoring would make attribution weaker and spend the quota being measured | `window-start` is the last direct D1 read before `00:00Z`; no D1, health or admin polling runs during the measured day. Drain is control-plane-only and is rejected if it includes health evidence. Ledger and reconciliation start only after `24:00Z` plus terminality grace; authenticated consumer requests must reconcile exactly with the durable attempt cohort, and any drain-version producer invocation without a Queue write invalidates the day. A runtime safety threat still permits immediate producer shutdown, which invalidates and repeats the measurement rather than hiding the intervention |
| 2026-08-29 | Classify the first WP2 day as rehearsal and repeat the final gate | Active; final window UTC 2026-08-31 | Independent review found that the new literal preflight was never published and the complete activation snapshot was captured after the first tick; reconstructing either retrospectively would contradict the create-only evidence contract | Preserve the 2026-08-29 captures under `evidence/rehearsal/`, close and measure that run safely, then repeat with preflight and activation before the first tick. Final evidence additionally requires a producer-only drain snapshot, exact deployed Free bindings/budgets, bounded control capture, authenticated ledger cutoff and a raw-derived self-validating builder |
| 2026-08-28 | Keep public health constant-cost and treat D1 telemetry as reconciliation | Active | A public `COUNT(*) GROUP BY declarationState` would scan the growing target set on every uncached request and could itself exhaust the account-wide D1 Free read quota; a failed ledger write after atomic phase completion must not trigger the completed work again | `/health` reads only allowlisted `runtime_state` keys and reports target counts unavailable. Phase queries abort after the first observed row-budget crossing, while bounded cleanup remains best-effort so release/ledger failure cannot replace the primary result; acquisition errors also attempt owner-checked release. Active scheduling without a valid, fresh current-day ledger is degraded after three cadence windows (minimum 15 minutes), and a scheduler error degrades until a newer healthy phase exists. Raw Cloudflare Analytics remains authoritative because row metadata arrives post-query and ledger persistence can fail |
| 2026-08-28 | Adopt the hybrid ORM convention for the observation Worker | Accepted; additive layer delivered in PR #35 | The spec mandated Drizzle but 19+ runtime queries were hand-written SQL strings, so schema drift could only fail at runtime inside a production cron | Runtime data access goes through `src/db/orm.ts` with rows typed by `$inferSelect`; the scheduler lease and the query-budget wrapper stay deliberately raw and are the only files allowed to call `.prepare(`; existing raw call sites migrate as they are next touched and a grep gate enforces the boundary in full from WP4 |
| 2026-08-28 | Require one worktree per session and clean-checkout gates | Active | Two sessions shared one working tree (a branch switch landed under an active session) and WP1 reported green tests by resolving dependencies from the parent checkout while its own install was broken | Each session works in its own git worktree and branch; parallel WPs declare disjoint file sets and a PR only contains files its session authored; a gate counts only when `npm ci` plus the package check pass in a clean checkout, with CI as arbiter |
| 2026-08-28 | Make WP3 fail closed around Grid Agent 303779 and one exact seller endpoint | Active | Workers cannot honestly claim Node-style DNS pinning, endpoint query strings can leak credentials, and a quote verdict assembled from different BSC blocks is internally inconsistent | Before any egress, WP3 requires the exact agent and endpoint allowlists and the exact derived Grid A2A message route; rejects credentials/query/fragment/redirects; fixes all RPC reads and ERC-1271 verification to one fresh BSC block; compares token decimals onchain; and groups contract reads so the ten-request ERC-1271 worst case remains below the Free default of 12. Expanding beyond this target is a separate WP4 architecture gate |
| 2026-08-28 | Make the staging admin trigger enqueue-only | Active | Running a phase inside `POST /__admin/run-scheduled` put the manual gate back under the 10 ms HTTP CPU limit, bypassed the Queue consumer's 30 s allowance and omitted its completion marker | The guarded route accepts no phase or timestamp, publishes exactly one versioned tick and reports success only after Queue accepts it. The serial consumer remains the sole phase executor; production and nominal staging keep the route hidden |
| 2026-08-28 | Split WP3 transport evidence into remote nominal egress and deterministic Workerd negatives | Active | With one exact allowlisted Grid endpoint, redirect and timeout cannot be induced remotely without changing the real seller or shipping fault injection in the candidate Worker | Cloudflare staging must prove the nominal Grid path. Workerd deterministically proves timeout, response cap and redirect rejection. Expected seller failures persist a sanitized observation and rotate; unexpected infrastructure exceptions do not commit and remain retryable |
| 2026-08-28 | Bootstrap only the exact WP3 Grid target after live reconciliation | Active | A clean staging D1 has no `probe_targets` row, so selecting before trust8004 refresh returned `no_candidate`; manually inserting a row would make the gate non-reproducible and weaken provenance | When the exact Free allowlists are present and no current row is selectable, PROBE synthesizes only Grid 303779, confirms the exact endpoint through trust8004, then atomically inserts or reactivates the target with `derived:marketplace-inventory` provenance while preserving `firstSeenAt` on conflict. Unavailable or removed live metadata produces no bootstrap write |
| 2026-08-28 | Normalize the exact trust8004 A2A Agent Card declaration before WP3 allowlist matching | Active | The live Grid record legitimately returns `endpoints: null` and declares `https://bnb-agent-marketplace-ruby.vercel.app/grid/.well-known/agent-card.json`, while the marketplace safety boundary is the logical seller base `/grid`; treating either shape as removed prevented the nominal probe | Optional endpoint arrays accept only null/absent as empty, malformed non-null values remain fail-closed, and only the exact A2A `/.well-known/agent-card.json` suffix is stripped after safe-URL validation. ERC-8183 declarations and near-match suffixes are never normalized. The remote gate then passed `quote_verified`; its pre-fix staging row is ignored until a normalized full SWEEP retires it without manual D1 mutation |
| 2026-08-29 | Record the atomic Analytics evidence publication contract | Accepted; implemented before this row | Partial or interleaved control captures could publish a self-inconsistent evidence directory whose provenance cannot be re-verified afterwards | Captures publish atomically into a captureId directory with a manifest and per-file SHA-256 hashes (`scripts/capture-wp2-analytics.ts`); the artifact builder re-validates the literal responses and hashes (`src/evidence/wp2-24h-artifact.ts`), and backlog count and bytes are now re-proven as zero for preflight, activation and cleanup while drain keeps its literal values |
| 2026-08-29 | Automate and test the activation-window rollback | Active | The spec-mandated rollback trap existed only as untested copy-paste shell inside the README runbook, fragile to typos and API drift during a real abort | A versioned script (`scripts/rollback-wp2-activation.ts`) builds the exact control-plane rollback sequence armed from activation until window start, defaults to printing without executing, and is covered by regression tests; the README runbook invokes the script instead of inline commands |
| 2026-08-29 | Fail closed when current observations are unavailable | Active for WP4 | The release agent snapshot generated on 2026-08-25 expired at 2026-08-28T23:39:15.884Z; serving it after Worker/D1 failure could make historical agent state look current | `/observations` is cacheable for at most 60 seconds with revalidation required, and its internal cache key includes the SHA-256 of the exact agent allowlist. After that, the marketplace may show live trust8004 declarations but marks observation state unavailable and disables derived Hire/reachability claims. The release snapshot has no active catalogue or Hire-authorization adapter and remains only on a route labelled historical. Only the aggregate WP0 funnel remains as an explicitly dated, block- and SHA-bound historical measurement |
| 2026-08-29 | Recalculate the Free D1 query envelope after the WP4 ORM migration | Active; corrected by adversarial WP4 TDD | Metadata-unavailable targets can accumulate across rotations, so one retirement statement per historical endpoint is not a hard bound | SWEEP now groups retirement/unavailable updates per agent (at most two candidate writes plus one grouped update). Config deliberately keeps the more conservative six-slot envelope: `SWEEP_LIMIT<=4`, Free minimum 38 and default 4/40. A pre-batch row estimate also rejects anomalous grouped updates before cursor/completion can commit beyond the configured write budget |
| 2026-08-29 | Keep general probe egress behind its architecture gate | Active | Independent WP4 review found that wildcard defaults had shipped before the spec's Cloudflare-egress trust boundary was demonstrated in staging | Root, staging and validation return to exact Agent `303779` plus its Grid endpoint. Wildcard also fails config unless `PROBE_GENERAL_EGRESS_APPROVED=1`; even with approval `/observations` returns 503 instead of scanning globally until a bounded feed contract exists. Expansion requires explicit decision, staging evidence and a newly measured bundle |
| 2026-08-29 | Bind current UI claims to endpoint-level observation evidence | Active | Review reproduced stale protocol claims, metadata/quote drift, order-dependent multi-endpoint selection and indexed trust8004 reachability leaking into the `all` view | Current labels require a <=60 s observation, matching current/observed metadata, a <=60 s `quoteNegotiatedAt`, future expiry and category-specific evidence. All surfaces use the same deterministic target selector; unavailable Worker state cannot become `Reachable · verified` |
| 2026-08-29 | Separate informative observations from buyer-requested transaction quotes | Active; supersedes observation-gated Hire in `Fail closed when current observations are unavailable` and `Bind current UI claims to endpoint-level observation evidence` | The five-minute Cron rotates `HEADER → SWEEP → PROBE`, so Free executes PROBE nominally every fifteen minutes and, with batch one plus target rotation, cannot support a sixty-second Hire gate. More importantly, a background observation is not the buyer's transaction quote | `/observations` keeps a 60-second HTTP/cache TTL and remains the source of timestamped informative claims only. Every ERC-8183-compatible seller admitted by the active marketplace allowlist exposes `Get fresh quote` even when evidence is old or Worker/D1 is unavailable; every click negotiates and validates a new quote, and the buyer may refresh again before signing. That fresh validated quote plus current onchain checks authorizes `prepare`; Worker, D1 and snapshots never do. A confirmed refresh publishes only sanitized evidence, while sync failure is explicit and does not fabricate public freshness. MCP-only agents remain discoverable but not hireable through the marketplace |
| 2026-08-30 | Make the landing journey follow the connected BSC chain, with Mainnet as the safe default | Active | The previous absence of a completed canonical Mainnet proof made the hero fall back to Testnet Job 551, so a disconnected Mainnet product appeared to be a Testnet demo | SSR, disconnected wallets, chain 56 and unsupported chains render the Mainnet hiring path; only a connected chain-97 wallet renders the Testnet demo/proof. A pending Mainnet proof is labelled as hiring availability, never as completed onchain proof |

## Current Mainnet proof boundary

- Seller Agent ID: `303779`.
- Job ID: `56662`.
- Current proven state: `SUBMITTED`.
- Deterministic deliverable hash:
  `0x104681048d6ecd1824bd04e39e3975eb7ab9fcf65e69647e982bf186f843aa5d`.
- The job becomes the canonical public Mainnet proof only after the settlement
  dry run confirms eligibility, settlement reaches `COMPLETED`, and proof capture
  validates every required receipt and event.

## ADR amendment: bounded observation scheduler

`docs/SPEC-MVP.md` v5 refines, without widening, the marketplace-observation
store permitted by clauses 6b and 6c below:

- five minute Cron Trigger on Free publishes one versioned tick to a Free Queue;
- the Queue consumer processes exactly one message, acquires the D1 lease,
  rejects an already-completed or stale timestamp and then runs one phase;
- exactly one of HEADER, SWEEP or PROBE per Free invocation; the next phase and
  cursor are persisted in D1;
- with the five-minute Cron and three-phase rotation, PROBE runs nominally every
  fifteen minutes; this is background evidence cadence, not Hire authorization
  and not a promise that every target is probed every fifteen minutes;
- fixed trust8004 request budget per run; no process-memory token bucket;
- HEADER processes its full recent page and SWEEP advances page data plus cursor
  atomically with `D1.batch()`;
- provisional catalogue counts cannot be published until WP0 commits a dated,
  block-pinned, internally reconciled snapshot;
- `hire_events` is idempotent first-hand telemetry. Onchain phases are accepted
  only after receipt and state verification; current job state is still read
  from BSC and is never inferred from D1;
- the public observation contract contains both current declaration metadata and
  observation-time metadata, including quote expiry, so labels remain derived at
  read time;
- Free live observation is intentionally scoped to ERC-8183 declarants and the
  curated inventory. The full 309,897-agent funnel remains reproducible through
  the versioned WP0 snapshot rather than being rewritten continuously into D1;
- targets that become unreachable or cease to declare an endpoint remain visible
  with literal status and timestamps.

This amendment does not authorize the portable ledger, a global event backfill,
trust8004 production changes or any new MVP feature. WP0 is a blocking capacity
and evidence gate; failure changes the design before infrastructure deployment.

Scope exchange for the submission: the observation layer takes the implementation
slot previously assigned to a new submission-bounded Job Ledger and to additional
holographic Passport polish. Existing direct BSC job tracking and versioned proof
capture remain; a new `/jobs` persistence surface and non-essential visual polish
are deferred. This is a replacement, not an additive MVP feature.

## ADR-2026-08-27: ERC-8183 index ownership and marketplace persistence

### Status

Accepted for design. The portable ERC-8183 ledger and event indexer are prohibited
before `2026-09-10`; the narrowly scoped marketplace observation and execution
stores below are permitted immediately under their stated safeguards.

### Context

trust8004 already operates a multichain PostgreSQL indexer with a durable event
inbox, block cursors, leases, retries and event idempotency. The marketplace is
BSC-only, but ERC-8183 job history is ecosystem evidence rather than a
marketplace-specific fact. Duplicating that projection inside the marketplace
would fragment track records and create two competing versions of onchain state.

At the same time, the marketplace produces observations that cannot be treated as
universal truth: it fetches Agent Cards, probes endpoints, verifies signed quotes,
sanitizes deliverables and measures its own user journey.

The governing rule is:

> trust8004 stores what is true for everyone; the marketplace stores what is true
> only because the marketplace did or observed something.

### Decision

Adopt the hybrid architecture:

1. Chain remains authoritative for financial, identity and ERC-8183 lifecycle
   facts.
2. trust8004 independently indexes verified ERC-8183 events and builds a portable,
   multichain job projection. Its primary key includes `chainId`, Commerce contract
   and Job ID from the first migration.
3. trust8004 initially indexes only official, explicitly allowlisted contracts.
   A marketplace may suggest a chain and contract address, but it never writes a
   job, transition or status into trust8004. The indexer verifies the contract
   before accepting it as a source.
4. The marketplace stores only its signed-quote observations, endpoint
   observations, validation snapshots, sanitized deliverable observations,
   references to indexed jobs and product telemetry.
5. Neither system produces a composite reliability score or universal ranking.
   Every aggregate carries its sample size, provenance and observation cutoff.
   Mainnet Job `56662` remains `n=1`.
6a. **Prohibited before `2026-09-10`: portable job ledger and ERC-8183 event
    indexer.** This prohibition covers the multichain projection, reorganisation
    handling, contract allowlists and RPC/storage budget required to make an
    independently authoritative ledger. The Build the Era submission does not
    require durable history, and changing this infrastructure before the deadline
    would add more risk than rubric value.

6b. **Permitted immediately: marketplace probe observations.** The marketplace
    may keep a thin, additive table of its own endpoint, Agent Card and quote
    observations, with the observation timestamp and an attached signature or
    canonical evidence reference. This is telemetry, not an ERC-8183 indexer: it
    is BSC-only, has no reorganisation handling, performs no multichain
    projection, verifies no contracts and carries no global indexing budget.

6c. **Permitted immediately: marketplace-executed hires.** A hiring flow executed
    through this marketplace may retain its first-hand, sanitised receipts and
    transaction references because the marketplace caused and observed that
    execution. It does not create a second job ledger and does not write job
    facts or lifecycle transitions into trust8004.

The unlock conditions for 6b and 6c are mandatory:

- first-hand `probe_observations` remain additive; reconciled target state is
  mutable only through the documented `current`/`removed`/`metadata_unavailable`
  transitions;
- current labels may consume only the bounded, cached `/observations`
  projection, never direct D1 access;
- an empty or unavailable observation store leaves live trust8004 declarations
  renderable but disables current observation claims; it does not prevent an
  ERC-8183-compatible seller from receiving a buyer-requested fresh quote. The
  committed snapshot is available only on its explicitly historical route;
- the stored value is an `OBSERVATION` with its timestamp, never a persisted
  boolean such as `hireable`; the label is calculated when read from the
  observation age and current policy.
- Worker/D1 observations are never authority for `prepare` or wallet signatures.
  A new buyer-requested quote is validated independently and may publish only a
  sanitized observation after confirmation; MCP-only declarations remain
  discovery evidence, not a hiring transport.

For the presentation funnel, no persistence is implemented. A one-shot harvest
script may use `eth_getLogs` and emit a dated JSON file with a pinned block, using
the same model as the public snapshot. It has no table, cron, reorganisation
logic or durable index.

7. **The catalogue never shrinks silently.** A 48-hour deployment rebuild may
   re-probe third-party endpoints, but a failed probe must not remove an agent
   that was previously visible. Retain the entry as `unreachable` together with
   its last good observation timestamp. Removal requires an explicit source or
   curation decision and a visible explanation.

8. **Freeze trust8004 production deployments through `2026-09-23`.** The
   production instance must keep the deployed `/api/v2` compatibility surface
   alive for the complete judging window. This is a dated operational decision,
   not an unresolved compatibility risk; any required trust8004 change is
   deferred until after the freeze.

### Data ownership

| Fact | trust8004 | Marketplace |
| --- | --- | --- |
| Job creation, participants, policy and configured contracts | Independently indexed onchain facts | References only |
| Budget, token, deadline and lifecycle transitions | Independently indexed onchain facts | Pre-signature presentation snapshot and references |
| Transaction hashes, blocks, timestamps and event-derived gas cost | Indexed with onchain provenance | Explorer links and presentation |
| Disputes, votes, rejection, refund and completion | Independently indexed onchain facts | User-facing explanation |
| Deliverable hash committed onchain | Indexed onchain fact | Direct verification and presentation |
| Signed quote observed and validated by our server | No | Sanitized fields, canonical hashes and observation time |
| Agent Card and endpoint behavior observed by our server | Declared metadata remains indexable; marketplace probe is not universal | Observation, status, capabilities and timestamp |
| Deliverable content or hosted result | Only a public onchain URI/hash when applicable; no arbitrary payload ingestion | Sanitized content/reference and hash comparison |
| Duration between onchain events | Derived fact with cutoff and sample size | Presentation |
| Wall-clock marketplace execution duration | No | Product observation |
| Category, hireability and Passport fingerprint | No | Marketplace policy and evidence snapshot |
| Discover-to-result funnel, browser failures and availability | No | Privacy-minimized product telemetry |

### Read-access and namespace decision

The job ledger is public infrastructure, not a record hidden behind a payment
gate. Adopt an Etherscan-style access model:

- a point read for one job is public and free;
- the job history for one agent is public and free with conservative pagination;
- bulk retrieval, exports, webhooks and historical time series are paid volume
  products in the stable external `/api/v1` contract using x402;
- trust8004's own frontend continues using its free `/api/app` BFF;
- free and paid external operations can coexist in `/api/v1`; x402 is an access
  policy, not a namespace.

BNB Agent Marketplace must not put ordinary catalogue or job-page rendering on
the Circle Gateway critical path and must not pay itself per page view. The
preferred long-term integration is a third, read-only first-party service tier
authenticated by a rotatable shared secret, with separate quotas and telemetry:

- it is not the frontend BFF;
- it is not an external x402 product;
- it exposes no mutations;
- secrets are Production-scoped, server-only and independently rotatable;
- handlers reuse the same feature queries as `/api/app` and `/api/v1`.

The precise namespace and authentication contract are deferred to Part 2 after
September 9. If the service tier is judged too costly for the first post-deadline
cut, the marketplace may temporarily consume `/api/app` as an explicitly recorded
same-owner exception. That exception must be revisited; it must not silently turn
the BFF into a general partner API.

### Cost ownership

The trust8004 operator initially pays RPC, backfill, reconciliation and storage.
x402 revenue from volume products may recover part of that cost but does not make
indexing free when nobody queries it. Each enabled chain and contract therefore
requires an approved RPC/storage budget and visible coverage. “Indexed ERC-8183”
means official allowlisted contracts through a stated block, never every contract
someone claims is compatible.

### Historical verification snapshot after WP4

The committed public verification snapshot remains reproducible historical
evidence, but it no longer gates `build:web`, populates current agent cards or
qualifies Hire. `build:deployment` therefore does not regenerate it. Current
seller observations come only from the Cloudflare `/observations` contract and
expire at read time; an unavailable Worker disables current observation claims.
The versioned job proofs and the dated WP0 funnel keep their historical labels,
blocks and hashes and remain renderable without pretending to be current.

These are operational rebuilds, not feature implementation. Each rebuild must
preserve the frozen code commit, record the new snapshot timestamp and block, and
pass the existing availability checks before promotion. If regeneration fails,
keep the previous deployment reachable but treat its evidence as stale rather
than silently current.

### Consequences and risks

- The public ledger remains portable because normal point reads do not require
  payment or a Circle dependency.
- Paid bulk access can contribute to indexing costs without taxing ordinary
  marketplace navigation.
- A first-party service tier introduces secret rotation, quota and namespace
  maintenance; temporary `/api/app` use is simpler but creates coupling.
- Allowlisting controls cost and malicious contracts but makes coverage partial;
  every response must expose coverage and indexed-block freshness.
- Reorg handling must invalidate orphaned events and rebuild affected job
  projections; current event idempotency alone is insufficient.
- Mapping a provider address to an ERC-8004 Agent ID remains ambiguous unless an
  independently verifiable binding exists.
- Arc Mainnet fits the composite keys but cannot be enabled until its official
  contracts, deployment blocks, RPC behavior and finality are verified after
  launch.
- The marketplace currently references trust8004 `/api/v2` routes. The dated
  production freeze preserves that compatibility surface through the judging
  window; migration to `/api/app` or the first-party service tier remains
  post-freeze work and does not authorize implementation of the new ledger
  before September 10.
- Snapshot expiry can break a rebuild or leave deployed evidence stale during
  judging unless the September 8 release and 48-hour operational refresh cadence
  are executed.

### Deferred

Part 2 is intentionally deferred until September 10. It will define API
contracts, index/reconciliation behavior, migration treatment for Jobs `514`,
`551` and `56662`, and implementation phases. The holographic presentation of the
Evidence Passport is outside this ADR; only the ledger fields consumed by its
evidence model belong here.

## 2026-08-29 — Separate producer shutdown from consumer drain

Cloudflare Cron removal is eventually consistent. A single global kill switch
cannot safely close a measured window: enabling it prevents a late producer tick
but also acknowledges queued retries without processing them. WP2 therefore adds
`PRODUCER_KILL_SWITCH`, which blocks Cron and manual producers while leaving the
Queue consumer governed by `KILL_SWITCH`.

At controlled-window close, the operator activates the producer switch and
removes the Cron immediately after the last expected tick, keeps the global
switch off through terminality grace, reconciles D1 plus Queue Analytics and
requires zero corroborating REST backlog, then enables the global switch. The
drain snapshot may contain pending backlog; requiring zero there would disable
the consumer before it could finish. Final raw evidence must show no schedule,
zero cleanup backlog, and both switches on.
The variable defaults to the global switch when omitted, preserving fail-closed
behavior for existing environments.

The measured Worker version is deployed with a Cloudflare message containing
the full Git SHA and a tag containing its first 12 characters. This makes the
version-to-commit link independently visible in `wrangler versions view`.
Drain versions created during shutdown carry the same commit annotation and
script etag as the measured version. Their Workers samples remain in the
resource/error cohort because they may consume retries. Unauthenticated versions
fail validation, and exact Queue writes prevent any version from hiding an extra
scheduled message.

## 2026-08-29 — Navigation and copy pass

Detail pages were dead ends. `AgentProfile` offered no route back to the
catalogue at all, and where a return existed it was three different labels
(`Return to agent profile`, `Return to profile`, `Return to demo`) sitting at
the bottom of the page. The job trackers were worse than absent: both pointed at
a demo route, but they are reached from the header, the landing hero and the
catalogue's Grid empty state, so most visitors were sent to a page they had
never opened.

Detail pages now carry a static server-rendered breadcrumb above the title.
Top-level pages in the primary nav (`/agents`, `/compare`, `/validate`,
`/evidence/verification`) deliberately have none: `aria-current="page"` on the
nav answers "where am I" there without adding a one-item trail.

Catalogue provenance existed in three places at once: inside the `CoverageBadge`
label, in the catalogue `PageIntro`, and a third time on `AgentProfile`, where
`CoverageBadge` was invoked with no props and rendered a catalogue-wide claim
next to a single agent's Hire button. The provenance — chainId 56, `active=true`,
`response.total`, fetch timestamp — is preserved in full but now stated once, in
the catalogue intro. A tooltip was rejected as its carrier: it would hide the
timestamps on touch devices, and this repository requires source timestamps to
stay visible.

Two hireability labels stay verbose on purpose. `MCP only` and
`Wallet attribution ambiguous` are long for a badge, but shortening them would
blur exactly the distinctions this marketplace exists to keep: MCP/A2A
availability is not ERC-8183 hireability, and an ambiguous wallet attribution is
not a generic failure. Only `Quote refresh required` was reworded, to
`Quote expired` — the same fact, without instructing the buyer to perform an
action the page does not offer.

`/compare` no longer carries a hardcoded list of four agent ids. It reads the
curated candidates from `listMarketplaceAgents`, so it cannot offer an agent the
catalogue has dropped nor miss one it has added, and every catalogue card now
links into it. An id arriving through `?agentId=` that is not curated still gets
a checkbox, so a selection seeded from the "all registered agents" view survives
the next submit.

`/proof/job-514`, `/jobs/[jobId]` and `/spikes/erc8183-browser` are reachable
only by typing their URL; no UI links to them. They are left in place rather
than removed — they are pre-existing routes and deleting them is not part of a
navigation pass.

Category filters still disappear in the "all registered agents" view. Offering
them there requires a change to `listMarketplaceAgents` in the business layer,
which is out of scope for a presentation change.

## 2026-08-30 — Bound and isolate buyer-requested quote refreshes

`ON_DEMAND_QUOTE_TIMEOUT_MS` is a single end-to-end deadline over Mainnet RPC,
identity, Agent Card, negotiation and quote verification. HTTP work receives an
abort signal; SDK/RPC calls that do not expose cancellation are raced against
the same deadline and fail closed. The subsequent D1 evidence sync has an
independent budget and cannot invalidate a verified session quote.

The Free default is 30 seconds, still bounded by the configured 1–30 second
range. The earlier 5-second value applied to each dependency separately; after
turning it into one global deadline, independent local E2E reproduced three
safe failures against the admitted live seller. Keeping 5 seconds would have
made the hardened flow unusable rather than safer.

A quote is no longer rejected merely because negotiation began more than 60
seconds ago. It remains acceptable only while it has the configured minimum
remaining validity, stays within the SDK's 900-second maximum TTL and is not
more than 60 seconds in the future.

Buyer evidence writes use `BUYER_OBSERVATION_SECRET`, separate from the staging
administrative `SHARED_SECRET`. The marketplace sends it only to an HTTPS URL
without userinfo whose origin exactly matches
`BUYER_OBSERVATION_ALLOWED_ORIGIN`. A future public rollout must add a
distributed per-buyer/origin rate limiter; process-local counters are rejected
because they cannot enforce a limit across concurrent instances.

## 2026-08-30 — Make hiring the catalogue's primary presentation

The catalogue now presents one dataset through two layouts. Cards remain the
default because they preserve the marketplace's four-stage evidence story;
Table is an optional denser comparison of the same page of agents. Switching
layout never changes the source, pagination or evidence semantics.

`Marketplace selection` and `All registered agents` are two scopes over the
same public BSC registry, not separate inventories. Marketplace selection is
the curated outcome subset and sorts a currently hireable agent first. All
registered agents is the live, paginated set of active registrations returned
by trust8004; registration never implies evaluation or ERC-8183 hireability.
The presentation uses explicit labels and
icons as well as colour. The original `Research only` label was removed after
it proved to collapse materially different states. Cards now say
`Monitoring unavailable`, `No endpoint declared`, `Not monitored`, `Never probed`,
`Verified in release`, `Observed reachable`, or `Last probe failed`; `Hireable on
Mainnet` and `Registered only` remain distinct. A dated release verification is
attached to the live catalogue record and may preserve its attempt timestamp,
but it is labelled historical and never promoted to current Worker reachability.

Compact cards and table rows keep `Declared → Reachable → Quote verified → Job
proven`, but move provenance, state, detail and timestamps into keyboard-focusable
tooltips. Full evidence remains visible on the agent profile. Each catalogue
entry and profile links to `https://trust8004.xyz/agents/56:{agentId}`. Safe
HTTPS and IPFS image declarations are normalized when trust8004 exposes them;
the robot avatar remains the honest fallback. No new MVP feature or delayed
gate is introduced by this presentation change.

The global network context is explicit independently of the catalogue data.
Before wallet hydration, and whenever no wallet is connected, the UI defaults
to `BSC Mainnet`. A connected wallet on chain 56 or 97 changes that context to
`BSC Mainnet` or `BSC Testnet`; every other chain is labelled unsupported rather
than being presented as Mainnet. This does not relabel Mainnet registry records
as Testnet records.

## 2026-08-30 — Expose probe history instead of inferring failure

The public observation feed now carries the latest scheduler attempt and, per
target, total probe attempts, first/last attempt times, HTTP status, duration
and the normalized error code. It still does not expose signatures, private
keys or seller payloads. These are historical operational facts; they do not
extend the 60-second transactional quote window.

Feed availability and quote freshness are deliberately separate. A historical
observation remains visible with its real timestamp even after the 60-second
quote window or the 15-minute monitoring cadence; only a fresh buyer-requested
quote can authorize hiring. Erasing older observations made “not connected”
indistinguishable from “last checked earlier”, which is the ambiguity this
decision removes.

Reachability uses the intended 15-minute monitoring window; transactional
quote validity remains independently bounded to 60 seconds and is refreshed on
buyer request. A protocol-valid result older than 15 minutes is shown as
historical evidence, never rewritten as “no valid response observed”.

The catalogue explicitly reports whether the monitoring feed is disconnected
or when the Worker last ran. An unavailable feed is never rendered as a failed
endpoint. Agent profiles show the attempt count and last result, while compact
cards keep the detail in the existing evidence tooltip. The vague `Partial
coverage` badge is replaced with the actual scope and count: `Operational
candidates` or `All registered agents`.

This change does not turn the WP2 staging Worker into a continuously scheduled
production monitor. The checked-in Worker configuration remains safe-off until
a measured production candidate, cadence and allowlist are deliberately
activated. The UI must therefore remain honest when no scheduler run exists.
# 2026-08-30 — Staging marketplace monitoring is an active product feed

- The staging Worker is configured for `HEADER → SWEEP → PROBE` on a five-minute Cron, so the allowlisted marketplace seller is probed approximately every 15 minutes after Cloudflare begins delivering the trigger.
- Both staging kill switches are off. Production and validation remain safe-off.
- The Free-plan scope remains explicit: agent `303779`, one endpoint, `PROBE_BATCH_SIZE=1`, and the existing per-invocation budgets.
- The default marketplace view admits only marketplace-operated sellers or third-party sellers that have independently passed the hireability gate. Research candidates remain discoverable in **All registered agents**.
- This activation supports current product monitoring; it is not the canonical WP2 24-hour evidence run and must not be presented as one.
- Deployment `e5377bdf-fa2c-4dd4-995c-2aec747bd927` and schedule `*/5 * * * *` were verified in the control plane at 2026-08-30T19:31Z. Cloudflare delivered the first post-activation tick at 2026-08-30T20:20:16Z, after a longer delay than its documented propagation window.
- Version `bcf1de57-ff9f-4d34-b4f7-50e8f66c47d2` added sanitized lifecycle logs without changing the existing Cron trigger. The first measured rotation completed HEADER, SWEEP and PROBE on the first Queue delivery with 7, 14 and 10 D1 queries respectively.
- The PROBE tick scheduled at 2026-08-30T20:30:16Z recorded `quote_verified` for agent `303779` at 2026-08-30T20:30:18.787Z with no error and a 1,692 ms probe duration.
- Local development and the remote staging Worker use BNB Chain's official public Mainnet RPC, `https://bsc-dataseed.bnbchain.org`. Production and validation remain safe-off and are not activated by this choice.
- Public-RPC latency can make a freshly returned block appear slightly newer than the timestamp captured before the request. Chain validation therefore permits at most 10 seconds of future clock skew while retaining the 120-second stale-block ceiling; larger future timestamps still fail closed.
- Staging uses the Free-profile maximum `PROBE_TIMEOUT_MS=10000`. This leaves enough wall-clock time for public-RPC reads and the seller exchange without changing the CPU, D1-query or subrequest budgets.
- The complete local rotation passed as HEADER, SWEEP and PROBE with 7, 13 and 10 D1 queries. Its PROBE recorded `quote_verified` for agent `303779` with no error in 4,933 ms.
- Version `0c219da0-09f3-45d7-93aa-8391dd40315a` was promoted to 100% of staging without modifying the existing Cron. The remote PROBE scheduled at 2026-08-30T20:45:16Z completed on its first Queue delivery, used 10 D1 queries and 8 upstream requests, and recorded `quote_verified` with no error in 1,837 ms at block `119025746`.

## 2026-08-31 — Normalize the registry before expanding hireability

- A catalog size is never a product target. Snapshot v2 measured 319,851 BSC registrations and derived 29,801 candidates from their declarations; future runs may produce any count dictated by the same criteria.
- Identity, endpoint and declaration are separate records. The 30,721 declarations collapse to 1,330 unique endpoints and 218 representative origin/protocol probes, so shared services are fetched once rather than once per Agent ID.
- The complete snapshot is the discovery baseline. Free HEADER writes only a bounded prioritized increment and reports candidates it deferred; those identities are reconciled by the next snapshot instead of being silently claimed as live-indexed.
- Browser A2A, MCP, web and ERC-8183 HTTP checks are read-only user evidence. CORS failures are reported honestly, results are persisted as `browser_reported`, and they never satisfy platform reachability or hireability filters.
- Worker and marketplace checks use distinct provenance. Public candidate filters can select declared, pending, A2A, MCP, ERC-8183-declared, quote-capable, hireable or failed agents; only platform evidence participates in those operational states.
- A fresh valid quote is necessary but not sufficient for the existing Grid hiring UI. `Hire agent` additionally requires a marketplace-admitted configuration whose identity, contracts, policy, token, budget and post-funding delivery path are executable end to end. Dynamic third-party admission is not inferred from MCP/A2A.
- Staging D1 was seeded with the snapshot and measured 29,801 agents, 1,330 endpoints, 30,721 relations and 218 representatives. The bulk import produced 61,854 logical changes but D1 counted 247,408 writes including indexes; future Free bootstrap imports must be split across UTC quota windows.
- Worker staging version `7b6836c5-bd57-473a-a755-8e9d7d669d71` runs the public BSC RPC and `*/5 * * * *`. Its first post-deploy HEADER tick completed without retry and reported 74 candidates seen, six indexed, 68 deferred, one endpoint and six declarations. Production and validation remain safe-off.
- The first generic PROBE tick at 2026-08-30T22:30:00Z completed on delivery one and persisted one `network_error`, proving queue-to-D1 operation. It also selected Beefy's generic `web` declaration before its MCP declaration. The following candidate fixes that information-value bug by ordering due targets `erc8183_http → mcp → a2a → web`; the measured staging version remains unchanged until that candidate is explicitly promoted.
