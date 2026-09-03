# Frontend Hire Journey — Specification

**Status:** In implementation
**Date:** 2026-09-02
**Owner:** Marketplace integration
**Companion specification:** `docs/OBSERVATION_INFRASTRUCTURE_SPEC.md`

**Related authorities:** `docs/API.md` defines the public machine-readable API and
`docs/HIRE-SPEC.md` defines the programmatic ERC-8183 transaction flow. This
document governs the browser journey and must not introduce a second public API or
a second hiring protocol.

### Document relationship

This specification and its companion define the next product migration. They do not retroactively rewrite WP2 evidence or its frozen measured bundle in `docs/SPEC-MVP.md`. If implementation changes an existing WP2 invariant, the integrating change must update `docs/SPEC-MVP.md` and `docs/DECISIONS.md` explicitly, with new evidence where required.

## 1. Purpose

Build a single, hire-first buyer journey for discovering an agent, understanding why it can or cannot be hired, requesting fresh evidence when useful, obtaining a quote, and entering the non-custodial ERC-8183 transaction flow.

The product journey remains:

```text
Discover → Understand → Compare → Hire → Track → Result
```

This document owns the browser experience from discovery through the handoff to the ERC-8183 transaction flow. The companion infrastructure specification owns discovery ingestion, endpoint classification, scheduled and on-demand validation, persistence, and the API contract consumed here.

## 2. Scope and ownership

### 2.1 This session owns

- `/agents`: catalog, filters, search, cards/table, loading and empty states.
- `/hire/[agentId]`: the canonical agent detail and hiring page.
- The temporary compatibility redirect from `/agents/[agentId]`.
- Direct browser validation for declared operational endpoints when technically possible.
- Display of evidence, provenance, freshness, failures and blockers.
- The UI handoff into the ERC-8183 quote and transaction interfaces owned by the hiring session.
- Frontend tests, accessibility, responsive behavior and analytics events.

### 2.2 This session does not own

- trust8004 ingestion, D1 migrations, Queue consumers or Worker scheduling.
- Declaring browser observations as marketplace-verified evidence.
- Seller signature verification or authoritative chain reads.
- Construction, signing or submission of ERC-8183 buyer transactions.
- Job tracking after creation, except for linking to `/jobs/[jobId]`.

### 2.3 Integration boundaries

| Area | Authority | Expected files |
| --- | --- | --- |
| Catalog and hire UI | Frontend | `app/agents/**`, `app/hire/**`, `components/marketplace/**`, related UI tests and styles |
| Discovery and observations | Infrastructure | `bnb-agent-probe/**`, D1 migrations, Worker routes and integration tests |
| ERC-8183 lifecycle | Hiring | quote/prepare/submit use cases, transaction APIs, wallet and job-flow components |
| Shared catalog DTOs | Infrastructure first, frontend consumes | API schema/fixtures and the minimum mapping code needed by the app |
| Architecture decisions | Integrating session | `docs/DECISIONS.md`, after rebasing all three work streams |

Avoid overlapping edits to shared DTO and decision files. The infrastructure contract is already merged; the frontend consumes it, and the hiring flow integrates through the explicit interfaces in §10.

## 3. Shared truth model

Every statement shown to a user must identify its evidence class:

| Evidence class | Meaning | May establish global state? |
| --- | --- | --- |
| `declared` | Taken from ERC-8004/trust8004 metadata | No; it is self-declared |
| `browser_observed` | This browser obtained a protocol-valid response | No, unless the response contains independently verifiable signed evidence |
| `platform_observed` | Marketplace Worker validated the declared endpoint | Yes, with timestamp and scope |
| `cryptographically_verified` | Backend validated a seller signature and terms | Yes, for that exact agent/quote |
| `onchain` | Read from BSC contracts or transaction receipts | Yes, with chain, block and transaction provenance |

Required rules:

- `reachable` does not mean `hireable`.
- A generic HTTP `200` does not prove an agent protocol or commerce capability.
- A2A or MCP reachability does not prove ERC-8183 support.
- CORS blocking does not prove an endpoint is unreachable.
- A quote belongs to one agent identity and cannot be shared across agent IDs merely because they share an endpoint.
- Financial facts and job state come from chain, never from cached metadata.
- “Created by BNB Agent Studio” must not be shown without a verifiable source marker. The registry also contains agents created by other tools.

