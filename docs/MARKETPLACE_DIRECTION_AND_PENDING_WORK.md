# Marketplace Direction and Pending Work

> Historical planning record (August 2026), not current operational policy.
> The accepted selection, attribution and UI policy is now
> [Marketplace eligibility and evidence](MARKETPLACE_ELIGIBILITY.md).
> Manual manifest admission, Grid-only eligibility, and absent job-index claims
> below are superseded. Historical commands and transactions are retained as
> evidence, not instructions to repeat them. Consult current code before use.

Operational source of truth as of 2026-08-26. This document explains what the
marketplace exposes, which agents it evaluates, and the remaining path to the
Build the Era submission. It does not expand `MVP_SCOPE.md`.

## Product direction

The product is not another ERC-8004 indexer and it is not a portfolio of agents
owned by the marketplace. It is an evidence and activation layer on top of the
public trust8004 catalogue:

```text
trust8004 BSC catalogue
  -> browse registered identities
  -> evaluate selected candidates
  -> verify identity, endpoints and quotes
  -> hire an ERC-8183 seller
  -> track and prove the resulting job onchain
```

The product promise remains:

```text
Discover -> Understand -> Compare -> Hire -> Track -> Result
```

trust8004 answers **what is indexed**. The marketplace adds evidence for
**what appears suitable, what was observed, and what can actually be hired**.

## Which agents appear

The marketplace has two deliberately separate catalogue views.

### All registered agents

`/agents?view=all&page=1&limit=24`

- Shows the BSC (`chainId=56`) snapshot returned by the trust8004 public list
  API.
- Uses server-side pagination, search and supported ordering.
- Fetches at most 24 list records per page and does not request a profile for
  every card.
- Newly indexed trust8004 agents become browsable without a marketplace code
  change.
- Records that have not been reviewed say `Not evaluated`.
- The API total is labelled as active indexed BSC records and always paired
  with `Catalog coverage: partial`; it is not presented as proof of complete
  onchain coverage.
- A trust8004 generic category or a matching description does not assign one
  of the marketplace's four categories.

This is how the product exposes the broad trust8004 supply without downloading,
enriching or classifying the complete catalogue.

### Marketplace candidates

`/agents?view=marketplace`

This is a small, intentionally curated inventory. It currently contains these
third-party Mainnet candidates:

| Category | Candidate | Current activation state |
|---|---|---|
| Rebalancing | `45650` V3 Pools powered by HeyAnon | MCP only |
| Grid Trading | No third-party candidate | Unverified / empty |
| Yield Optimisation | `45422` Beefy powered by HeyAnon | MCP only |
| Yield Optimisation | `43129` Venus powered by HeyAnon | MCP only |
| Health Factor Monitoring | `45381` Aave powered by HeyAnon | MCP only |
| Health Factor Monitoring | `43129` Venus powered by HeyAnon | MCP only |

Agent `43129` is intentionally multi-label. None of these four third-party
agents is currently ERC-8183 hireable. MCP presence is never treated as a
commercial quote or a verified seller.

A trust8004 record enters this curated view only after an explicit evidence
review and manifest change. Indexing alone does not promote it.

### Marketplace-operated Grid seller

The repository contains exactly one marketplace-operated seller because Grid
Trading has no verified third-party candidate and that absence blocks the
end-to-end Mainnet demonstration. It performs a deterministic Grid planning
calculation; it does not trade, hold assets or promise returns.

It must always be labelled:

> Marketplace-operated Grid seller — not an official BNB reference agent

This seller is not a fixture once registered on Mainnet, but it remains visibly
separate from third-party catalogue agents. The Testnet Agents `1815` and
`1866` remain testing infrastructure and never enter the Mainnet catalogue or
the four-category candidate inventory.

## Promotion and evidence rules

An agent progresses through distinct states; no earlier state implies a later
one:

| State | Meaning |
|---|---|
| Registered on BSC | Present in the trust8004 BSC snapshot |
| Marketplace candidate | Deliberately selected and classified with evidence |
| MCP only | MCP is declared or observed; ERC-8183 hiring is not verified |
| Quote verified | A fresh signed quote matches seller, identity, chain, contracts and token |
| Hireable | The quote and direct ERC-8004/contract qualification both pass |
| Job proven | A real funded job and deliverable have direct chain evidence |

The evidence classes remain separate everywhere:

- `declared`: profile metadata and claimed services;
- `observed`: endpoint behavior at a timestamp;
- `onchain`: direct BSC identity, contracts, balances and job state;
- `derived`: marketplace category and hireability decisions;
- `performance`: completed job, timing, cost and result integrity.

