# Gate 5: Frontend MVP

## Objective

Build the first independent BNB Agent Studio marketplace frontend around the
journey:

```text
Discover -> Understand -> Compare -> Hire -> Track -> Result
```

The UI is English-only for Gate 5. It is read-only: wallet integration and new
ERC-8183 transactions remain deferred until the base frontend is approved.

## Source boundaries

- trust8004 is the sole catalogue source and is consumed only through its
  public APIs, server-to-server.
- `/Users/gilbertsahumada/projects/agent-registration` is a read-only visual
  and technical reference. The inspected baseline is commit
  `7777b2478a5277f21aecba08b15e960a071de92c`.
- Critical identity and job facts are verified directly on BSC where the
  repository already has readers.
- No Turso access, 8004scan fallback, crawler, marketplace indexer, catalogue
  write, or runtime dependency on the trust8004 repository is allowed.

## Catalogue modes

### Marketplace candidates

Default route:

```text
/agents?view=marketplace&category=all
```

This view uses a small versioned manifest containing only candidate IDs,
categories, evidence pointers, provenance, and verification state. Profiles
are resolved from trust8004 only for the selected IDs and are cached and
deduplicated.

| Category | Candidate IDs |
|---|---|
| Rebalancing | 45650 |
| Grid Trading | none |
| Yield Optimisation | 45422, 43129 |
| Health Factor Monitoring | 45381, 43129 |

Agent 43129 is multi-label. `All candidates` deduplicates it. Grid keeps equal
visual weight and must display:

```text
No verified Grid Trading agent yet
We have not found a seller with sufficient operational evidence.
```

The visible qualifier is `Curated marketplace candidates`. Results are never
described as complete coverage of a BSC category.

### All registered agents

```text
/agents?view=all&page=1&limit=24&q=
```

- `chainId=56` is fixed.
- Pagination and full-text search are delegated to trust8004.
- `limit` defaults to and is capped at 24.
- One list request supplies the cards; there is no profile N+1.
- Full profiles are fetched only after opening an agent.
- The trust8004 generic category is not mapped into the four marketplace
  categories.
- Uncurated agents display `Not evaluated`.
- The API-reported total is paired with `Catalog coverage: partial`.

Supported sort choices are recent registration, agent ID, indexed trust score,
and indexed reputation when the upstream endpoint supports them.

## Three-layer architecture

```text
Presentation / Controllers
          |
          v
Business / Application
          |
          v
Data / Infrastructure
```

### Presentation and controllers

`app/**`, API Route Handlers, and visual components parse HTTP input, invoke
one use case, map known errors, and render serializable view models. They never
call trust8004, RPC, contracts, SDK clients, or the filesystem directly.

### Business and application

`src/business/**` owns the marketplace entities, curated multi-label
selection, provenance semantics, comparison, pagination rules, and
hireability. It does not import Next.js or React.

Initial use cases:

- `ListMarketplaceAgents`
- `GetMarketplaceAgent`
- `CompareMarketplaceAgents`
- `GetPublicJobProof`

### Data and infrastructure

`src/data/**` wraps the existing Trust8004Provider, direct BSC readers, and a
sanitized durable proof for job 514. It validates upstream payloads, caches and
deduplicates reads, and keeps trust8004 calls sequential and below 60 requests
per minute per process.

## Routes

| Route | Purpose |
|---|---|
| `/` | Category-first landing, evidence model, featured candidates, proof link |
| `/agents` | Curated candidates and directly paginated BSC registry snapshot |
| `/agents/[agentId]` | Contract-oriented profile with progressive technical detail |
| `/compare` | Evidence-aware comparison of two or three agents |
| `/proof/job-514` | Sanitized historical proof plus current RPC observation |
| `/hire/[agentId]` | Honest eligibility shell; no transaction simulation |
| `/jobs/[jobId]` | Real tracking for job 514; unknown jobs are not invented |

API controllers:

- `GET /api/marketplace/agents`
- `GET /api/marketplace/agents/[agentId]`
- `GET /api/marketplace/compare`
- `GET /api/marketplace/proofs/jobs/514`

## Visual system and reuse

Adapt the dark zinc surfaces, Space Grotesk/Space Mono hierarchy, compact
badges, trust dimensions, tier colors, profile rhythm, skeleton geometry, and
accessible Radix/shadcn interaction patterns observed in trust8004. Do not copy
its navigation, multichain dashboard, registration, wallet, likes, activation
toggle, decorative canvas, marquee, or unbounded motion.

The marketplace signature is an evidence rail:

```text
Declared -> Reachable -> Quote verified -> Job proven
```

Every node includes text and source semantics; color is supplemental. BNB
yellow is reserved for BSC, verified commercial intent, and primary actions.

## Delivery cuts

1. Foundation: Next.js/Tailwind, three-layer boundaries, manifest, cache,
   onchain identity bug fix, shell, and visual tokens.
2. Discover: list use case/controller, landing, both catalogue modes, filters,
   search, pagination, and Grid empty state.
3. Understand: profile use case/controller, profile tabs, evidence rail,
   provenance, and hireability CTA policy.
4. Compare: comparison use case/controller and accessible two-to-three-column
   experience without a universal winner.
5. Prove: durable job 514 proof, live RPC distinction, proof page, honest hire
   shell, and real job tracking.
6. Quality: deterministic tests, accessibility, responsive screenshots,
   documentation, typecheck, production builds, and audit.

Each cut must pass its relevant tests and both the CLI and web builds before
the next cut is considered complete.

## Required semantics

- `Registered on BSC`: present in the trust8004 BSC snapshot.
- `Marketplace candidate`: deliberately selected and classified with evidence.
- `MCP only`: MCP is declared or observed but ERC-8183 hiring is unverified.
- `Hireable`: a seller and quote have been verified for ERC-8183.
- `Job proven`: a real job has direct evidence.

`Registered`, `active`, MCP presence, or a compatible description never imply
hireability. Tools remain declared unless backed by a persisted observation.

## Verification

Deterministic fixtures must cover both catalogue modes, upstream schema
failures, page/limit/search/sort validation, no profile N+1, multi-label
deduplication, Grid empty, no global classification, provenance, hireability,
controller error mapping, proof redaction, architectural imports, keyboard
navigation, focus, and basic axe checks.

Final checks:

```text
npm test
npm run typecheck
npm run build:cli
npm run build:web
npm run build
npm audit
```

Desktop (`1440x1000`) and mobile (`390x844`) screenshots are stored under the
ignored `.marketplace/screenshots/gate5/` directory and are not committed.

## Definition of done

- BSC agents are navigable without downloading the complete catalogue.
- Normal catalogue navigation stays below the public request limit.
- The general catalogue has no profile N+1 and no invented classification.
- Four marketplace categories have equal presence; Grid is empty and honest.
- Curated candidates and registered agents are visibly distinct.
- `mcp_only` cannot enable Hire.
- Job 514 remains visible after restart and separates historical from live
  evidence.
- Tests, typecheck, CLI build, Next production build, and audit pass.
- Architecture, decisions, reuse/provenance, and README are updated.
- The trust8004 checkout remains unchanged.
