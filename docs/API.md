# Marketplace HTTP API

The machine-readable surface of the marketplace. Every route is a thin handler over
`src/business/composition.ts`; the response shapes are the entity types named per route.
This is the surface the MCP server (plan P3) and any programmatic buyer consume.

## What this API does and does not claim

- **MCP/A2A availability never implies hireability.** An agent is hireable only when
  `hireability.canHire` is true, which requires a marketplace-admitted configuration
  with a verified quote path.
- **The Evidence Passport is read-only evidence**, not an NFT, a financial endorsement,
  or a reputation protocol.
- **Job state resolves from chain.** Tracking responses report chain-read facts with
  transaction hashes and timestamps preserved; marketplace claims never substitute for
  them.
- Every piece of evidence carries its provenance (see vocabularies below); consumers
  must not treat `declared` data as verified.

## Conventions

Base path: `/api/marketplace` on the deployed origin. All bodies are JSON. No route
reads an `Authorization` header; write routes are bounded and rate limited instead.

### Error bodies — two vocabularies

Catalogue routes (`marketplaceErrorResponse`, `src/presentation/http/marketplace-http.ts`)
return `{ "error": { "code", "message" } }` where `code` is the error class name:

| code | status | notes |
| --- | --- | --- |
| `InvalidMarketplaceInputError`, `InvalidPublicJobProofIdError` | 400 | |
| `MarketplaceAgentNotFoundError`, `PublicJobProofNotFoundError` | 404 | |
| `MarketplacePayloadTooLargeError` | 413 | |
| `MarketplaceRateLimitError` | 429 | with `Retry-After` header (seconds) |
| `MarketplaceDataUnavailableError` | 503 | |
| `INTERNAL_ERROR` | 500 | message is generic; details are never leaked |

ERC-8183 routes (`erc8183SpikeErrorResponse`, `src/presentation/http/erc8183-spike-http.ts`)
use the same body shape with SCREAMING_SNAKE codes:

| code | status | notes |
| --- | --- | --- |
| `ERC8183_SPIKE_DISABLED` | 404 | flow disabled by environment (see gating) |
| `INVALID_ERC8183_SPIKE_INPUT` | 400 | |
| `ERC8183_DEMO_JOB_NOT_FOUND` | 404 | |
| `ERC8183_QUOTE_REJECTED` | 409 | quote failed the allowlist policy |
| `ERC8183_JOB_NOT_READY` | 409 | buyer preconditions or job state not met |
| `ERC8183_SPIKE_UNAVAILABLE` | 503 | seller or chain check unavailable |
| `INTERNAL_ERROR` | 500 | |

The two vocabularies are historical and both stable; they are documented as-is.

### Provenance vocabularies

Three encodings appear, all stable:

1. `EvidenceRecord.kind` on catalogue entities: `declared | observed | onchain |
   derived`, with `source`, `observedAt`, `verifiedDirectly` and `note`.
2. Passport-check `provenance`: `onchain | observed | derived | not_probed |
   unavailable`.
3. Namespaced strings on transaction proofs and verification blocks, e.g.
   `onchain:bsc-testnet`, `onchain:bsc-mainnet-rpc`,
   `derived:marketplace-seller-qualification`.

### Cache headers

Only these routes set `Cache-Control`; all others send none:

| route | header |
| --- | --- |
| `GET /agents/[agentId]/passport` | `public, max-age=60, must-revalidate` |
| `GET /proofs/jobs/mainnet/[jobId]` | `public, max-age=60, stale-while-revalidate=300` |
| `POST /validate`, `GET /validate/:requestId`, `POST /demo/erc8183-mainnet/quote`, `POST /hire-events` | `no-store` |

## Discover / Understand / Compare

### `GET /api/marketplace/agents`

Query parameters:

