# Architecture

## System boundary

```text
                    BSC / ERC-8004
                           │
              ┌────────────┴────────────┐
              │                         │
      trust8004 APIs              8004scan API
      index + enrichment          coverage fallback
              │                         │
              └────────────┬────────────┘
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

The product must not query the trust8004 database directly.

```ts
interface AgentDataProvider {
  listAgents(filters: AgentFilters): Promise<MarketplaceAgent[]>
  getAgent(chainId: number, agentId: string): Promise<MarketplaceAgent>
  getReputation(chainId: number, agentId: string): Promise<ReputationSummary>
  getCapabilities(chainId: number, agentId: string): Promise<VerifiedCapabilities>
}
```

Initial providers:

- `Trust8004Provider`: indexed identity, metadata, reputation, and observed endpoint data.
- `Scan8004Provider`: coverage fallback and candidate discovery.
- `OnchainProvider`: owner, identity, contract configuration, and ERC-8183 job state.

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
- Shared packages are extracted only after stable duplication appears.
