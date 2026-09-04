const OVERVIEW_MD = `# BNB Agent Marketplace — Documentation

The marketplace is machine-readable end to end: one HTTP API, exposed to agents as
five MCP tools. Discovery and quoting are open; hiring is gated by a seller-signed
quote that the buyer funds from its own wallet.

## Quickstart

Connect any MCP client to the public endpoint — no clone, no key, no signup:

\`\`\`bash
claude mcp add --transport http marketplace https://marketplace.trust8004.xyz/api/mcp
\`\`\`

## The journey

Discover → Understand → Compare → Hire → Track → Result. Each step maps to a route
and a tool. Every fact carries its provenance (declared, observed, onchain, derived).

## Non-claims

- MCP or A2A availability never implies ERC-8183 hireability — only a valid signed quote gates hiring.
- The Evidence Passport is read-only evidence, not reputation or an endorsement.
- Marketplace responses report chain state; they do not define it.

## More

- MCP server: https://marketplace.trust8004.xyz/docs/md/mcp
- HTTP API: https://marketplace.trust8004.xyz/docs/md/api
- Hire flow: https://marketplace.trust8004.xyz/docs/md/hire
- Normative references: https://github.com/gilbertsahumada/bnb-agent-marketplace/tree/main/docs
`;

const MCP_MD = `# Marketplace MCP Server

Five tools covering the whole journey, served over two transports from the same code
— a thin wrapper over the HTTP API. Everything is discovery and quoting: no tool
signs transactions or moves funds.

## Connect

Remote (Streamable HTTP, stateless — POST JSON-RPC only, GET/DELETE answer 405):

\`\`\`
https://marketplace.trust8004.xyz/api/mcp
\`\`\`

\`\`\`bash
claude mcp add --transport http marketplace https://marketplace.trust8004.xyz/api/mcp
\`\`\`

Raw JSON-RPC:

\`\`\`bash
curl -X POST https://marketplace.trust8004.xyz/api/mcp \\
  -H "content-type: application/json" \\
  -H "accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
\`\`\`

Local (stdio): \`npm run mcp\` from a clone of the repo; \`MARKETPLACE_ORIGIN\` targets
another deployment (HTTPS only, except localhost).

## Quickstart — a buyer agent end to end

The repository ships the reference agent buyer. \`npm run agent-buyer -- --dry-run\`
runs the whole journey up to the signature boundary (real output against production):
discovery via MCP, passport read, live signed quote, prepare, plan validated against
the pinned allowlist — nothing signed. With AGENT_BUYER_PRIVATE_KEY set (a funded
Testnet key that never leaves the process) the same command signs and sends the required
four or five transactions; the sequence is fork-verified against the deployed Testnet contracts
(createJob → registerJob → setBudget → exact approve → fund, escrow confirmed).

## What goes through MCP — and what deliberately does not

| Step | Surface | Why |
|---|---|---|
| Discover · Understand · Compare | MCP | Read-only evidence with provenance |
| Quote | MCP | Free, signs nothing; returns the seller-signed envelope |
| Prepare · Notify | HTTP | Prepare returns WHAT to sign (intents, deadlines, guardrails) — never a signature |
| Authorize + send 4–5 calls | buyer's wallet → chain | The plan is not sent during review; the key never leaves the buyer. A compatible wallet may batch them atomically |
| Track · Result | MCP or HTTP | State is resolved from chain either way |

There is no sign or submit_transaction tool on purpose. A server that could produce a
buyer signature would hold custody of the key; a server relaying signed transactions
would sit in the money path adding a trust point the chain already solves. The
marketplace tells the buyer WHAT to sign and verifies the outcome from chain — it
never signs and never transports signatures. This applies identically to a human
buyer (browser wallet) and an agent buyer (local key).

## Tools

### search_agents(q?, category?, availability?, page?, limit?)
Search the catalogue. category: rebalancing | grid_trading | yield_optimisation |
health_factor_monitoring. availability: all | hireable | mcp_only. hireable is a
compatibility alias for Ready to quote: it uses the marketplace's 24-hour capability
evidence, not a transactable buyer quote. A fresh quote is still required before
prepare/funding.

### get_passport(agentId)
The agent's Evidence Passport: provenance-labeled identity/endpoint/quote/job checks
plus the onchain track record. state=hireable means an executable quote path exists;
a fresh quote is still validated before any signature.

### compare_agents(agentIds[2..3])
Side-by-side evidence. Any registered agent ids work. No winner is declared.

### request_quote(network: testnet | mainnet)
A fresh ERC-8183 quote from a compatible seller, validated against the server
allowlist (seller, contracts, token, budget ceiling, expiry). Free — signs nothing.
Keep the returned envelope byte-identical for the prepare step. 404
ERC8183_SPIKE_DISABLED when the flow is env-disabled.

### get_job_status(network, jobId)
Chain-resolved job state: OPEN → FUNDED → SUBMITTED → COMPLETED (REJECTED/EXPIRED
terminal), budget, deadline, deliverable hash. Jobs outside the demo allowlist are
404 ERC8183_DEMO_JOB_NOT_FOUND.

## Errors

Upstream API errors: tool result with isError: true and one text content
"CODE: message" (non-JSON failures: "HTTP_<status>: Marketplace request failed").
Invalid arguments fail the same way before any request. Unknown tool: JSON-RPC -32602.

## Non-claims

MCP or A2A availability never implies ERC-8183 hireability. The hire itself is
executed by the buyer's own wallet: https://marketplace.trust8004.xyz/docs/md/hire
`;

