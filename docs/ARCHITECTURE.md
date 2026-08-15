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
