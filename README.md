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

Gate 1 can use the included controlled seller fixture instead of waiting for a
third-party seller. It is test infrastructure derived from the official BNB
Agent SDK A2A example; it is not a marketplace agent or an official reference
agent. It requires an existing encrypted seller keystore and a temporary public
HTTPS URL:

```bash
npm run gate1:seller -- serve
npm run gate1:seller -- register
```

The Gate 1 CLI is available without a frontend:

```bash
npm install
npm run gate1 -- preflight --agent-id <numeric-bsc-testnet-id>
npm run gate1 -- run --agent-id <numeric-bsc-testnet-id>
npm run gate1 -- resume --job-id <erc8183-job-id>
```

`run` is a dry run unless `--execute` is supplied. Execution is locked to BSC
Testnet and an existing encrypted EVM keystore pinned by `BUYER_ADDRESS`;
raw private-key environment variables, wallet auto-creation, and contract
overrides are rejected. Supply `BUYER_WALLET_PASSWORD` through an external
secret mechanism only.

TWAK is not an ERC-8183 or A2A requirement. The buyer calls the SDK's generic
`ERC8183Client` through an injectable wallet factory; Gate 1 uses
`EVMWalletProvider` with an existing encrypted Keystore V3 by default. A future
TWAK factory can be added without changing the buyer protocol or lifecycle.

See:

- [MVP scope](docs/MVP_SCOPE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Reuse and provenance](docs/REUSE_AND_PROVENANCE.md)
- [Decision log](docs/DECISIONS.md)

## License

[MIT](LICENSE)
