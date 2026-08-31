# Agent-to-agent hiring — delivery plan

Decision record: see `DECISIONS.md` → "Bring agent-to-agent hiring into hackathon scope" (2026-08-31).

## Objective

Make the marketplace consumable by programmatic buyers so that an agent can run the same
journey a human runs today — Discover → Understand → Compare → Hire → Track → Result —
through the same ERC-8183 gate, and make the marketplace the visibility layer for that
economy.

```
                    ┌─ Human (browser + wallet) ── existing UI ──┐
Discover → Compare ─┤                                             ├─ ERC-8183 (signed quote → escrow → job onchain)
                    └─ Agent (own wallet) ── MCP / HTTP API ─────┘
```

Invariants that do not change, for either buyer type:

- A valid signed quote (token, budget, deadline, expiry) is the only gate to hiring.
- MCP/A2A availability never implies hireability.
- Financial facts and job state resolve from chain; hashes and timestamps are preserved.
- Wallet interactions stay non-custodial.

## What already exists and is reused

The discovery and hire surface is **already implemented as HTTP routes** under
`app/api/marketplace/`, each a thin handler over `src/business/composition`. Nothing is
rebuilt; P1 audits and documents this surface instead of creating it.

| Existing route | Use-case behind it | Role in this plan |
| --- | --- | --- |
| `GET /api/marketplace/agents` | `listMarketplaceAgents` (view, category, q, sort, page, limit) | Discover |
| `GET /api/marketplace/agents/[agentId]` | `getMarketplaceAgent` | Understand |
| `GET /api/marketplace/agents/[agentId]/passport` | `getAgentEvidencePassport` | Understand (provenance-separated evidence) |
| `GET /api/marketplace/compare` | `compareMarketplaceAgents` | Compare |
| `POST /api/marketplace/validate` | `validateMarketplaceAgent` | Understand (fresh validation) |
| `POST /api/marketplace/demo/erc8183/quote` | `requestErc8183Quote` (Testnet) | Hire — quote |
| `POST /api/marketplace/demo/erc8183/prepare` | `prepareErc8183Hire` (Testnet) | Hire — transaction plan |
| `POST /api/marketplace/demo/erc8183/notify` | `notifyFundedJob` (Testnet) | Hire — funding handoff |
| `POST /api/marketplace/demo/erc8183-mainnet/*` | qualified Mainnet variants of the three above | Hire (Mainnet) |
| `GET /api/marketplace/jobs/testnet/[jobId]` | `getErc8183TestnetJobTracking` | Track |
| `GET /api/marketplace/jobs/mainnet/[jobId]` | `getMainnetErc8183JobStatus` | Track (Mainnet) |
| `GET /api/marketplace/proofs/jobs/*` | job proof use-cases | Result |

Shared plumbing that is reused as-is:

- `src/business/composition.ts` — the only wiring point; new surfaces import from here.
- `src/business/policies/erc8183-spike-policy.ts` — quote/job validation rules; the agent
  buyer runs the same `assertAllowedQuote` path the UI runs.
- `src/presentation/http/marketplace-http.ts` and `erc8183-spike-http.ts` — parameter
  parsing and error mapping for any new or adjusted route.
- `src/data/erc8183/contracts.ts` and `src/mainnet/contracts.ts` — addresses and minimal
  ABIs, including the five browser transaction intents.

## Priorities

Hard dependency chain: **P1 → P2 → P3 → P4 → P5**. P6 is independent and is the first
thing cut under time pressure.

### P1 — Discovery API: audit and document the existing surface

Scope: treat `app/api/marketplace/` as a public machine-readable API. No new
infrastructure; the routes stay in this repository (an isolated worker was rejected —
the use-cases, view-models and deploy already live here, and the Cloudflare Worker
remains a probing concern with distinct provenance).

Tasks:

- Audit each route above for machine consumption: response shape stability, error
  contract (`marketplaceErrorResponse`), cache headers, and whether provenance labels
  (declared / observed / onchain / derived) survive serialization.
- Fill only real gaps found by the audit (for example, a missing field an agent needs to
  decide hireability, or an inconsistent error body). No speculative additions.
- Write `docs/API.md`: every route, parameters, response fields with their provenance,
  error shapes, and explicit statements of what a field does **not** claim.

Done when: `curl` against the documented routes matches `docs/API.md` exactly, and the
existing route tests still pass.

### P2 — Programmatic hire spec