## Current operational status

| Item | Status | Evidence |
|---|---|---|
| Testnet buyer lifecycle | Passed | Jobs `514` and `551`; `551` is the current primary proof |
| Frontend and paginated trust8004 catalogue | Implemented | Production marketplace and server-side list mode |
| Four-category curated inventory | Implemented | Third-party candidates remain curated; Grid contains marketplace-operated Agent `303779` |
| Verification drift UI | Implemented | Sanitized release snapshot with provenance and freshness |
| Evidence Passport | Deployed, visual iteration pending | Deterministic evidence fingerprint, five honest states, shareable page and JSON API; the current restrained treatment is not yet the intended collectible-style card |
| Validate my agent | Deployed | One-ID read-only validation; no category assignment, automatic promotion or browser-supplied endpoint |
| Mainnet Grid seller endpoint | Reachable | Fixed production origin and matching Agent Card |
| Mainnet security decision | `GO` | Fresh read-only check at 2026-08-25T21:49:09.564Z, BSC block `118074603` |
| Mainnet registration simulation | Passed | Fresh dry run at BSC block `118077040`; no transaction sent |
| Mainnet command ergonomics | Fixed locally | `npm run mainnet:go-no-go` now loads `.env.local`; its regression test and the real GO command pass |
| Mainnet Grid Agent ID | Registered | Agent `303779`; tx `0x6f227a8607352e3a935de2e55ac69cbfd2a36e70edcbde49125574e2c48219e5`; block `118077255` |
| Mainnet seller qualification | Passed | Agent `303779` has matching direct identity and a current verified signed A2A quote |
| Mainnet browser job | `SUBMITTED` | Job `56662`; five buyer signatures, seller notification, deterministic result and matching deliverable hash are proven |
| Mainnet public proof | Pending settlement | Job `56662` must reach `COMPLETED`, then be captured into the canonical sanitized proof history |
| Marketplace Job Ledger | Not implemented | Jobs exist onchain, one active browser journal exists locally, and versioned proof JSON exists; there is no durable queryable marketplace history |

The seller address is
`0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5`. The operator explicitly chose
to reuse the Testnet signer on Mainnet. Separate server-only environment
variables preserve the chain boundary, but the reuse increases the impact of a
signer compromise and is recorded in `DECISIONS.md`.

## Pending work, in execution order

### 1. Preserve the seller gas reserve

- Completed. The seller retains `0.003 BNB` after registration.
- The seller refuses to submit when its balance is below `0.002 BNB`.
- Registration consumes gas, so verify after registration that the wallet still
  retains the `0.002 BNB` submission reserve.
- Keep funding limited to operational gas. Do not send buyer payment funds to
  the seller wallet.

### 2. Register the Grid seller on BSC Mainnet

Completed at BSC block `118077255`:

- Agent ID: `303779`.
- Transaction: `0x6f227a8607352e3a935de2e55ac69cbfd2a36e70edcbde49125574e2c48219e5`.
- Registry owner: `0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5`.
- Receipt: `success`.
- Registered metadata points to the production Grid Agent Card.

Do not repeat the registration transaction.

### 3. Publish the new identity to the seller configuration

Completed. Vercel Production contains `ERC8183_MAINNET_SELLER_AGENT_ID=303779`;
the Agent Card returns HTTP `200` with the fixed A2A message URL and both
required seller skills. Two Production rebuilds completed without enabling
Mainnet writes.

### 4. Wait for trust8004 indexing, then qualify only this seller

Completed. The registered identity is readable through the trust8004 public
API. A readiness report generated at `2026-08-25T23:39:36.620Z` records the
seller as `qualified`, Grid as a candidate category with quote evidence, and
activation coverage as `partial`.

Run:

```bash
npm run readiness:bsc
```

The release can promote the Grid seller only when:

- `sellerQualification.qualifiedAgentIds` includes the new Agent ID;
- `categories.grid_trading.agentIds` includes the new Agent ID;
- identity matches direct BSC reads;
- the endpoint is reachable;
- the canonical signed quote is `quote_verified`; and
- `activationCoverage.status` is no longer `none`.

If trust8004 has not indexed the identity yet, the honest state remains
pending. The marketplace must not classify the entire catalogue while waiting.

### 5. Enable the Mainnet buyer path only after qualification