| param | values | default | invalid → |
| --- | --- | --- | --- |
| `view` | `marketplace` \| `all` | `marketplace` | 400 |
| `page` | positive integer | 1 | 400 |
| `limit` | positive integer ≤ 24 | 12 (`marketplace`) / 24 (`all`) | 400 |
| `q` | free text ≤ 120 chars | — | 400 |
| `sort` | one of `MARKETPLACE_DATA_SORTS` | — | 400 |
| `category` | Repeatable: `rebalancing` \| `grid_trading` \| `yield_optimisation` \| `health_factor_monitoring` (marketplace view only) | — | 400 |
| `availability` | `all` \| `hireable` \| `mcp_only` (marketplace view only) | — | 400 |
| `status` | Repeatable catalog status: `declared` \| `pending` \| `a2a` \| `mcp` \| `mcp_only` \| `erc8183` \| `quote_capable` \| `hireable` \| `failed` (marketplace view only) | `declared` in the catalog | 400 |
| `protocol` | Repeatable: `a2a` \| `mcp` \| `erc8183_http` (marketplace view only) | — | 400 |
| `reachability` | Repeatable: `live` \| `historical` \| `never` \| `browser_observed` (marketplace view only) | — | 400 |
| `commerce` | Repeatable: `declared` \| `candidate` \| `admitted` \| `suspended` \| `none` (marketplace view only) | — | 400 |
| `quote` | Repeatable: `verified` \| `expired` \| `missing` (marketplace view only) | — | 400 |
| `latestFailure` | `true` \| `false` (marketplace view only) | — | 400 |

Response: `MarketplaceAgentPage` (`src/business/entities/marketplace-agent.ts`) —
`{ view, items: MarketplaceAgent[], pagination: { page, pageSize, total, totalPages },
categories: [{ category, count, status }], catalogCoverage: "partial", fetchedAt }`.

Each `MarketplaceAgent` carries, among others: `chainId`, `agentId`, `name`,
`description`, `owner`, `operator`, `metadataUri`, declared `services` / `endpoints` /
`tools` / `capabilities`, catalog-owned `validationTargets` (each with `endpointKey`,
`protocol` and `endpoint`, only for current eligible operational declarations),
`endpointObservation`, `reputation`, `trustScore`,
`categories` (each with an `EvidenceRecord`), `provenance` (per-fact
`EvidenceRecord`s), `hireability: { status, canHire, reason, evidence }` and
`freshness`. `hireability.status` is one of `quote_verified | quote_stale |
wallet_ambiguous | mcp_only | protocol_discovered | no_transport_declared |
not_evaluated`.

`availability=hireable` filters to `hireability.canHire === true`;
`availability=mcp_only` filters to `hireability.status === "mcp_only"`.
Repeated evidence `status` values are ANDed (an agent must satisfy every selected
state); repeated values in category, protocol, reachability, commerce and quote
dimensions are ORed. All dimensions are then ANDed. For example,
`status=declared&status=hireable&category=grid_trading` returns hireable agents in
that category. Advanced catalog filters fail closed with `503` if the catalog
service is unavailable; the curated fallback is never used to fabricate an answer
for them. Marketplace-only filters sent with `view=all` are rejected with `400`.

### `GET /api/marketplace/agents/[agentId]`

`agentId` numeric, else 400; unknown → 404. Response: one `MarketplaceAgent` with
`onchainIdentity` attached (`{ status: "match" | "mismatch" | "unavailable" | …,
owner, agentWallet, metadataUri, registryAddress, blockNumber, observedAt, checks,
error, evidence }`).

### `GET /api/marketplace/agents/[agentId]/passport`

Response: `AgentEvidencePassport` (`src/business/entities/evidence-passport.ts`) —
`{ schemaVersion: 1, chainId, agentId, name, operator, state: "registered" |
"evaluated" | "hireable" | "job_proven" | "attention", evidenceSnapshotHash,
generatedAt, attentionReasons, checks: { identity, endpoint, quote, job, hireActivity },
trackRecord, nextRequirements }`. Each check:
`{ status: "verified" | "missing" | "not_probed" | "failed" | "unavailable" | "stale",
provenance, observedAt, detail }`; the `quote` check also carries
`hireabilityStatus`.

`checks.hireActivity` reports the latest hire lifecycle phase (`created`,
`funded`, `submitted`, `settled`, `refunded`) that the observation Worker
verified on BSC Mainnet for this agent: receipt to the pinned Commerce
contract, a matching Commerce event for the job, compatible job state and the
job's provider equal to the agent's ERC-8004 registry wallet. It is activity,
not a track record: it never changes `state`, `trackRecord` or `checks.job`, and
a verified phase proves the phase, not the deliverable. It enters
`evidenceSnapshotHash`. When the Worker feed is unavailable the check is
`missing`, never an error.

