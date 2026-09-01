# Observation Infrastructure and D1 Normalization — Specification

**Status:** Implementation in progress — infrastructure local gates pass; public API integration is merged; frontend integration and remote staging gates pending
**Date:** 2026-09-01
**Owner:** Infrastructure session  
**Companion specification:** `docs/FRONTEND_HIRE_JOURNEY_SPEC.md`

**Related authorities:** `docs/API.md` defines the public machine-readable surface
and `docs/HIRE-SPEC.md` defines the programmatic ERC-8183 hire flow. The Worker API
specified here is an internal upstream data plane and must not become a parallel
public API.

### Document relationship

This specification describes the next infrastructure migration. The measured WP2 bundle, evidence gates and frozen-window rules in `docs/SPEC-MVP.md` remain authoritative for the current WP2 candidate until they are deliberately superseded. No implementation under this document may silently alter that measured bundle or relabel rehearsal evidence as final.

### Current implementation evidence

Local evidence captured on 2026-09-01:

- all additive migrations `0008` through `0015` apply successfully to the Wrangler local D1;
  migration `0014_catalog_agent_identity.sql` preserves the declared owner,
  metadata URI and registration block alongside the normalized catalog row, and
  `0015_agent_scoped_validation_dedupe.sql` scopes legacy validation keys by agent;
- Worker typecheck and manifest validation pass;
- 489 unit tests and 105 Miniflare integration tests pass in
  `bnb-agent-probe` (`vitest.config.ts` and `vitest.worker.config.ts`);
- production, staging and validation dry-run bundles build successfully;
- application-side endpoint policy, controller and observation-sync coverage passes
  25 focused tests (`browser-endpoint-validation.test.ts`,
  `marketplace-controllers.test.ts` and `catalog-observation-sync.test.ts`);
- the complete application gate passes: typecheck, 547 tests across 62 files and
  the production CLI/Web build. The current checkout also passes 551 tests because
  it contains four concurrent frontend tests outside this infrastructure commit;
  the BNB Agent SDK still emits its known dynamic dependency warning during
  bundling, but the bundle completes successfully.
- `docs/API.md`, `docs/HIRE-SPEC.md`, `docs/MCP.md` and `docs/MARKETPLACE.md`
  are now integrated from `main` in PR #56; the frontend companion remains a
  separate concurrent change and is not included in this infrastructure commit.
- catalog evidence reads enforce cryptographic/on-chain verification levels,
  isolate shared-endpoint observations by declaring agent, and release Queue/D1
  leases after a failed result batch; these paths are covered by the integration
  suites above.

This is not the remote rollout gate. Staging migrations, shadow parity, bounded v2
writes/reads, operational metrics and legacy-retirement evidence remain required
before this specification can be marked complete.

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
`0015`; `0014_catalog_agent_identity.sql` adds the declared identity provenance
columns without rewriting existing rows, and
`0015_agent_scoped_validation_dedupe.sql` migrates legacy on-demand keys without
touching the append-only observation ledger.

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
- A quote observation is scoped to an agent, endpoint and signed artifact.
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

A slower lane re-reads metadata to detect removed or changed resources. It preserves prior declarations and observations while moving obsolete relations to `removed`.

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
Discovery page:         12 identities
Ingest tasks/run:       2
Declarations/task:      4
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

