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
| 2026-08-31 | Remove the superseded Neon seller-observation slice | Active | Current observations already come exclusively from the bounded Cloudflare Worker and D1 contract; the unconfigured Vercel cron and standalone PostgreSQL schema duplicated that ownership boundary without serving current reads | The marketplace has one observation persistence path; historical Neon code remains recoverable from Git |

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
  boolean such as `hireable`; `Quote verified` is calculated from observation
  age, while `Hireable` is calculated from an admitted executable marketplace
  configuration plus a current declaration and always requests a new quote.
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

## 2026-08-30 — Reconcile WP4 presentation with the hireability evidence model

WP4's observation layer overrides card hireability to hireable, quote_stale or
listed_only, while `quoteRequestAvailable` is computed on the base view model.
A card could therefore say "Not evaluated" beside a "Get fresh quote" CTA. The
card now labels that combination "Quote on request": a statement about the
declared request path of a marketplace-operated seller, not a claim of
verification, so it does not conflate availability with ERC-8183 hireability.

WP4 also stopped rendering `hireability.reason` on the agent profile, which
erased the prose distinction between "MCP declared but not hireable" and
payment-safety blocks. The profile renders the policy-authored reason again
when no quote request is available, and reuses the shared label map for the
states it shares with cards.

`/agents?view=all&category=…` used to accept and propagate a category that the
registered view never applies — pagination links and the search form carried a
filter that did not exist. The parameter is now dropped outside the marketplace
view, and the registered-view intro states that category filters apply only to
curated candidates.

### Review addendum (same day)

A three-agent review of the change found that the quote-on-request rule had
been applied to the card only: the profile still rendered "Not hireable"
beside the "Get fresh quote" button, /compare still printed raw enum values,
and the restored entity-level `hireability.reason` could contradict a
positive observation badge ("Hireable now" next to prose denying a verified
quote). Every finding was reproduced by a failing test before being fixed
(tests/pr40-review-*.test.tsx).

The rule now lives in one exported helper, `hireabilityLabelFor`, consumed by
card, profile and compare, so the label cannot fork per surface again. The
profile shows the entity reason only when observations resolve the agent to
listed_only — structural facts observations cannot contradict — and shows the
observation-aware quote detail otherwise. The quote-on-request state gained
its user-facing definition on the profile: continuing requests a fresh
ERC-8183 quote verified before any wallet interaction.

Also recorded: `/agents?view=all&category=<invalid>` now renders instead of
returning 404, matching the API route, which already ignored category in the
registered view; the behavior is pinned by tests.

## 2026-08-31 — Landing redesign: value-first copy, visual funnel, proof-led hero

The landing talked to judges, not buyers: headlines described editorial policy,
the hero badge opened with a caveat, and the first screen was dominated by
"Not Observed" states. Redesigned against an approved mockup:

- Hero: BNB badge removed, primary CTA shortened to "Get a Mainnet quote"
  (seller named in a support line), evidence rail rendered compact.
