# MVP Scope

## Core problem

A BSC user cannot easily find an appropriate agent, determine whether it actually works, and hire it through a comprehensible onchain workflow.

## Core user

A DeFi user who understands the outcome they want but does not need to understand Agent Studio, ERC-8004, A2A, MCP, or ERC-8183.

## Success criteria

1. A new user can choose one of four required categories and understand viable candidates.
2. Agent claims are separated from marketplace observations and onchain facts.
3. At least one real ERC-8183 journey completes from quote through `SUBMITTED`.
4. All four categories have equivalent discovery, profile, comparison, and activation depth.
5. The application is publicly accessible and survives reload during an active job.

## In scope

- BSC Mainnet catalogue and BSC Testnet development environment.
- Rebalancing, Grid Trading, Yield Optimisation, and Health Factor Monitoring.
- A read-only trust8004 catalogue adapter and separate direct onchain verification.
- Multi-label category evidence.
- Endpoint and capability verification.
- Proof-of-hireability states.
- Category pages, agent profiles, comparison, hire flow, and My Jobs.
- ERC-8183 negotiation, quote review, job creation, budget, funding, notification, and result tracking.
- Public deployment and repeatable judging demo.

## Explicitly out of scope

- Partner tracks.
- Multichain marketplace support.
- A replacement ERC-8004 indexer in this repository.
- Four proprietary agents.
- Custody of buyer funds or private keys.
- Social feed, likes, token, DAO, or a new reputation protocol.
- A full trading terminal.
- Claims or guarantees of financial return.

## Conditional scope

A minimal Grid Trading seller may be built only if no existing live agent can satisfy the required category and that absence blocks the end-to-end demo.

## Gates

1. Repository and provenance.
2. ERC-8183 buyer spike.
3. BSC data baseline.
4. Four-category verification.
5. Marketplace end to end.
6. Public submission.

The full frontend does not begin until the buyer spike demonstrates real hiring.