The Free discovery page is additionally constrained by its all-new
header+sweep D1 projection (page 15 is the largest value compatible with the
40-query ceiling and the scheduler's cleanup reserve). After discovery, the
scheduler admits only whole ingest tasks whose conservative query ceiling fits
the remaining invocation budget, reserving the final state write and any due
probe work instead of entering a deterministic retry loop.

One-minute Queue scheduling is not the initial default. It is allowed only after measured retries keep projected Queue operations within the Free allowance and the project's reserve. Nominal one-minute producer+consumer work can approach 4,320 operations/day and retry scenarios can approach the existing 8,000-operation reserve.

### 10.4 Paid profile

Initial paid profile, still measured rather than assumed:

```text
Cron cadence:           1 minute
Batch size:             10
Concurrency:            4
Timeout/deadline:       configurable from measured protocol latency
```

Increasing paid limits is a configuration promotion gated by staging evidence, not a code fork.

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

1. Create normalized columns/tables and indexes.
2. Keep current APIs and writes active.
3. Backfill roles, protocols, eligibility, admission candidates and projections deterministically.
4. Record migration provenance and counts.

### Phase B — Shadow parity

1. Produce v1 and v2 derived results for fixtures and a staging sample.
2. Assert that differences are explained by the new policy.
3. Specifically verify social/web exclusion, latest-attempt ordering and admission behavior.

### Phase C — Switch writes

1. Write observations and projections atomically to the normalized model.
2. Enable validation-request deduplication and leases.
3. Keep compatibility reads during the observation window.

### Phase D — Switch API reads

1. Publish API v2 contract fixtures.
2. Frontend consumes v2 after rebasing.
3. Compare production/staging counts and sample agent histories.

### Phase E — Retire legacy storage

Only after runtime-reference search, parity tests and an evidence export:

- drop transitional bridge triggers;
- stop writes to legacy `probe_targets`/`probe_observations`;
- retain/archive historical evidence before any destructive drop;
- remove `marketplaceConfigured` after admission backfill and all consumers migrate.

Database rollback is additive: disable v2 readers/writers and return to compatibility reads. Do not attempt destructive down-migrations that lose observations.

## 16. Required code cleanup

After replacement tests pass, remove:

- `web` as a generic probe protocol and all scheduler branches that fetch it.
- Unknown/null service fallback to `web` in catalog validation target selection.
- Browser endpoint-test actions for social and human-facing resources.
- Hard-coded agent-specific scheduled quote logic once general admission/on-demand quote paths cover it.
- Duplicate observation writes/readers and transitional bridge code after v2 parity.
- `marketplaceConfigured`-based hireability logic. During the compatibility window
  the legacy storage field may remain, but v2 cards, Passport and API capabilities
  must read `catalog_agent_admission`/derived state only.
- Queries where any historical failure overrides a later effective success.
- Obsolete bootstrap/rotation code once the Worker is the sole owner and tests prove no import remains.
- Obsolete summary types that no longer describe actual phase output.

The Worker test suite enforces the ORM boundary with a versioned file-and-count
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

Write failing table-driven tests for every example in §8, including Twitter, Telegram and website mislabeled as MCP/A2A/ERC-8183.

**Gate:** only eligible operational resources can produce work.

### WP-B2 — D1 migration

Test migration from representative current rows, constraints, indexes, backfill counts and rollback-compatible reads.

**Gate:** no agent/declaration/observation loss; append-only triggers hold.

### WP-B3 — Effective evidence projection

Test success→failure, failure→success, stale success, browser-only success, shared origin/different path and metadata replacement.

**Gate:** projection equals ledger-derived result and never overstates scope.

### WP-B4 — Work selection and budgets

Test due ordering, leases, duplicate Queue deliveries, partial batches, retry/backoff and query/subrequest accounting.

**Gate:** `D1 queries <= 40` under every configured Free invocation fixture; external resources are absent.

### WP-B5 — Protocol probes

Use deterministic local servers for A2A schema, MCP three-step handshake, ERC-8183 HTTP convention, timeouts, redirects, unsafe targets and malformed responses.

**Gate:** protocol-valid outcomes are distinct from HTTP success; timing is per-stage and total.

### WP-B6 — Browser/on-demand APIs

Test arbitrary URL rejection, undeclared endpoint rejection, CORS report semantics, deduplication, fresh reuse, rate limit, queue completion and attempt history.

**Gate:** unsigned browser evidence never changes platform reachability.

### WP-B7 — Quote evidence

Test valid/invalid EIP-191, ERC-1271 pass/fail, wrong agent, wrong chain, changed terms, expired quote, replay/deduplication and sanitized storage.

**Gate:** only independently verified exact artifacts create `quote_verified`.

### WP-B8 — Discovery

Test cursor paging, page+cursor atomicity, new/changed/removed metadata, directed tracking, trust8004 delay and resume after interruption.

**Gate:** a newly indexed identity appears without waiting for an endpoint probe.

### WP-B9 — API contract

Contract-test all list/detail filters, capabilities and blocker combinations consumed by the frontend specification.

**Gate:** one versioned fixture set passes in Worker and application consumer tests.

### WP-B10 — Local and remote E2E

1. Run migrations and Worker locally with Wrangler/Miniflare.
2. Ingest deterministic trust8004 fixtures.
3. Process mixed operational/external resources.
4. Exercise browser report, fallback Queue and signed quote flows.
5. Deploy staging with kill switches safe, then enable a bounded batch.
6. Inspect structured logs, D1 rows, Queue counts and public API results.

**Gate:** unit, integration, Miniflare, typecheck, budget validation and production bundle checks pass before runtime promotion.

## 18. Rollout, safety and configuration

All capacity controls remain configurable:

- producer/consumer kill switches;
- ingest cadence;
- validation cadence;
- batch size and concurrency;
- per-protocol timeout and total deadline;
- retry/backoff;
- freshness policy;
- query/subrequest/Queue budgets;
- daily on-demand validation admission budget;
- API v2 read/write feature flags.

The checked-in controls are `CRON_INTERVAL_MINUTES`,
`CATALOG_DISCOVERY_PAGE_SIZE`, `CATALOG_INGEST_TASKS_PER_RUN`,
`CATALOG_DECLARATIONS_PER_TASK`, `CATALOG_PROBE_BATCH_SIZE`,
`CATALOG_PROBE_CONCURRENCY`, the three `CATALOG_*_TIMEOUT_MS` values, the
four `CATALOG_*_REFRESH_MINUTES` values,
`CATALOG_FAILURE_BACKOFF_MINUTES`, the D1/subrequest/Queue budgets and the v2
read/write switches. `loadConfig` validates each value against the selected Free or
Paid profile and rejects a discovery+ingest request projection that exceeds
`TRUST8004_REQUESTS_PER_RUN`.

Rollout order:

1. Local schema/protocol E2E.
2. Additive staging migration with both kill switches enabled.
3. Shadow ingest/classification and parity report.
4. Enable v2 writes for a bounded sample.
5. Enable Queue consumer, then producer at 5-minute cadence.
6. Promote batch up to four only from measured evidence.
7. Move to 2-minute Free cadence if daily budgets/retries permit.
8. Enable v2 internal reads, prove application-adapter parity, then enable the corresponding `/api/marketplace/*` integration.
9. Retire legacy code only after the observation gate.

On error, stop producer first, drain/disable consumer safely, preserve Queue/D1 and keep evidence append-only.

## 19. Acceptance criteria

- Newly indexed trust8004 agents appear as declared/pending within the configured ingest cadence.
- Registry size is unbounded by an obsolete snapshot count.
- Website/social resources are preserved but never probed.
- A2A, MCP and ERC-8183 HTTP checks follow distinct protocol semantics.
- Queue consumers process bounded due work; cron cadence never implies probing every agent.
- Free profile stays within self-validated D1, subrequest and Queue budgets.
- Browser-only observations cannot create platform reachability or hireability.
- Signed quote evidence is independently verified and agent-specific.
- Latest attempt, last success, freshness and attempt count are queryable without contradiction.
- Commerce admission replaces the `marketplaceConfigured` shortcut.
- Internal API v2 returns one normalized state/capability model that the application maps consistently into cards, table, Passport and hire-page responses.
- Migration/backfill loses no declarations or observations.
- Legacy code is removed only after parity and runtime-reference gates.
- Local Wrangler/Miniflare and remote staging evidence both pass before production promotion.

## 20. Integration order with the other sessions

1. Infrastructure lands the additive D1 migration, internal API v2 schema and deterministic fixtures.
2. Frontend rebases and implements the companion hire journey against those fixtures.
3. Hiring session exposes quote/prepare/submit interfaces under `docs/HIRE-SPEC.md` and consumes verified quote/admission IDs.
4. Integration session resolves shared DTOs, updates `docs/DECISIONS.md`, runs the full application build and end-to-end story.
5. Legacy deletion occurs last, in its own reviewable change, after production/staging parity.

This order prevents the frontend from inventing state, the infrastructure from owning wallet behavior, and the hiring flow from duplicating observation logic.
