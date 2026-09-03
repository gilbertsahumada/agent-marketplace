# Programmatic ERC-8183 Hire Specification

How a buyer with a wallet — human or agent — executes the marketplace's hire flow
without the UI. Everything here documents behavior that already exists; the sources of
truth are `src/business/policies/erc8183-spike-policy.ts`,
`src/business/use-cases/prepare-erc8183-hire.ts`,
`src/data/erc8183/browser-wallet-adapter.ts` and `src/data/erc8183/contracts.ts`.
Route contracts are in `docs/API.md`.

## Invariants

- A valid signed quote is the **only** gate to hiring. Reachability, MCP/A2A
  availability, or catalog presence never substitute for it.
- The flow is non-custodial: the server never receives a buyer private key. The buyer
  signs every transaction with their own wallet (injected in the browser; a local key
  for a programmatic buyer).
- Job state resolves from chain events and reads; marketplace responses report it,
  they do not define it.
- Amounts are raw token units as decimal strings; convert with `tokenDecimals` from
  the quote for display only.

## Prerequisites

- A buyer address on the target chain with: native balance > 0 (gas) and payment-token
  balance ≥ the quoted price.
- Network selection: Testnet routes under `/api/marketplace/demo/erc8183/`, Mainnet
  under `/api/marketplace/demo/erc8183-mainnet/`. Both are env-gated; when disabled
  they answer `404 ERC8183_SPIKE_DISABLED` (see API.md).
- The seller, contracts, token and budget ceiling are fixed by a server-side
  allowlist. A programmatic buyer does not choose contracts; it verifies the server's
  plan against the quote (step 3).

## Step 1 — Discover

`GET /api/marketplace/agents?view=marketplace&availability=hireable` filters to agents
with `hireability.canHire === true`. Inspect evidence with
`GET /api/marketplace/agents/{agentId}/passport`. Both are read-only and documented in
API.md. A passport state of `hireable` means an executable quote-request path exists —
a fresh quote is still obtained and validated before any signature.

## Step 2 — Request a quote

`POST …/quote` (no body). The response is a `NormalizedErc8183Quote`:

```
envelope        raw seller-signed object — keep it byte-identical for step 3
agentId         seller's ERC-8004 agent id
chainId         56 | 97
provider        seller address
endpoint        seller's A2A endpoint origin (scheme + host only)
commerce, router, policy, token   contract addresses the job will use
tokenSymbol, tokenDecimals
priceRaw        decimal string, raw units
priceDisplay    human formatting only
negotiatedAt, quoteExpiresAt      unix seconds
description     job description the quote covers
```

The Mainnet variant additionally carries `observationSync: { status }` (see API.md);
treat it as informational.

The server validates the quote in two layers before returning it. The repository
layer verifies the seller's signature and the contract/provider/token bindings while
normalizing the envelope — those failures surface as `503
ERC8183_SPIKE_UNAVAILABLE`, not 409 (on Mainnet, budget and staleness violations are
also caught at this layer). The allowlist policy (`assertAllowedQuote`) then enforces
these rules, whose failures are `409 ERC8183_QUOTE_REJECTED`:

1. `agentId` and `chainId` must match the fixed seller for the network.
2. `commerce` must be the allowlisted Commerce contract.
3. `router` and `policy` must be the allowlisted evaluator configuration.
4. `token` must be the allowlisted payment token.
5. `provider` must be the allowlisted seller address.
6. `priceRaw` must be a positive base-10 integer.
7. `priceRaw` must not exceed the allowlist budget ceiling.
8. `quoteExpiresAt` must be in the future.

A programmatic buyer should re-check 6–8 locally and treat the quote as immutable: any
edit invalidates the seller's signature, and the seller re-verifies the signed quote at
the funded block before doing work (buyer edits, signature removal or late funding are
permanent `quote_invalid` rejections on the seller side).

## Step 3 — Prepare

