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

Gate 1 passed on BSC Testnet on 2026-08-13. The controlled seller fixture was
registered as ERC-8004 Agent ID `1815`, and ERC-8183 Job ID `514` completed the
buyer flow through onchain `SUBMITTED`. The test used one raw `$U` unit and
separate buyer/seller testnet wallets.

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

The published SDK `0.5.0` Testnet policy preset was no longer whitelisted by
the active Router during the spike. Gate 1 pins the observed active policy
`0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA` and verifies its whitelist status
onchain during every preflight before any buyer write.

TWAK is not an ERC-8183 or A2A requirement. The buyer calls the SDK's generic
`ERC8183Client` through an injectable wallet factory; Gate 1 uses
`EVMWalletProvider` with an existing encrypted Keystore V3 by default. A future
TWAK factory can be added without changing the buyer protocol or lifecycle.

## BSC candidate inventory

The read-only `Trust8004Provider` uses the public trust8004 API as the sole
catalogue source. It is locked to BSC Mainnet (`chainId=56`), validates every
response at runtime, normalizes declared services, and labels catalogue
coverage as a partial snapshot. Declared tools and derived categories are
candidate evidence, not verified capabilities. Financial facts, critical
identity, and ERC-8183 state remain direct BSC reads outside this adapter.

Generate the local, Git-ignored inventory with:

```bash
npm run inventory:bsc
```

The public API currently does not provide catalogue-completeness guarantees,
an API/schema version, ERC-8183 hireability, quote/payment data, or direct-chain
verification proofs. Persisted endpoint observations may also be absent. The
provider preserves those gaps instead of inventing values and limits calls with
request deduplication, a simple cache, and sequential pacing below 60 requests
per minute.

Generate a separate read-only evidence report with:

```bash
npm run verify:bsc
```

The verifier compares trust8004 identity fields with `ownerOf` and `tokenURI`
at one pinned BSC Mainnet block, then performs MCP `initialize` and `tools/list`
against each declared public endpoint. It never calls a tool. Observed tool
names prove only that the endpoint exposed them at that timestamp; they do not
prove functional execution or ERC-8183 hireability. The report is written to
`.marketplace/verification/bsc-candidates.json`. Exit code `2` means the report
was written but contains a mismatch, unavailable evidence, or declared/observed
tool drift; exit code `1` is reserved for fatal catalogue, RPC, or output errors.

Run the final pre-frontend readiness gate with:

```bash
npm run readiness:bsc
```

It combines a fresh trust8004 snapshot, direct BSC Mainnet identity reads,
declared-protocol activation checks, and a fresh BSC Testnet verification of
Gate 1 Job `514`. A2A and HTTP ERC-8183 are probed only when explicitly
declared; MCP-only agents are never presented as hireable. A declared seller
must return a signed quote whose provider, chain, Commerce contract, and
payment token validate before receiving `quote_verified`.

The report is written to
`.marketplace/readiness/bsc-marketplace.json`. `frontendReady=true` means the
marketplace can represent the available evidence honestly and the buyer proof
still validates onchain; it does not mean all categories have a live seller.
Current real-agent activation coverage is empty, and Grid remains explicitly
empty/unverified.

See:

- [ERC-8183 Gate 1 interaction diagram](diagrams/erc8183-gate1-flow.html)
- [MVP scope](docs/MVP_SCOPE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Reuse and provenance](docs/REUSE_AND_PROVENANCE.md)
- [Decision log](docs/DECISIONS.md)

## License

[MIT](LICENSE)