Completed. The intended injected buyer was funded, the final activation decision
was recorded, and the independently gated Mainnet demo and seller writes were
enabled in Production. Qualification remains authoritative: an environment flag
cannot make an unqualified seller hireable.

### 6. Execute one browser-signed Mainnet job

Completed through `SUBMITTED` as Job `56662`. The injected buyer retained custody
and signed `createJob`, `registerJob`, `setBudget`, exact `approve` and `fund`.
The server then verified `FUNDED`, notified the seller and published the
deterministic Grid result. The hosted result matches deliverable hash
`0x104681048d6ecd1824bd04e39e3975eb7ab9fcf65e69647e982bf186f843aa5d`.

Execution record: the buyer, not the server, signed:

```text
createJob -> registerJob -> setBudget -> exact approve if needed -> fund
```

The proven constraints were:

- BNB Mainnet for gas;
- exactly the accepted `U` budget, capped at `0.01 U`;
- no unlimited approval.

The server verified `FUNDED`, performed idempotent `notify_funded`, and the
seller submitted the deterministic Grid deliverable. Transaction hashes remain
in the browser journal and onchain; they must be promoted into the sanitized
canonical proof after settlement.

### 7. Settle and publish the primary Mainnet proof

The allowlisted policy has a seven-day dispute window. `SUBMITTED` proves
delivery, but the primary Mainnet proof is published only after onchain
`COMPLETED`. Based on the submitted timestamp and configured window, the expected
earliest settlement is `2026-09-03T00:40:26+02:00`; the dry-run command remains
authoritative and must confirm eligibility before any write.

After the window:

```bash
npm run mainnet:settle-grid-job -- <jobId>
npm run mainnet:settle-grid-job -- <jobId> --execute --evidence ./erc8183-56-job-<jobId>-sanitized.json
npm run mainnet:capture-proof -- <jobId> ./erc8183-56-job-<jobId>-sanitized.json --publish
```

Jobs `514` and `551` remain accessible as historical Testnet evidence.

### 8. Submission operations

- Keep Production public without Deployment Protection from 2026-09-09
  through 2026-09-23.
- Keep the hourly availability workflow green for landing, catalogue, profile,
  hire, proof, Agent Card, quote and prepare.
- Run `npm run check`, the production build and `npm audit --audit-level=low`
  on the submitted commit.
- Rehearse the three-click path from landing to a fundable quote.
- Capture final desktop/mobile screenshots and the demo video by 2026-09-08.
- Sweep seller earnings according to the operational decision and rotate the
  shared signer after the judging window.

## Superseded proposal: four marketplace-operated launch sellers

**Decision on 2026-08-27:** do not activate this expansion before submission.
The single Grid seller proves the common hiring rail. Submission capacity now
goes to durable job evidence and the validation product. This preserves the
marketplace framing and the repository rule against building four proprietary
agents.

### Recommendation

It is technically feasible to operate one seller for each required category
before 2026-09-09, and doing so would materially improve the submission if each
seller performs authentic category work and completes a real ERC-8183 lifecycle.
This is not the same as building four unrelated agent products.

The minimum credible implementation is:

- one shared, audited ERC-8183 seller runtime;
- four distinct ERC-8004 identities;
- four small, deterministic category policies;
- one production origin and one operational model;
- one real, browser-signed Mainnet job per category;
- no custody and no autonomous execution of financial transactions.

Each identity must be labelled **Marketplace-operated launch seller**. It must
never be described as an official BNB reference agent or as an independent
third-party agent. The broad, third-party catalogue remains visible: these
sellers bootstrap hireable supply rather than replacing the marketplace.

This proposal is a material scope change. It should only become active after the
Grid seller template succeeds end to end. Until then, the repository policy of
not building four proprietary agents remains in force.

### Proposed authentic tasks

The four sellers should return reproducible decision artifacts rather than echo
responses or pretend to execute trades:

| Category | Deterministic input | Authentic deliverable | Explicit boundary |
| --- | --- | --- | --- |
| Rebalancing | LP position, current price, fee assumptions and risk bounds | Proposed ranges, rebalance triggers, projected allocation and assumptions | Does not move liquidity or sign a transaction |
| Grid Trading | Pair, price range, capital and grid count | Grid levels, per-order sizes, trigger points and assumptions | Does not place orders or hold funds |
| Yield Optimisation | Candidate opportunities, rates, constraints and risk preferences | Ranked allocation plan, expected blended yield and assumptions | Does not deposit, withdraw or promise future yield |
| Health Factor Monitoring | Collateral, debt, oracle prices and safety target | Health factor, liquidation buffer and prioritised remediation plan | Does not liquidate or modify a lending position |