- Funnel: headline is computed from the real evidence counts ("309,897
  registered. 16 declare hiring.") and stages render as proportional bars.
  Citation (artifact, SHA-256, block) unchanged. Unmeasured stages stay
  "Pending observation" — no invented counts.
- The "What Hireable now means" explainer collapses into a details block;
  content unchanged and still pinned by tests.
- The candidates section (observation alerts, provenance legend and agent
  cards) is removed from the landing entirely: the catalogue is reached via
  the category cards, the header nav and the hero's secondary CTA. Live
  observations still power the hero evidence and the admitted-seller state.
- Verified evidence steps render green with a green check everywhere the
  evidence rail appears; funnel bars are neutral, with provenance carried by
  the existing badges.

All figures remain sourced from evidence artifacts, catalogue counts and
observation view models; nothing is hardcoded. Network-aware hero behavior
(Mainnet default, Testnet on chain 97) is unchanged and remains pinned by
tests/frontend-components.test.tsx.
`OBSERVATIONS_URL` is the server-side address of the Worker's public evidence
feed and is also the source from which the marketplace derives the public
catalog and authenticated write routes. `BUYER_OBSERVATION_ALLOWED_ORIGIN` is
an outbound destination allowlist, not a CORS setting and not the marketplace
origin. Marketplace validation responses must expose whether every generated
observation was `recorded`, only some were recorded, publishing failed, or the
server/Worker secret pair was not configured; a successful protocol check must
never imply that shared monitoring was updated.

Validation also distinguishes admission from evidence. A third-party seller
that returns a valid quote is a `quote_verified_candidate` and remains blocked
until manual marketplace admission. A seller already configured by the
marketplace reports `marketplace_configured` and `canHire: true`; validation
does not re-promote it, and Hire still requests a new quote before signatures.

The 2026-08-31 staging promotion applied the legacy observation bridge and
deployed Worker version `80c76b08-0467-4e14-ba41-08f3902164b0`. The acceptance
probe recorded both A2A protocol and ERC-8183 quote observations and returned
the pre-admitted seller as hireable. The Production promotion then followed the
required order: configure all three server-side observation variables, merge,
and repeat the HTTP and D1 persistence checks. The measured close-out is
recorded below; an unconfigured Production fallback was never accepted.

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
- Preview smoke testing found that Grid's verified WP3 observations remained only in the legacy table, so the v2 profile reported zero platform attempts and the `hireable` filter returned zero. Migration `0007_bridge_probe_observations.sql` now backfills and continuously mirrors those append-only facts into the normalized catalogue. `Hireable` remains stable for an admitted executable seller even after an informational quote expires; clicking it obtains and validates a new transaction quote. MCP-only agents remain non-hireable.

## 2026-08-31 — Promote the shared catalogue to the Production frontend

- `OBSERVATIONS_URL`, `BUYER_OBSERVATION_ALLOWED_ORIGIN` and `BUYER_OBSERVATION_SECRET` were confirmed by name in Vercel Preview and Production. One newly generated buyer-observation secret was delivered by stdin to both Vercel environments and Worker staging; its value is not part of this record.
- Preview deployment `bnb-agent-marketplace-9v45k0p5a-teterabobs-projects.vercel.app` passed the three catalogue views and a real validation before merge. Its validation at `2026-08-31T09:41:16.735Z` returned A2A verified, quote verified, `observationSync` recorded 2/2, `canHire=true` and Passport `hireable`; the filtered D1 count increased from 197 to 199.
- PR #43 merged to `main` as `750c90232232fcf100af04f7814f9fb04a247afd` at `2026-08-31T09:42:42Z`. Vercel Production deployment `dpl_H7HuJ64Zb5vU72SzzRCCFdNPUrea` reached Ready and received the public aliases.
- Production returned HTTP 200 for the declared, hireable and ERC-8183 catalogue views. Each rendered the normalized shared-index description with monitoring connected, proving that the previous hybrid fallback was no longer serving the marketplace view.
- The Production read between `2026-08-31T09:45:22.791Z` and `2026-08-31T09:45:25.995Z` measured 29,994 declared candidates, 14 ERC-8183 declarants and exactly one hireable agent, `303779`.
- Production validation at `2026-08-31T09:46:26.661Z` matched identity at BSC block `119129868`, verified A2A and a fresh ERC-8183 quote, recorded 2/2 observations, returned `marketplace_configured` with `canHire=true`, and produced a `hireable` Passport. The filtered D1 count increased from 199 to 201; rows `247` and `248` are the corresponding `erc8183/quote_verified` and `a2a/protocol_valid` facts.
- Rotating the Worker secret created active version `b492f10e-7285-4345-8586-d3eae3e7e421` at 100%. Its deployed bindings retain staging D1 `6fbeea3e-4516-4c4e-a5c4-392cb067198a`, the staging Queue, `KILL_SWITCH=0` and `PRODUCER_KILL_SWITCH=0`. The public feed reported producer and consumer enabled, a five-minute interval, and a completed HEADER attempt at `2026-08-31T09:45:26.322Z`; the checked-in Cron remains `*/5 * * * *`.
- This is a release/configuration close-out, not a new MVP feature. It promotes the already accepted shared-index path and does not activate the safe-off production Worker environment or expand the staging allowlist.

## 2026-08-31 — Reconcile bridged quote evidence across cards and Passports

- A `quote_verified` observation proves both that the marketplace reached the seller during that exchange and that the returned ERC-8183 quote passed validation. This remains true when migration `0007_bridge_probe_observations.sql` preserves the legacy transport value (`a2a`) instead of rewriting the protocol to `erc8183`.
- Presentation selects quote evidence by outcome, not by an assumed protocol value. A newer bridged quote must not hide an independently recorded `protocol_valid` observation or render either step as `not observed`.
- The indexed Evidence Passport consumes the same normalized catalogue candidate as the evidence rail. Its fingerprint therefore includes the current catalogue-derived verification and hireability input instead of displaying a static `not probed` Passport beside verified Worker evidence.
- `Hireable` continues to mean that the admitted seller has an executable quote-request path; the transactional flow still obtains and validates a new quote before any wallet action.
- Hireable cards expose both `View profile` and `Hire agent`. Endpoint inspection and read-only validation remain available without forcing the buyer into the signing flow.

## 2026-08-31 — Bring agent-to-agent hiring into hackathon scope

- Agent-to-agent hiring is adopted as a hackathon differentiator, not post-MVP work. Nothing in ERC-8183 requires a human buyer; the buyer is an address that signs. The scope guardrail in `AGENTS.md` is updated accordingly. The signed-quote gate, the token/budget/deadline checks and the on-chain job-state resolution apply to agent buyers unchanged.
- The marketplace becomes the visibility layer for that economy in three ordered steps: (1) a read-only discovery API exposing the existing catalogue and evidence view-models with their provenance, (2) the hire/quote flow documented as a spec for programmatic buyers, (3) surfacing jobs whose buyer is itself a registered ERC-8004 agent as delegation in the UI.
- The discovery API lives in this repository as Next.js route handlers reusing `src/business/composition` — not an isolated worker. Rationale: the use-cases and view-models already exist here, the deploy pipeline already exists, and the Cloudflare Worker remains a probing concern with distinct provenance. CLI and MCP server are thin wrappers over the same HTTP API; the semantics and tests live once, in the API.
- Single-confirmation hiring uses wallet-side batching, not a periphery contract. The five transaction intents (`createJob`, `registerJob`, `setBudget`, conditional `approve`, `fund`) are batched atomically via EIP-5792 `wallet_sendCalls` (EIP-7702 is live on BSC), with the current sequential flow as fallback for wallets without batching. A periphery `hireWithQuote()` contract is rejected: it would change `msg.sender` attribution on Commerce and require Router allowlisting of a contract this project does not control. Atomicity also removes the orphan-job state where `createJob` lands but `fund` fails.
- Both payment tokens support EIP-2612. Probed on 2026-08-31 via `eth_call`: mainnet token `0xcE24439F2D9C6a2289F741120FE202248B666666` (chain 56) returned `DOMAIN_SEPARATOR() = 0x358738403e5a61fdc30a8be78a60f289cbe4d2545b735a344b6229c70c1679b6` and a valid `nonces()` read; testnet token `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` (chain 97) returned `DOMAIN_SEPARATOR() = 0xbfdacda9e354449fe1236dbd82c99a502d8fb126472b59cdd770a76099bede17` and a valid `nonces()` read. Permit replaces the `approve` transaction with an off-chain signature on the non-batching fallback path; on the batched path it is unnecessary.
- Altana (`@altananetwork/sdk`, optional peer of `@bnbagent/sdk`, currently not installed) is the buyer-side containment choice when an agent buyer is implemented: EIP-7702 session keys with call whitelist, spend caps and expiry, plus ERC-1271 quote signing through `sessionQuoteSigner()` without granting the agent a generic signing capability. For the hackathon it is set aside: the demo agent buyer runs on a plain local key with the existing spend-ceiling policy on Testnet, and Altana is reconsidered only if a post-hackathon Mainnet agent buyer needs delegated custody.
- Per change discipline, the named trade: the next catalogue-expansion iteration (broadening hireable coverage beyond the admitted seller) is delayed behind the discovery endpoint. No existing MVP item is removed.

## 2026-08-31 — P1: publish the existing routes as the machine-readable API

- The agent-to-agent plan's P1 audit found the public surface already implemented under `app/api/marketplace/` as thin handlers over `src/business/composition`. `docs/API.md` now documents it for machine consumers: both error vocabularies, the three provenance encodings, the cache-header inventory, per-route contracts and the explicit non-claims (MCP ≠ hireable, passport is not reputation, job state resolves from chain).
- One gap was closed: `GET /api/marketplace/agents` now parses the `availability` query parameter (`all | hireable | mcp_only`) that `ListMarketplaceAgents` already supported, rejecting unknown values with 400. `MARKETPLACE_AVAILABILITIES` is exported from the use-case as the single source of the accepted values.
- Deliberately unchanged, documented as-is: the two error vocabularies stay split (unifying would break the UI and pinned tests), the three provenance encodings stay distinct, and no cache headers were added to routes that send none. The browser-observation ingestion route, the fixture routes and the seller A2A endpoints are documented as outside the public contract.

## 2026-08-31 — Reconcile the observation-infrastructure migration with the public API contract

Cross-session reconciliation between the observation/D1 migration (per `docs/OBSERVATION_INFRASTRUCTURE_SPEC.md`) and the machine-readable surface merged in `913cf54`. Recorded by the integrating role that spec §20 assigns.

- **The Worker catalog API is internal upstream, not public contract.** `GET /catalog-agents` and `GET /catalog-agent` (and any `/catalog-*` route, including apiVersion 2 additions) are a data plane consumed server-side through `src/business/composition` and `src/data/observation/catalog-candidate-feed.ts`. The public machine-readable surface is `/api/marketplace/*` as documented in `docs/API.md`; CLI and MCP wrap those routes, never the Worker. The browser never reads the Worker directly. This formalizes what the audited implementation already does.
- **Admission is the authority; `marketplaceConfigured` is a synchronized transitional mirror.** `catalog_agent_admission.state = "admitted"` is the new commerce authority in the Worker. Until the joint migration lands, the Worker must keep the legacy `marketplaceConfigured` integer synchronized with admission, because `GetAgentEvidencePassport` derives `canHire` from it and `catalog-candidate-feed.ts` requires it. Removing or desynchronizing the field before that migration would make an admitted agent hireable in the Worker filter and non-hireable in its Passport. The joint migration is one change, not parts: `CatalogCandidate` entity, the feed parser, `GetAgentEvidencePassport`, and a contract test proving equality between the Worker `hireable` filter, the card state and the Passport. `schemaVersion` stays `1` meanwhile; the parser tolerates additive fields, so `apiVersion`, `admission` and `state` are safe additions.
- **Scheduler evidence-validity windows are not display claims.** The Worker probe policy windows (ERC-8183 HTTP 6h, A2A 12h, MCP 24h, priority ≥ 100 at 15 min) govern recheck scheduling and evidence validity for the ledger. They do not alter the presentation rules: "reachable now" remains the 15-minute window in `components/marketplace/view-models.ts` and transactional Mainnet exposure remains the 60-second rule in `get-mainnet-hiring-exposure.ts`. A scheduling window never promotes stale evidence into a current visual or transactional claim.
- The bridged-quote invariants recorded on 2026-08-31 ("Reconcile bridged quote evidence") are confirmed preserved by the migration: quote evidence selected by outcome, bridged `a2a` transport retained, quote observations separated from operational observations so a newer quote never hides `protocol_valid`.
- Two dimensions, two filters, kept distinct on purpose: the catalog `status` parameter answers "which protocol/state" (`declared … erc8183 … hireable | failed`, Worker-fed), while `availability` on `GET /api/marketplace/agents` answers "can I hire now" (`all | hireable | mcp_only`). Transport values never enter `availability`; MCP/A2A availability is not a degree of hireability.

## 2026-08-31 — P2 + P3: hire spec and the marketplace MCP server

- `docs/HIRE-SPEC.md` documents the programmatic ERC-8183 hire flow — quote validation rules, buyer preconditions, the five exact contract calls with resume semantics, notify and chain-resolved tracking — distilled from the existing policy, prepare use-case and browser wallet adapter. No new protocol surface.
- The MCP server ships as stdio in this repository (`src/marketplace-mcp.ts` + `marketplace-mcp-bin.ts`, `npm run mcp`, registered in `.mcp.json`). Per the scope guardrail and the same-day reconciliation entry, its five tools (`search_agents`, `get_passport`, `compare_agents`, `request_quote`, `get_job_status`) wrap only the documented `/api/marketplace/*` routes — never D1 or the Worker. Tool descriptions carry the non-claims (MCP availability ≠ hireability; quote envelopes are immutable; job state from chain).
- `@modelcontextprotocol/sdk` 1.30.0 is declared as a direct dependency (it was already installed transitively). The server uses the SDK's schema-free low-level `Server` API with plain JSON Schema tool definitions, avoiding an undeclared zod dependency. The CLI's origin policy (`normalizedOrigin`, `MARKETPLACE_ORIGIN`, HTTPS-only) is exported and shared instead of duplicated.

## 2026-08-31 — Remote MCP endpoint: the tools become reachable by URL

- The five MCP tools are now also served over Streamable HTTP at `POST /api/mcp`, so any MCP client can connect to the deployed marketplace by URL without cloning the repo — the missing piece for agent-to-agent discovery at large. Implementation: `handleMarketplaceMcpRequest` in `src/marketplace-mcp.ts` wires the existing transport-free tools into the SDK's `WebStandardStreamableHTTPServerTransport` (already inside the declared 1.30.0 — zero new dependencies), and `app/api/mcp/route.ts` is a three-line-per-verb handler.
- Stateless by design (`sessionIdGenerator: undefined`, JSON responses): each JSON-RPC POST is self-contained, which is what a serverless deployment can honestly guarantee; `GET`/`DELETE` answer 405. No sessions, no SSE push, no resumability claims.
- The endpoint's upstream origin comes from `MARKETPLACE_ORIGIN`/the pinned production default — never from the request's `Host` header — so callers cannot redirect the server's own fetches (no SSRF via Host).
- Scope unchanged in substance: this is a second transport over the same thin wrapper, not a parallel implementation, and it widens discovery/quoting only. Hiring remains gated by the signed-quote allowlist; the stdio server and `.mcp.json` stay for local development.

## 2026-09-01 — P4: the agent buyer demo (Testnet)

- `src/demo/agent-buyer-cli.ts` (`npm run agent-buyer`) is the autonomous ERC-8183 buyer: it discovers and quotes through the public MCP endpoint (`/api/mcp` — the same surface any third-party agent uses), enforces the demo spend ceiling before anything else, prepares over HTTP, verifies the plan with `validateHirePlan` — the identical pinned-allowlist module the browser UI runs — then signs the five intents with viem from a plain local key, notifies the seller and reads the job back from chain. Testnet only, by assertion.
- Custody stays as decided on 2026-08-31: `AGENT_BUYER_PRIVATE_KEY` from the environment, never sent anywhere, bounded by the allowlist `maximumBudgetRaw` (1 raw unit). Altana remains set aside.
- `--dry-run` executes everything up to the signature boundary; verified against production on 2026-09-01: MCP discovery (agent 303779), passport read, live signed quote, prepare, plan validation — nothing signed.
- Done-when (the onchain job with an agent wallet as buyer) is pending a funded Testnet key; the run itself is one command.

## 2026-09-01 — WP6: verified hire events, on both BSC networks

- The hire journey now leaves a chain-verified trace in the shared index. The browser demo reports `clicked` when a quote is requested and each buyer-confirmed phase (`created`, `funded`, and `submitted` when the seller's notify answer carries its transaction hash) to the same-origin route `POST /api/marketplace/hire-events` via `navigator.sendBeacon`. That route (`app/api/marketplace/hire-events/route.ts`) validates a closed contract, drops every request context and forwards only `{ agentId, chainId, phase, jobId, txHash }` to the Worker with the dedicated `BUYER_OBSERVATION_SECRET`, through the same exact-origin allowlist the quote evidence uses (`privateWorkerUrl` in `catalog-observation-sync.ts`, now shared instead of copied a fourth time).
- The Worker route `POST /hire-events` (`bnb-agent-probe/src/routes/hire-events.ts`) is the only writer of `hire_events`. Telemetry phases get a server-side UUID key and the server's receipt time. Chain phases are keyed `chainId:txHash:phase`, so a retry answers 200 `duplicate` without a second row, and are stored only after RPC verification: successful receipt addressed to the Commerce contract of that chain, a Commerce event of the phase for that `jobId`, `getJob` state compatible with having passed the phase (not required to equal it), and the job's provider matching the ERC-8004 registry wallet (or owner) of the reported `agentId`. `occurredAt` is the block timestamp; nothing from the browser is trusted as time.
- `hire_events.chainId` now admits 97 as well as 56 (migration `0018_hire_events_testnet.sql`, rebuilding the append-only table because SQLite cannot alter a CHECK). Reason: every executable hire today — the browser demo and the P4 agent buyer — runs on Testnet; keeping the Mainnet-only check would have made WP6 unobservable. Testnet verification uses the Testnet Commerce/Registry addresses pinned in `lib/chain.ts` and a separate `BSC_TESTNET_RPC_URL` secret; without it Testnet chain phases answer 503 and are not stored. Registry reads were confirmed against Testnet on 2026-09-01 (`getAgentWallet(1866)` equals the demo seller and Job 551's provider).
- Non-goals kept: no read surface yet (section 15 still blocks public track-record claims until the canonical job list is reconciled), no distributed rate limiter on the same-origin route (telemetry rows are the only unverified writes and remain bounded by the Worker's D1 budget), and the agent-buyer CLI does not report — its job becomes visible through P5, which reads the chain.

## 2026-09-02 — D1 read profile: the catalogue list was spending the whole Free quota

- Evidence: `wrangler d1 info` on staging reported 60,038,783 rows read in 24 hours against the 5,000,000 account-wide Free limit (error 7500 from 18:45 UTC onwards, `/health` 503, `/catalog-agents` 1101). A local Miniflare harness (`bnb-agent-probe/test/integration/d1-read-profile.test.ts`, 4,000 agents / 64,000 observations) reproduced it without touching the remote database, measuring `rows_read` per statement and `EXPLAIN QUERY PLAN` per route.
- Root causes, both in `GET /catalog-agents`: (1) the correlated `EXISTS` filters over `catalog_observations` (`a2a`, `mcp`, `live`, latest failure, verified quote) had no index starting with `agentKey` that also carried `outcome`/`verificationLevel`/`protocol`, so SQLite drove them from `idx_catalog_observations_outcome` and scanned every `protocol_valid` row once per agent — 51,243,200 rows for one `status=a2a` count; (2) the per-page attempt count joined `catalog_endpoints` first and read every eligible endpoint's observations for each page — 80,767 rows per default list.
- Fixes: migration `0019_catalog_observations_agent_evidence.sql` adds `(agentKey, outcome, verificationLevel, protocol, observedAt DESC, id DESC)`; the attempt count is now grouped per `(agentKey, endpointKey)` off the agent index and joined to the page's current operational declarations in memory. Measured at the same scale: default list 97,270 → 17,319 rows, `hireable` 103,486 → 23,535, `a2a` 51,434,214 → 53,439, detail unchanged at 284. The harness stays as a regression guard with per-route ceilings.
- What remains is structural: the list `count(*)` costs about three index rows per current agent, and every `force-dynamic` page view hits the Worker live. So public catalogue reads can now be served from the Workers Cache for `CATALOG_RESPONSE_CACHE_SECONDS` (default 0, staging 300); the response advertises the same window in `Cache-Control`, and the payload's own timestamps keep freshness visible. The marketplace-side `no-store` fetch and in-memory memo are unchanged.
- Historical consequence for WP2: its 24-hour Free gate (`<4,000,000` rows read)
  was unachievable under the old profile. That proposed window was not executed;
  the Paid release decision below supersedes it as a current release blocker.

## 2026-09-02 — Promote the bounded catalogue scheduler to Paid staging

- Staging now runs `* * * * *` with the Paid profile, a four-target catalogue
  batch, concurrency two, 15 external subrequests, at most 40 D1 statements,
  3,000 rows read and a 200-row phase/pre-ledger write envelope. Paid HEADER
  reads 15 newest identities per minute, versus the former two, to cover more
  than three times the observed approximately 4.5 registrations/minute.
  Production and validation retain their existing safe-off Free configurations.
- The initial 60-row write ceiling failed closed on the first four-target PROBE
  tick after 68 observed writes. With the 100-row ceiling, nine consecutive
  first deliveries completed `PROBE → HEADER → SWEEP` three times. Their maxima
  were 31 queries, 670 reads, 87 writes, six upstream requests and 3,066 ms.
- The generic A2A validator now accepts at most one same-origin, public-HTTPS
  redirect and still rejects cross-origin redirects. This was required because
  Cloudflare observed a redirect for the Vercel-hosted Agent Card while ordinary
  clients received the final `200`; following arbitrary redirects would weaken
  the existing SSRF boundary.
- Buyer-triggered validation binds Cloudflare's global `fetch` explicitly, and
  the seller/RPC clients invoke injected fetch functions without an object
  receiver. Regression tests reproduce the former `Illegal invocation` failure.
- BNB Chain documents several public Mainnet RPCs with a 10,000 requests per
  five-minute limit. `bsc-dataseed-public.bnbchain.org` answered locally but
  returned HTTP failure from the Worker; staging therefore uses the also-listed
  `https://bsc-dataseed.nariox.org`, which passed the same Worker chain reads.
  Source: [BNB Chain JSON-RPC endpoints](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/).
- Initial Paid traffic version `10d10603-89fa-4713-bf02-c89099649eac` served staging.
  Vercel preview `dpl_9DhjZ9bAqAWTzcfeX6SD5aAGBUzN` returned a Mainnet quote
  with `observationSync.status=synced`. D1 then contained, for agent `303779`,
  current `protocol_valid` evidence, a cryptographic `quote_verified` artifact,
  an onchain `erc8183_detected` artifact and admission state `admitted`.
  `GET /catalog-agents?status=hireable&limit=24` returned exactly that agent with
  `canPrepareHire=true`.
- The final reviewed candidate `355f7b66-7b41-4021-9b49-ab17f83107ce` closes the
  review findings. HEADER reads a second descending page when the first does not
  reach the previous watermark, prioritizes that catch-up over rolling SWEEP,
  advances its high-water mark only after the catch-up batch commits, and emits
  `headerSaturated=true` if 30 identities still do not close the gap. Its config
  validator also reserves both HEADER reads in the external-subrequest budget.
  The profile UI posts the exact normalized endpoint key, polls an encrypted
  authenticated token with bounded backoff, preserves a non-terminal running
  or interrupted-status state, and refreshes only after `hasResult=true`. Its
  first complete staging rotation stayed at 33 queries, 693 reads, 132
  pre-ledger writes, six upstream requests and 5,385 ms. Preview
  `dpl_DJWxu1Xc2KeWizSnskAsw5kcHwja` submitted validation `7` for Agent `303779`;
  D1 completed it once with observation `642`
  and HTTP 200.
- Paying for Workers deliberately supersedes the old 24-hour Free-quota window
  as a release blocker. Historical WP2 artifacts remain immutable, but each new
  candidate is gated by local budgets, a remote phase rotation and an exact
  endpoint-scoped E2E artifact (`evidence/catalog-paid-staging-2026-09-02.json`).
- Cloudflare intentionally has one live observation data plane: the Paid staging
  Worker and its D1. The production marketplace reaches it only through the
  server-side `OBSERVATIONS_URL` adapter. A remote parity check returned `29,844`
  declared agents from both surfaces and the same Agent `303779` observation
  (`642`, observed at `2026-09-02T12:54:01.683Z`). Creating a duplicate production
  D1 would add synchronization work without adding product value.
- Quote synchronization remains intentionally limited to the marketplace Grid
  seller (`303779`, `a2a`, `grid_trading`) in this release. General quote
  verification requires the hiring contract to transport the selected
  `endpointKey`; protocol validation is already general and must not imply that
  every reachable agent has a verified ERC-8183 quote.

## 2026-09-02 — One catalogue authority, visible facets, and pre-expiry renewal

- The landing page now builds featured-agent evidence from the same normalized
  `/catalog-agents` v2 response as `/agents`; the old `/observations` projection
  is no longer a second UI authority. A verified but expired quote remains
  attributed as historical evidence and is not painted green.
- Successful endpoint evidence is scheduled for renewal four minutes before its
  expiry. `PROBE` receives one turn every three one-minute scheduler phases, so
  this preserves at least one extra tick of headroom instead of allowing a
  healthy priority endpoint to appear stale between phase rotations.
- Filter totals come from a fixed, five-minute-cached `facets=true` read and are
  independent of the active filters. D1 production rejected the correlated
  quote-facet plan even though Miniflare accepted it; the exact count now
  reconciles current admitted endpoints with their indexed latest quote rows in
  memory. This uses two bounded D1 reads and preserves newer-rejection semantics.

## 2026-09-03 — Begin the canonical profile-and-hire route migration

- This decision supersedes the 2026-08-31 presentation choice that exposed both
  `View profile` and `Hire agent`. The later frontend journey specification makes
  `/hire/[agentId]` the single agent destination; `/agents/[agentId]` becomes a
  temporary compatibility redirect once the unified page is complete.
- Buyer actions and blockers come from the normalized catalogue v2 state. The
  hire page must fail closed when that state is absent and must not reconstruct
  commerce readiness from legacy operator, service or observation fields.
- The existing ERC-8183 browser flow now supports an embedded presentation mode.
  Its quote verification, allowlist, wallet preparation, signatures, transaction
  ordering and job tracking remain unchanged; only composition is being prepared.
- Agent-scoped prior-job history is progressive enhancement until the backend
  exposes that query. It does not block the canonical-route migration.
- The migration ships as one reviewed Vercel candidate with deployment rollback,
  rather than keeping two UI implementations behind a long-lived feature flag.

## 2026-09-03 — Complete route unification and honor declared ERC-8183 resources

- Cards and table rows now expose one contextual action and one canonical agent
  destination: `/hire/[agentId]`. The compatibility `/agents/[agentId]` route
  redirects there, while the hire page composes identity, evidence, monitoring,
  endpoint validation and the existing allowlisted Mainnet transaction flow.
- `Reachable` remains operational evidence, never implicit hireability. A buyer
  may trigger an immediate browser check or an endpoint-key-bound marketplace
  validation; only the latter can update shared platform evidence, and neither
  unsigned check creates a verified quote.
- ERC-8183 HTTP validation reads the exact normalized URL declared by the agent.
  It accepts the legacy `{status: "ok"}` response or a structured same-origin
  support declaration with version, job types and jobs endpoint. The previous
  Worker-only `/health` suffix could produce a false 404 for declarations such
  as `/erc8183/status` and is removed from both browser and Worker behavior.
- Generic signed-quote synchronization remains limited to transports with an
  implemented quote contract. A protocol-valid third-party status endpoint is
  presented as available for further validation, not as transaction-ready.

## 2026-09-03 — Closing SPEC-MVP §11.3 for the v2-only Paid promotion

- The 2026-09-02 promotion moved staging to the Paid profile on the catalogue v2 path. §11.3 was written for the legacy WP2 `header → sweep → probe` pipeline; that pipeline stays behind `WP2_PAID_PIPELINE_NOT_VALIDATED` and is never selected while `CATALOG_V2_WRITES_ENABLED=1`. No `pipeline` scheduler is built: the v2 path runs one phase per tick on every plan, and `loadConfig` now derives `schedulerMode=single_phase` whenever v2 writes are enabled, so `/health` stops advertising a multi-phase mode the Worker does not run.
- Items still missing from the checklist are filled in without new infrastructure: `npm run d1:export:staging` (item 2, `wrangler d1 export` into `evidence/raw/`) and a README runbook that fixes the promotion order (safe-off commit → verify → enable in a second commit → two observed rotations) and the rollback order (kill switches → Cron → plan → verify). Everything else in §11.3 (Paid defaults, two full rotations, one-minute Cron with the kill switch, observed rounds) is already evidenced in `evidence/catalog-paid-staging-2026-09-02.json`.
- The SPEC status line follows the 2026-09-02 decision that Paid billing supersedes the 24-hour Free-quota window as a release blocker; the WP2 evidence tooling keeps asserting the Free profile for its immutable historical artifacts and is not parameterised.

## 2026-09-03 — D1 read profile of the cron tick: two backlog-proportional scans bounded

- The local harness (`bnb-agent-probe/test/integration/d1-read-profile.test.ts`) now also drives one catalogue v2 tick per phase with the staging Paid pins (discovery 15, probe 4×2, ingest 1×1) at 2,000 agents, 4,000 due endpoints and 200 pending ingest tasks. Measured before the fix: header 418, sweep 417, probe 12,476 rows read. Two statements were proportional to the backlog rather than to the batch, so the phase would have failed closed against `D1_ROWS_READ_PER_RUN=3000` exactly when work had accumulated (after an outage, a bulk re-schedule, or a sustained discovery rate above the one-task-per-tick ingest).
- Probe target selection (`catalog-probe-d1.ts` `selectTargets`) read and sorted every due endpoint (12,000 rows) because only `nextProbeAt`, the first ordering key, is served by `idx_catalog_endpoints_lease`. It now ranks the full order (protocol, priority, lastProbedAt) inside a window of the oldest-due endpoints (`max(25 × batch, 100)`, taken in index order), and the outer query repeats only the lease check so its sole usable index is the primary key. Ordering is exact unless more than the window size share the boundary due timestamp, in which case the tie resolves in index order; the lease `UPDATE … RETURNING` remains the atomic claim.
- The ingest claim (`catalog-ingest.ts` `processNextCatalogIngestTask`) ordered every claimable task (401 rows for 200 pending) because `idx_catalog_ingest_tasks_work` leads with `retryAt`. Migration `0020_catalog_ingest_tasks_claim_index.sql` replaces it with `(status, priority DESC, updatedAt, agentKey)`, and the claim is one compound statement with a per-status branch that walks that index in claim order and stops at its first claimable row (`INDEXED BY`, so the plan does not depend on statistics); the compound `ORDER BY` ranks at most three rows. The old index is dropped rather than kept alongside: the claim was its only reader, and a second secondary index would add one written row per task write, which the Free sweep test caught (62 against the 60-row envelope).
- After the fix: header 17, sweep 20, probe 582 rows at the same scale; the harness pins ceilings of 200 / 200 / 1,000 and asserts every phase under the staging pin of 3,000. The catalogue list `count(*)` is left as-is: on Paid there is no daily read quota and the 300-second response cache bounds it.

## 2026-09-03 — Make the canonical agent route a hiring workspace

- `/hire/[agentId]` is a commerce surface, not a second ERC-8004 profile. It
  keeps only the agent's compact identity, availability, quote readiness,
  ERC-8183 work history and the next executable hiring step. Detailed identity,
  metadata, services, tools, trust score and reputation are delegated to the
  existing trust8004 agent page through one secondary external link.
- The catalogue uses `Hire agent` for every candidate with a real next step.
  The canonical page then resolves that action to quote/transaction preparation
  or to the required endpoint validation. Unsupported candidates retain the
  neutral `View agent` action and the hire control is disabled on arrival.
- Agent-scoped Mainnet proofs are returned with the existing passport read and
  rendered as a compact ERC-8183 job history. No new database or competing job
  authority is introduced; each row links to the existing chain-backed job page.

## 2026-09-03 — Verified hire events get a read surface: activity, not track record

- Partially lifts the 2026-09-01 non-goal "no read surface yet". The Worker now serves `GET /hire-events?chainId=56|97&agentId=…`: only `chain_verified` rows of one agent on one chain (newest first, at most 50, `idx_hire_agent`), 30-second cache, strict query allowlist. Telemetry rows (`marketplace_observed`) are never exposed. Like `/catalog-agents`, the route is an internal upstream of the marketplace API, read server-side through `OBSERVATIONS_URL` by `src/data/observation/hire-event-feed.ts`, a strict allowlist parser that fails closed to `null`.
- Section 15 of the spec still blocks public track-record claims until the canonical job list is reconciled, so the Passport reports the feed as `checks.hireActivity` ("verified hire activity": the latest verified phase with job id and transaction hash) and nothing else changes: `state`, `trackRecord` and `checks.job` stay driven by hash-verified proofs. A verified phase proves that the phase happened for a job whose provider is the agent's registry wallet; it says nothing about the deliverable. The events do enter `evidenceSnapshotHash`, because they are evidence and the fingerprint must change when they do.
- Chain scoping is explicit: the catalogue and the Passport are Mainnet, so the Passport reads chain 56 by the agent id; the demo and the agent buyer run on Testnet, where the same numeric id names a different registry entry, so `/jobs/testnet/[jobId]` reads chain 97 for the allowlisted seller agent (1866) and shows the phases of that job as "Chain-verified hire phases" with their transaction links. Both pages render exactly as before when the feed is absent, empty or failing.

## 2026-09-03 — The agent buyer reports its own hire phases

- Reverses the 2026-09-01 non-goal "the agent-buyer CLI does not report". Now that the Testnet job page shows chain-verified phases, an agent-initiated hire that never reported would be the one hire invisible there. Live runs of `npm run agent-buyer` post `clicked` (after the signature boundary, so dry runs stay silent), `created`, `funded` and, when the seller's notify answer carries its transaction hash, `submitted` to the same same-origin route and five-key contract the browser demo uses.
- The report is best effort by construction: one helper wraps the existing HTTP client in a try/catch, logs one line per phase and never throws, so a 409 from a claim the chain does not support, a 5xx or an offline marketplace cannot interrupt or fail the hire. The Worker still verifies every chain phase by RPC before storing it, so the CLI's claims carry no weight of their own. The CLI keeps importing nothing from `src/data/observation`; the source audit in `tests/agent-buyer.test.ts` enforces that and that every reportable phase sits after the dry-run return.

## 2026-09-03 — P5: delegation is a fact about the buyer address, verified only against the registry

- There is no address → agent id index on chain or in the catalogue, so "hired by an agent" cannot be derived for arbitrary buyers without inventing linkage. The marketplace therefore declares one identity, `DEMO_AGENT_BUYER` in `src/business/entities/demo-agent-buyer.ts` (the wallet the P4 agent buyer signs with, previously duplicated as a literal in the CLI, two tests and the MCP docs sample), with an optional Testnet ERC-8004 `agentId` that stays `null` until the wallet is registered.
- `/jobs/testnet/[jobId]` resolves `buyerIdentity` from the live job or the snapshot: the demo wallet is labelled "Hired by an agent"; when an agent id is declared and the repository can read chain, the page verifies `getAgentWallet(agentId)` (or `ownerOf`) against the buyer through a new optional `readAgentWallet` on the Testnet repository and links the registry entry only then. A read error, a missing chain reader or an undeclared id degrade to "labelled, not verified"; any other buyer is `unknown` and renders exactly as before. Chain-resolved facts only: no derived reputation, no invented linkage.
- The frozen Job 551 proof manifest keeps its literal buyer address on purpose (a versioned evidence record must stay self-contained), and the Worker's integration test keeps its own copy because the packages do not share source.
