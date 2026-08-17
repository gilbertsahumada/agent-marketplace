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
to safe public HTTPS endpoints, stays on the validated origin, and never sends
`tools/call`. Tool-list drift and identity mismatches require attention but are
preserved as evidence instead of being reconciled automatically. ERC-8183
hireability remains outside this verifier.

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

## Independence requirements

- Financial facts and ERC-8183 state come from chain.
- Marketplace job references survive a trust8004 outage.
- Provider failures degrade individual evidence, not the whole identity record.
- No duplicate full indexer in the MVP.
- Catalogue completeness is unknown and must be shown as a partial snapshot.
- Shared packages are extracted only after stable duplication appears.