Deterministic inputs must produce deterministic canonical output so a judge can
recompute the deliverable hash. An LLM is unnecessary on the critical path and
would make correctness harder to demonstrate.

The workshop describes these categories with active verbs: manage, place, route
and act. A calculator that only echoes user-supplied numbers would therefore be
too weak. The minimum safe implementation should read relevant live BSC state,
perform the analysis autonomously after the ERC-8183 job is funded, and return a
reproducible decision artifact. Where practical, the artifact can include
simulated or unsigned transaction intent that a user could execute separately.
It must not claim autonomous asset execution unless an onchain transaction and
enforced permissions prove it.

### Expansion gate

Do not duplicate the runtime until the existing Grid path has all of the
following on BSC Mainnet:

1. Registered ERC-8004 identity and stable production Agent Card.
2. Qualification through the unchanged readiness checks.
3. Browser-injected buyer wallet completing the ERC-8183 writes.
4. Seller notification and a job reaching `SUBMITTED`.
5. A public sanitized proof with transaction and deliverable hashes.

If this is not complete by 2026-08-28, keep one reference seller and prioritise
the evidence UI, reliability data and submission polish. Four incomplete sellers
would score worse than one proven seller and an honest external catalogue.

### Why this remains a marketplace

The product is not valuable because it owns four agents. Its value is the shared
decision and transaction layer applied equally to owned and third-party supply:

```text
trust8004 catalogue
        +
marketplace endpoint and quote observations
        +
direct BSC identity and ERC-8183 job verification
        +
marketplace job-performance evidence
        =
discoverable, comparable and safely hireable agents
```

The owned launch sellers solve the cold-start problem. The defensible product is
the evidence model, qualification rules, non-custodial buyer flow and public job
proof. A third-party seller that later satisfies the same rules should obtain the
same marketplace status without a code change.

## Product direction: the validation and activation layer

trust8004 is the catalogue and indexing infrastructure. The marketplace should
not duplicate that index or add another catalogue provider. Its differentiated
job is to turn the broad trust8004 inventory into evidence that helps a person
decide whether and how to hire an agent.

Every BSC agent available through trust8004 should be discoverable through
server-side pagination and search. Opening the complete catalogue must not mean
downloading, enriching or classifying every record. A card can truthfully show
the listing fields and `Not evaluated` until stronger evidence exists.

The product has four intentionally different states:

1. **Indexed:** trust8004 exposes the ERC-8004 registration in its BSC snapshot.
2. **Evaluated:** the marketplace has collected recent, attributable evidence.
3. **Hireable:** a compatible ERC-8183 seller and valid quote have been verified.
4. **Proven:** at least one real job has onchain lifecycle and outcome evidence.

These states form a promotion pipeline, not synonyms. An indexed agent is not
automatically evaluated; an evaluated endpoint is not automatically hireable;
and a hireable seller is not reliable merely because it can accept payment.

### One canonical agent workspace

The buyer-facing surface is a single route: `/hire/:agentId`. It is the
agent's profile, validation workspace and hiring flow at once. The former
`/agents/:agentId` and `/agents/:agentId/passport` URLs permanently redirect to
this route so a validation result cannot be stranded on a different screen.

The workspace renders one ordered state model from the normalized catalogue
candidate and the same model drives the catalogue card:

```text
Declared -> Reachable -> Quote -> Hire -> Job history
```

Each stage is literal and independently sourced. A browser check is labelled
`browser-only` and is never promoted to platform reachability. A marketplace
check shows its queue, Worker probe, poll and committed result (protocol,
outcome, HTTP status, duration, attempt count and timestamp). A fresh quote is
the only state that can expose the configured ERC-8183 transaction flow; a
generic seller notice never masquerades as a hire flow.

The two validation actions are intentionally explicit:

- **Validate from browser** performs a read-only GET/MCP handshake in the
  visitor's browser and records only browser-reported evidence.
- **Validate through marketplace** queues the endpoint-scoped Worker check,
  persists the observation in D1 and refreshes the same workspace so every
  visitor sees the resulting state.

