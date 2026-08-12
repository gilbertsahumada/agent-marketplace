# Agent Development Guidelines

## Objective

Build the BSC marketplace journey required by the Build the Era main track:

```text
Discover → Understand → Compare → Hire → Track → Result
```

## Scope guardrails

- Keep all four required categories first-class.
- Treat ERC-8183 hiring as the critical path.
- Reuse trust8004 through APIs, never direct database access.
- Resolve financial facts and job state from chain.
- Do not build a full frontend before the buyer spike passes.
- Do not build four proprietary agents.
- Build a fallback seller only when a missing category blocks judging.
- Partner tracks, multichain support, social features, and a new reputation protocol are out of scope.

## Provenance

Always distinguish:

- pre-existing trust8004 infrastructure;
- upstream BNB Agent SDK functionality;
- third-party 8004scan data;
- code and product work created in this repository.

Never describe a candidate agent as an official reference agent without a published BNB source.

## Quality rules

- Separate onchain facts, self-declared metadata, observed capabilities, derived scores, and job performance.
- Never equate MCP/A2A availability with ERC-8183 hireability.
- Keep wallet interactions non-custodial.
- Show token, allowance, budget, deadline, and transaction intent before signatures.
- Every primary CTA must have a functional destination.
- Preserve source timestamps and transaction hashes.

## Change discipline

- Update `docs/DECISIONS.md` for material scope or architecture changes.
- A new MVP feature must state which existing item is removed or which gate is delayed.
- Run the relevant tests and production build before merging application changes.