### `GET /api/marketplace/compare?agentId=…&agentId=…`

2–3 unique numeric `agentId` params, else 400; any missing agent → 404. Response:
`{ agents: MarketplaceAgent[], winner: null, note, catalogCoverage: "partial",
fetchedAt }`. The marketplace never declares a winner; the comparison is evidence
side by side.

### `POST /api/marketplace/validate`

Requires `Content-Type: application/json`; bodies over 256 bytes → 413. The route has
two explicit request modes so the compatibility validator cannot be confused with the
shared observation pipeline:

1. **Compatibility report:** body exactly `{ "agentId": "<numeric string>" }` — any
   extra key → 400. Response: `AgentValidationReport`
   (`src/business/entities/agent-validation.ts`), embedding a fresh
   `AgentEvidencePassport`. This ad-hoc report does not write platform observations or
   promote an agent.
2. **Infrastructure fallback:** body exactly
   `{ "agentId": "<numeric string>", "endpointKey": "<sha256>",
   "validationKind": "protocol" }`. The endpoint key must already belong to the
   agent's current eligible operational declaration; arbitrary URLs are never
   accepted. A fresh/running request is reused when possible. A new request returns
   `202` with `{ schemaVersion: 2, status: "queued" | "running", reused,
   requestId, pollAfterMs }`; a fresh completed result returns `200` with
   `status: "completed", requestId: null`. `requestId` is an opaque, expiring
   application token; the Worker/D1 numeric validation ID is never exposed. Rate
   limits return 429 plus `Retry-After`, and an unavailable validation service returns
   503. The resulting platform observation becomes visible through the normal catalog
   reads; it does not by itself admit the seller or enable hiring.

### `GET /api/marketplace/validate/:requestId`

Polls an infrastructure-fallback request using the opaque `requestId` returned above.
The response is `schemaVersion: 2` plus `status` (`queued`, `running`, `completed`,
`failed` or `cancelled`), `attemptCount`, `createdAt`, `startedAt`, `completedAt`,
`errorCode` and `hasResult`. Expired or tampered tokens return 404. The application
resolves the private Worker status route server-side; browser and MCP clients never
call `/catalog-validations` directly.

## Hire (ERC-8183)

Testnet routes under `/api/marketplace/demo/erc8183/`, Mainnet under
`/api/marketplace/demo/erc8183-mainnet/`. Same request/response contracts; error
messages are labeled per network.

**Environment gating** — when the flow is off these routes answer 404
`ERC8183_SPIKE_DISABLED`: Testnet requires `ERC8183_BROWSER_SPIKE_ENABLED=true` plus a
configured seller origin; Mainnet quote requires the Mainnet demo configuration, and
Mainnet prepare/notify additionally require `ERC8183_MAINNET_WRITES_ENABLED=true` and a
current seller qualification.

### `POST …/quote`

No request body. Response: `NormalizedErc8183Quote`
(`src/business/entities/erc8183-browser-spike.ts`) —
`{ envelope, agentId, chainId, provider, endpoint, commerce, router, policy, token,
tokenSymbol, tokenDecimals, priceRaw, priceDisplay, negotiatedAt, quoteExpiresAt,
description }`. The quote has already passed the allowlist policy
(`src/business/policies/erc8183-spike-policy.ts`): allowlisted seller and contracts,
positive `priceRaw` within the budget ceiling, unexpired. A rejected quote is 409
`ERC8183_QUOTE_REJECTED`. The Mainnet variant adds
`observationSync: { status: "synced" | "duplicate" | "failed" | "not_configured" }`.

Keep the raw `envelope`: `prepare` validates it again server-side.

### `POST …/prepare`

Body: `{ "buyer": "<EVM address>", "quote": <the envelope object> }`. Response:
`Erc8183HirePlan` — `{ quote, buyer, seller, nativeBalanceRaw, tokenBalanceRaw,
allowanceRaw, approvalRequired, approvalAmountRaw, deadline, disputeWindowSeconds,
executeBefore, maximumSignatures, guardrails, transactions }`.