The public infrastructure contract is endpoint-scoped: callers submit the
normalized `endpointKey` and `validationKind: "protocol"`, receive an opaque
`requestId`, and poll until `queued`, `running`, `completed`, `failed` or
`cancelled`. A completed response exposes only the sanitized observation
(`protocol`, `source`, `outcome`, timestamps, HTTP status and duration); it does
not expose the internal D1 result pointer, lease or caller metadata.
`hasResult` must exactly match the presence of `result`, and protocol outcomes
exclude quote evidence (`quote_verified` and `quote_rejected`). This keeps the
Worker/D1 boundary and the buyer workspace on the same fail-closed contract.

Loading and error states use the same language as the final evidence: no
  result is shown as successful until the Worker returns a committed,
  request-scoped observation. If polling is interrupted, the request remains
  retryable and the UI says so instead of implying that the agent is down.

### Complete exposure without mass enrichment

The two catalogue modes remain complementary:

- **All registered agents:** the complete paginated BSC snapshot reported by
  trust8004. No profile N+1, no global four-category classification and no
  invented validation status.
- **Marketplace candidates:** the smaller evidence-backed inventory, including
  external candidates and marketplace-operated launch sellers. Multi-label
  categories, qualification and evidence are computed only for this set.

Interactive validation and marketplace promotion remain limited to curated
candidates, marketplace-operated sellers and agents a user explicitly requests.
The 2026-08-28 Free-first amendment additionally brings a bounded
transport-observation pipeline into submission scope. Live observation starts
with ERC-8183 declarants and the curated four-category inventory; the global A2A
population remains represented by the reproducible funnel snapshot. A probe does
not classify or promote an agent; it only records literal, timestamped protocol
evidence, and every unprobed target remains literal. This replaces the planned
new Job Ledger implementation slot; it is not an additional feature.

### What the validation layer checks

For an evaluated agent, the marketplace can produce a reproducible evidence
passport:

- reconcile declared identity, owner, wallet, metadata URI and services with BSC;
- probe supported endpoints under SSRF, timeout and body-size controls;
- distinguish declared tools from tools actually observed;
- detect identity and capability drift with a timestamp;
- request and verify an ERC-8183 quote without spending funds;
- validate seller, provider, token, chain, contracts, budget and deadline;
- record direct job lifecycle and deliverable hashes when a user hires;
- aggregate proven execution count, latency, cost, terminal state and disputes.

Rules and timestamps should be public. The output is useful even when validation
fails: `unreachable`, `quote rejected`, `not probed` and `no proven jobs` are more
honest and actionable than a generic trust badge.

## How reliability should be represented

The marketplace should show an evidence passport rather than invent one opaque
reliability number. Different sources answer different questions and must remain
separate:

| Dimension | Preferred source | What it proves |
| --- | --- | --- |
| Identity | Direct BSC + trust8004 | Registration, owner, wallet and metadata URI |
| Endpoint | Marketplace observation | Reachability at a stated time |
| Capability | Declared metadata versus observed protocol response | What was claimed and what was actually seen |
| Quote | Marketplace readiness verification | Request binding, seller, token, budget, deadline and contracts |
| Job | Direct ERC-8183 reads | Funded, submitted, completed or disputed state |
| Outcome | Sanitized proof and deliverable hash | What was delivered for a real job |
| Performance | Multiple proven jobs | Sample size, success, latency, cost and disputes |

The labels should stay literal: `declared`, `observed`, `onchain`, `derived` and
`not_probed`. A trust score with zero feedback or zero validations can be shown,
but its sample size must be shown beside it.

## Do we need to index ERC-8183?

Not globally for this submission. The marketplace can complete and prove its own
jobs using direct contract reads, receipts and versioned sanitized proofs. Building
a new global indexer before 2026-09-09 would displace work that is scored more
directly.

After the submission, a global ERC-8183 event index becomes valuable for seller
history, cross-buyer completion rates, dispute rates and discovery of independently
operated sellers. The natural long-term option is to add those verified commerce
facts to the existing trust8004 infrastructure, or collaborate with an ecosystem
provider, rather than create a competing marketplace-only indexer.

### Deferred design: submission-bounded Job Ledger

A global indexer remains out of scope. The design below is retained for
post-submission work, but SPEC v3 defers its implementation in favor of the
bounded observation layer. Existing direct-chain job pages and versioned proofs
remain authoritative for this submission.

The minimum persisted record is:

- `chainId` and `jobId` as the unique identity;
- Agent ID, public buyer and public seller;
- payment token, raw budget and deadline;
- current onchain status plus last verified block and timestamp;
- lifecycle transaction hashes, blocks, timestamps and gas cost;
- deliverable hash, sanitized result and result-hash verification;
- provenance and freshness for every derived or observed claim.