`POST …/prepare` with `{ "buyer": "<checksummed EVM address>", "quote": <the envelope> }`.
Failures: `400 INVALID_ERC8183_SPIKE_INPUT` (malformed buyer); `503
ERC8183_SPIKE_UNAVAILABLE` when the envelope fails re-verification — including a
tampered or edited envelope, whose broken signature is indistinguishable from a seller
outage at this layer, so **on a 503 from prepare, request a fresh quote before
retrying; never retry a modified envelope**; `409 ERC8183_QUOTE_REJECTED` for
policy-level rejections; `409 ERC8183_JOB_NOT_READY` when the buyer preconditions
fail — policy not allowlisted by the Router, token balance below `priceRaw`, or zero
native balance.

The response is an `Erc8183HirePlan`. Load-bearing fields:

- `transactions` — the ordered intent list (step 4). `approve.required` is true only
  when the current allowance is below the price (`approvalRequired`).
- `deadline` — job expiry the buyer passes to `createJob`: `now + disputeWindowSeconds
  + 3600`.
- `executeBefore` — equals `quote.quoteExpiresAt`; all five transactions must land
  before it.
- `maximumSignatures` — 5 with approval, 4 without.
- `guardrails` — the custody contract: `custody: "injected_wallet"`,
  `buyerPrivateKeyReceivedByServer: false`, `spendCeilingRaw`,
  `approvalMode: "exact_if_required"`, `approvalSpender` (the Commerce contract),
  `cancellationAvailableAfterFunding: false`.

Before signing, verify the plan and quote against a **locally pinned allowlist** of
contract addresses — not against each other. This is what gives the check its value:
a malicious or buggy server could return a plan and quote that are mutually
consistent but point at the wrong contracts. The browser adapter's
`validateHirePlan` pins the quote's commerce/router/policy/token/seller/agentId to
hard-coded deployment constants, then checks `0 < priceRaw ≤` the pinned budget
ceiling, `approvalAmountRaw` is `priceRaw` iff approval is required and `"0"`
otherwise, `maximumSignatures` consistency, `tokenBalanceRaw ≥ priceRaw`,
`nativeBalanceRaw > 0`, the deadline within `(now, now + disputeWindow + 7200]`, and
`executeBefore === quoteExpiresAt` still in the future.

## Step 4 — Execute the five transactions

Exact calls, in order (ABIs in `src/data/erc8183/contracts.ts`; the reference
implementation is `executeBrowserHire` in `src/data/erc8183/browser-wallet-adapter.ts`):

| # | Contract | Call |
|---|---|---|
| 1 | Commerce | `createJob(provider, evaluator, expiredAt, description, hook)` with `provider = plan.seller`, `evaluator = router`, `expiredAt = plan.deadline`, `description = quote.description`, `hook = router` |
| 2 | Router | `registerJob(jobId, policy)` |
| 3 | Commerce | `setBudget(jobId, priceRaw, "0x")` |
| 4 | Token | `approve(commerce, priceRaw)` — only when `approvalRequired`; exact amount, never unlimited |
| 5 | Commerce | `fund(jobId, priceRaw, "0x")` |

Mechanics the reference implementation applies and a programmatic buyer should too:

- **Simulate, then write**: `simulateContract` with the buyer account, then send the
  returned request; wait for the receipt, require `status: success`, and check the
  transaction's `to` equals the intended contract.
- **jobId** comes from the `JobCreated(jobId, client, provider, …)` event in the
  `createJob` receipt (`client` is the buyer).
- **Resume semantics**: steps 2, 3 and 4–5 are individually skippable when a previous
  run already registered, budgeted or funded the job — recover the job by id and check
  its state before re-sending.
- **Orphan warning**: if execution stops after `createJob`, an unfunded job exists
  onchain. It is harmless (nothing was paid) but must be resumed or abandoned
  explicitly; `fund` takes an explicit `expectedBudget` argument so the funding
  amount is stated by the buyer rather than read from job state.
- **Atomic alternative**: a wallet supporting EIP-5792 `wallet_sendCalls` can submit
  the five calls as one atomic batch (plan P6), removing the intermediate states.
  This is what the browser flow does first; see below.

### Batched execution (EIP-5792)

