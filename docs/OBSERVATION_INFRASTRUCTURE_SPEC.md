# Observation Infrastructure and D1 Normalization — Specification

**Status:** Paid staging and frontend integration verified — production promotion and legacy retirement pending
**Date:** 2026-09-02
**Audit commit:** `7c133ef27906284f654064b24a42c43bf8859a40` (PR #62 merged)
**Paid candidate evidence:** `evidence/catalog-paid-staging-2026-09-02.json`
**Owner:** Infrastructure session  
**Companion specification:** `docs/FRONTEND_HIRE_JOURNEY_SPEC.md`

**Related authorities:** `docs/API.md` defines the public machine-readable surface
and `docs/HIRE-SPEC.md` defines the programmatic ERC-8183 hire flow. The Worker API
specified here is an internal upstream data plane and must not become a parallel
public API.

### Document relationship

This specification supersedes the WP2 Free-profile frozen-window gate for the
catalogue release path. Historical WP2 rehearsal/24-hour artifacts remain
immutable evidence of their exact bundles, but the Paid release gate is now a
bounded remote rotation, per-phase budget enforcement and endpoint-scoped E2E
proof. No historical artifact may be relabelled as evidence for a newer bundle.

### Current implementation evidence

Local and remote evidence captured through 2026-09-02:

`[x]` means verified against the current checkout and the cited local or remote
artifact. `[ ]` means not complete or not yet verifiable. A local pass never
stands in for a remote claim, and the bounded Paid artifact never stands in for
the historical 24-hour Free-profile artifact.

- [x] all additive migrations `0008` through `0017` apply successfully to the Wrangler local D1;
  migration `0014_catalog_agent_identity.sql` preserves the declared owner,
  metadata URI and registration block alongside the normalized catalog row, and
  `0015_agent_scoped_validation_dedupe.sql` scopes legacy validation keys by agent;
  `0016_scoped_quote_artifact_dedupe.sql` scopes signed-quote artifact uniqueness
  by declaring agent and exact endpoint; `0017_catalog_validation_caller_rate_limit.sql`
  adds an opaque caller scope and indexed target dimensions for distributed
  on-demand admission limits;
- [x] Worker typecheck and manifest validation pass;
- [x] 515 unit tests and 132 Miniflare integration tests pass in
  `bnb-agent-probe` (`vitest.config.ts` and `vitest.worker.config.ts`);
- [x] the versioned raw-SQL allowlist contains only the two normative runtime
  exceptions (`src/db/query-budget.ts` and `src/lib/scheduler-lease.ts`); its
  ORM/schema/query-budget gate passes 16 focused tests and reports no new or
  stale callsites;
- [x] production, staging and validation dry-run bundles build successfully;
- [x] the Wrangler local runtime smoke test returns `200` for `/health` and
  `/catalog-agents?limit=1`; the seeded local D1 currently contains 29,801
  identities where `indexState='current'` and `metadataState='ok'`, 681
  eligible operational endpoints, and one `catalog_agent_admission` candidate.
  `npm run migrate:local` reports no migrations pending. The identity count is
  explicitly based on `indexState`, not the metadata-state enum (whose valid
  value is `ok`, not `current`).
- [x] With `CATALOG_V2_READS_ENABLED=1`, the same local Worker returns the v2
  `/catalog-agents?limit=1` contract with HTTP `200`, `schemaVersion=2`, and
  `total=29,314` operational candidates; the sample `303779` row is exposed as
  `declared`/`pending` with `commerceStatus=admission_pending` until a current
  commerce declaration is admitted.
- [x] A clean Wrangler tick was then run against an isolated copy of that seeded
  D1 with v2 reads/writes, catalog probing and both kill switches temporarily
  enabled. The first successful `GET /__scheduled?cron=*/5+*+*+*+*` returned
  `200` and completed `HEADER` (2 identities, 21 rows written, 17 D1 queries);
  the following tick returned `200` and completed `SWEEP` (cursor advanced, 2
  identities/tasks, 24 rows written, 21 D1 queries). The initial stale-copy
  migration error was corrected by applying `0014` through `0017` to the
  isolated fixture; the copy was discarded after the smoke and shared local and
  remote state were not modified.
- [x] application-side endpoint policy, controller and observation-sync coverage passes
  41 focused tests (`browser-endpoint-validation.test.ts`,
  `marketplace-controllers.test.ts`, `catalog-observation-sync.test.ts`,
  `catalog-validation-sync.test.ts` and `catalog-validation-route.test.ts`);
- [x] the complete application gate passes: typecheck, 609 tests across 67 files and
  the production CLI/Web build. The frontend changes and endpoint-scoped fallback
  tests are integrated by PR #62 (merge commit `7c133ef...`);
  the BNB Agent SDK still emits its known dynamic dependency warning during
  bundling, but the bundle completes successfully.
- [x] the application catalog adapter preserves v2 `metadataVersion` and
  `metadataObservedAt` provenance and no longer presents `registeredAt` as a
  metadata freshness timestamp; focused feed/adapter regression tests cover
  both fields.
- [x] the application catalog feed parser revalidates normalized image URLs and
  drops credentials, query strings or other unsafe targets before exposing
  them to UI consumers; the focused feed suite covers unsafe and safe URLs.
- [x] browser validation target policy coverage includes reserved IPv4 and IPv6
  hosts, so loopback, link-local and private targets are rejected before fetch.
- [x] the catalog D1 seed generator now materializes normalized endpoint role,
  validation protocol, eligibility and due-probe scheduling, creates
  quote-verification admission candidates, and accepts legacy snapshots that
  omit optional identity fields; the generated 29,801-agent snapshot seed
  applies cleanly after migrations `0001` through `0017`.
- [x] seed reconciliation now suspends admissions that are absent from the complete
  registry snapshot or no longer have an eligible commerce endpoint, while
  leaving the append-only observation ledger untouched; non-transport
  declarations (`x402` and unknown/custom labels) are retained as external
  resources and are never scheduled for protocol probing.
- [x] `docs/API.md`, `docs/HIRE-SPEC.md`, `docs/MCP.md` and `docs/MARKETPLACE.md`
  are integrated from `main`; the frontend companion is now integrated by PR #62
  (merge commit `7c133ef...`).
- [x] The application exposes the endpoint-scoped infrastructure fallback through
  `POST /api/marketplace/validate` and its opaque-token status route; the private
  Worker `/catalog-validations` route remains server-only.
- [x] The agent profile binds each infrastructure action to the normalized
  `endpointKey`, polls only the opaque same-origin request token, and refreshes
  the shared profile after a terminal result. Targets without a catalog key keep
  browser-only validation and cannot fall back to the legacy whole-agent route.
- [x] Paid staging version `355f7b66-7b41-4021-9b49-ab17f83107ce` completed a
  first-delivery `PROBE → HEADER → SWEEP` rotation at one-minute cadence with
  maxima of 33 D1 queries, 693 rows read, 132 phase/pre-ledger rows written,
  six upstream requests and 5,385 ms wall time. Vercel preview deployment
  `dpl_DJWxu1Xc2KeWizSnskAsw5kcHwja` then queued validation `7` for Agent
  `303779`; it completed in one attempt with observation `642`, HTTP 200 and
  `protocol_valid`. Exact facts are stored in the paid candidate evidence file.
- [x] Local development E2E can point the mutation adapters at a Wrangler/Miniflare
  Worker over HTTP on `localhost` or `127.0.0.1`; non-loopback HTTP and every
  production/non-development destination remain rejected, and the private
  origin/secret checks are unchanged.
- [x] The fallback derives a caller fingerprint from application request context,
  HMACs it with `BUYER_OBSERVATION_SECRET`, and sends only the opaque key to the
  Worker; D1 enforces both the global daily budget and the configured per-caller
  daily budget without storing an IP or origin.
- [x] The Worker rejects missing or malformed caller fingerprints before any D1
  lookup or Queue admission; accepted values are fixed-size opaque hex keys.
- [x] Registry inventory reads retain current ERC-8004 identities even when their
  metadata has no endpoint declaration; the operational inventory remains
  endpoint-gated by default.
- [x] Declared image metadata is normalized only to public HTTPS/IPFS URLs without
  credentials, query strings or fragments; unsafe image targets are discarded
  before they reach catalog/API consumers.
- [x] catalog evidence reads enforce cryptographic/on-chain verification levels,
  isolate shared-endpoint observations by declaring agent, and release Queue/D1
  leases after a failed result batch; these paths are covered by the integration
  suites above.
- [x] catalog protocol probes enforce the configured `MAX_SELLER_RESPONSE_BYTES`
  limit while streaming seller responses, so Free/Paid response budgets are
  applied consistently to scheduled and on-demand A2A/MCP/ERC-8183 checks.
- [x] the application card adapter accepts only platform reachability/protocol
  evidence for the Reachable state and keeps on-chain/quote-only rows from
  masquerading as transport probes, with legacy compatibility coverage.
- [x] The v2 catalog serializers tolerate malformed legacy `detailsJson` by exposing
  an explicit `null` detail while preserving the surrounding evidence envelope;
  the Worker integration suite covers the detail route regression.

- [x] Remote rollout gate: staging migrations, shadow parity, bounded v2 writes/reads
  and operational metrics are proven by the Paid candidate artifact. Cloudflare has
  one live observation data plane (`bnb-agent-probe-staging`); the production
  marketplace consumes that Worker through its private `OBSERVATIONS_URL` adapter
  instead of duplicating D1. Legacy retirement remains a separate, non-blocking
  cleanup after the hackathon submission.

## 1. Purpose

Build the bounded infrastructure that discovers ERC-8004 identities through trust8004, normalizes their declared resources, validates only machine-operational endpoints, stores auditable evidence in D1, and exposes truthful states to the marketplace and hiring flow.

The system must make newly indexed agents visible quickly, process a potentially unbounded registry without attempting every endpoint every 15 minutes, and use Cloudflare Free safely until paid capacity is explicitly enabled.

## 2. Scope and ownership

### 2.1 This session owns

- trust8004 incremental ingestion and directed agent tracking.
- Metadata normalization and endpoint/resource classification.
- D1 schema migrations, backfill, projections and retention.
- Scheduler, Queue producer/consumer, priorities, leases and budgets.
- A2A, MCP and supported ERC-8183 HTTP observations.
- On-demand marketplace validation requested by the frontend.
- Independent verification and persistence of signed seller quote evidence.
- Catalog/read APIs and contract fixtures.
- Worker observability, local/staging tests and rollout controls.

### 2.2 This session does not own

- Catalog/hire UI implementation.
- Browser-direct network calls.
- Buyer wallet signatures or transaction submission.
- A proprietary reputation protocol.
- Direct access to trust8004 databases; use its public APIs only.
- Treating A2A/MCP availability as ERC-8183 hireability.

### 2.3 Parallel-session boundaries

The infrastructure session owns `bnb-agent-probe/**`, D1 migrations and the
versioned internal Worker contract. The application server consumes that contract
through `src/business/composition.ts` and the observation adapters, then exposes the
public `/api/marketplace/*` contract documented in `docs/API.md`. The browser, CLI,
MCP server and programmatic buyers never call the Worker directly. The ERC-8183
hiring session owns buyer quote orchestration, transaction preparation/submission
and job lifecycle under `docs/HIRE-SPEC.md`. Shared application DTO files are changed
only after coordination or during final integration.

## 3. Required truth and provenance model

Persist and expose these classes separately:

| Class | Examples | Authority |
| --- | --- | --- |
| Self-declared metadata | name, image, services, endpoints | ERC-8004 metadata through trust8004 |
| Browser observation | direct A2A/MCP response or CORS failure | This user/browser only |
| Platform observation | Worker protocol checks | Marketplace infrastructure |
| Cryptographic evidence | seller-signed quote | Signature verification for exact agent/terms |
| Onchain fact | owner, policy, token, job state | BSC contract read/receipt |
| Derived state | reachability, commerce admission, allowed actions | Versioned marketplace policy over the above facts |

Every evidence row preserves source, observed time, scope and supporting identifiers. Derived fields must be reproducible from persisted facts plus a policy version.

## 4. Protocol semantics

### 4.1 Discovery is not validation

ERC-8004/trust8004 provides identity and declared metadata. It can yield:

- chain and agent ID;
- owner/wallet and agent URI;
- name, description, image and categories;
- A2A, MCP, ERC-8183 HTTP, x402 and other declared services;
- websites and external links.

Do not claim an agent was created by BNB Agent Studio unless metadata or a published BNB source proves it.

### 4.2 Operational transports

- **A2A:** GET the declared Agent Card and validate its shape, URL and capabilities.
- **MCP:** POST `initialize`, then `notifications/initialized`, then `tools/list`.
- **ERC-8183 HTTP:** supported SDK/Studio convention, not a requirement of ERC-8183 itself. Health may establish transport availability; status/admission and negotiation are separate checks.
- **x402:** preserve as a declared commerce capability, but it is outside the current ERC-8183 hiring rail unless separately admitted.

### 4.3 External resources

Website, Twitter/X, Telegram, GitHub repository and documentation URLs are display/provenance resources. They are never scheduled, never shown as machine validation targets and never contribute to reachability or hireability.

If metadata labels an obvious social or human-facing URL as A2A/MCP/ERC-8183:

- preserve the raw declaration;
- classify it `invalid_declaration` or `non_machine_endpoint`;
- do not fetch it as a machine protocol;
- expose the reason.

### 4.4 Quote and chain behavior

- Quote negotiation is offchain and on demand.
- Seller signs the quote using EIP-191 or ERC-1271-compatible verification.
- Buyer does not sign or pay merely to request a quote.
- Verify the exact signed envelope, signer/agent relation, terms, expiry, chain and admitted commerce configuration.
- EIP-191 verification is local; ERC-1271 may require read-only `eth_call`.
- Context reads such as chain ID, block, owner, payment token, policy whitelist and decimals are read-only.
- Buyer approve/create/register/fund transactions belong to the hiring session, not this scheduler.

## 5. Current baseline and problems to remove

The current system already has a Cloudflare Worker, Queue and D1. Its scheduled phases rotate `HEADER → SWEEP → PROBE`; the Queue carries phase ticks while D1 acts as the worklist.

Known problems that this specification resolves:

1. A 15-minute display TTL expires long before normal A2A/MCP rechecks, making successful agents appear unobserved.
2. Unknown or missing service types can become `web`, allowing website/social URLs into browser or Worker validation.
3. The generic prober still supports `web`.
4. `marketplaceConfigured` is too weak to represent commerce admission.
5. Historical “any failure” can outweigh a later success unless the latest effective attempt is selected.
6. Browser observations and platform evidence need stronger contract separation.
7. A legacy agent-specific quote path must be replaced by general admission and on-demand quote verification.
8. Legacy probe tables and catalog observations overlap and are joined by transitional logic.

Existing evidence artifacts must never be deleted as cleanup.

## 6. Target architecture

```text
trust8004 API ──► ingest lane ──► D1 agents + declarations
                                      │
                                      ▼
                              priority work selector
                                      │
Cloudflare Cron ──► phase tick ──► Queue ──► bounded consumer
                                               │
                          A2A / MCP / ERC-8183 HTTP
                                               │
                                               ▼
                                      D1 observations
                                               │
Browser direct check ──► browser report ───────┤
Signed quote envelope ─► independent verify ───┤
Chain reads ───────────► onchain facts ─────────┘
                                               │
                                               ▼
                                      versioned catalog API
```

The Queue is transport, not the full worklist. D1 stores pending/due work and leases so retry or duplicate delivery remains idempotent.

## 7. D1 normalized model

Use additive migrations first. The implementation currently applies `0008` through
`0017`; `0014_catalog_agent_identity.sql` adds the declared identity provenance
columns without rewriting existing rows,
`0015_agent_scoped_validation_dedupe.sql` migrates legacy on-demand keys,
`0016_scoped_quote_artifact_dedupe.sql` scopes signed-quote artifact uniqueness,
and `0017_catalog_validation_caller_rate_limit.sql` adds the opaque caller scope
and indexed target dimensions for on-demand admission limits. None of these
migrations rewrites or deletes the append-only observation ledger.

### 7.1 `catalog_agents`

Retain identity and discovery columns. Required additions/normalization:

- `owner`, `metadataUri` and `blockNumber` copied from the trust8004 catalog;
- `metadataVersion` or metadata hash.
- `metadataObservedAt`.
- `policyVersion` used for the derived projection.
- Preserve `registeredAt`, block, first/last seen and removed/current state.
- `imageUrl` remains declared data and must be fetched/rendered with safety controls, not treated as verified identity.

Do not store `hireable` as an unexplained boolean.

### 7.2 `catalog_endpoints`

This table stores normalized declared resources, including external links, while only operational rows are eligible for work.

Required columns:

```text
endpointKey          stable hash/key
endpoint             canonical URI
declaredProtocol     a2a | mcp | erc8183_http | x402 | web | unknown
role                 operational | external
validationProtocol   a2a | mcp | erc8183_http | NULL
externalKind         website | social | repository | documentation | other | NULL
eligibility          eligible | unsafe | invalid_declaration | unsupported
safetyReason         nullable reason
originKey            normalized origin for batching only
representativeAgentKey nullable
lastAttemptAt        cached projection
lastAttemptOutcome   cached projection
lastSuccessfulAt     cached projection
nextProbeAt          nullable; NULL for external/ineligible
consecutiveFailures  cached projection
```

Constraints:

- `operational` requires non-null `validationProtocol`.
- `external` requires null `validationProtocol` and `nextProbeAt`.
- `eligible` is required before enqueue.
- A null `representativeAgentKey` means that the declaration has no current
  shared-projection owner. Buyer refresh may append agent-scoped evidence for
  that declaration, but it must not update the endpoint's cached `last*` or
  scheduling columns.
- One origin representative can prove first-pass origin availability only. It cannot prove every path or every agent declaration.

### 7.3 `catalog_agent_endpoints`

Retain the many-to-many declaration relation and history:

- agent key + endpoint key;
- current/removed declaration state;
- first/last seen;
- priority;
- raw service label or metadata pointer needed for provenance.

Metadata changes retire the old relation and create/update the new one. Never silently overwrite history.

### 7.4 `catalog_observations`

This is the append-only evidence ledger.

Normalize/add:

```text
id
attemptId
agentKey
endpointKey
validationKind       reachability | protocol | quote | chain
source               browser_reported | worker_probe | buyer_refresh | chain_read | migration
verificationLevel    user_observed | platform_observed | cryptographic | onchain
outcome
observedAt
expiresAt            nullable; freshness policy, not deletion time
durationMs
httpStatus
errorCode
detailsJson          sanitized, versioned details only
artifactHash         signed/evidence hash when applicable
```

Rules:

- Append-only by application and D1 triggers.
- `browser_reported` cannot use `platform_observed` verification level.
- A quote observation is scoped to an agent, endpoint and signed artifact; the
  dedupe key is `(agentKey, endpointKey, artifactHash)` rather than a global hash.
- Never store secrets, authorization headers or private payloads.
- Use monotonic/high-resolution timing in the Worker and record per-stage plus total duration.

### 7.5 `catalog_validation_requests`

Create an auditable, deduplicated on-demand work table:

```text
id
dedupeKey
agentKey
endpointKey
validationKind
requestedBy          system | browser_fallback | admission
status               queued | running | completed | failed | cancelled
priority
createdAt
startedAt
completedAt
attemptCount
resultObservationId
errorCode
leaseOwner
leaseExpiresAt
```

A partial unique index prevents more than one active request for the same declaring
`agentKey + endpointKey + validationKind`. This agent scope is required even when
several identities declare the same endpoint: an observation is committed to the
declaring agent and must not be reused for another identity. Quote requests may
extend the dedupe key with the requirements hash.

### 7.6 `catalog_agent_admission`

Replace `marketplaceConfigured` as the commerce authority:

```text
agentKey             primary key
state                candidate | admitted | suspended
commerceTransport    a2a | erc8183_http
endpointKey
chainId
provider
validatedAt
configurationVersion
reasonCode
```

Admission means the marketplace understands a supported executable commerce path. Reachability remains separate. Suspension preserves history and a reason.

### 7.7 Cached projection versus authority

The observation ledger and admission rows are authoritative. Endpoint `last*` columns are a query projection updated atomically with each observation. Reconciliation tests must prove projection parity with the latest effective ledger rows.

## 8. Classification and normalization algorithm

For every declared resource:

1. Preserve the raw service declaration and source metadata reference.
2. Canonicalize known service names into A2A, MCP, ERC-8183 HTTP, x402 or web/unknown.
3. Parse and canonicalize the URI; run SSRF and unsafe-host checks.
4. Detect obvious external resources (social, repository, docs, human website).
5. Assign `role`, `validationProtocol`, `externalKind` and `eligibility`.
6. Link the normalized resource to every declaring agent.
7. Enqueue only eligible operational resources.

Examples that must be fixtures:

| Declaration | Classification |
| --- | --- |
| A2A + valid Agent Card URL | operational / a2a / eligible |
| MCP + valid HTTPS endpoint | operational / mcp / eligible |
| ERC-8183 + supported HTTP endpoint | operational / erc8183_http / eligible |
| Website + project home | external / website |
| Twitter/X or Telegram | external / social |
| MCP label pointing to `x.com` or `t.me` | operational declaration retained, `invalid_declaration`, never fetched |
| Unknown human URL | external / other, never fetched |
| Private/local/unsafe host | unsafe, never fetched |

Do not rely solely on a domain denylist; combine declared type, URI shape, known external patterns and protocol response validation.

## 9. Discovery lanes

### 9.1 Incremental trust8004 ingest

- Poll recent/high-water catalog data independently of heavy endpoint probes.
- Target cadence: every 1–2 minutes when platform budget permits.
- Use cursor/high-water idempotency and page+cursor atomic writes.
- Newly indexed identities become visible as `declared/pending` without waiting for validation.
- The marketplace cannot guarantee trust8004's own indexing delay; expose the upstream timestamp.

The registry size is not a fixed target. “Approximately 21k” was a past snapshot, not the definition of candidates. Ingestion must operate for any current/future count.

### 9.2 Directed demo tracking

For a newly registered identity provided as `chainId + agentId + txHash`:

1. Verify the registration transaction/identity onchain.
2. Persist `Registered on BSC` state.
3. Poll the trust8004 point API with bounded backoff.
4. When indexed, ingest metadata and mark `Listed; validation pending`.
5. Prioritize its eligible operational endpoints.

This lane enables demos without bypassing trust8004 as the catalog source.

### 9.3 Reconciliation

A slower lane re-reads metadata to detect removed or changed resources. It preserves prior declarations and observations while moving obsolete relations to `removed`. If a removed relation owned a shared endpoint, reconciliation deterministically reassigns that endpoint to the lowest-key remaining current declarer, or leaves it unassigned when none remains.

## 10. Scheduling, Queue and resource budgets

### 10.1 Work priority

Within due eligible work:

1. Explicit buyer/admission request.
2. Newly declared ERC-8183 HTTP commerce endpoint.
3. Never-probed MCP.
4. Never-probed A2A.
5. Failed endpoints whose backoff is due.
6. Successful endpoint refresh.

External resources never enter this list.

### 10.2 Cadence is not per-agent cadence

A one-minute scheduler means “release a bounded batch every minute,” not “validate every agent every minute.” Each resource has `nextProbeAt`; the consumer claims only due rows.

### 10.3 Free profile

Initial safe profile:

```text
Cron cadence:           5 minutes during staging, then 2 minutes after evidence
Discovery page:         2 identities (measured Free row-safe maximum)
Ingest tasks/run:       1
Declarations/task:      1
Batch size:             configurable 1 → 4
Concurrency:            2
Protocol timeouts:      A2A 5s / MCP 5s / ERC-8183 HTTP 5s
Consumer wall deadline: approximately 25 seconds
D1 query budget:        <= 40 per invocation
External subrequests:   <= configured validated ceiling
On-demand validations:  100 new Queue requests/day initially
Success refresh:        priority 15m / ERC-8183 6h / A2A 12h / MCP 24h
Failure backoff:        1h / 6h / 24h / 7d
```

Promoting the Free catalog batch to four also requires
`EXTERNAL_SUBREQUESTS_PER_RUN >= 15`: discovery plus ingest reserve three
requests and an all-MCP four-target batch can require twelve more. Configuration
validation fails closed when this worst case does not fit the declared ceiling,
and the scheduler enforces the ceiling again at runtime.

The Free discovery page is additionally constrained by both D1 budgets. The
initial twelve-identity page was measured in Miniflare at 88--91
`rows_written` before cleanup and therefore cannot fit the 60-row invocation
allowance. A two-identity page with one ingest operation and one declaration
per task was measured at 39 rows for a new header and 54 rows for an all-new
header+sweep fixture (including a four-declaration agent), leaving the required
cleanup/telemetry reserve. `loadConfig` rejects larger Free values; Paid retains
the larger configurable envelope. After discovery, the scheduler admits only
whole ingest tasks whose conservative query ceiling fits the remaining
invocation budget,
reserving the final state write and any due probe work instead of entering a
deterministic retry loop.

One-minute Queue scheduling is not the initial default. It is allowed only after measured retries keep projected Queue operations within the Free allowance and the project's reserve. Nominal one-minute producer+consumer work can approach 4,320 operations/day and retry scenarios can approach the existing 8,000-operation reserve.

This is a project-level safety choice, not a Cloudflare Cron restriction. Cloudflare
supports `* * * * *` (one invocation every minute) on Workers Free and Paid; see
the [Cron Trigger documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
The Worker remains cadence-agnostic: a one-minute tick still publishes one small
Queue message and the consumer claims only bounded due work. With the current
Free defaults, `loadConfig` deliberately fails closed for a one-minute override
because its worst-case retry projection plus the on-demand validation reserve
exceeds the project's 80% Queue safety ceiling. A one-minute Free deployment
therefore requires an explicitly measured budget profile; it does not require a
schema or scheduler redesign.

### 10.4 Paid profile

Initial paid staging profile, measured on 2026-09-02:

```text
Cron cadence:           1 minute
Catalog probe batch:    4
Concurrency:            2
Discovery page:         15 identities
Ingest:                 1 task, 1 declaration
Protocol timeouts:      A2A 5s / MCP 5s / ERC-8183 HTTP 5s
D1 query budget:        <= 40 per invocation
D1 rows read:           <= 3,000 per invocation
D1 phase/pre-ledger rows written: <= 200
External subrequests:   <= 15 per invocation
```

The initial two-identity Paid page was smaller than the observed registration
rate and could defer omitted identities to rolling SWEEP. Paid HEADER reads the
15 newest identities and, when that page does not reach the previous high-water,
immediately reads one additional descending page before advancing. On a SWEEP
tick this catch-up page takes priority over the rolling oldest-first page so the
40-query ceiling remains intact. A Miniflare regression proves 16 arrivals
between ticks are admitted without a gap. A second full page that still does not
reach the previous watermark emits `headerSaturated=true`; the bounded profile
does not claim lossless sub-minute ingestion above 30 arrivals per tick.

The post-change first-delivery staging rotation completed
`PROBE → HEADER → SWEEP`. Its measured maxima were 32 D1 queries, 805 rows read,
116 rows written before the attempt-ledger write, six upstream requests and
8,866 ms wall time. The 200-row control is therefore explicitly a phase/pre-ledger
envelope, not the total number of account writes caused by an invocation.
Increasing Paid limits remains a configuration promotion gated by staging
evidence, not a code fork.

### 10.5 Invocation discipline

- Select due work in one bounded query.
- Acquire leases atomically.
- Batch observation/projection/request updates.
- Count every D1 statement, including statements inside `db.batch()`.
- Keep the self-validated budget at `<= 40` queries per invocation.
- Release/expire leases reliably; idempotency must tolerate partial work and Queue redelivery.
- Never perform unbounded catalog-page processing inside one invocation.

## 11. Probe behavior

### 11.1 A2A

- One Agent Card GET.
- Validate JSON/schema, declared identity/URL and capability fields.
- Distinguish HTTP success from protocol validity.
- Exact path validation is required before assigning endpoint reachability to an agent.

### 11.2 MCP

- Three-step handshake with a shared total deadline.
- Capture each stage duration and failure.
- A successful `tools/list` proves MCP protocol reachability, not commerce.

### 11.3 ERC-8183 HTTP

- `/health`, `/status` and `/negotiate` are SDK/Studio conventions, not ERC-8183 core requirements.
- Scheduled refresh may use the declared health convention.
- Status/admission is one-time or metadata-change work, not every hot-path check.
- Negotiation occurs for admission or buyer demand, not for every scheduled probe.

### 11.4 Freshness and failures

Store separately:

- `lastAttemptAt` and latest attempt outcome;
- `lastSuccessfulAt` and last valid protocol evidence;
- `nextProbeAt`;
- display freshness classification.

A later failure does not erase that an endpoint was previously reached; it changes the latest-attempt state and may make `live` false. Likewise, a historical success must not be labeled “live now” after its SLA window.

Recheck and display TTL must be coherent. A successful endpoint cannot become visually “not observed” hours before the next scheduled opportunity. Use protocol policy to return `live`, `historical` or `stale`, while retaining the timestamp.

## 12. Browser-assisted and on-demand validation

### 12.1 Browser reports

Accept only an existing `agentId + endpointKey + validationKind`. Validate that the endpoint is currently declared and eligible.

Unsigned browser reports:

- use `source=browser_reported` and `verificationLevel=user_observed`;
- never update platform `lastSuccessfulAt`;
- never satisfy commerce admission;
- never cancel scheduled platform verification;
- may be displayed as local/community evidence with explicit provenance.

### 12.2 Signed quote evidence

The frontend submits the exact seller-signed envelope. The Worker/backend independently:

1. parses the canonical payload;
2. verifies signer/signature, including ERC-1271 when needed;
3. verifies agent identity, chain, endpoint/admission and requirements hash;
4. validates expiry and terms;
5. records a sanitized observation plus artifact hash;
6. returns capabilities for the next hiring step.

Parsed browser claims without the signed artifact are rejected.

### 12.3 Infrastructure fallback

`POST /catalog-validations`:

- validates catalog membership and eligibility;
- returns an existing fresh/running/queued request when possible;
- enqueues one bounded request otherwise;
- rate-limits by caller and target;
- does not allow arbitrary URLs;
- returns `202` with validation ID for asynchronous work.

The application derives an opaque caller fingerprint from the request's
normalized proxy/origin context and HMACs it with `BUYER_OBSERVATION_SECRET`. The Worker
accepts only that fixed-size fingerprint, persists it as `callerKey`, and never
stores the source IP or origin. A global daily cap and the configurable
`CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY` cap are both enforced before Queue
admission; target deduplication/cooldown remains independent of caller scope.

## 13. Internal Worker catalog API v2

These `/catalog-*` routes are the versioned server-to-Worker data plane. They are
authoritative for normalized observation state inside the infrastructure boundary,
but they are not the repository's public machine-readable contract. The application
server maps them into `/api/marketplace/*`; that public contract remains governed by
`docs/API.md`.

### 13.1 List

`GET /catalog-agents`

Supports combinable filters:

- search;
- operational protocol;
- MCP-only (current eligible MCP declaration and no eligible A2A/ERC-8183 commerce declaration);
- current platform reachability;
- commerce declared/admitted;
- quote evidence;
- latest platform failure;
- outcome/category;
- chain;
- cursor/page and limit.

Quote filters use only cryptographic evidence for the agent's current admitted
commerce endpoint; a valid quote on a different or historical endpoint cannot
make the current seller appear quote-capable.

Default inventory should prioritize actionable operational candidates. Registry-only identities are accessible without being presented as a separate source of truth. This route is consumed server-side only.

### 13.2 Detail

`GET /catalog-agent/:agentId` returns:

- declared identity and trust8004 provenance;
- normalized operational/external resources;
- latest effective evidence per resource/protocol;
- last attempt, last success, attempt count and next eligibility time;
- commerce admission;
- quote summary;
- onchain references;
- derived capabilities and blocking reasons;
- policy/API version.

### 13.3 Mutations/status

- `POST /catalog-browser-observations`
- `POST /catalog-validations`
- `GET /catalog-validations/:validationId`
- `POST /catalog-quote-evidence`

All mutations use strict schemas, size limits, origin/auth controls appropriate to environment, rate limits and structured error codes. Public callers reach these capabilities through bounded application routes; exposing the internal Worker mutation endpoints directly is not part of this specification.

### 13.4 Derived capabilities

The backend returns, rather than asking each component to infer:

```text
operationalStatus
freshness
commerceStatus
quoteStatus
buyerAction
canRequestBrowserValidation
canRequestInfrastructureValidation
canRequestQuote
canPrepareHire
blockingReasons[]
```

Policy examples:

- MCP-only reachable agent: reachable, not hireable.
- Commerce admitted but no quote: `request_quote`.
- Fresh verified quote plus current chain checks: `prepare_hire`.
- `hireable`/availability means an admitted executable seller has a current
  compatible declaration and a fresh quote can be requested. It does not mean
  that a cached quote authorizes a transaction; `canPrepareHire` is the
  stricter gate that requires a fresh verified quote plus current chain facts.
- Browser-only unsigned success: `browser_observed`, never platform reachable.
- CORS browser failure: no platform failure transition.

## 14. Telemetry and observability

Emit structured logs for every phase and attempt without secrets:

- invocation/phase/attempt IDs;
- endpoint key, protocol, source and priority;
- queue delay, lease wait, per-stage duration and total duration;
- outcome/error code/retry decision;
- D1 query count and external subrequest count;
- rows claimed/completed/skipped/deduplicated;
- budget profile and configuration version.

Required operational views:

- due/queued/running/failed work counts;
- age of oldest due item;
- discovery lag from trust8004 timestamp to D1 visibility;
- platform success/failure by protocol;
- retry rate and Queue operations/day;
- D1 rows read/written and queries/invocation;
- invalid/external declarations excluded from probes.

Use high-resolution timing. Zero-millisecond failures are allowed only when the failure truly occurs before network dispatch and must carry a stage/error code.

## 15. D1 migration and compatibility plan

### Phase A — Additive schema

- [x] 1. Create normalized columns/tables and indexes. Migrations `0008`–`0017`
  and the schema/integration suites pass locally.
- [x] 2. Keep current APIs and writes active. Compatibility reads/writes remain
  covered while the v2 flags are independently switchable.
- [x] 3. Backfill roles, protocols, eligibility, admission candidates and
  projections deterministically. The generated seeded catalog applies cleanly
  through migration `0017`.
- [x] 4. Record migration provenance and counts. Owner, metadata URI, block,
  metadata timestamps and normalized counts are persisted and asserted by tests.

### Phase B — Shadow parity

- [x] 1. Produce v1 and v2 derived results for deterministic local fixtures.
- [x] 1a. Remote sample parity is proven for Agent `303779`: the public marketplace
  and Worker v2 expose the same endpoint key, observation `642`, observed timestamp
  and hireability inputs.
- [x] 2. Assert that local differences are explained by the new policy.
- [x] 3. Verify social/web exclusion, latest-attempt ordering and admission
  behavior. Classification, evidence-policy, ingest and admission integration
  tests cover these cases.

### Phase C — Switch writes

- [x] 1. Write observations and projections atomically to the normalized model;
  local HEADER and SWEEP smoke ticks persisted bounded batches successfully.
- [x] 2. Enable validation-request deduplication and leases; local integration
  tests cover duplicate delivery, reclaim and release after failure.
- [x] 3. Keep compatibility reads during the observation window; the v2
  read/write switches remain independently configurable.
- [x] 3a. The bounded Paid observation window is published in
  `evidence/catalog-paid-staging-2026-09-02.json`. Seventeen consecutive ticks of
  the final candidate completed with zero unexplained errors and stayed inside all
  configured per-invocation budgets.

### Phase D — Switch API reads

- [x] 1. Publish API v2 contract fixtures and Worker serializers.
- [x] 2. Frontend consumes v2 after rebasing; this is included in merged PR #62
  (`7c133ef27906284f654064b24a42c43bf8859a40`).
- [x] 3. Compare the public production marketplace with its staging D1 data plane.
  Both returned `29,844` declared operational agents, and Agent `303779` resolved
  to observation `642` at `2026-09-02T12:54:01.683Z`. No separate production D1
  exists or is required by the deployed architecture.

### Phase E — Retire legacy storage

Only after runtime-reference search, parity tests and an evidence export:

- [ ] drop transitional bridge triggers;
- [ ] stop writes to legacy `probe_targets`/`probe_observations`;
- [ ] retain/archive historical evidence before any destructive drop;
- [ ] remove `marketplaceConfigured` after admission backfill and all consumers
  migrate.

Database rollback is additive: disable v2 readers/writers and return to compatibility reads. Do not attempt destructive down-migrations that lose observations.

## 16. Required code cleanup

After replacement tests pass, remove:

- [ ] `web` as a generic probe protocol and all scheduler branches that fetch it;
  it remains in the compatibility schema and fixtures until the remote parity gate.
- [ ] Unknown/null service fallback to `web` in catalog validation target selection;
  compatibility normalization still preserves this legacy representation.
- [ ] Browser endpoint-test actions for social and human-facing resources; policy
  rejection is covered, but the legacy compatibility surface remains.
- [ ] Hard-coded agent-specific scheduled quote logic once general admission/on-demand
  quote paths cover it.
- [ ] Duplicate observation writes/readers and transitional bridge code after v2 parity.
- [ ] `marketplaceConfigured`-based hireability logic. During the compatibility window
  the legacy storage field may remain, but v2 cards, Passport and API capabilities
  must read `catalog_agent_admission`/derived state only.
- [x] Queries where any historical failure overrides a later effective success;
  latest-effective-attempt projection tests prevent that regression.
- [ ] Obsolete bootstrap/rotation code once the Worker is the sole owner and tests
  prove no import remains; the compatibility bootstrap is still present.
- [ ] Obsolete summary types that no longer describe actual phase output.

- [x] The Worker test suite enforces the ORM boundary with a versioned file-and-count
allowlist. Only the atomic query-budget wrapper and scheduler lease helper are
currently exempt from the Drizzle runtime boundary; any new raw `.prepare()` call
fails the standard check.

Do not remove:

- raw metadata/declarations;
- append-only observations;
- rehearsal/final evidence artifacts;
- testnet configuration;
- explicit demo seller fixtures still used by the separate hiring lifecycle.

## 17. TDD work packages

### WP-B1 — Classification

- [x] Write and pass table-driven tests for every example in §8, including
  Twitter, Telegram and website mislabeled as MCP/A2A/ERC-8183
  (`catalog-resource-classification.test.ts` and header-index integration tests).

**Gate:** [x] only eligible operational resources can produce work.

### WP-B2 — D1 migration

- [x] Test migration from representative current rows, constraints, indexes,
  backfill counts and rollback-compatible reads
  (`catalog-normalization-migration.test.ts` and schema tests).

**Gate:** [x] no agent/declaration/observation loss; append-only triggers hold.

### WP-B3 — Effective evidence projection

- [x] Test success→failure, failure→success, stale success, browser-only success,
  shared origin/different path, metadata replacement and representative
  reassignment after retirement.

**Gate:** [x] projection equals ledger-derived result and never overstates scope.

### WP-B4 — Work selection and budgets

- [x] Test due ordering, leases, duplicate Queue deliveries, partial batches,
  retry/backoff and query/subrequest accounting.

**Gate:** [x] `D1 queries <= 40` under every configured Free invocation fixture;
external resources are absent.

### WP-B5 — Protocol probes

- [x] Use deterministic local servers for A2A schema, MCP three-step handshake,
  ERC-8183 HTTP convention, timeouts, redirects, unsafe targets and malformed
  responses.

**Gate:** [x] protocol-valid outcomes are distinct from HTTP success; timing is
per-stage and total.

### WP-B6 — Browser/on-demand APIs

- [x] Test arbitrary URL rejection, undeclared endpoint rejection, CORS report
  semantics, deduplication, fresh reuse, rate limit, queue completion and attempt
  history.

**Gate:** [x] unsigned browser evidence never changes platform reachability.

### WP-B7 — Quote evidence

- [x] Test valid/invalid EIP-191, ERC-1271 pass/fail, wrong agent, wrong chain,
  changed terms, expired quote, replay/deduplication and sanitized storage.

**Gate:** [x] only independently verified exact artifacts create `quote_verified`.

### WP-B8 — Discovery

- [x] Test cursor paging, page+cursor atomicity, new/changed/removed metadata,
  directed tracking, trust8004 delay and resume after interruption.

**Gate:** [x] a newly indexed identity appears without waiting for an endpoint
probe.

### WP-B9 — API contract

- [x] Contract-test all list/detail filters, capabilities and blocker combinations
  consumed by the frontend specification.

**Gate:** [x] one versioned fixture set passes in Worker and application consumer
tests.

### WP-B10 — Local and remote E2E

- [x] 1. Run migrations and Worker locally with Wrangler/Miniflare.
- [x] 2. Ingest deterministic trust8004 fixtures.
- [x] 3. Process mixed operational/external resources.
- [x] 4. Exercise browser report, fallback Queue and signed quote flows in the
  local Worker/application test suites.
- [x] 5. Deploy Paid staging, then enable one-minute producer and bounded
  four-target consumer batches.
- [x] 6. Inspect D1 attempt rows, Queue completion, preview API projection and
  endpoint-scoped on-demand validation remotely.

**Gate:** [x] unit, integration, Miniflare, typecheck, budget validation,
production bundle and bounded remote runtime checks pass.

## 18. Rollout, safety and configuration

All capacity controls remain configurable and are covered by the configuration
validation tests:

- [x] producer/consumer kill switches;
- [x] ingest cadence;
- [x] validation cadence;
- [x] batch size and concurrency;
- [x] per-protocol timeout and total deadline;
- [x] retry/backoff;
- [x] freshness policy;
- [x] query/subrequest/Queue budgets;
- [x] daily on-demand validation admission budget;
- [x] per-caller daily on-demand validation admission budget;
- [x] API v2 read/write feature flags.

The checked-in controls are `CRON_INTERVAL_MINUTES`,
`CATALOG_DISCOVERY_PAGE_SIZE`, `CATALOG_INGEST_TASKS_PER_RUN`,
`CATALOG_DECLARATIONS_PER_TASK`, `CATALOG_PROBE_BATCH_SIZE`,
`CATALOG_PROBE_CONCURRENCY`, the three `CATALOG_*_TIMEOUT_MS` values, the
four `CATALOG_*_REFRESH_MINUTES` values,
`CATALOG_FAILURE_BACKOFF_MINUTES`, the D1/subrequest/Queue budgets and the v2
read/write switches and `CATALOG_VALIDATION_REQUESTS_PER_CALLER_DAY`. The
per-caller default is 10 on Free and 100 on Paid; it is capped by the global
`CATALOG_VALIDATION_REQUESTS_PER_DAY` value. `loadConfig` validates each value against the selected Free or
Paid profile and rejects a discovery+ingest request projection that exceeds
`TRUST8004_REQUESTS_PER_RUN`.

Rollout order:

- [x] 1. Local schema/protocol E2E.
- [x] 2. Apply additive staging migrations and verify the normalized read path.
- [x] 3. Exercise remote staging ingest/classification on the bounded scheduler.
- [x] 4. Enable v2 writes for a bounded local sample.
- [x] 5. Enable Queue consumer, then producer at the authorized one-minute Paid cadence.
- [x] 6. Promote the catalog probe batch to four from measured remote evidence.
- [x] 7. Replace the obsolete planned 2-minute Free promotion with the measured
  one-minute Paid profile; Free defaults remain unchanged and safe-off outside staging.
- [x] 8. Enable v2 internal reads, prove application-adapter parity, and integrate
  the corresponding `/api/marketplace/*` surface in merged PR #62.
- [ ] 9. Retire legacy code only after the observation gate.

- [x] Rollback procedure stops the producer first, preserves Queue/D1 and keeps
  evidence append-only in local tests; the earlier remote rehearsal remains
  preserved under `evidence/rehearsal/`.

## 19. Acceptance criteria

- [x] Newly indexed trust8004 agents appear as declared/pending without waiting
  for an endpoint probe (local discovery/integration coverage).
- [x] Registry size is unbounded by an obsolete snapshot count.
- [x] Website/social resources are preserved but never probed.
- [x] A2A, MCP and ERC-8183 HTTP checks follow distinct protocol semantics.
- [x] Queue consumers process bounded due work; cron cadence never implies probing
  every agent (local budget and scheduler coverage).
- [x] Free profile stays within self-validated D1, subrequest and Queue budgets.
- [x] Browser-only observations cannot create platform reachability or hireability.
- [x] Signed quote evidence is independently verified and agent-specific.
- [x] Latest attempt, last success, freshness and attempt count are queryable
  without contradiction.
- [x] Commerce admission is the v2 source of hireability; the legacy
  `marketplaceConfigured` field remains only for compatibility.
- [x] Internal API v2 returns one normalized state/capability model consumed by
  cards, table and Passport; merged PR #62 established this DTO integration.
- [ ] The canonical `/hire/[agentId]` page consumes that same state/capability
  model for its complete profile-and-hire presentation. Route unification remains
  owned by `docs/FRONTEND_HIRE_JOURNEY_SPEC.md`.
- [x] Migration/backfill loses no declarations or observations in local tests.
- [ ] Legacy code is removed only after parity and runtime-reference gates.
- [x] Local Wrangler/Miniflare and bounded remote staging evidence pass before
  production promotion. Production itself is not changed by this specification run.

## 20. Integration order with the other sessions

- [x] 1. Infrastructure lands the additive D1 migration, internal API v2 schema
  and deterministic fixtures.
- [x] 2a. Frontend rebases and consumes the v2 DTO and fixtures (merged PR #62).
- [ ] 2b. Frontend completes the companion profile/hire route unification against
  those fixtures.
- [x] 3. Hiring session exposes quote/prepare/submit interfaces under
  `docs/HIRE-SPEC.md` and consumes verified quote/admission IDs.
- [x] 4. Integration session resolves shared DTOs, keeps `docs/DECISIONS.md`
  aligned with `main`, and passes the full application build/test gate.
- [ ] 5. Legacy deletion occurs last, in its own reviewable change, after
  production/staging parity.

This order prevents the frontend from inventing state, the infrastructure from owning wallet behavior, and the hiring flow from duplicating observation logic.
