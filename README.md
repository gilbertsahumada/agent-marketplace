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

Gate 5 now provides the read-only Frontend MVP. It covers discovery,
evidence-aware profiles, comparison, an honest hiring eligibility shell, and
the public Job `514` proof.

Gate 6A passed on 2026-08-19. A human-controlled injected EIP-1193 wallet
signed all five allowlisted buyer operations for Job `551`; hosted fixture
Agent `1866` then submitted a hash-verified result. The buyer key never reached
the server. Job `551` is now the primary public non-custodial proof, while Job
`514` remains historical Gate 1 evidence.

Gate 6B promotes that hardened flow to the controlled `/demo/erc8183` journey
and adds direct-chain tracking at `/jobs/testnet/{jobId}`. The demo remains
disabled by default, Testnet-only, and separate from the BSC Mainnet catalogue.
It does not enable Hire for MCP-only marketplace candidates. The former
`/spikes/erc8183-browser` URL redirects to the demo when enabled.

The tunnel-based Agent `1815` remains historical Gate 1 evidence. Gate 6A now
uses a replacement public hosted seller fixture backed by a Testnet-only
server secret. Agent `1866` exposes a public Agent Card, A2A negotiation, and
deterministic deliverable routes at the production marketplace origin. Its
registration transaction is
`0x166cdb89f4fb2236d760fcd372db7980d51d473a16f3ab51118eeb024eb61e2a`.

Submission hardening now includes a separate, disabled-by-default BSC Mainnet
path for exactly one marketplace-operated deterministic Grid planner. It is
not an official BNB reference agent and it never executes trades or takes
custody. Its server computes reproducible levels, allocations and rebalance
triggers; the browser retains custody for every buyer write. This path remains
NO-GO until a fresh read-only report verifies the fixed official contracts,
active proxy implementations, `U` token, policy, spend ceiling, dedicated
seller public address and production origin.
The origin check also fetches the Grid Agent Card through the shared
DNS-pinned, redirect-rejecting, 64 KiB transport and verifies both required
seller skills before a report can become `GO`.

```bash
npm run mainnet:go-no-go
npm run mainnet:grid-seller -- register          # dry run
npm run mainnet:grid-seller -- register --execute # explicit Mainnet write
npm run mainnet:settle-grid-job -- <jobId>       # dry run after dispute window
npm run mainnet:settle-grid-job -- <jobId> --execute --evidence ./erc8183-56-job-<jobId>-sanitized.json
npm run mainnet:capture-proof -- <jobId> ./erc8183-56-job-<jobId>-sanitized.json
# Add --publish only after COMPLETED to promote it as /proof/mainnet.
```

The first recorded Mainnet evaluation at block `117715355` was `NO_GO`: all
direct contract and policy checks passed, while the dedicated seller address,
its minimum gas balance and the production origin were not configured. No
Mainnet write was attempted.

Enable the local demo only while the fixture's registered HTTPS endpoint is
running:

```bash
ERC8183_BROWSER_SPIKE_ENABLED=true
ERC8183_BROWSER_SPIKE_SELLER_ORIGIN=https://your-temporary-origin.example
npm run dev
```

The origin and any optional bearer credential are server-only. The browser
never receives a private key, wallet password, mnemonic, or arbitrary seller
URL. See [Gate 6A Browser Wallet Spike](docs/GATE_6A_BROWSER_WALLET_SPIKE.md).

Gate 1 can use the included controlled seller fixture instead of waiting for a
third-party seller. It is test infrastructure derived from the official BNB
Agent SDK A2A example; it is not a marketplace agent or an official reference
agent. It requires an existing encrypted seller keystore and a temporary public
HTTPS URL:

