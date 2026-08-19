# Gate 6A: Browser Wallet ERC-8183 Spike

Research snapshot: 2026-08-17.

## Objective and scope

Prove that an injected EIP-1193 wallet can remain fully non-custodial while a
browser user creates and funds one real ERC-8183 job on BSC Testnet. The
active seller is controlled hosted fixture Agent `1866`. Both it and the
historical Gate 1 fixture are labelled throughout as:

> Testing infrastructure — not a marketplace agent

This spike delays the production integration of `/hire/[agentId]`. It does not
remove a Gate 5 feature, enable the four MCP-only HeyAnon candidates, introduce
WalletConnect, or support mainnet.

Operational update (2026-08-19): the original Agent `1815` remains historical
Gate 1 evidence, but its local keystore password was not retained. Gate 6A is
therefore migrating to a new public hosted fixture at seller address
`0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5`. Its public Agent Card and signed
quote passed deployment validation before it was registered as Agent `1866` in
transaction
`0x166cdb89f4fb2236d760fcd372db7980d51d473a16f3ab51118eeb024eb61e2a`.

## SDK compatibility decision

The installed and npm-latest stable package is `@bnbagent/sdk@0.5.0`, pinned by
the lockfile integrity
`sha512-oqPrvM9NFaHhAjavJ+F2otLO3+mDhKadvn0T7vv8SOfRhY08gattXtpz5pbskrgPQeVOQcsN3NqiPR+x30ERSg==`.
The published package records git head
`010703af5a45d5d8be4772dae7afe57c259b87b8`; the official repository main head
observed during this research was
`b24d45c33dfbfaf3cdb0ecd171ff9865dfcf39d2`. They are not presented as the
same source snapshot.

Evidence from the installed artifact:

- `package.json` declares Node `>=20` and has no browser export condition.
- `ERC8183Client.create` accepts the SDK's abstract `WalletProvider`, not an
  EIP-1193 provider or a viem `WalletClient`.
- `WalletProvider.makeExecutor` expects raw transaction signing or a
  self-broadcasting SDK backend. The built-in `EVMWalletProvider` is a
  filesystem-backed Keystore V3 implementation.
- The `@bnbagent/sdk/erc8183` entry imports `LocalStorageProvider`,
  `EVMWalletProvider`, and TWAK support. Its dependency chunks import Node
  `fs`, `path`, and `os` and read `process.env`.
- No installed export implements `eth_requestAccounts`,
  `wallet_switchEthereumChain`, or an EIP-1193 injected-wallet adapter.

Therefore the complete SDK is not treated as a supported browser bundle and
is kept out of Client Components. The split is:

| Concern | Runtime | Implementation |
|---|---|---|
| ERC-8004 resolve, Agent Card, A2A negotiation | Server | Existing SDK and hardened A2A client |
| Quote signature and commercial-policy validation | Server | `@bnbagent/sdk/erc8183` plus direct chain reads |
| `notify_funded` | Server | Fixed-origin A2A client after direct FUNDED verification |
| ERC-8183 reads and tracking | Server/public RPC | viem and the SDK read facade where appropriate |
| `createJob`, `registerJob`, `setBudget`, exact `approve`, `fund` | Browser | viem `custom(window.ethereum)` with minimal official ABIs |

This is not a new wallet abstraction. The browser adapter implements only the
five required writes, simulation, receipt waiting, and chain/account checks.

## Official references

- BNB Agent SDK quickstart:
  <https://docs.bnbchain.org/developer-kit/bnbagent-sdk/quickstart/>
- BNB Agent SDK networks and contracts:
  <https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks/>
- Official TypeScript A2A buyer example:
  <https://github.com/bnb-chain/bnbagent-sdk/blob/main/typescript/examples/a2a-agent/scripts/buyer.ts>
- Official TypeScript wallet contract:
  <https://github.com/bnb-chain/bnbagent-sdk/blob/main/typescript/src/wallets/walletProvider.ts>
- Official TypeScript ERC-8183 facade:
  <https://github.com/bnb-chain/bnbagent-sdk/blob/main/typescript/src/erc8183/client.ts>
- Official generated contract ABIs:
  <https://github.com/bnb-chain/bnbagent-sdk/tree/main/typescript/src/abis>

The upstream buyer example is a Node script: it imports `node:crypto`,
`node:path`, `node:url`, loads environment files, and uses
`EVMWalletProvider`. It demonstrates the protocol order but is not evidence of
browser compatibility.

## Fixed testnet configuration

