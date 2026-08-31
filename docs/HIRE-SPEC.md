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
endpoint        seller's A2A endpoint
commerce, router, policy, token   contract addresses the job will use
tokenSymbol, tokenDecimals
priceRaw        decimal string, raw units
priceDisplay    human formatting only
negotiatedAt, quoteExpiresAt      unix seconds
description     job description the quote covers
```

The server has already validated the quote against the allowlist
(`assertAllowedQuote`); each failure is `409 ERC8183_QUOTE_REJECTED`:

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
Failures: `400 INVALID_ERC8183_SPIKE_INPUT` (malformed buyer), `409
ERC8183_QUOTE_REJECTED` (envelope re-validation), `409 ERC8183_JOB_NOT_READY` when the
buyer preconditions fail — policy not allowlisted by the Router, token balance below
`priceRaw`, or zero native balance.

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

Before signing, verify the plan against the quote (the browser adapter's
`validateHirePlan` does exactly this): contract addresses match the quote, `0 <
priceRaw ≤ spendCeilingRaw`, `approvalAmountRaw` is `priceRaw` iff approval is
required and `"0"` otherwise, `tokenBalanceRaw ≥ priceRaw`, `nativeBalanceRaw > 0`,
and `executeBefore` is still in the future.

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
  explicitly; `fund` passes `expectedBudget` so a mismatched budget reverts instead of
  paying the wrong amount.
- **Atomic alternative**: a wallet supporting EIP-5792 `wallet_sendCalls` can submit
  the five calls as one atomic batch (plan P6), removing the intermediate states.

## Step 5 — Notify the seller

`POST …/notify` with `{ "buyer": "<address>", "jobId": "<decimal string>" }`. The job
must be `FUNDED` (else `409`). Response: `{ acknowledged: true, alreadySubmitted,
sellerTransactionHash?, job }` — the seller proceeds to submit its deliverable.

## Step 6 — Track and verify the result

`GET /api/marketplace/jobs/testnet/{jobId}` (or `…/jobs/mainnet/{jobId}`). Job status
machine: `OPEN → FUNDED → SUBMITTED → COMPLETED`, with `REJECTED` and `EXPIRED` as
terminal failures. `deliverableHash` is read from chain; when the deliverable content
is available the response carries `result.hashVerified: true` only if the fetched
content matches the onchain hash. Do not trust a deliverable whose hash was not
verified.

## Error handling summary

All error bodies are `{ "error": { "code", "message" } }` (tables in API.md). The
codes a programmatic buyer must branch on: `ERC8183_SPIKE_DISABLED` (404 — flow off,
do not retry), `ERC8183_QUOTE_REJECTED` (409 — get a fresh quote; do not modify the
old one), `ERC8183_JOB_NOT_READY` (409 — fix balances/preconditions, then retry),
`ERC8183_SPIKE_UNAVAILABLE` (503 — transient, retry with backoff).

## Non-claims

- This spec covers the marketplace's demo-gated, allowlisted hire path — one admitted
  seller per network with a bounded budget. It is not a general ERC-8183 client spec.
- MCP or A2A reachability of any agent implies nothing about hireability; only steps
  2–5 hire.
- Quote requests are free and unsigned on the buyer side; the buyer's wallet is first
  used in step 4.