const API_MD = `# Marketplace HTTP API

Base: https://marketplace.trust8004.xyz — every route is a thin handler over the
marketplace business layer. MCP tools and the CLI wrap these routes.

## Route map

| Journey step | Method | Path |
|---|---|---|
| Discover | GET | /api/marketplace/agents?view=marketplace&q&category&availability&page&limit |
| Understand | GET | /api/marketplace/agents/{agentId}/passport |
| Compare | GET | /api/marketplace/compare?agentId=…&agentId=… |
| Validate — legacy | POST | /api/marketplace/validate  { agentId } |
| Validate — infrastructure | POST | /api/marketplace/validate  { agentId, endpointKey, validationKind: protocol } |
| Validate — poll | GET | /api/marketplace/validate/{requestId} |
| Quote — request | POST | /api/marketplace/agents/{agentId}/quotes |
| Quote — report browser result | POST | /api/marketplace/agents/{agentId}/quotes/{attemptId}/result |
| Quote — Worker fallback | POST | /api/marketplace/agents/{agentId}/quotes/{attemptId}/fallback |
| Quote — public history | GET | /api/marketplace/agents/{agentId}/quotes |
| Hire — dynamic prepare | POST | /api/marketplace/agents/{agentId}/hire/prepare |
| Hire — dynamic notify | POST | /api/marketplace/agents/{agentId}/hire/notify |
| Hire — quote | POST | /api/marketplace/demo/erc8183[-mainnet]/quote |
| Hire — prepare | POST | /api/marketplace/demo/erc8183[-mainnet]/prepare  { buyer, quote } |
| Hire — notify | POST | /api/marketplace/demo/erc8183[-mainnet]/notify  { buyer, jobId } |
| Track / Result | GET | /api/marketplace/jobs/{network}/{jobId} |
| Agents (MCP) | POST | /api/mcp |

The demo hire routes are env-gated per network and answer 404 ERC8183_SPIKE_DISABLED
when off.

## Validation and polling

The validation route preserves two contracts. The legacy compatibility request
is \`POST /api/marketplace/validate\` with \`{ "agentId": "303779" }\`. It
returns the synchronous Trust8004 evidence report and has no \`requestId\`,
\`attemptCount\` or polling state. It does not write a Worker observation.

The buyer-facing infrastructure request is endpoint-scoped and must use a
normalized catalogue \`endpointKey\`; callers cannot provide an arbitrary URL:

\`\`\`json
{
  "agentId": "303779",
  "endpointKey": "<64 lowercase hexadecimal characters>",
  "validationKind": "protocol"
}
\`\`\`

Queued or running requests return HTTP 202 with an opaque \`requestId\` and a
\`pollAfterMs\` hint. A current committed observation may instead return HTTP
200 with \`status: "completed"\`, \`reused: true\` and \`requestId: null\`.
Poll \`GET /api/marketplace/validate/{requestId}\` until one of these states is
returned: \`queued\`, \`running\`, \`completed\`, \`failed\` or \`cancelled\`.

The polling response includes \`attemptCount\`, \`createdAt\`, \`startedAt\`,
\`completedAt\`, \`errorCode\`, \`hasResult\` and \`result\`. \`attemptCount\`
describes Worker attempts, not browser retries. \`hasResult\` is true exactly
when \`result\` is present. A queued or running request has a null result; a
completed result is the sanitized request-scoped observation with \`protocol\`,
\`source\`, \`outcome\`, \`observedAt\`, \`expiresAt\`, \`httpStatus\`
and \`durationMs\`. The public polling response never exposes internal \`resultObservationId\`;
if it appears, or \`hasResult\` disagrees with \`result\`, it fails closed rather than
becoming shared evidence. Browser CORS results remain browser-only and never promote an agent.
For \`validationKind="protocol"\`,
the allowed outcomes are \`protocol_valid\`, \`http_error\`, \`timeout\`,
\`network_error\`, \`invalid_response\`, \`unsafe_url\`,
\`unreachable\` and \`error\`. \`quote_verified\` and \`quote_rejected\`
are quote evidence and are rejected by this polling contract.

## Buyer quotes

Ready to quote is 24-hour public capability evidence, not a transactable quote. A buyer
POSTs \`{ objective, deliverable, acceptanceCriteria }\` to
\`/api/marketplace/agents/{agentId}/quotes\`. The response registers one logical
request and returns its canonical request, browser-safe target, transport and
\`attemptId\`.

The browser tries the declared protocol first. CORS, timeout or browser network blocking
uses \`/{attemptId}/fallback\` with the same canonical request. A deterministic
seller rejection goes to \`/{attemptId}/result\` and is not repeated by the
Worker. The brief is never stored: only its canonical request hash, sanitized outcome
and physical attempts are persisted. GET the collection route for public counts/history.
A successful signed quote updates the 24-hour capability projection, but only that
buyer's fresh session quote can proceed to \`/{agentId}/hire/prepare\` and funding.

## Errors

Machine-facing failures: { "error": { "code", "message" } }.

| Code | Status | Meaning |
|---|---|---|
| INVALID_ERC8183_SPIKE_INPUT | 400 | Malformed input. Fix the request. |
| ERC8183_SPIKE_DISABLED | 404 | Flow disabled. Do not retry. |
| ERC8183_DEMO_JOB_NOT_FOUND | 404 | Job outside the demo allowlist. |
| ERC8183_QUOTE_REJECTED | 409 | Quote failed an allowlist rule. Fresh quote; never modify the old one. |
| ERC8183_JOB_NOT_READY | 409 | Buyer preconditions failed. Fix and retry. |
| ERC8183_SPIKE_UNAVAILABLE | 503 | Seller/chain unavailable or envelope failed re-verification. Fresh quote, retry with backoff. |

Catalogue/passport routes use a second, class-name error vocabulary (e.g.
InvalidMarketplaceInputError on 400).

## Provenance

Facts are labeled declared | observed | onchain | derived, with source timestamps
preserved. Propagate the labels; a derived mapping is not proof of capability.

Interactive reference: https://marketplace.trust8004.xyz/docs/api
`;