| Fact | Allowlisted value |
|---|---|
| Chain | BSC Testnet, chain ID `97` |
| ERC-8004 Agent | `1866` |
| Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| AgenticCommerce | `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de` |
| EvaluatorRouter | `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25` |
| Active allowlisted policy | `0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA` |
| Payment token `$U` | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` |
| Maximum spike budget | `1` raw `$U` unit |

The SDK `0.5.0` preset still names policy
`0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6`; Gate 1 proved that address was
not accepted by the active Router. Gate 6A preserves the separately verified
active policy and checks its Router whitelist at runtime before preparing any
write. Commerce, Router, Registry, chain, token, and seller are immutable
allowlist entries in the spike code.

## Configuration and availability

The route and controllers fail closed unless all conditions hold:

```dotenv
ERC8183_BROWSER_SPIKE_ENABLED=true
ERC8183_BROWSER_SPIKE_SELLER_ORIGIN=https://temporary-seller.example
# Optional server-only transport credential:
# ERC8183_BROWSER_SPIKE_BEARER_TOKEN=<external secret>
```

The origin must be HTTPS, contain no credentials, query, or fragment, and must
exactly match the A2A origin resolved from Agent `1866`. It is never accepted
from browser input. The feature flag is false by default in every environment.
Mainnet and every chain other than `97` are rejected in
presentation, business policy, and infrastructure.

## Three-layer flow

```text
Presentation / Controllers
  experimental page + injected-wallet UI + thin Route Handlers
                         |
                         v
Business / Application
  RequestErc8183Quote -> PrepareErc8183Hire
  NotifyFundedJob     -> GetErc8183JobStatus
                         |
                         v
Data / Infrastructure
  fixed-origin A2A + ERC-8004/8183 reader + official minimal ABIs
  injected viem adapter + receipt/event parser
```

Each Route Handler validates HTTP input, invokes exactly one use case, and
maps known errors. It does not negotiate, normalize quotes, select contracts,
or read chain state directly.

## Security invariants

1. The browser cannot submit a seller URL, token address, policy, Router,
   Commerce address, Registry address, or chain configuration.
2. A quote must be accepted, signed, unexpired, bound to chain `97` and the
   allowlisted Commerce contract, issued by the active fixture Agent's current
   agent wallet, denominated in allowlisted `$U`, positive, and no more than
   one raw unit.
3. The confirmation view precedes wallet connection and every signature. It
   shows buyer, seller, endpoint origin, balances, exact allowance decision,
   raw/display budget, deadline, contracts, purpose, and maximum signatures.
4. Approval is exactly the quote amount and is omitted when allowance is
   sufficient. Unlimited approval is never encoded.
5. Every write is simulated when supported, then confirmed by a successful
   receipt. Job ID comes only from a `JobCreated` event emitted by the
   allowlisted Commerce contract.
6. `notify_funded` ignores transaction hashes as proof. The server rereads the
   job and requires the expected buyer, seller, Router, budget, policy, and
   FUNDED-or-later state. The controlled seller operation is idempotent; the
   server also deduplicates concurrent notification attempts.
7. Public errors are stable codes plus generic messages. No raw provider,
   header, endpoint credential, private key, mnemonic, password, or local path
   is returned or logged.
8. The browser journal contains only chain ID, public buyer/seller, job ID,
   transaction hashes, and last confirmed step. Reload reconstruction trusts
   receipts and current chain state, never `localStorage` completion flags.

## Transaction sequence and recovery

```text
server quote -> browser confirmation -> connect/switch chain 97
-> read balances and allowance -> simulate + createJob
-> parse confirmed JobCreated -> simulate + registerJob
-> simulate + setBudget -> exact approve only if required
-> simulate + fund -> server verifies FUNDED -> notify_funded
-> server polls chain -> SUBMITTED -> sanitized deliverable receipt
```

After reload, a stored create transaction hash is sufficient to recover the
Job ID from its receipt. Once a Job ID exists, direct reads determine which
steps are already complete. No confirmed transaction is repeated.

## Assumptions and uncertainties

- The replacement fixture must be reachable at a stable public HTTPS origin
  before registration; its registered A2A origin must match the server
  allowlist at execution time.
- The replacement key controls a new identity, so it is registered once with
  `npm run hosted-seller:register`. The resulting Agent ID and transaction hash
  are recorded before the browser route is enabled. Historical Agent `1815` is
  not updated because its keystore is no longer operationally recoverable.
- The injected wallet already holds enough Testnet tBNB and `$U`; the spike
  never requests or handles private keys.
- The maximum accepted quote is the fixture's one-raw-unit service price.
- Browser RPC providers may not support all simulation methods uniformly;
  the implementation uses a public BSC Testnet client for simulation and
  receipt validation, then requests the injected wallet signature.
- In-memory notification deduplication does not replace seller idempotency
  across server restarts. The controlled fixture's `notify_funded` handler
  must return the existing submission for already-submitted jobs.

## Exit criteria

Automated readiness requires deterministic security/policy/receipt/recovery
tests, typecheck, CLI build, web production build, and dependency audit. Gate
6A itself remains pending until a human-controlled injected wallet signs the
real Testnet transactions and the resulting job is independently observed at
`SUBMITTED` after a reload. The implementation must stop for that manual
interaction; a server key is never an acceptable substitute.