`transactions` is the ordered list of intents the buyer signs:

1. `createJob` (Commerce) — create the job and anchor the signed quote
2. `registerJob` (Router) — bind the allowlisted policy
3. `setBudget` (Commerce) — set the exact quoted budget
4. `approve` (token) — exact amount, only when `approvalRequired`
5. `fund` (Commerce) — move the exact budget into escrow

`guardrails` states the custody model explicitly: `custody: "injected_wallet"`,
`buyerPrivateKeyReceivedByServer: false`, `spendCeilingRaw`,
`approvalMode: "exact_if_required"`, `approvalSpender`,
`cancellationAvailableAfterFunding: false`. Unmet buyer preconditions (policy not
allowlisted, insufficient token balance, no native gas) → 409 `ERC8183_JOB_NOT_READY`.

### `POST …/notify`

Body: `{ "buyer": "<EVM address>", "jobId": "<positive integer string>" }`. Tells the
seller the job is funded. Response: `{ acknowledged: true, alreadySubmitted,
sellerTransactionHash?, job: Erc8183JobFacts }`. Job not in FUNDED state → 409.

### `POST /api/marketplace/hire-events`

Same-origin evidence route used by the browser hire flow; it is not a hiring step and
authorizes nothing. Body: `{ agentId, chainId: 56 | 97, phase, jobId, txHash }` where
`phase` is `clicked` (with `jobId` and `txHash` `null`) or `created`, `funded`,
`submitted` (both required). The route validates the closed contract, drops every
request context (no IP, session or headers reach storage) and forwards the event to
the observation Worker, which verifies chain phases by RPC — receipt, Commerce event
for that job, current job state and the agent's registry wallet — before storing them
under the idempotent key `chainId:txHash:phase`. Response: `{ persistence }` with
`recorded` (201), `duplicate` (200), `rejected` (409, the chain does not support the
claim), or `failed` / `not_configured` (202, nothing stored). Track and Result keep
reading BSC directly; this route never becomes their source.

## Track / Result

### `GET /api/marketplace/jobs/testnet/[jobId]`

Response: `{ liveStatus: "verified" | "unavailable", job: Erc8183JobFacts | null,
snapshot: PublicJobProofSnapshotRecord | null, verifiedPhases: VerifiedHireEvent[],
buyerIdentity: BuyerIdentity }`.
When the live chain read is unavailable but a stored snapshot exists, the
snapshot is served with `liveStatus: "unavailable"`.

`buyerIdentity` is what the marketplace can honestly say about the buyer
address: `{ kind: "demo_agent" | "unknown", agentId: string | null, verified:
boolean, registry: address | null }`. `demo_agent` means the buyer is the
declared demo agent-buyer wallet (`src/business/entities/demo-agent-buyer.ts`);
`verified` is true only when that wallet declares an ERC-8004 agent id and the
registry's `getAgentWallet` (or `ownerOf`) read from chain equals the buyer.
`unknown` claims nothing; human-initiated jobs render exactly as before.

`verifiedPhases` lists this job's hire phases that the observation Worker
verified on BSC Testnet for the allowlisted seller agent, newest first:
`{ chainId: 97, agentId, phase, jobId, txHash, blockNumber, occurredAt (block
time, ISO), verifiedAt }`. Empty when no phase was reported or the Worker feed
is unavailable; the rest of the response is unchanged either way.

`Erc8183JobFacts`: `{ chainId, jobId, buyer, provider, evaluator, policy, description,
budgetRaw, deadline, status: "OPEN" | "FUNDED" | "SUBMITTED" | "COMPLETED" |
"REJECTED" | "EXPIRED", submittedAt, deliverableHash, deliverableUrl, result,
quotedToken, quotedPriceRaw, quoteExpiresAt }` — read from chain.

### `GET /api/marketplace/jobs/mainnet/[jobId]`

Response: `{ "job": Erc8183JobFacts }`. Only the allowlisted demo job is visible;
others → 404 `ERC8183_DEMO_JOB_NOT_FOUND`.