For a fresh hire (no stored journal, no job to recover) `executeBrowserHire` asks
the wallet `wallet_getCapabilities` for the target chain and, when `atomic.status`
is `supported` or `ready`, sends the intents as one `wallet_sendCalls` batch with
`atomicRequired: true` — one wallet confirmation, and either every call lands or
none does. The helpers are in `src/data/erc8183/batched-hire.ts`:

- **Job id prediction**: calls 2–5 need the job id that `createJob` only assigns
  on chain, so the batch uses `jobCounter() + 1` (Commerce assigns `++jobCounter`;
  verified on BSC Testnet 2026-09-03). A wrong prediction is harmless: `registerJob`
  and `setBudget` are client-checked, a foreign id reverts, and the atomic batch
  rolls back including `createJob`.
- **Simulation**: only `createJob` can be simulated before the job exists; the rest
  is protected by atomicity.
- **Confirmation**: `wallet_getCallsStatus` until `success`; the confirmed job id is
  read from the `JobCreated` event across the returned receipts (one per call or one
  for the batch) and must equal the prediction. The journal then records `created`,
  `registered`, `budgeted`, `approved` (if any) and `funded` with the receipt hashes,
  so hire-event reporting is unchanged.
- **Fallback**: a wallet without atomic capabilities, or one answering that
  `wallet_sendCalls` is unsupported, takes today's sequential path (five
  confirmations). Resume and recovery always use the sequential path, which can
  skip the steps chain already shows as done. A user rejection propagates as such.
- **No permit**: the exact `approve` stays a call inside the batch; EIP-2612 permit
  is not used in this iteration.

## Step 5 — Notify the seller

`POST …/notify` with `{ "buyer": "<address>", "jobId": "<decimal string>" }`. The job
must be `FUNDED` (else `409`). Response: `{ acknowledged: true, alreadySubmitted,
sellerTransactionHash?, job }` — the seller proceeds to submit its deliverable.

## Step 6 — Track and verify the result

The two networks return different shapes:

- `GET /api/marketplace/jobs/testnet/{jobId}` → `{ liveStatus: "verified" |
  "unavailable", job, snapshot }`; when the live chain read fails but a stored
  snapshot exists, `job` is `null` and the snapshot is served with
  `liveStatus: "unavailable"`.
- `GET /api/marketplace/jobs/mainnet/{jobId}` → `{ job }`.

Both routes only expose jobs matching the fixed demo allowlist; anything else is
`404 ERC8183_DEMO_JOB_NOT_FOUND` — expect it when polling a job id outside the
allowlisted seller's bounds. Job status machine: `OPEN → FUNDED → SUBMITTED →
COMPLETED`, with `REJECTED` and `EXPIRED` as terminal failures. `deliverableHash` is
read from chain; when the deliverable content is available, `job.result` carries
`hashVerified: true` only if the fetched content matches the onchain hash. Do not
trust a deliverable whose hash was not verified.

## Error handling summary

All error bodies are `{ "error": { "code", "message" } }` (tables in API.md). The
codes a programmatic buyer must branch on: `ERC8183_SPIKE_DISABLED` (404 — flow off,
do not retry), `ERC8183_DEMO_JOB_NOT_FOUND` (404 — job outside the demo allowlist),
`ERC8183_QUOTE_REJECTED` (409 — get a fresh quote; do not modify the old one),
`ERC8183_JOB_NOT_READY` (409 — fix balances/preconditions, then retry),
`ERC8183_SPIKE_UNAVAILABLE` (503 — either a genuinely unavailable seller/chain OR a
quote that failed signature/binding re-verification; the safe recovery is always to
request a fresh quote, then retry with backoff — never resubmit the same envelope
unchanged after editing it).

## Non-claims

- This spec covers the marketplace's demo-gated, allowlisted hire path — one admitted
  seller per network with a bounded budget. It is not a general ERC-8183 client spec.
- MCP or A2A reachability of any agent implies nothing about hireability; only steps
  2–5 hire.
- Quote requests are free and unsigned on the buyer side; the buyer's wallet is first
  used in step 4.