The ledger must never persist private keys, environment variables, authorization
headers, arbitrary seller payloads or browser wallet state. It accepts records
only from the marketplace hiring lifecycle or an explicit proof-capture operation,
and reconciles critical facts with BSC before presenting them as current.

Initial product surfaces:

```text
/jobs                         verified marketplace job history
/jobs/[jobId]                 live onchain state plus persisted evidence
/agents/[agentId]/passport    track record sourced from verified ledger records
```

Versioned proof JSON remains the portable, reviewable submission artifact. The
ledger makes the same evidence navigable across devices and deployments. No
contract-wide backfill, mass event scan or claim of complete ERC-8183 coverage is
part of this cut.

## Winning thesis

The strongest defensible submission message is:

> The BSC agent marketplace that separates claims from evidence and lets users
> discover, compare and hire agents non-custodially across all four required
> categories, with identity, endpoints, quotes and job outcomes independently
> attributable and verifiable.

This maps directly to the published judging criteria:

- **Functionality:** an authentic Grid task, a browser-signed hire flow, tracking
  and a real deterministic result without dead ends.
- **Data Quality:** trust8004 catalogue data, marketplace observations, direct BSC
  facts and job outcomes, each with provenance and freshness.
- **Agent Diversity:** all four categories have equal product depth while the open
  catalogue continues to include third-party supply.

The submission loses its differentiation if the UI looks like a storefront for
our own bots, if outputs are stubs, or if reliability is asserted without sample
size and proof. One operated seller is sufficient to prove the rail while the
open trust8004 catalogue remains the source of ecosystem supply.

## Workshop alignment review — 2026-08-25

This assessment uses the complete 30-slide `Build The Era Workshop deck` from
2026-08-24 and the workshop transcript supplied by the operator. Sponsor tracks
and third-party catalogue providers are intentionally excluded from the product
decision.

The workshop reduces the main-track marketplace to four required qualities:

1. **Identity:** the user can establish who the ERC-8004 agent is.
2. **Track record:** the user can understand what it has actually done.
3. **Rails:** the user can hire it in a few clicks.
4. **Trust:** live status, permissions, limits and revocation are visible.

It also states three constraints that control our strategy:

- the submission is the marketplace itself, not a portfolio of agents;
- Rebalancing, Grid, Yield and Health Factor need equal depth;
- functionality, data quality and diversity are scored independently.

### Where the product is already aligned

| Workshop requirement | Evidence already in the repository | Assessment |
| --- | --- | --- |
| Complete discovery | Paginated trust8004 BSC catalogue with search and profile-on-open | Strong foundation |
| Identity | trust8004 metadata plus direct BSC owner, wallet and URI reconciliation | Strong and differentiated |
| Understand and compare | Evidence-aware profiles, four-category catalogue and comparison | Implemented |
| Hiring rails | Browser-injected ERC-8183 lifecycle proved with Testnet Job `551` and Mainnet Job `56662` | Mainnet proven through `SUBMITTED`; settlement pending |
| Result tracking | Direct-chain job tracking and sanitized public proofs | Live Mainnet tracking works; durable Mainnet history pending |
| Data quality | Runtime schemas, provenance separation, freshness, drift and visible missing evidence | Strong foundation |
| Safe buyer control | Exact approval, transaction intent, token, budget and deadline before signatures | Stronger than a generic connect-wallet flow |
| Public operation | Production deployment and availability checks exist | Must remain monitored through judging |

### What would prevent a win today

| Scoring risk | Current gap | Required correction |
| --- | --- | --- |
| Functionality | Mainnet Job `56662` is real but cannot settle until its seven-day policy window opens | Settle it when eligible and publish the canonical proof |
| Data quality | Broad hireability claims are not backed by reproducible catalogue/probe coverage | Complete SPEC WP0–WP4 and expose literal, timestamped observation outcomes |
| Diversity | Four categories are visible, while third-party candidates remain MCP-only and only Grid has a qualified seller | Preserve honest coverage and recruit/validate third-party sellers instead of fabricating owned supply |
| Trust | The guardrail panel is deployed, but its clarity must be included in the newcomer rehearsal | Verify that exact approval, custody, continuing authority and revocation boundaries are understood without protocol knowledge |
| Marketplace adoption | `Validate my agent` is deployed, but discovery does not yet expose background endpoint/quote evidence | Connect the bounded observations contract without auto-promoting or auto-classifying agents |
| Newcomer journey | The working path is still framed partly as a demo and uses protocol vocabulary | Promote the qualified Mainnet path into the normal discover-to-result journey |

