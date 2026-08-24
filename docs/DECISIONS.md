# Decision Log

| Date | Decision | Status | Rationale | Trade-off |
|---|---|---|---|---|
| 2026-08-12 | Create a standalone public repository | Approved | Independent, attributable, and adoptable product | Requires a stable API boundary |
| 2026-08-12 | Reuse trust8004 through APIs | Approved | Preserves existing infrastructure advantage | Initial external dependency |
| 2026-08-12 | Limit MVP to BSC | Approved | Direct main-track alignment | Multichain deferred |
| 2026-08-12 | Use ERC-8183 for buyer activation | Approved | Official hiring lifecycle | Wallet and `$U` complexity |
| 2026-08-12 | Build four proprietary agents | Rejected | Marketplace is the evaluated product | Existing sellers must be verified |
| 2026-08-12 | Build a minimal Grid seller | Conditional | Only if the category remains blocked | Adds seller maintenance |
| 2026-08-12 | Enter partner tracks | Out of scope | Protect main-track execution | Additional prizes deferred |
| 2026-08-12 | Build complete UI before buyer spike | Rejected | Does not reduce critical technical risk | Visual build starts later |
| 2026-08-12 | Duplicate the full indexer | Rejected for MVP | High effort without judging value | Provider dependency remains |
| 2026-08-14 | Use trust8004 as the sole catalogue source | Approved | One read-only API boundary preserves provenance and keeps the BSC inventory simple | Coverage is explicitly partial; critical facts still require direct BSC verification |
| 2026-08-16 | Keep verification evidence separate from the trust8004 snapshot | Approved | Prevents observed MCP tools and direct BSC reads from overwriting declared catalogue data | Consumers must interpret mismatches and temporal drift explicitly |
| 2026-08-17 | Gate frontend work on reproducible evidence, not third-party seller access | Approved | Gate 1 already proves the buyer lifecycle onchain; the UI can honestly represent MCP-only and unavailable states | Replaces waiting for an external seller; no existing MVP item or gate is delayed |
| 2026-08-17 | Probe only explicitly declared seller protocols | Approved | Prevents MCP/A2A discovery from being misrepresented as ERC-8183 hireability | Undeclared compatible routes are intentionally not guessed |
| 2026-08-17 | Split discovery into curated marketplace and paginated registered views | Approved | Enables navigation of the trust8004 BSC snapshot without mass download, N+1 enrichment, or global classification | Registered agents remain `Not evaluated` until deliberately curated |
| 2026-08-17 | Deliver the read-only Frontend MVP before wallet signing | Approved | Gate 1 already proves the ERC-8183 lifecycle and the UI can now expose real evidence safely | Non-custodial wallet/ERC-8183 integration is the delayed next gate; no fake quotes or jobs are introduced |
| 2026-08-18 | Keep `@bnbagent/sdk` server-side and use viem for injected-wallet ERC-8183 writes | Approved for Gate 6A | SDK `0.5.0` accepts its Node-oriented `WalletProvider`, has no EIP-1193 adapter, and its ERC-8183 entry reaches filesystem-backed providers; a minimal viem adapter preserves browser custody | Delays production `/hire/[agentId]` integration until the Testnet spike is signed and observed at `SUBMITTED`; WalletConnect and mainnet remain out of scope |
| 2026-08-19 | Replace the unrecoverable local seller with public hosted Testnet Agent `1866` | Implemented for Gate 6A | Agent `1815`'s keystore password was never retained, so its signing key cannot be recovered; a new Testnet-only key is held as a server-side Vercel secret and public A2A routes keep the fixture usable without a tunnel | Deterministic deliverables avoid adding storage; the browser flow still requires a user-controlled injected wallet and remains Testnet-only |
| 2026-08-20 | Productize the proven wallet flow as a separate Testnet demo | Approved for Gate 6B | Mainnet catalogue Agent IDs and Testnet fixture IDs are different identity spaces, so `/demo/erc8183` and `/jobs/testnet/{jobId}` avoid presenting Agent `1866` as a marketplace candidate | Replaces the experimental route as the visible entry point; production `/hire/[agentId]` remains delayed until a real BSC Mainnet ERC-8183 seller is verified |
| 2026-08-20 | Qualify Mainnet sellers from curated and explicit IDs without global classification | Approved for Gate 6C | Bounded profile reads and declared-protocol probes let newly indexed sellers be assessed without scanning the partial trust8004 catalogue or treating descriptions as operational evidence | A verified explicit seller is reported but not promoted; `/hire` and the curated manifest remain delayed until a separate review |
| 2026-08-21 | Pin validated seller DNS and bound Gate 6C evidence collection | Approved for Gate 6C | Connection-time IP pinning, incremental 64 KiB reads, canonical request binding, quote freshness, and probe budgets prevent SSRF rebinding, replay, memory, and fan-out risks | Qualification is intentionally incomplete when limits are reached; broader coverage requires a later reviewed run, not silent relaxation |
| 2026-08-23 | Share Gate 6C probe budgets and make report provenance authoritative | Approved for Gate 6C | Review showed MCP could bypass seller limits, mapped IPv6 could bypass the SSRF boundary, and duplicated category/contract fields could overclaim evidence | Report schemas advance to verification `2` and readiness `3`; skipped probes, expired quotes, manifest categories, SDK configuration, and direct RPC observations remain explicitly distinct |
| 2026-08-23 | Use the proven Testnet lifecycle as the submission hiring demonstration | Approved for submission | Job `551` already proves the non-custodial browser-wallet path through a public hosted fixture, so judges can verify real transactions and a hash-matched result without presenting fixture Agent `1866` as a Mainnet candidate | No MVP feature is added or delayed; Mainnet candidates remain MCP-only, Grid remains empty, and a repeat live signing flow is optional |
| 2026-08-24 | Gate one marketplace-operated Grid seller and one browser-signed Mainnet job behind a read-only security decision | Approved for implementation, Mainnet writes pending GO | Grid remains the only demonstrably empty category and the existing conditional scope permits one authentic fallback seller; Mainnet strengthens the judgeable activation path only if official contracts, policy, token, recovery paths and spend ceiling verify | UI evidence and submission hardening continue independently; a documented NO-GO preserves Job `551` as the primary proof and never relaxes a readiness check |
| 2026-08-24 | Publish verification drift from a sanitized release snapshot | Approved | The Git-ignored operator report contains useful declared/observed/onchain differences but cannot be a production runtime source | Vercel runs `build:deployment`, which regenerates readiness and the sanitized snapshot before the deterministic application build; a live dependency failure or evidence older than 72 hours fails closed instead of deploying stale claims |
| 2026-08-24 | Record generic execution measurements usable by the Main Track and the manually authored TermiX report | Narrow scope exception | Duration, gas, token cost and deterministic Grid correctness are also useful public job evidence; the without-agent baseline and partner submission remain manual work | No partner-specific UI, protocol or workflow is added; Binance B402 remains dropped and the Mainnet seller/job replace no existing Main Track feature |
| 2026-08-24 | Keep the first Mainnet security evaluation at NO-GO | Recorded | Direct block `117715355` reads verified chain, code, active proxy implementations, payment token `U`, policy wiring, quorum and five active voters; the dedicated seller address, its minimum gas balance and production origin were not yet configured | No Mainnet registration, funding or seller write may occur until those operator checks pass in a fresh report; five voters meets quorum three but remains below the non-blocking 3x operational recommendation |
| 2026-08-24 | Keep the proven Testnet browser demo enabled during 2026-09-09 through 2026-09-23 | Approved for judging operations | Job `551` is durable proof and the hosted Agent `1866` provides an optional repeat path without Mainnet value | `ERC8183_BROWSER_SPIKE_ENABLED=true` is the production baseline for judging; `ERC8183_MAINNET_DEMO_ENABLED` remains false until GO, registration, qualification and proof capture all pass |
| 2026-08-24 | Render landing candidates from the sanitized release snapshot | Approved for submission resilience | A trust8004 outage made the server-rendered landing fail even though its drift evidence was already versioned; the landing now performs no live profile fan-out and states the snapshot timestamp and limits | Paginated catalogue, profile, comparison and hireability reads remain live trust8004 operations; known outages render a retryable state and API controllers retain diagnostic `503` responses |
| 2026-08-24 | Keep the dedicated Mainnet seller key in one sensitive Production-only Vercel variable | Approved, secret not provisioned | `MAINNET_SELLER_PRIVATE_KEY` is read behind a `server-only` boundary and is never a public variable, response field or log value; the wallet will be new, single-purpose and gas-funded only | Preview and Development cannot run the Mainnet seller; earnings are swept after each completed job (and at least daily while a balance exists), retaining only the documented gas floor, and the key is rotated and the old variable revoked after 2026-09-23 UTC |
| 2026-08-24 | Validate Preview hiring without copying the Testnet seller key into Preview | Approved | The Preview buyer flow negotiates with fixed Testnet Agent `1866` at the Production-hosted seller origin, so quote and preflight need only the Preview-scoped enable flag and fixed origin; the seller signature remains in the Production function | Preview can validate through quote and transaction preparation, while the final five injected-wallet signatures remain an explicit human action; `SELLER_PRIVATE_KEY` stays Sensitive and Production-only |
| 2026-08-24 | Define the catalogue total as trust8004's active indexed BSC list total | Approved | On 2026-08-24 the list API with `chainId=56&active=true`, the same request without `active`, `/api/v2/agents/stats?chainIds=56`, `/api/v2/chains`, and the landing payload all reconciled at `155185`; BSC reported zero inactive rows | The UI says `active indexed BSC records returned by trust8004`, carries the fetch timestamp and partial-coverage warning, and does not reinterpret this as onchain completeness |
| 2026-08-24 | Treat the Mainnet OptimisticPolicy dispute window as a submission timing risk | Recorded, pre-write | The allowlisted APEX policy has a seven-day window, quorum three and five active allowlisted voters. It is UMA-style in semantics but does not invoke UMA OOV3: `dispute` and `voteReject` are nonpayable and charge only variable BNB gas. Official `OptimisticPolicy.sol` returns REJECT when reject votes reach quorum and APPROVE after the window when they do not, whether or not a dispute was opened | The primary Mainnet run must be submitted no later than 2026-09-08 and monitored through settlement. It can remain pending for at most the seven-day window; a quorum rejection or a submission too late to settle before judging keeps Testnet Job `551` as the primary proof |
| 2026-08-24 | Derive Mainnet hiring exposure from current release qualification | Approved, pre-write | Environment flags configure an already-qualified integration but cannot create hireability; landing, `/hire`, demo UI, quote and prepare require a current `qualified` readiness snapshot entry | The hourly monitor uses the server-gated quote API rather than the page's possible soft 404. Before proof publication its `404` is intentionally unavailable; once the canonical Mainnet proof exists, `404` fails. An exposed quote requires the public `MAINNET_UPTIME_BUYER_ADDRESS` and verifies Agent Card and read-only prepare without signing or broadcasting |
| 2026-08-24 | Separate Mainnet seller discovery from transaction authority | Approved, pre-write | Readiness must reach the Agent Card and signed-quote surface before GO, so the seller enable flag cannot also authorize an onchain submission | `ERC8183_MAINNET_WRITES_ENABLED` defaults false and is enabled only after a fresh recorded GO; marketplace notify and the seller repository's final submit boundary both fail closed while it is false |