```bash
npm run gate1:seller -- serve
npm run gate1:seller -- register
npm run gate1:seller -- update
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

Before a release, publish only the sanitized verification fields consumed by
the UI. The command rejects stale input and removes endpoint URLs, probe
payloads and errors:

```bash
npm run publish:verification -- --input .marketplace/readiness/bsc-marketplace.json
```

Vercel uses `npm run build:deployment`: it regenerates the bounded readiness
report, publishes the sanitized snapshot, verifies its 72-hour freshness limit,
and only then runs the application build. Local `npm run build` remains a
deterministic check of the already published artifact. An expired snapshot or a
failed live regeneration blocks the deployment.

The verifier compares trust8004 identity fields with `ownerOf` and `tokenURI`
at one pinned BSC Mainnet block, then performs MCP `initialize` and `tools/list`
against at most one declared public endpoint per agent. It never calls a tool. Observed tool
names prove only that the endpoint exposed them at that timestamp; they do not
prove functional execution or ERC-8183 hireability. The report is written to
`.marketplace/verification/bsc-candidates.json`. Exit code `2` means the report
was written but contains a mismatch, unavailable evidence, or declared/observed
tool drift; exit code `1` is reserved for fatal catalogue, RPC, or output errors.
Verification report schema `2` retains declarations skipped by the execution
budget as `not_probed` instead of presenting them as failed observations.

Run the final pre-frontend readiness gate with:

```bash
npm run readiness:bsc
```

Gate 6C reuses this command for bounded, read-only seller qualification. The
four versioned marketplace candidates are always evaluated. Newly indexed
agents can be evaluated explicitly without scanning or classifying the global
catalogue:

```bash
npm run readiness:bsc -- --agent-id <bsc-mainnet-agent-id>
```

`--agent-id` may be repeated for up to 20 additional IDs. Explicit IDs are
reported as `operator_explicit`; they are not assigned a marketplace category,
added to the curated manifest, or enabled in `/hire` automatically.

It combines bounded trust8004 profile reads, direct BSC Mainnet identity reads,
declared-protocol activation checks, and a fresh BSC Testnet verification of
Gate 1 Job `514`. A2A and HTTP ERC-8183 are probed only when explicitly
declared; MCP-only agents are never presented as hireable. A declared seller
must return a signed quote whose provider, chain, Commerce contract, and
payment token validate before receiving `quote_verified`. A seller receives
`qualified` only when its direct ERC-8004 identity also matches and the
configured Mainnet policy remains allowlisted. Quotes are never funded by this
command. The returned quote must bind to the exact canonical readiness request,
be observed within 60 seconds, and use no more than the SDK's 900-second TTL.
Public seller connections pin the DNS addresses validated before the request,
reject IPv4-mapped and other non-global IPv6 ranges, and cancel MCP, A2A, or
HTTP ERC-8183 response bodies above 64 KiB after decompression.

Qualification uses one shared 180-second protocol budget. It evaluates at most
one MCP endpoint per agent and 24 per run, plus one declared endpoint per seller
transport, two seller endpoints per agent, and 48 seller endpoints per run. The
combined ceiling is 72 endpoints. Any omitted endpoint is reported as
`not_probed`; incomplete probes remain visible and cannot silently become
qualification evidence.

Readiness report schema `3` makes the versioned manifest the sole authority for
candidate `categories`; current profile heuristics remain separately visible as
`profileDerivedCategories`. SDK-configured contract addresses and direct RPC
payment-token/policy observations have separate provenance. A quote that
expires before report finalization remains historical evidence but no longer
counts toward qualification or category coverage.

The report is written to
`.marketplace/readiness/bsc-marketplace.json`. `frontendReady=true` means the
marketplace can represent the available evidence honestly and the buyer proof
still validates onchain; it does not mean all categories have a live seller.
Current third-party activation coverage is empty. Grid remains explicitly
empty until a marketplace-operated seller is registered and qualified; setting
`ERC8183_MAINNET_SELLER_AGENT_ID` deliberately adds only that ID to the Grid
readiness target and never classifies the global catalogue. A trust8004 outage or invalid schema fails visibly and does
not replace the previous atomic local report with stale or invented evidence.

Run the web product locally with:

```bash
npm run dev
```

`/agents` defaults to the curated marketplace candidates. Switch to
`/agents?view=all&page=1&limit=24` to browse the trust8004 BSC snapshot through
server-side pagination. This mode performs one list request per uncached page;
it does not download the full catalogue or fetch a profile for every card.

## Submission demo runbook

The public deployment is
[bnb-agent-marketplace-ruby.vercel.app](https://bnb-agent-marketplace-ruby.vercel.app).
The shortest judgeable path uses only public pages until the optional wallet
step:

1. **Discover:** open the [landing page](https://bnb-agent-marketplace-ruby.vercel.app/)
   and inspect the four equally visible categories and the evidence line.
2. **Understand:** open [Agent 45650](https://bnb-agent-marketplace-ruby.vercel.app/agents/45650)
   and verify that declared metadata, direct identity reads, derived trust, and
   endpoint observations remain separate.
3. **Compare:** compare [V3 Pools, Aave, and Venus](https://bnb-agent-marketplace-ruby.vercel.app/compare?agentId=45650&agentId=45381&agentId=43129)
   without an invented universal winner.
4. **Browse:** switch between [curated candidates](https://bnb-agent-marketplace-ruby.vercel.app/agents?view=marketplace)
   and the [paginated registered snapshot](https://bnb-agent-marketplace-ruby.vercel.app/agents?view=all&page=1&limit=24).
   Registered records remain `Not evaluated`; Grid remains explicitly empty.
5. **Hire:** open the [controlled Testnet demo](https://bnb-agent-marketplace-ruby.vercel.app/demo/erc8183)
   and request a live signed quote. This first action performs no transaction
   and requests no wallet access.
6. **Track and result:** inspect [Job 551](https://bnb-agent-marketplace-ruby.vercel.app/jobs/testnet/551),
   its five browser-signed buyer transactions, seller submission, current
   onchain state, and hash-verified public result.

Repeating the wallet portion is optional because Job `551` is durable public
evidence. A repeat requires an injected wallet on BSC Testnet (`chainId=97`),
Testnet tBNB for gas, Testnet `U`, and at most five sequential confirmations.
Every contract, token, amount, allowance, deadline, and transaction purpose is
shown before signing. Never use a Mainnet wallet or Mainnet funds.

The controlled Agent `1866` is testing infrastructure, not a marketplace agent
or official BNB reference agent. The four current Mainnet candidates remain
MCP-only, Grid has no verified seller, and catalogue coverage remains partial.
Those limitations are part of the evidence model rather than hidden demo data.
If a live catalogue or RPC dependency is unavailable, the application shows a
retryable diagnostic state instead of inventing records. The landing remains
usable from the sanitized, timestamped release snapshot without treating it as
a live profile or commercial qualification source; the versioned Job `551`
snapshot and transaction links remain the durable hiring proof.

Before presenting a new deployment, run:

```bash
npm run check
npm audit --audit-level=low
```

The submission URL is
`https://bnb-agent-marketplace-ruby.vercel.app`. Its Production Deployment
Protection must remain disabled throughout 2026-09-09 through 2026-09-23; protected
PR previews are not submission URLs. The scheduled GitHub Actions uptime check
requires an anonymous, non-redirected HTTP `200` from the landing, catalogue, Agent
`45650` profile, its `/hire` route and durable Job `551` throughout judging. The
monitor detects Mainnet exposure from the server-gated quote API: before current seller
qualification it accepts `404`; once that API returns `200`, it requires the public
`MAINNET_UPTIME_BUYER_ADDRESS` repository variable and verifies the Agent Card,
signed quote and read-only prepare response without signing or broadcasting. Once
the canonical Mainnet proof is published, a missing Mainnet hiring route fails the
check instead of being treated as intentionally unavailable.
Production keeps `ERC8183_BROWSER_SPIKE_ENABLED=true` from 2026-09-09 through
2026-09-23; the independent Mainnet flag stays false unless its complete GO,
registration, qualification and proof-capture sequence succeeds.

Provision the new single-purpose Mainnet seller key only as a write-only Vercel
secret:

```bash
vercel env add MAINNET_SELLER_PRIVATE_KEY production --sensitive
vercel env ls production
```

The listing must show `Hidden`, `Sensitive`, and `Production` only. Do not add a
Preview or Development copy. The key-loading module is marked `server-only`, and
the build/test boundary fails if any client import graph can reach the variable.

See:

- [ERC-8183 Gate 1 interaction diagram](diagrams/erc8183-gate1-flow.html)
- [Gate 5 delivery specification](docs/GATE_5_FRONTEND_MVP.md)
- [Gate 6A browser-wallet spike](docs/GATE_6A_BROWSER_WALLET_SPIKE.md)
- [MVP scope](docs/MVP_SCOPE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Reuse and provenance](docs/REUSE_AND_PROVENANCE.md)
- [Decision log](docs/DECISIONS.md)

## License

[MIT](LICENSE)