The product is therefore directionally correct and technically advanced, but it
is not submission-complete. Its strongest capabilities currently live behind
operator commands and evidence pages. The next phase must make those capabilities
obvious to a first-time user.

## Defensible product architecture

The marketplace should have three product planes built on the same evidence
model:

```text
CATALOGUE
Every BSC agent indexed by trust8004 is searchable and has a profile
        ↓
VALIDATION
Identity + endpoint + capability + quote + guardrail evidence passport
        ↓
ACTIVATION
Non-custodial ERC-8183 hire + direct job tracking + proven outcome
```

trust8004 is infrastructure created by this team, but ERC-8004 is an ecosystem
standard rather than something the marketplace owns. Submission language must
say that we operate trust8004 and verify ERC-8004 identities; it must never claim
ownership of the standard.

The marketplace can expose all indexed agents immediately while validation
coverage grows independently. This makes the product useful on day one without
making false claims about agents that have not been observed.

### The feature that makes the validation layer visible

After the first Mainnet job works, add a bounded read-only entry point:

```text
Validate my agent
  -> enter BSC Agent ID
  -> resolve its trust8004 profile
  -> reconcile identity directly onchain
  -> probe declared public transport safely
  -> verify a quote when ERC-8183 is declared
  -> show pass, fail, missing and not-probed evidence
  -> explain the exact next requirement for marketplace qualification
```

It must not automatically assign a category, promote a candidate or make a
seller hireable. It exposes the existing rules as a product and gives Agent
Studio builders a path into the marketplace without manual operator intervention.

This creates a credible ecosystem loop:

```text
Build in Agent Studio
  -> register ERC-8004
  -> appear through trust8004
  -> validate in the marketplace
  -> become understandable and potentially hireable
  -> accumulate proven ERC-8183 jobs
```

### Holographic Agent Evidence Card

Present the Evidence Passport as a collectible-style holographic card without
minting, ownership or transfer semantics. It is a live visualization of the
marketplace verification record, not an NFT, credential issued by the agent or
guarantee of financial performance.

The visual state must follow evidence depth:

| Card state | Minimum evidence | Visual treatment |
| --- | --- | --- |
| Registered | Present in the trust8004 BSC snapshot | Base card; `Not evaluated` |
| Evaluated | Identity and bounded endpoint checks recorded | Subtle evidence treatment |
| Hireable | Current ERC-8183 qualification and quote verification pass | BNB-yellow hiring rail and restrained holographic layer |
| Job Proven | At least one directly proven job and outcome | Complete holographic evidence treatment with sample size |
| Stale / Attention | Evidence expired, drifted or failed | Holographic treatment removed; reason and timestamp visible |

The holographic pattern may be generated deterministically from:

```text
chainId + agentId + evidenceSnapshotHash
```

That makes the artwork a reproducible visual fingerprint of one evidence
snapshot. When the evidence changes, the fingerprint and verification timestamp
change. A shared image must always link back to the live passport so an old
screenshot cannot imply current verification.

The front of the card shows identity, categories, current state, freshness and
the `Declared -> Reachable -> Quote verified -> Job proven` rail. The expanded
view shows sources, declared-versus-observed capabilities, guardrails, jobs,
cost, duration, outcomes and transaction hashes.

Accessibility is mandatory: the evidence is available as text, color is never
the only status signal, keyboard interaction works, and motion respects
`prefers-reduced-motion`. The visual layer is implemented only after the passport
schema uses real evidence; it must never manufacture a stronger state for a more
attractive card.

## API and CLI recommendation

Do not build another generic catalogue API. trust8004 already owns that role.
The additional public surface should expose the marketplace's differentiated
evidence:

- normalized evidence passport for one BSC Agent ID;
- current qualification/readiness with reasons;
- public sanitized proof for an ERC-8183 job;
- provenance and freshness for every returned claim.

The repository already has internal CLI commands for inventory, verification,
readiness, registration, settlement and proof capture. A public CLI is useful
only as a thin client over the same business use cases and schemas:

```text
marketplace agent inspect 56:<agentId>
marketplace agent validate 56:<agentId>
marketplace seller qualify 56:<agentId>
marketplace job proof 56:<jobId>
```

Do not build a second validation engine inside the CLI and do not make CLI-based
funding the primary judging journey. The workshop explicitly evaluates whether
a newcomer can complete the frontend journey. The CLI is a reproducibility and
builder-adoption feature after the Mainnet path and `Validate my agent` UI exist.