## Mainnet security decision — 2026-08-24

This is the required pre-write record for the read-only evaluation generated at
`2026-08-24T01:47:46.370Z` against BSC block `117722575`.

- Seller wallet: **not configured**. No Mainnet seller wallet or private key was
  created or read during this evaluation.
- Buyer payment spend ceiling: **0.01 U** (`10000000000000000` raw units).
- Seller gas funding requirement: **at least 0.002 BNB**; unavailable until the
  dedicated public address exists.
- Final decision: **NO-GO**. Mainnet registration, funding and seller writes remain
  prohibited until a fresh report passes every item.

| Check | Result | Observed |
|---|---|---|
| Chain ID is 56 | Pass | `56` |
| Code exists at registry, Commerce, Router, policy and token | Pass | Present at all five allowlisted addresses |
| Commerce implementation matches allowlist | Pass | `0xd5f9b570c96b5d67702d508c0BFb8B3b09209787` |
| Router implementation matches allowlist | Pass | `0xf0Cf8F47e5c035F16247fF16E9F367e477eE5007` |
| Commerce payment token matches | Pass | `0xcE24439F2D9C6a2289F741120FE202248B666666` |
| Policy is allowlisted by Router | Pass | `true` |
| Policy Commerce wiring matches | Pass | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` |
| Policy Router wiring matches | Pass | `0x51895229E12F9876011789B04f8698af06cCD6DA` |
| Dispute window is positive | Pass | `604800` seconds |
| Vote quorum is positive | Pass | `3` |
| Active voters meet quorum | Pass with warning | `5`; below the non-blocking 3x recommendation of `9` |
| Policy admin is non-zero | Pass | `0x5057b09A4b510ccaf7e3fb3038Ba60713E62B1fc` |
| Payment token symbol | Pass | `U` |
| Payment token decimals | Pass | `18` |
| Buyer payment spend ceiling | Pass | `0.01 U` |
| Dedicated seller public address configured | **Fail** | Not configured |
| Seller gas balance at least 0.002 BNB | **Fail** | Unavailable |
| Fixed production seller origin configured | **Fail** | Not configured |
| DNS-pinned production Agent Card matches required skills | **Fail** | Unavailable or mismatched |

The warning is exactly: `Active voter count 5 is below the APEX operational
recommendation of 3x quorum (9).` It refers to the allowlisted APEX
`OptimisticPolicy`, not an external UMA Optimistic Oracle transaction. The SDK
describes this policy as “silence approves”: an undisputed submission can be
settled after `604800` seconds (seven days). A disputed submission resolves as
rejected if three allowlisted reject votes reach quorum; otherwise the official
APEX `OptimisticPolicy.sol` returns approval when the same seven-day window
expires. There is no dispute bond
or fixed protocol fee in the deployed ABI; `dispute`, `voteReject`, and `settle`
are nonpayable, so their cost is only `gasUsed × transaction gas price` in BNB.
At block `117821751` the observed gas price was `0.05 gwei`; the exact cost is
recorded from receipts rather than estimated as a constant. The operational risk
is therefore a pending state lasting until the window expires, not indefinite
pending. A quorum-rejected job must not be promoted as the primary proof, and a
submission on 2026-09-08 should become settleable by 2026-09-15, inside the
2026-09-09 through 2026-09-23 evaluation window.

## Scope change rule

Any new MVP feature must identify either:

- the existing feature it replaces; or
- the gate and delivery date it delays.

Unapproved suggestions remain outside the active backlog.
