# Architecture

## System boundary

```text
                    BSC / ERC-8004
                           │
                           │
                  trust8004 public APIs
              partial index + enrichment
                           │
                Marketplace Data Layer
            normalize + verify + categorize
                           │
                     Web Product
              discover + compare + hire
                           │
                    @bnbagent/sdk
                           │
              ERC-8183 quote/job/result
```

## Data provider contract

The product must not query the trust8004 database directly. trust8004 is the
only catalogue source in the active design; there is no external catalogue
fallback or marketplace indexer.

```ts
interface AgentDataProvider {
  listAgents(filters: AgentFilters): Promise<AgentListPage>
  getAgent(chainId: number, agentId: string): Promise<MarketplaceAgent>
}
```

Initial providers:

- `Trust8004Provider`: read-only, BSC-only catalogue snapshot containing indexed identity,
  declared metadata/services, reputation, trust score, and any persisted endpoint observation.
- Direct BSC readers, outside the catalogue adapter: critical identity, contract
  configuration, financial facts, and ERC-8183 job state.

The provider validates public API responses at runtime, normalizes `services`
from either JSON strings or arrays, and paces cached/deduplicated requests below
the public 60 requests/minute limit. Its `catalogCoverage` is always `partial`.
Missing observations remain `not_observed`; declared tools are never promoted
to verified capabilities. Comparison is not fetched because it adds no field
needed by the current inventory and would consume public quota.

## Frontend application layers

The Gate 5 web application uses one-way dependencies:

```text
app/** + components/** + src/presentation/**
                    ↓
             src/business/**
                    ↓
               src/data/**
```

Route Handlers validate HTTP input, invoke exactly one composed use case, and
map known errors. They do not import data providers. Server Components may
invoke the same business use cases directly; client presentation never calls
trust8004 or an RPC endpoint.

`ListMarketplaceAgents` has two explicit modes. `all` delegates page, limit,
search, and supported ordering to one trust8004 list request and marks every
record `not_evaluated`. `marketplace` resolves only the four IDs in the
versioned curated manifest, deduplicates multi-label agents, and applies the
four marketplace categories. No request classifies or enriches the complete
BSC snapshot.

`GetMarketplaceAgent` fetches one full trust8004 profile after navigation and
attaches a separately sourced direct BSC identity check. `GetPublicJobProof`
reads the versioned sanitized Job `514` snapshot and a cached direct Testnet
observation. These evidence sources remain structurally separate.

## Read-only verification layer

The BSC verification CLI consumes a fresh partial catalogue snapshot but writes
a separate evidence report. It does not mutate the provider's declared data.

```text
trust8004 declared snapshot ─┐
                            ├─ evidence report: declared / observed / onchain
BSC ownerOf + tokenURI ─────┤
MCP initialize + tools/list ┘
```

All identity reads share a pinned BSC Mainnet block. MCP discovery is limited
to one endpoint per agent and a bounded run budget, accepts only public HTTPS
addresses, stays on the validated origin, and never sends `tools/call`. Skipped
declarations are `not_probed`, not failed observations. Tool-list drift and
identity mismatches require attention but are preserved as evidence instead of
being reconciled automatically. ERC-8183 hireability remains outside this
verifier.

## Pre-frontend readiness gate

The readiness CLI composes, but does not collapse, the catalogue and evidence
layers:

```text
trust8004 partial catalogue ──┐
BSC Mainnet identity/MCP ─────┼─ readiness report ─ frontendReady
declared A2A or ERC-8183 HTTP ┤
BSC Testnet Gate 1 proof ─────┘
```

Seller probes are driven only by declared services. A2A requires the official
negotiation and `notify_funded` skills; HTTP uses the official ERC-8183
health/status/negotiate route family. The transports are assessed independently
and no adapter is inferred. A signed quote is checked against the direct
ERC-8004 agent wallet and BSC Mainnet Commerce configuration. MCP alone remains
`mcp_only`.

Frontend readiness means the evidence is complete enough to render without
inventing capabilities and the existing buyer lifecycle still has valid
onchain proof. Real-seller activation coverage is reported separately and may
remain partial or empty.

## Evidence model

Every important field records its provenance:

| Evidence class | Example |
|---|---|
| Onchain fact | Identity owner, job status, budget |
| Self-declared | Name, description, claimed skill |
| Observed | Endpoint response, tools discovered |
| Derived | Category confidence, hireability state |
| Performance | Completed job, delivery time, dispute |

## Hiring lifecycle

```text
Resolve ERC-8004 identity
→ Resolve and verify A2A endpoint
→ Request signed quote
→ createJob
→ registerJob
→ setBudget
→ approve/fund in $U
→ notify_funded
→ monitor onchain state
→ fetch deliverable at SUBMITTED
→ settle or dispute according to policy
```

The buyer keeps custody. The server may resolve, negotiate, and monitor, but cannot sign financial transactions for the user.

## Gate 6A browser-wallet boundary