### `GET /api/marketplace/proofs/jobs/514`

The public Testnet proof (browser-signed Job #551 lineage). Response:
`PublicJobProofRecord` (`src/data/proofs/public-job-proof-record.ts`):
`{ schemaVersion: 1, snapshot, live }` — the snapshot preserves per-phase transaction
hashes with `provenance: "onchain:bsc-testnet"` and a `fixture` block that explicitly
labels test infrastructure; `live` re-verifies against the chain
(`status: "verified" | "mismatch" | "unavailable"` with per-check booleans).

### `GET /api/marketplace/proofs/jobs/mainnet/[jobId]`

Response: `MainnetJobProof` (`src/business/entities/mainnet-job-proof.ts`) —
`{ schemaVersion: 1, capturedAt, chainId: 56, agentId, jobId, buyer, seller, token,
budgetRaw, finalState, deliverableHash, resultHashVerified,
deterministicResultVerified, durationSeconds, totalGasCostWei, transactions }`, each
transaction with hash, block, timestamp, gas figures, `explorerUrl` and
`provenance: "onchain:bsc-mainnet-rpc"`. Only the stored primary proof's jobId
resolves; others → 404.

## Seller-side surface (not marketplace consumption)

These belong to the **seller's A2A protocol interface**; buyers talk to them through
the hire flow above, not directly:

- `GET /.well-known/agent-card.json` and `GET /grid/.well-known/agent-card.json` —
  A2A agent cards (`protocolVersion "0.3.0"`, JSONRPC transport, skills
  `negotiate-erc8183-job` / `negotiate` / `notify_funded`).
- `POST /api/sellers/grid/a2a` and `GET /api/sellers/grid/job/[jobId]/response` — the
  Mainnet Grid seller's JSON-RPC `message/send` endpoint and deliverable fetch,
  env-gated, rate limited.

## Not part of the public contract

- `POST /api/marketplace/agents/[agentId]/observations/browser` — internal ingestion
  of browser-reported validation evidence (strict 13-key contract, cross-checked
  against the agent's declared endpoints). Not for external callers.
- `app/api/fixtures/erc8183/**` — test infrastructure for the Testnet spike; the
  proof records label it `testInfrastructure: true`.
- Worker `GET /hire-events?chainId=56|97&agentId=…` — the upstream feed behind
  `checks.hireActivity` and `verifiedPhases` (chain-verified rows only, at most
  50, cached 30 s). Like `/catalog-agents`, it is an internal upstream of this
  API, reached server-side through `OBSERVATIONS_URL`; consume the routes above.

Response shapes on the public routes above are covered by
`tests/marketplace-controllers.test.ts`, `tests/erc8183-spike-controllers.test.ts` and
`tests/hosted-seller-controllers.test.ts`; changes to them are breaking-change reviews,
not refactors.

## Connect an agent (MCP)

The marketplace exposes this API as five MCP tools (`search_agents`, `get_passport`,
`compare_agents`, `request_quote`, `get_job_status`) over two transports. Both are
thin wrappers over the routes above — same contracts, same non-claims. The hire flow
a programmatic buyer executes after `request_quote` is specified in
`docs/HIRE-SPEC.md`.

- **Remote (Streamable HTTP)** — `POST /api/mcp` on the production origin. Stateless:
  no session ids, each JSON-RPC message is a self-contained request; `GET`/`DELETE`
  answer `405`. Connect from any MCP client, e.g.
  `claude mcp add --transport http marketplace https://marketplace.trust8004.xyz/api/mcp`.
  The endpoint's tools call the marketplace API at its configured origin
  (`MARKETPLACE_ORIGIN`, defaulting to the production origin) — never the request's
  own `Host` header, so the upstream cannot be redirected by callers.
- **Local (stdio)** — run `npm run mcp` from the repo (or use the checked-in
  `.mcp.json` with Claude Code). Targets the production origin by default; set
  `MARKETPLACE_ORIGIN` to point elsewhere (useful against a local dev server).

Remote availability of these tools is discovery and quoting only: every agent in the
catalogue is searchable and comparable, but hiring remains gated by the signed-quote
allowlist — MCP reachability never implies ERC-8183 hireability.