## 4. Canonical routes and navigation

### 4.1 `/agents`

The discovery surface. It shows operational candidates and their truthful current state. It must not imply that every registered ERC-8004 identity is hireable.

Default behavior:

- Default network without a connected wallet: BSC Mainnet.
- Connected wallet: use its supported BSC network; update all labels, links and contract configuration together.
- Main inventory prioritizes agents with a machine-operational declaration.
- Public registry identities remain discoverable through secondary filters, not as a competing product universe.
- Filters are combinable and represented in the URL.
- Typing in search updates results after a short debounce; no submit button is required.
- Filter changes show result-level loading feedback and preserve the surrounding layout.
- A visible `Clear filters` action resets search, evidence, outcome, view and pagination.
- Desktop: fixed filter column and independently scrollable results region when viewport height permits.
- Small screens: a filter icon button appears left of search and opens a drawer/sheet.
- Cards are the default view; table is the alternative.

### 4.2 `/hire/[agentId]`

The canonical detail and action page. It combines what used to be a profile with the hiring decision and flow.

Required sections, in this order:

1. Compact identity row: image, name, BSC network, Agent ID, reachability,
   proven-job count and the external identity/reputation link.
2. One checkout with four states: `Quote → Review → Fund → Track`. Only the
   current state is expanded, and its control is the page's only primary CTA.
3. Compact hire summary: agent, network, normalized quote and connected wallet.
4. Collapsed contract/permission details, expanded only on buyer demand.
5. Agent-scoped ERC-8183 job history with links to the corresponding job proof.

The CTA names the next real action (`Request quote`, `Prepare hire`, `Create &
fund job`, `Open tracker`); the page title does not duplicate it. Quote requests
also refresh seller evidence, so an admitted seller does not require a separate
reachability action before negotiation.

ERC-8004 identity details, metadata, services, tools, trust score and reputation
are not duplicated on this route. A secondary link sends users to the agent's
trust8004 page for those facts. The marketplace route remains useful when an
agent cannot yet be hired: the checkout either begins the permitted availability
check or shows one concise blocker.

### 4.3 `/agents/[agentId]`

Compatibility only:

- First release: temporary redirect to `/hire/[agentId]` so rollback remains possible.
- After production verification and link migration: permanent redirect.
- No independent profile implementation or duplicated data fetching remains here.

### 4.4 `/jobs/[jobId]`

Remains separate. It tracks an already-created job, chain state and result; it is not part of the profile/hire merge.

## 5. Catalog presentation

### 5.1 One destination, one primary CTA

Cards and table rows expose one product destination:

- Clicking the name/card opens `/hire/[agentId]`.
- `Hire agent` opens the corresponding quote/transaction section when commerce is admitted.
- `Hire agent` opens the required availability check when an operational commerce endpoint exists but current evidence is missing, stale or failed.
- `View agent` still opens the canonical page when no supported commerce path exists; the page includes the concise blocker instead of presenting a dead Hire control.
- Remove the separate `View profile`, `Request quote`, `Continue hire` and
  `Check availability` catalogue labels. The destination explains the precise
  next step while the catalogue consistently presents the product action.
- The Agent ID itself links externally to trust8004 in a new tab.

### 5.2 Card information hierarchy

Always visible:

- Image or deterministic fallback.
- Agent name.
- `BSC Mainnet` or `BSC Testnet` according to the active data/chain context.
- Linked Agent ID.
- One commerce/readiness badge.
- One outcome/category badge when known.
- Four compact evidence stages: Declared, Reachable, Quote verified, Job proven.
- One primary CTA.

Details belong in tooltips or the hire page, not under every stage. Stage styling:

- Verified/success: green icon, border and connecting line.
- Latest effective attempt failed: red border/line and red failure marker; base icon remains muted.
- Pending/not observed: neutral gray.
- Browser-only observation: distinct informational treatment; never the verified green state.
- Onchain proof: visually identified as onchain, with transaction link.

### 5.3 Table view

The table presents the same facts and actions as cards. It is not a second product model. Columns:

```text
Agent | Outcome | Operational protocols | Latest platform check | Commerce | Evidence | Action
```

Both views must use the same server-provided state and state-to-label mapping.

## 6. Shared state contract consumed from the backend