The experimental `/spikes/erc8183-browser` route preserves the same three
layers while splitting execution by custody boundary:

```text
Browser presentation
  -> Business: quote / prepare / notify / status use cases
  -> Data server: fixed-origin A2A + SDK quote verification + chain reads

Browser presentation
  -> Business client composition
  -> Data browser: injected EIP-1193 + viem + minimal official ABIs
```

`@bnbagent/sdk@0.5.0` is not imported by Client Components. Its installed
ERC-8183 entry targets Node, accepts the SDK `WalletProvider` rather than an
EIP-1193 provider, and reaches filesystem-backed wallet/storage modules. The
server retains ERC-8004 resolution, A2A negotiation, quote signature checks,
`notify_funded`, deliverable verification, and tracking. The browser adapter
has exactly five possible writes: `createJob`, `registerJob`, `setBudget`, an
exact `approve` when necessary, and `fund`.

The route is false by default and fixed to BSC Testnet chain `97`, hosted
fixture Agent `1866`, its registered seller wallet, canonical
Commerce/Router/token addresses, and the active Router-allowlisted policy. The
seller origin is a server-only bare HTTPS allowlist value and must match current
ERC-8004 discovery. Reload recovery treats the sanitized local journal as a
locator only; receipts and current chain state determine completion.

### Hosted Testnet seller fixture

The replacement seller runs as three public Node.js route handlers on Vercel:

```text
GET  /.well-known/agent-card.json
POST /api/fixtures/erc8183/a2a
GET  /api/fixtures/erc8183/job/{jobId}/response
```

Each route remains a thin controller over a business use case and a dedicated
server-only repository. The seller key is read only from `SELLER_PRIVATE_KEY`,
validated against the fixed Testnet seller address, and never enters shared
composition or client bundles. Negotiation and notification are public; trust
comes from signed quotes, fixed contracts, the one-raw-unit budget, direct job
state validation, and idempotent submission rather than a bearer credential.

No external deliverable store is required for the deterministic fixture. The
response body is regenerated from the job ID and fixed contract set, and it is
served only when its canonical manifest hash matches the submitted onchain
deliverable. The old Agent `1815` remains historical evidence. The replacement
is Agent `1866`, registered after the public hosted endpoint passed deployment
and signed-quote checks.

## Gate 6B Testnet demo boundary

Gate 6B replaces the experimental route as the visible entry point without
changing the custody or protocol boundaries proven in Gate 6A:

```text
/demo/erc8183
  -> marketplace demo controllers
  -> quote / prepare / notify use cases
  -> fixed Agent 1866 A2A + BSC Testnet contracts

/jobs/testnet/{jobId}
  -> one tracking use case
  -> direct chain state + optional versioned sanitized proof
  -> browser journal used only for matching local transaction links
```

The Mainnet catalogue uses `chainId=56`; the controlled seller fixture uses
Testnet `chainId=97`. They therefore remain separate URL and entity spaces.
Agent `1866` is never inserted into trust8004 catalogue results, curated
categories, comparison, or `/hire/[agentId]`.

Job tracking accepts only jobs whose provider, evaluator, policy, quoted token,
and budget match the fixed Testnet allowlist. Direct contract state is
authoritative. A versioned snapshot keeps Job `551` available when the live RPC
or demo feature flag is unavailable, while an unversioned job receives no
invented fallback. The local journal remains schema-versioned and sanitized;
it can add transaction links for the matching browser but cannot establish job
state.

## Gate 6C Mainnet seller qualification boundary

Gate 6C is read-only and does not connect the Testnet demo to marketplace
profiles. It evaluates the four versioned candidates plus at most 20 explicit
operator-supplied Agent IDs:

```text
curated manifest + explicit Agent IDs
  -> bounded trust8004 profile reads
  -> one pinned BSC Mainnet identity snapshot
  -> probes only declared A2A / HTTP ERC-8183 services
  -> signed quote + official contract/policy checks
  -> local sanitized qualification report
```

No list or FTS request selects qualification targets. An explicit ID remains
`operator_explicit`, receives no curated category, and cannot increase category
coverage until a later reviewed manifest change. Grid therefore stays empty
unless deliberately curated evidence is added.

`quote_verified` records a signed quote that is also valid when the report is
finalized. A quote that expires during later probes becomes `expired_quote`;
its signed payload remains historical evidence but cannot qualify a seller.
The stricter `qualified` state additionally requires matching direct ERC-8004
identity, BSC Mainnet chain and Commerce/payment-token configuration, and an
allowlisted Router policy. The CLI never creates or funds a job, calls
`notify_funded`, or changes `/hire`. Provider/schema failures are visible and
do not overwrite the previous atomic report.