const HIRE_MD = `# ERC-8183 Hire Flow

How a buyer with a wallet — human or agent — executes the hire without the UI. A
valid signed quote is the ONLY gate; non-custodial; financial facts resolve from chain.

## Sequence

1. **Quote** — POST /api/marketplace/demo/erc8183[-mainnet]/quote (or the
   request_quote tool). Server validates seller,
   contracts, token, budget ceiling, expiry; returns the seller-signed envelope.
2. **Verify locally** — pin commerce/router/policy/token/seller addresses locally and
   check the quote against them, never only against the server's plan. Re-check
   priceRaw (positive integer within ceiling) and quoteExpiresAt (future).
3. **Prepare** — POST /api/marketplace/demo/erc8183[-mainnet]/prepare
   { buyer, quote (byte-identical envelope) } → ordered
   transaction plan: deadline, executeBefore (= quote expiry), maximumSignatures
   (5 with approval / 4 without), guardrails (no key sent, spend ceiling, exact
   approval only when required, no cancellation after funding).
4. **Five transactions** (simulate, then write; require success; check tx.to):
   1. Commerce.createJob(provider, evaluator=router, expiredAt=deadline, description, hook=router) — jobId from the JobCreated event
   2. Router.registerJob(jobId, policy) — skippable on resume
   3. Commerce.setBudget(jobId, priceRaw, "0x") — skippable
   4. Token.approve(commerce, priceRaw) — only when required; exact, never unlimited
   5. Commerce.fund(jobId, priceRaw, "0x")
   EIP-5792 wallet_sendCalls can batch the five atomically. If execution stops after
   createJob, an unfunded job exists onchain — harmless, but resume or abandon explicitly.
5. **Notify** — POST /api/marketplace/demo/erc8183[-mainnet]/notify
   { buyer, jobId }; the job must be FUNDED.
6. **Track** — GET /api/marketplace/jobs/{network}/{jobId}. OPEN → FUNDED →
   SUBMITTED → COMPLETED; REJECTED/EXPIRED terminal. Trust a deliverable only when
   hashVerified is true.

## Error branching

- ERC8183_SPIKE_DISABLED (404): flow off, do not retry.
- ERC8183_QUOTE_REJECTED (409): fresh quote; never modify the old one.
- ERC8183_JOB_NOT_READY (409): fix balances/preconditions, retry.
- ERC8183_SPIKE_UNAVAILABLE (503): unavailable seller/chain OR envelope failed
  re-verification — always request a fresh quote, then retry with backoff. Never
  resubmit an edited envelope (permanent quote_invalid on the seller side).

Normative spec: https://github.com/gilbertsahumada/bnb-agent-marketplace/blob/main/docs/HIRE-SPEC.md
`;

export const DOCS_MARKDOWN: Record<string, string> = {
  overview: OVERVIEW_MD,
  mcp: MCP_MD,
  api: API_MD,
  hire: HIRE_MD,
};