The frontend must consume authoritative, normalized fields. It must not derive critical readiness from arbitrary observations.

```ts
type EvidenceSource =
  | "declared"
  | "browser_observed"
  | "platform_observed"
  | "cryptographically_verified"
  | "onchain";

type OperationalStatus =
  | "pending"
  | "browser_observed"
  | "platform_reachable"
  | "platform_failed"
  | "invalid_declaration"
  | "unsafe"
  | "unsupported";

type Freshness = "never" | "live" | "historical" | "stale";

type CommerceStatus =
  | "none"
  | "declared"
  | "admission_pending"
  | "admitted"
  | "suspended";

type QuoteStatus =
  | "not_supported"
  | "not_requested"
  | "verified_fresh"
  | "verified_historical"
  | "rejected";

type BuyerAction =
  | "unavailable"
  | "check_availability"
  | "request_quote"
  | "prepare_hire";
```

The API also returns capabilities and blockers:

```ts
type AgentCapabilities = {
  canRequestBrowserValidation: boolean;
  canRequestInfrastructureValidation: boolean;
  canRequestQuote: boolean;
  canPrepareHire: boolean;
  blockingReasons: string[];
};
```

The UI maps these values to copy; it does not recompute them from raw rows.

## 7. Direct browser validation

### 7.1 Goal

Allow a visitor to validate a declared operational endpoint directly from their browser when the endpoint permits it, reducing marketplace infrastructure work and producing immediate local feedback.

### 7.2 Eligible targets

Only normalized operational declarations supplied by the backend:

- A2A Agent Card.
- MCP endpoint.
- ERC-8183 HTTP endpoint following a declared, supported convention.

Never offer endpoint testing for:

- website;
- Twitter/X;
- Telegram;
- GitHub repository;
- documentation;
- arbitrary user-entered URLs.

The browser submits `agentId`, `endpointKey` and `validationKind`; it does not choose an untrusted URL outside the catalog contract.

### 7.3 Protocol checks

- **A2A:** fetch the declared Agent Card, validate its structure, declared URL and skills.
- **MCP:** `initialize` → `notifications/initialized` → `tools/list`; report per-stage timing and failure.
- **ERC-8183 HTTP:** GET the exact normalized resource declared by the agent. Accept either the legacy `{status: "ok"}` convention or a structured `erc8183` support declaration; never invent `/health` or `/status` suffixes. Request a quote only on buyer demand.
- **Quote:** preserve the exact signed seller payload so the backend can independently verify it. Parsed fields alone are insufficient.

### 7.4 Result handling

| Browser result | UI | Global effect |
| --- | --- | --- |
| Protocol-valid unsigned response | Immediate `Observed in this browser` | Store only as `browser_reported`; does not certify reachability |
| Valid signed seller quote | Show pending verification, submit exact artifact | Backend may promote to `quote_verified` after signature/terms/chain validation |
| CORS blocked | “Browser verification blocked by CORS; endpoint may still be operational” | Offer infrastructure fallback; do not mark failed |
| Network/timeout | Report local attempt and time | May be stored as browser evidence; do not mark platform failure |
| Invalid protocol response | Explain mismatch | Browser-only evidence until platform confirms |

Successful unsigned browser checks do not remove scheduled backend validation. Only cryptographically verifiable evidence can update a global verified state without a marketplace fetch.

### 7.5 Infrastructure fallback

When direct browser validation is impossible or inconclusive:

1. User chooses `Verify with marketplace infrastructure`.
2. Frontend submits the catalog-provided `agentId`, `endpointKey` and
   `validationKind: "protocol"` to `POST /api/marketplace/validate`. It never sends
   an arbitrary URL or calls the Worker directly.
3. A fresh, running or queued validation is reused rather than duplicated.
4. UI displays queued/running/completed state and polls
   `GET /api/marketplace/validate/:requestId` with bounded backoff. The returned
   request ID is an opaque application token, not a Worker/D1 identifier.
5. The final platform observation becomes visible to all users.

## 8. Hire-page state machine