Seller HTTP is constrained by a server-only transport. It resolves each HTTPS
origin once, rejects private, mapped, translated, and other non-global IP
addresses, pins the validated addresses for the actual connection while
retaining the original TLS hostname, rejects redirects, and closes its
dispatcher after the probe. MCP, A2A, and HTTP ERC-8183 response bodies are
cancelled incrementally above 64 KiB after decompression. Quotes are bound to
the canonical SDK request hash, must be no more than 60 seconds old, and cannot
exceed the SDK's 900-second TTL.

MCP and seller assessment share one 180-second deadline and a combined ceiling
of 72 external endpoints. MCP is capped at one endpoint per agent and 24 per
run. Seller probing remains capped at one endpoint per supported transport,
two per agent, and 48 per run. Skipped declarations are retained as
`not_probed`; their presence sets `probe_incomplete` unless another seller
endpoint already produced a verified quote. Per-category quote evidence and
fully identity-qualified sellers are reported in separate fields.

Readiness schema `3` exposes manifest categories as `candidate.categories` and
keeps non-authoritative profile heuristics in `profileDerivedCategories`.
Explicit IDs therefore remain uncategorized. Quote contract context separates
SDK-configured Commerce, Router, and policy addresses from payment-token and
allowlist values observed by RPC, including the observation block and
timestamp.

## Submission evidence and gated Mainnet path

The frontend never reads the Git-ignored operator verification report. A
release command validates report schema `2`, enforces a 72-hour maximum age,
removes endpoint URLs, payloads and error details, and writes the versioned
`bsc-candidates-public.json` snapshot. Cards and profiles receive this evidence
through the marketplace repository; the methodology page receives it through
one business use case. `not_probed` remains distinct from observed absence.

The Vercel deployment build first runs `readiness:bsc` and
`publish:verification`, then applies the normal freshness gate and application
build. This keeps the runtime independent of the operator report while ensuring
each deployment embeds a newly sanitized snapshot; an unavailable live source
or expired artifact stops the deployment.

The landing composes its four category counts, candidate names and drift cards
from that sanitized release snapshot. It performs no live profile fan-out.
The paginated registered catalogue and deliberately opened profiles remain
live trust8004 reads; a known upstream timeout becomes a retryable presentation
state while the API continues returning a diagnostic `503`. The snapshot is
never used to fabricate registered rows, profile fields or current commercial
qualification.

The optional Mainnet path reuses the custody boundary proven on Testnet but has
its own flags, journal key, routes, allowlist and public configuration:

```text
/demo/erc8183-mainnet
  -> Mainnet quote / prepare / notify use cases
  -> fixed marketplace-operated Grid Agent and production origin
  -> official BSC Mainnet Commerce / Router / policy / U token
  -> injected EIP-1193 wallet signs buyer writes

/grid/.well-known/agent-card.json
  -> thin controller -> deterministic Grid seller business policy
  -> `server-only` Production secret -> SDK signer -> submit manifest hash
```

When provisioned, `MAINNET_SELLER_PRIVATE_KEY` exists only as a Sensitive
Production Vercel variable. Preview and Development have no copy, no
`NEXT_PUBLIC_` variant exists, and client dependency tests reject any import path
to its loader.

The already-operated Testnet seller uses the separate `SELLER_PRIVATE_KEY`, also
Sensitive and Production-only. Preview does not need that key: its buyer routes
are enabled against the fixed Production-hosted Testnet Agent `1866`, so Preview
can request and validate quotes and prepare the injected-wallet intents without
crossing the seller secret boundary.

No browser input can select a seller URL, Agent ID, token, policy or contract.
Seller A2A calls use the shared DNS-pinned, redirect-rejecting and 64 KiB
bounded transport. The quote must bind to the canonical Grid request, be at
most 60 seconds old, expire within the SDK 900-second ceiling, match the
registered ERC-8004 agent wallet, and pass direct token/policy checks.

Mainnet writes remain disabled until `mainnet:go-no-go` records a fresh `GO`.
That report must observe the fixed production Grid Agent Card through the
DNS-pinned, redirect-rejecting, body-capped transport and match its message URL
and negotiation/notification skills; checking only the configured origin text
is insufficient.
The recorded read at block `117722575` remained `NO_GO` solely because the
dedicated seller address, minimum gas balance and production origin were not configured. Browser
writes are simulated immediately before each signature. After the seven-day
policy window, `mainnet:settle-grid-job` validates provider, evaluator, policy,
state and deliverable before its separate explicit `--execute` settlement.

Once registered, `ERC8183_MAINNET_SELLER_AGENT_ID` adds exactly that known ID
to the Grid readiness target and curated UI inventory. It does not classify,
scan or enrich the global trust8004 catalogue. The model labels the seller as
`marketplace` operated and never as an official BNB reference agent.

## Independence requirements

- Financial facts and ERC-8183 state come from chain.
- Marketplace job references survive a trust8004 outage.
- Provider failures degrade individual evidence, not the whole identity record.
- No duplicate full indexer in the MVP.
- Catalogue completeness is unknown and must be shown as a partial snapshot.
- Shared packages are extracted only after stable duplication appears.
