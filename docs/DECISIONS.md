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
| 2026-08-26 | Make Evidence Passport and bounded `Validate my agent` the visible validation layer | Deployed; visual iteration pending | Separates declared, observed, onchain and derived evidence without inventing one opaque reliability score | Validation never auto-assigns categories, promotes a seller or enables Hire |
| 2026-08-27 | Adopt a hybrid ERC-8183 evidence architecture: trust8004 indexes universal onchain facts; the marketplace stores only its own observations | Accepted with staged implementation | A portable job history belongs in the existing multichain trust8004 index, while quotes, probes, sanitized results and product telemetry are true only because the marketplace observed them | The portable ledger/indexer remains frozen until 2026-09-10; additive marketplace observations and marketplace-caused receipts are permitted immediately under the safeguards below. Point reads remain public and free; x402 applies to volume products. A first-party authenticated service tier is preferred over making the marketplace depend on Circle Gateway |
| 2026-08-27 | Keep the marketplace catalogue monotonic across rebuilds | Active | A transient third-party outage is an observation, not proof that an agent ceased to exist | Failed probes remain visible as `unreachable` with the last good observation; removal requires an explicit source or curation decision |
| 2026-08-27 | Freeze trust8004 production deployments through 2026-09-23 | Active | The submitted marketplace still depends on the deployed `/api/v2` compatibility surface during judging | Trust8004 changes and namespace migration wait until after the evaluation window |
| 2026-08-27 | Implement the BSC observation layer as one bounded Cloudflare Worker + D1 scheduler | Accepted; Free-first amendment below | A D1 lease and fixed per-run request budget are compatible with distributed Worker invocations and make overlap, rate use and cursor progress testable | Free runs exactly one phase per invocation; the pipeline is enabled only after an explicit Paid-plan change and staging gates |
| 2026-08-27 | Stop WP1 and recalculate observation-layer storage and cadence | Resolved 2026-08-28 by the Free-first profile | The reviewed reproducible snapshot found 21,210 A2A/ERC-8183 declarants and 21,213 candidate endpoints, above the 5,000 sizing gate; it retained aggregate counts but not the 16 ERC-8183 IDs | The global funnel remains snapshot-backed; live targets start from the versioned curated inventory and add ERC-8183 declarations observed by HEADER. Historical declarants are not claimed live until a versioned ID artifact exists; no full rescan runs inside Workers Free |
| 2026-08-28 | Make Workers Free the mandatory default until payment is explicitly approved | Accepted | Free has 10 ms CPU, 50 external subrequests per invocation, and daily D1 quotas; the previous Paid assumptions could terminate scheduled runs even when wall time remained | `CLOUDFLARE_WORKERS_PLAN=free` is the code default, `KILL_SWITCH=1` remains independent, Free uses one phase per run and 20% D1 quota reserve; Paid requires an explicit config change plus staging measurements before enabling cron |
| 2026-08-28 | Complete WP1 with a separate Free staging Worker and D1, still disabled | Active | The schema, lease, health contract and curated inventory now pass local/runtime tests and need an isolated deployment target before WP2 traffic exists | `bnb-agent-probe-staging` remains `KILL_SWITCH=1` with no Cron Trigger; enabling HEADER/SWEEP belongs to WP2 and enabling PROBE belongs to WP3 |
| 2026-08-28 | Reserve 20 % of the D1 per-invocation query limit before WP2 | Active | D1 Free has a hard limit of 50 queries per Worker invocation and local Miniflare allowed 60, so row budgets and local green tests cannot prevent a staging-only failure | Free rejects configurations above 40 queries; every batch statement is counted, the phase preflights before writes, and three queries remain outside the phase budget for a sanitized error summary, lease release and daily ledger |
| 2026-08-28 | Bound Free SWEEP by detail-request budget | Active | The live-set cursor contains agent IDs and trust8004 exposes the observed detail route per ID; the former default of 25 would require 25 upstream requests despite a budget of 4 | Free defaults `SWEEP_LIMIT=4`, requires it to be no greater than `TRUST8004_REQUESTS_PER_RUN`, and keeps Paid disabled until its separate promotion gate |
| 2026-08-28 | Harden WP2 from independent review with TDD regressions | Active | Review reproduced mutable-OFFSET skips, incomplete IPv6 policy, hidden phase failures, unsafe D1 bind sizing and invalid zero budgets despite the initial green suite | SWEEP pages the monotonic set of all persisted eligible target IDs; HEADER chunks binds below 1.5 MB and skips/counts invalid items; failures and allowlisted metrics reach `/health`; executable limits are non-zero and `D1_QUERIES_PER_RUN >= 13` |
| 2026-08-28 | Keep WP2 cron disabled until the Free CPU gate is demonstrated | Resolved by Queue isolation | Direct Cron HEADER=1 measured 21,364 µs initially, 16,336 µs after reducing D1 work and 16,508 µs after lazy loading; a ten-run series returned one cold sample at 14,962 µs and eight warm samples below 10,000 µs, so the required cold/P99 Free gate fails | Cron no longer executes a phase. It only publishes a versioned tick to a Free Queue; the consumer owns the 30 s CPU allowance. Staging remains `KILL_SWITCH=1` with no Cron Trigger after each trial |
| 2026-08-28 | Isolate WP2 phases behind Cloudflare Queues on Free | Active | Queue consumers are available on Free with a 30 s default CPU limit. At five-minute cadence, 288 ticks/day project to 864 nominal Queue operations and 1,728 with three retries per tick, below the executable 8,000-operation safety ceiling; the remote HEADER=1 and SWEEP=1 trial succeeded at 16,747 µs and 15,107 µs respectively | Adds one staging Queue and at-least-once delivery handling. Batch size is exactly one; a tick is marked complete atomically with phase state, failed deliveries remain retryable, lease contention requests retry after 240 s without ack, and stale/completed ticks are rejected after the lease. D1 attempts are budgeted separately at 288 nominal/1,152 retry-worst. Production cadence remains disabled until defaults, two Queue rotations, memory/D1 daily gates and WP3 pass |
| 2026-08-28 | Make Queue scheduling serial and validate remote state explicitly | Active | A controlled staging retry found a previously enqueued Cron tick after the config declared no schedules; a second preflight showed backlog zero before a new push exposed a delayed retry. Eventual trigger propagation, best-effort backlog metrics and at-least-once delivery make deploy output or one empty metric insufficient evidence | Root and staging declare `crons: []`, consumers use `max_concurrency=1`, and messages more than five minutes in the future are rejected. Every destructive retry trial uses a fresh validation Queue ID and deletes it after evidence capture; drain timing never authorizes reuse. Memory closes on `memoryUsageBytesP999 < 100663296`; D1 requires a controlled 24 h window and two live rounds require `sweepRound +2` |
| 2026-08-28 | Use an isolated validation Worker, Queue and D1 for destructive retry trials, with a 60-second automatic retry delay | Active | A fresh remote trial proved lease and phase-exception redelivery, but first exposed that the implicit zero-delay consumer setting exhausted retries 0–3 in about three seconds. The isolated database also prevents controlled failures or delayed messages from contaminating staging evidence | Every environment declares `retry_delay=60`; the lease-contention path still requests 240 seconds explicitly. Each destructive trial uses a fresh Queue ID and deletes its consumer, temporary Worker and Queue after evidence capture; D1 remains for audit. Failed-phase summaries count attempted upstream requests. The isolated run passed duplicate suppression and advanced `sweepRound` from 0 to 2 with Free defaults, but production cadence remains disabled until WP3 and the real D1 24-hour gate pass |
| 2026-08-28 | Make D1 daily sizing retry-aware and defer the final 24-hour gate until WP3 | Active | The former 10,000/250 per-run defaults fit nominal traffic but could project 11.52 million reads and 288,000 writes if all four Queue delivery attempts reached D1; measuring the WP2 PROBE placeholder would also understate the final candidate | Free defaults are 3,000 reads and 60 phase writes per attempt; two telemetry rows make the executable projection 864,000/17,856 nominal and 3,456,000/71,424 retry-worst, inside the 4 million/80,000 safety ceilings. Every D1 result contributes `meta.rows_read`/`rows_written` to a UTC daily ledger, while an append-only attempt ledger reconciles Queue delivery number and outcome. The final gate still uses raw database and account Cloudflare Analytics for a full 00:00–24:00 UTC staging day because local ledgers omit their own writes and unrelated account usage |
| 2026-08-28 | Make the final WP2 day independently reproducible and safely reversible | Active for the 2026-08-29 UTC gate | Adaptive Analytics cannot prove 288 exact Cron ticks or distinguish retries, and Cron propagation plus delayed Queue delivery makes a config diff insufficient evidence | Staging records every real Queue delivery append-only under `(scheduledTime, attempt)`, versions the exact D1/Workers/Queue queries, validates 288 aligned ticks and 96 completions per phase, and retains raw responses with SHA-256. The temporary `*/5` schedule is installed before midnight UTC, removed after `23:55Z`, and followed by a retry grace before restoring `KILL_SWITCH=1`; staging Queue, consumer and D1 are retained |
| 2026-08-28 | Keep public health constant-cost and treat D1 telemetry as reconciliation | Active | A public `COUNT(*) GROUP BY declarationState` would scan the growing target set on every uncached request and could itself exhaust the account-wide D1 Free read quota; a failed ledger write after atomic phase completion must not trigger the completed work again | `/health` reads only allowlisted `runtime_state` keys and reports target counts unavailable. Phase queries abort after the first observed row-budget crossing, while bounded cleanup remains best-effort so release/ledger failure cannot replace the primary result; acquisition errors also attempt owner-checked release. Active scheduling without a valid, fresh current-day ledger is degraded after three cadence windows (minimum 15 minutes), and a scheduler error degrades until a newer healthy phase exists. Raw Cloudflare Analytics remains authoritative because row metadata arrives post-query and ledger persistence can fail |
| 2026-08-28 | Adopt the hybrid ORM convention for the observation Worker | Accepted; additive layer delivered in PR #35 | The spec mandated Drizzle but 19+ runtime queries were hand-written SQL strings, so schema drift could only fail at runtime inside a production cron | Runtime data access goes through `src/db/orm.ts` with rows typed by `$inferSelect`; the scheduler lease and the query-budget wrapper stay deliberately raw and are the only files allowed to call `.prepare(`; existing raw call sites migrate as they are next touched and a grep gate enforces the boundary in full from WP4 |
| 2026-08-28 | Require one worktree per session and clean-checkout gates | Active | Two sessions shared one working tree (a branch switch landed under an active session) and WP1 reported green tests by resolving dependencies from the parent checkout while its own install was broken | Each session works in its own git worktree and branch; parallel WPs declare disjoint file sets and a PR only contains files its session authored; a gate counts only when `npm ci` plus the package check pass in a clean checkout, with CI as arbiter |
| 2026-08-28 | Make WP3 fail closed around Grid Agent 303779 and one exact seller endpoint | Active | Workers cannot honestly claim Node-style DNS pinning, endpoint query strings can leak credentials, and a quote verdict assembled from different BSC blocks is internally inconsistent | Before any egress, WP3 requires the exact agent and endpoint allowlists and the exact derived Grid A2A message route; rejects credentials/query/fragment/redirects; fixes all RPC reads and ERC-1271 verification to one fresh BSC block; compares token decimals onchain; and groups contract reads so the ten-request ERC-1271 worst case remains below the Free default of 12. Expanding beyond this target is a separate WP4 architecture gate |
| 2026-08-28 | Make the staging admin trigger enqueue-only | Active | Running a phase inside `POST /__admin/run-scheduled` put the manual gate back under the 10 ms HTTP CPU limit, bypassed the Queue consumer's 30 s allowance and omitted its completion marker | The guarded route accepts no phase or timestamp, publishes exactly one versioned tick and reports success only after Queue accepts it. The serial consumer remains the sole phase executor; production and nominal staging keep the route hidden |
| 2026-08-28 | Split WP3 transport evidence into remote nominal egress and deterministic Workerd negatives | Active | With one exact allowlisted Grid endpoint, redirect and timeout cannot be induced remotely without changing the real seller or shipping fault injection in the candidate Worker | Cloudflare staging must prove the nominal Grid path. Workerd deterministically proves timeout, response cap and redirect rejection. Expected seller failures persist a sanitized observation and rotate; unexpected infrastructure exceptions do not commit and remain retryable |
| 2026-08-28 | Bootstrap only the exact WP3 Grid target after live reconciliation | Active | A clean staging D1 has no `probe_targets` row, so selecting before trust8004 refresh returned `no_candidate`; manually inserting a row would make the gate non-reproducible and weaken provenance | When the exact Free allowlists are present and no current row is selectable, PROBE synthesizes only Grid 303779, confirms the exact endpoint through trust8004, then atomically inserts or reactivates the target with `derived:marketplace-inventory` provenance while preserving `firstSeenAt` on conflict. Unavailable or removed live metadata produces no bootstrap write |
| 2026-08-28 | Normalize the exact trust8004 A2A Agent Card declaration before WP3 allowlist matching | Active | The live Grid record legitimately returns `endpoints: null` and declares `https://bnb-agent-marketplace-ruby.vercel.app/grid/.well-known/agent-card.json`, while the marketplace safety boundary is the logical seller base `/grid`; treating either shape as removed prevented the nominal probe | Optional endpoint arrays accept only null/absent as empty, malformed non-null values remain fail-closed, and only the exact A2A `/.well-known/agent-card.json` suffix is stripped after safe-URL validation. ERC-8183 declarations and near-match suffixes are never normalized. The remote gate then passed `quote_verified`; its pre-fix staging row is ignored until a normalized full SWEEP retires it without manual D1 mutation |

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

- the store is purely additive;
- it is not on the landing-page render path;
- an empty store falls back to the committed/public snapshot without breaking
  the page;
- the stored value is an `OBSERVATION` with its timestamp, never a persisted
  boolean such as `hireable`; the label is calculated when read from the
  observation age and current policy.

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

### Evidence snapshot release risk

The marketplace public verification snapshot expires exactly 72 hours after
generation. `build:web` runs `check:verification-snapshot` and refuses to build
after `staleAfter`, but it does not regenerate the artifact. Only
`build:deployment` runs readiness, publishes a new snapshot and then builds.

This creates two distinct failure modes during judging:

1. A redeploy using only `build:web` fails once the committed snapshot expires.
2. Without a redeploy, the already running application continues serving a
   snapshot whose evidence cutoff has passed.

The release candidate must therefore be built with `build:deployment` on
September 8 UTC, after all readiness checks pass and no earlier than 72 hours
before judging begins. A single September 8 artifact cannot remain fresh through
September 23. During the evaluation window, regenerate and redeploy the same
frozen application commit every 48 hours, through September 22. The 48-hour
cadence leaves a 24-hour recovery margin before the prior snapshot expires.

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