Scope: a document, not code. Distill the flow the UI already executes into a contract a
third-party buyer can implement.

Contents (`docs/HIRE-SPEC.md`):

- Quote request and the validation rules (`assertAllowedQuote`): allowlisted seller,
  token, budget ceiling, deadline, expiry window.
- The buyer preconditions checked by `prepareErc8183Hire`: policy allowlisted, token
  balance, native gas balance.
- The five transaction intents in order — `createJob` (Commerce), `registerJob`
  (Router), `setBudget` (Commerce), conditional exact `approve` (token), `fund`
  (Commerce) — with contract addresses per network and the orphan-state warning
  (`createJob` landed, `fund` failed).
- Tracking: job state resolves from chain events (`JobCreated`, `JobFunded`,
  `JobSubmitted`), never from marketplace claims.

Done when: an external engineer could implement the hire reading only the spec.

### P3 — MCP server

Scope: a thin wrapper exposing the P1/P2 surface as MCP tools. No business logic in the
wrapper; every tool call maps to one HTTP route (or one composition call).

Tools:

- `search_agents` → `GET /api/marketplace/agents`
- `get_passport` → `GET /api/marketplace/agents/[agentId]/passport`
- `compare_agents` → `GET /api/marketplace/compare`
- `request_quote` → the quote route for the selected network
- `get_job_status` → the job tracking routes

Provenance rule carried into tool descriptions: results state what is declared vs
observed vs onchain, and `search_agents` results never present MCP availability as
hireability.

A CLI over the same routes is optional and only if time remains; it must not fork logic.

Done when: an MCP client (e.g. Claude) discovers the admitted seller, reads its
passport, and obtains a valid quote — without any code changes for the demo.

### P4 — Agent buyer demo (Testnet)

Scope: a small script in this repository (e.g. `src/demo/agent-buyer-cli.ts`) that acts
as the buyer end to end. It is a demo, not a product: no service, no UI, no deployment.
It runs once and leaves onchain evidence.

- Custody: plain local key from env, Testnet only, bounded by the existing
  `maximumBudgetRaw` spend ceiling in the allowlist policy. Altana is explicitly out
  (see the decision record) — delegated custody is a post-hackathon Mainnet concern.
- Flow: discover via MCP (P3) → validate the quote with the same policy module the UI
  uses → sign and send the five intents with viem → track the job from chain.
- This does not violate the "do not build four proprietary agents" guardrail: that
  guardrail is about seller supply; this is a buyer.

Done when: a new Testnet job exists onchain with `buyer = the agent's wallet`, funded
and tracked, hashes preserved — the agent-initiated counterpart of Job #551.

### P5 — Delegation visibility in the UI

Scope: the marketplace shows agent-initiated jobs as delegation.

- Detection: a job whose buyer address is itself a registered ERC-8004 agent identity
  (or, for the demo, the known demo-buyer address) is labeled "hired by an agent".
- Rendering: the job page links both sides — buyer identity and seller identity — with
  chain-resolved facts only. No derived reputation, no invented linkage.

Done when: the P4 job's page shows the delegation with onchain data, and human-initiated
jobs render exactly as before.

### P6 — One-confirmation hire (cuttable)

Scope: UX and atomicity for the human path; independent of P1–P5.

- Primary: batch the five intents atomically via EIP-5792 `wallet_sendCalls` (EIP-7702
  is live on BSC; wagmi exposes `useSendCalls`). One wallet confirmation. Also removes
  the orphan-job intermediate state.
- Fallback (wallet without batching): today's sequential flow, improved with EIP-2612
  `permit` — verified onchain on 2026-08-31 for both payment tokens (probe values in
  the decision record) — replacing the `approve` transaction with an off-chain
  signature: five signatures become four transactions plus one signature.
- Rejected: a periphery `hireWithQuote()` contract (breaks `msg.sender` attribution on
  Commerce; would need Router allowlisting of an uncontrolled contract).

Done when: a full Testnet hire completes with one confirmation on a batching-capable
wallet and the sequential fallback still passes its tests.

## Out of scope

- Altana / delegated custody (set aside for the hackathon; decision record has details).
- Building seller agents, partner tracks, multichain, social features, new reputation
  protocols (unchanged guardrails).
- A standalone worker or second implementation of the API surface.

## Demo narrative

"Humans hire with evidence. Agents hire with the same evidence, through the same
protocol — here is the onchain job that proves it — and the marketplace is where that
economy becomes visible."