| Conditions | Primary UI state | Primary action |
| --- | --- | --- |
| No supported commerce declaration | Explain unsupported commerce | Unavailable |
| Commerce declared, endpoint never checked | Validation pending | Check availability |
| Latest platform check failed | Show failure, timestamp and attempts | Revalidate when eligible |
| Platform reachable, admission pending | Explain remaining admission checks | Check availability |
| Commerce admitted, no fresh quote | Ready to negotiate | Request quote |
| Browser returned signed quote, backend verifying | Verifying seller quote | Wait/retry status |
| Quote verified and current chain checks pass | Transaction preview ready | Prepare hire |
| Quote expired or chain facts changed | Explain invalidation | Request new quote |
| Job created | Onchain job link | Track job |

“Hireable” means that the marketplace has admitted a supported commerce path and can request a fresh quote. It does not mean a cached monitoring result authorizes a transaction. `Prepare hire` requires a fresh verified quote and current chain checks.

## 9. Network and wallet behavior

- With no wallet connected, render BSC Mainnet data and identify the network in contextual content, not a permanent redundant banner.
- Testnet evidence must never appear as Mainnet evidence.
- Connecting an unsupported network does not silently mix data; request a supported network switch.
- All explorer, trust8004, contract and transaction links use the active chain configuration.
- Wallet connection is not required to browse, inspect evidence, validate an endpoint or request an unsigned seller quote.
- Wallet interaction begins only when the buyer prepares/signs a transaction.
- Before any signature show token, allowance, budget, deadline, target contract and transaction intent.

## 10. Interface with the ERC-8183 hiring session

The hiring session provides these capabilities behind stable application interfaces:

1. `requestQuote(agentId, endpointKey, requirements)` returns the exact signed quote envelope plus parsed display fields.
2. `verifyQuote(...)` is authoritative only after backend validation.
3. `prepareHire(agentId, verifiedQuoteId)` returns current onchain facts and transaction intents.
4. `submitHire(...)` uses the connected wallet and returns transaction/job identifiers.

The frontend session owns presentation and orchestration, not signature or financial validation. The infrastructure session may persist verified quote evidence, but it must not submit buyer transactions.

## 11. API dependencies

The browser consumes only the application API under `/api/marketplace/*`, as
documented in `docs/API.md`. It never calls the Cloudflare Worker's `/catalog-*`
routes directly. The application server composes the public response from the
internal Worker data plane and the existing business use cases.

Required public capabilities:

- `GET /api/marketplace/agents` with combinable filters, search and pagination.
- `GET /api/marketplace/agents/:agentId` and
  `GET /api/marketplace/agents/:agentId/passport` for detail, evidence and blockers.
- `POST /api/marketplace/validate` as the bounded public request for a fresh
  endpoint-scoped validation, plus `GET /api/marketplace/validate/:requestId` for its
  opaque status token. The legacy `{agentId}` compatibility body remains available
  for the existing ad-hoc report, but it is not the infrastructure fallback.
- The network-specific ERC-8183 quote, prepare, notify and tracking routes already
  defined in `docs/API.md` and `docs/HIRE-SPEC.md`.

Unsigned browser observations and exact quote-evidence ingestion may cross the
application boundary through authenticated server-side adapters, but their Worker
routes are not browser or machine-client contracts. CLI and MCP clients use the same
`/api/marketplace/*` surface as every other programmatic buyer.

The application must fail closed for critical claims. If the API is unavailable, show an availability error and retain only clearly labeled historical data already in the response/cache. Do not substitute a bundled snapshot as if it were current.

## 12. Loading, error and empty states

- `/agents/loading.tsx` mirrors the catalog shell, fixed/overlay filters, search controls and card/table geometry.
- Filter/search transitions retain controls and show skeletons or a progress state only in the result region.
- The live-search input has one focus ring following its rounded border; browser/default outlines must not create a second border.
- Empty states distinguish: no matches, no admitted agents, no operational declarations, backend unavailable.
- Evidence failures expose a short reason, last attempt time and available retry action.
- Exact attempt count is shown only when provided by the backend; never infer it.

## 13. Accessibility and responsive requirements

- Every enabled button/link uses the pointer cursor; disabled controls use a disabled cursor and native semantics.
- All icon-only actions have accessible names.
- Tooltips are supplemental; critical state and actions remain available by keyboard/touch.
- Evidence stages wrap or change layout without overlapping labels or connectors.
- Search, filter button and cards/table toggle remain aligned until the narrowest layout, where controls may wrap in a documented order.
- Mobile filter drawer traps focus, closes with Escape and restores focus to its trigger.
- Color is never the only carrier of success/failure state.