## Revised priority order

### P0 — required to be competitive

1. **Completed through `SUBMITTED`:** Grid registration, qualification and one
   browser-signed Mainnet job (`56662`).
2. Settle Job `56662` when the seven-day policy window opens, then publish its
   canonical sanitized proof.
3. Complete SPEC WP0–WP4: reproducible funnel, bounded probe and observations.
4. Publish the evidence-backed landing and Grid track record in the normal UI.
5. Move hiring from demo framing into the normal three-click marketplace journey.
6. **Implemented:** show custody, exact spend, continuing authority and
   honest pre/post-funding revocation semantics in a user-facing guardrail
   panel.

### P1 — the differentiator judges can interact with

1. **Deployed:** bounded `Validate my agent` for one explicitly
   supplied BSC Agent ID.
2. **First iteration deployed; visual iteration pending:** turn the restrained
   Passport into the distinctive collectible-style holographic card while
   preserving its complete textual and accessible representation.
3. **Partially implemented:** aggregate proven Mainnet job count, terminal
   state, latest cost and latency with explicit sample size. Dispute history
   remains unavailable until a Mainnet proof exists.
4. **Deployed:** publish the sanitized JSON schema through the
   Passport API and document its state rules and deterministic fingerprint on
   the static verification methodology page.

### P2 — only after P0 and P1 are stable

1. **Deployed:** package the existing validation capabilities as a
   thin BSC-only public CLI over marketplace APIs.
2. **Implemented:** document the read-only validation and durable
   Mainnet job-proof API.
3. **Implemented:** add a builder handoff that explains how an Agent
   Studio deployment becomes registered, evaluated, reviewed, hireable and job
   proven without collapsing those states.

Do not spend submission time on another indexer, a new wallet framework, another
chain, autonomous custody, a generic agent builder or a second commerce protocol.

## Execution plan to 2026-09-09

| Date | Critical outcome |
| --- | --- |
| Aug 25–26 | Fund the gas buffer, register Grid, confirm indexing and qualification |
| Aug 26–27 | Complete the first browser-signed Grid Mainnet job through `SUBMITTED` |
| Aug 27–29 | Complete SPEC WP0–WP3: reproducible catalogue snapshot, Free-plan bounded Worker/D1 observation and Grid-only probe gate |
| Aug 29–31 | Complete SPEC WP4–WP6: observations contract, cached marketplace integration, evidence-backed landing and minimal hire events |
| Sep 1–3 | Settle Job `56662` when eligible and publish the canonical Mainnet proof |
| Sep 4–6 | Capture completed proofs, verify correctness, accessibility, mobile and uptime |
| Sep 7 | Full newcomer rehearsal and release candidate freeze |
| Sep 8 | Record demo, finalize submission and keep production unchanged for judging |

Because the configured optimistic dispute window is seven days, demonstration
jobs intended to appear `COMPLETED` should be submitted no later than Sep 1,
preferably Aug 30–31. A job that is only `SUBMITTED` is still real evidence, but
it is weaker than a settled proof during judging.

The schedule is achievable because wallet connection, quote negotiation, direct
job tracking, seller notification, proof rendering and deployment already exist.
It depends on keeping the new work bounded to endpoint/quote observations and
minimal marketplace-caused event references, while deferring a new `/jobs`
persistence surface, additional holographic polish, new sellers, chains,
protocols, autonomous execution and a global indexer.

## What we are deliberately not building

- A second indexer or direct trust8004 database integration.
- Mass classification of every BSC record.
- Four independent agent stacks or a closed portfolio that replaces third-party
  supply. The earlier conditional expansion is superseded for this submission.
- A fake Grid candidate selected by keyword matching.
- Hire buttons for MCP-only agents.
- Multichain, WalletConnect, x402/B402, social features or a trading terminal.

## Short answer

We expose the broad BSC catalogue from trust8004 through pagination, but we do
not claim every indexed record is a marketplace candidate. The marketplace's
core value is the smaller evidence-backed layer that tells a user which agents
are suitable and which sellers can be hired through ERC-8183. As trust8004
indexes more agents, they automatically become discoverable; they become
curated or hireable only after explicit evidence and qualification.

The proposed four launch sellers are a controlled way to prove equal functional
depth before the deadline, not the final source of marketplace supply. The safest
winning path is conditional: prove Grid first, then replicate only the deterministic
category policy while keeping the common hiring and evidence infrastructure.
