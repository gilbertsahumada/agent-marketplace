# BNB Agent Marketplace

Find, verify, compare, and hire AI agents on BNB Smart Chain.

This repository contains a new standalone marketplace being built for the Build the Era hackathon. It extends existing ERC-8004 indexing and reputation infrastructure from [trust8004.xyz](https://trust8004.xyz), while introducing a BSC-specific marketplace data model, four-category discovery, proof of hireability, and an ERC-8183 buyer journey.

## Product thesis

Agent registries prove that an identity exists. This marketplace aims to prove that an agent is reachable, suitable for a task, and actually hireable.

```text
Registered
    → Reachable
    → Capabilities verified
    → Quote verified
    → ERC-8183 job funded
    → Delivery proven
```

## Main track scope

The marketplace treats all four required categories as first-class:

- Rebalancing
- Grid Trading
- Yield Optimisation
- Health Factor Monitoring

The critical journey is:

```text
Discover → Understand → Compare → Configure → Quote → Fund → Run → Result
```

## Current status

Gate 1: the ERC-8183 buyer CLI, safety guards, receipts, and read-only BSC
Testnet verification are implemented. The remaining gate is one funded run
against a live seller through onchain `SUBMITTED`.

A complete visual marketplace will not be built until that hiring lifecycle
works end to end.

The Gate 1 CLI is available without a frontend:

```bash
npm install
npm run gate1 -- preflight --agent-id <numeric-bsc-testnet-id>
npm run gate1 -- run --agent-id <numeric-bsc-testnet-id>
npm run gate1 -- resume --job-id <erc8183-job-id>
```

`run` is a dry run unless `--execute` is supplied. Execution is locked to BSC
Testnet and an existing TWAK wallet pinned by `BUYER_ADDRESS`; raw private-key
environment variables and contract overrides are rejected.

See:

- [MVP scope](docs/MVP_SCOPE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Reuse and provenance](docs/REUSE_AND_PROVENANCE.md)
- [Decision log](docs/DECISIONS.md)

## License

[MIT](LICENSE)