## 14. Analytics

Record product events without endpoint secrets, signed payloads or personal data:

- `catalog_search_changed`
- `catalog_filter_changed`
- `agent_hire_page_opened`
- `browser_validation_started`
- `browser_validation_succeeded`
- `browser_validation_cors_blocked`
- `infrastructure_validation_requested`
- `quote_requested`
- `quote_verified`
- `hire_prepare_started`
- `hire_transaction_submitted`

Include chain ID, agent ID, protocol, outcome category and evidence source when applicable.

## 15. Required cleanup

Delete code only after tests prove no remaining consumer:

- Separate `View profile` CTA and duplicated profile-only navigation.
- Independent `/agents/[agentId]` page implementation after the redirect is in place.
- Components duplicated between profile and hire pages; retain one hire-oriented implementation.
- Browser validation targets that classify unknown or missing service types as `web`.
- Test buttons for websites and social links.
- Mainnet surfaces containing hard-coded Testnet copy or evidence.
- Snapshot fallback paths that present historical catalog data as current platform state.

Do not delete:

- raw declared metadata needed for provenance;
- job tracking;
- trust8004 external links;
- evidence timestamps/hashes;
- testnet support itself.

## 16. TDD implementation sequence

### WP-F1 — Contract adapters

Write failing tests for every backend enum, capability and blocker mapping. Implement one adapter used by cards, table and hire page.

**Gate:** unknown enum values fail safely; no component derives hireability independently.

### WP-F2 — Route unification

Write route/component tests proving card, name and primary CTA reach `/hire/[agentId]`, while `/agents/[agentId]` redirects.

**Gate:** no separate profile CTA or duplicate profile fetch remains.

### WP-F3 — Hire-page states

Create fixtures for every row in §8 before implementation.

**Gate:** each state renders the correct evidence, blocker and single primary action.

### WP-F4 — Browser validation

Use deterministic mocked servers for A2A, MCP, ERC-8183 HTTP, signed quote, CORS, timeout and invalid response.

**Gate:** CORS never becomes unreachable; social/web resources are never tested; unsigned success never becomes platform verified.

### WP-F5 — Catalog interaction

Test combined filters, clear, debounced search, result loading, URL persistence, card/table parity, responsive controls and keyboard behavior.

**Gate:** no stale result flash is presented as the response to the newest query.

### WP-F6 — ERC-8183 integration

Consume the hiring session interfaces using contract fixtures; do not duplicate their implementation.

**Gate:** wallet is requested only at transaction preparation; transaction preview includes all required financial facts.

### WP-F7 — End-to-end

Run these stories against local Worker/D1 fixtures:

1. Discover pending agent → browser A2A success → browser-observed state.
2. Browser CORS block → fallback queued → platform-reachable result visible globally.
3. Commerce admitted → signed quote → backend verification → prepare hire.
4. Expired quote → re-quote, no transaction preparation.
5. Mainnet/Testnet switch → no evidence or explorer-link leakage.

**Gate:** typecheck, unit/component tests, browser E2E, production build and accessibility checks pass.

## 17. Rollout and rollback

1. Ship route unification directly after component, route and production-build gates pass.
2. Keep the old profile route as a temporary redirect.
3. Preserve the already shipped endpoint-scoped browser validation and infrastructure fallback contracts.
4. Promote the redirect to permanent and delete duplicate code only after production verification.

Rollback restores the previous Vercel deployment while preserving backend evidence and D1 migrations. No second implementation or long-lived feature flag is retained.

## 18. Acceptance criteria

- There is one canonical agent destination: `/hire/[agentId]`.
- Every card/table row exposes one primary action consistent with server capabilities.
- A user can distinguish declared, browser-observed, platform-observed, signed and onchain evidence.
- Websites/social links never appear as operational validation targets.
- CORS is presented as browser limitation, not agent failure.
- A browser-obtained signed quote can become global only after backend verification.
- Fresh verified quote plus current chain facts is required before transaction preparation.
- Mainnet is the disconnected default and Testnet is shown only for Testnet data.
- Catalog filters combine, clear, load visibly and remain responsive/accessible.
- No deleted code is still referenced; tests and production build pass.
