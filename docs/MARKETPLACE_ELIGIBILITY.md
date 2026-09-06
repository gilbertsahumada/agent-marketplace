# Marketplace eligibility and evidence

Decision: 2026-09-05. Status: implemented locally; remote rollout not yet verified.
This supersedes earlier manual candidate/admission and Grid-only listing policy.
It does not claim that the redesigned catalogue, shared projection or multi-network
quote flow is deployed. Public companion: `/docs/sellers#selection-policy`.

## Product promise

### Network implementation boundary (2026-09-06)

The local multinet change requires migration 0025. Agent identity keys and catalogue reads are isolated by chain (56/97); switching the network preserves filters and resets pagination. This is not a claim that Testnet discovery or quote execution has been configured: until those paths are implemented and verified, Testnet must explicitly report that limitation and must not inherit Mainnet agents, counters, readiness or hiring actions. Remote rollout remains unverified.

Show fewer agents with a usable negotiation path, not every registered identity
as purchasable inventory. New and established sellers follow the same rules.
No past job, previous quote, manual manifest entry or marketplace ownership is
required to request a first quote. Registration alone guarantees none of these.

## Independent facts

- Indexed identity: registry, chain and agent ID; provenance from the catalogue.
- Availability: outcome and timestamp for the particular endpoint checked.
- Negotiation compatibility: supported operation, usable input schema, safe
  destination and supported settlement configuration. Website/social links and
  generic MCP tools do not establish this.
- Public quote capability: cryptographically verified quote evidence, retained
  for 24 hours independently of the signed artifact's shorter expiry.
- Active buyer quote: current request-bound session artifact; only this can
  authorize Review/Fund after the remaining safety checks.
- Jobs: chain state, separately from verified result and attribution to an agent.

None is a proxy for marketplace ownership. A past job is not proof of current
availability. A successful quote establishes negotiation at that endpoint then,
not universal uptime of every declared endpoint.

## Catalogue and action matrix

| Evidence | Main hiring catalogue | Action |
| --- | --- | --- |
| Compatible requirements and current connection; no previous quote | Included | Request quote |
| Same plus recent verified quote capability | Included, ranked first | Request quote |
| Previously compatible, availability stale | Secondary verification view | Check availability |
| Negotiation declared, requirements uninspected | Secondary verification view | Check compatibility |
| Missing/unsupported requirements or unsupported settlement policy | Excluded from hiring inventory | View compatibility / integration guide |
| Failed quote attempt, still usable current form and no newer endpoint failure | Included; filter by Quote failed | Retry quote |
| Suspended or unsafe endpoint | Excluded | Unavailable |
| Valid buyer-session quote | Session-specific, not public promotion | Review quote |

Do not use `Ready to quote` for declarations alone. Reserve it for recent
verified capability AND usable current requirements. First-time compatible
sellers can offer `Request quote` without this stronger badge. Unknown, failed,
expired and unsupported are distinct; lack of telemetry is not zero or failure.
Indexing/discovery remains intact when an agent is excluded from hiring results.

The default Agents view is **For hiring**, an explicit `scope=hiring` inventory,
not a checkbox silently reapplied after clearing filters. **Under evaluation**
uses `scope=evaluation` and includes current operational agents that do not meet
the requestable predicate: pending, unsupported, inaccessible or expired inputs.
It is not a list of proven incompatibility. `/agents?view=all` remains the registry.

The same SQL requestable predicate defines both disjoint inventories. It requires
a current operational declaration, eligible supported transport, non-suspended /
non-unsupported capability, non-null schema hash and unexpired compatibility
verification, with no newer unresolved platform failure for that endpoint.
Successful requirements discovery itself proves that negotiation destination
responded; a separate health request is not a mandatory extra buyer step.
Transport support and form validation do not yet prove settlement compatibility:
provider, signature and settlement pins are checked on the returned quote.

The Ready to quote filter (`quote_capable`; legacy `hireable` alias) additionally
requires recent capability evidence. Protocols are OR within their group,
outcomes are OR within their group, and groups combine with AND. Facet counts
and rows use the same normalized eligibility; an endpoint count is not an agent
count. Clear filters clears selections **within the selected inventory**.
Search, pagination and filter navigation preserve scope; changing inventory resets
filters. Counts are scoped by inventory even when a facet excludes its own group.
API consumers can opt into `scope=hiring` or `scope=evaluation` on
`/api/marketplace/agents?view=marketplace` and Worker `/catalog-agents`.
Existing unscoped API semantics are retained for discovery clients.
If the evidence service cannot enforce scope, the UI fails closed rather than
substituting unverified registry rows. Deploy the Worker supporting scope before
the frontend; migration 0024 is a prerequisite, not a new migration in this patch.

## One decision across surfaces

Persist discovery outcome per registry/chain/agent/endpoint/schema revision, with
checkedAt, expiry and sanitized reason. Cards, filters, detail, API and scheduling
must consume the same projection. An unrelated healthy endpoint cannot qualify
a failed negotiation endpoint. A schema change requires renewed validation.

Cron and buyer requests use the same discovery and negotiation adapter. Automatic
probes may use explicitly published safe samples validated against the schema;
do not infer or invent required inputs from a category. Without a valid sample,
record that buyer input is needed, not a seller failure. Buyer-first quoting must
remain possible. Generic MCP must not become hireable; compatible new MCP must
not require a prior quote. Preserve bounded fetches, SSRF protection, signature,
provider, hash, chain, contract, policy, token, budget and expiry checks.

The optional sample field is `capabilityProbeParameters`, an object validated by
`buildContractRequest` against the published input schema. Missing samples yield
`BUYER_INPUT_REQUIRED` without creating a failed quote attempt. A sample is not
a buyer brief, transaction authorization or instruction to execute paid work.

## Scheduling and diagnosing slow coverage

Bootstrap and maintenance have independent bounded candidate queries. Both rank
previously responsive endpoints first and prioritize explicit ERC-8183 HTTP within
that ranking; each uses its own dispatch budget. This prevents a window full of
failed retries from starving never-inspected sellers. A shared per-tick origin
set and five-minute endpoint claims remain in force. Existing concurrency and
backoff limits are not increased. Due ready rows are eligible for refresh too.
The two cohorts alternate priority each scheduler minute so a shared host with
a large discovery backlog cannot permanently exclude due maintenance.
Origin deduplication now happens in SQL before limiting the candidate window.
This avoids repeatedly reading only one host's agents and dispatching an almost
empty batch. Consumers and per-origin dispatch limits remain unchanged.
Provider integration/access blockers wait seven days before automatic discovery
retry; transient failures keep the configured progressive backoff. Manual
discovery remains possible and does not bypass access restrictions.
`/health.quoteQueue.sweep` exposes atomic counters for the current UTC hour:
selected, enqueued, completed, consumer errors, accumulated execution duration
and queue wait, and outcome groups. These are physical executions, not unique
agents, and enqueued minus completed is not a reliable backlog across hours or
retries. Counters use existing runtime_state; no migration is required. Metrics
write failures are logged separately and never replay an otherwise completed quote.
Discovery errors update compatibility, not quote outcome. `Quote failed` and
its facet require an actual failed or rejected negotiation attempt; legacy
discovery-only failures do not qualify.

Health reports `lastPhaseUpdatedAt`, `lastSchedulerUpdatedAt`,
`lastSchedulerErrorIsHistorical`, `lastSchedulerErrorStage`, and separates
`quoteQueue.lastQuoteAttemptAt` from `lastProcessedAt` (which also includes
requirements discovery). Compare timestamps before declaring the scheduler down.
The existing PHASE_FAILED summary observed on 2026-09-05 came from lease acquisition,
not seller negotiation. Later successful phases and advancing compatibility counts
showed recovery. The underlying historical D1/lease exception was not retained in
that sanitized summary; its exact cause remains unproven. Do not label it a CPU
limit or increase load on that assumption.

## Provider blockers and adapter policy

- HTTP 401/403: **Requirements blocked by provider**. Do not retry another transport
  to bypass access restrictions or invent credentials.
- HTTP 429: **Provider rate limit**. Preserve backoff.
- Missing negotiation skill, quote tool or supported form: **Integration required**.
- Network/service failure: **Compatibility unavailable**, not incompatible.

OptimAI 304169 was checked on 2026-09-05: its declared
`https://bnbagent.optimai.network/erc8183/health` returned 200;
`https://bnbagent.optimai.network/erc8183/status` returned 403 administrative denial.
No usable public negotiation contract was established. Its provider-wallet job
does not supply that contract. No speculative OptimAI adapter was added. Revisit
when the provider publishes accessible requirements, or authoritative integration
documentation and supported signed-quote behavior. External adapters must validate
the same security pins and canonical request; they cannot infer fields from jobs.

## Histories and attribution

- Count logical recorded buyer requests separately from physical attempts and
  imported historical observations. Migration rows are not invented user actions.
- Keep historical verification separate from active quote expiry.
- Deduplicate jobs by chainId/jobId. Aggregate totals independently of pagination.
- Provider-wallet activity is not exclusive agent attribution. Label it in the
  section heading; never silently use it as the agent's accomplishment count.
- Current indexed chain state leads; older hire events remain a timeline.
- Completed is not Result verified. Verify the deliverable separately.
- Display five rows per history page. Jobs precede quotes; diagnostics come last.

## Interaction contract

One canonical `/hire/[agentId]` view. Primary content is the usable form or one
compact, specific blocker. Actions are buttons with focus, hover, pending and
result feedback; navigation is a link; external links have an external indicator;
accordions have a rotating chevron; copying gives confirmation. Status badges do
not pretend to be actions. Keep key explanations available without hover alone.

Show the current phase: connection, discovery, negotiation, verification. On
success update header, form, quote history and catalogue together, including
back navigation. Do not confuse local configuration failure with seller failure.
Use relative check times with full UTC details. Honor reduced motion and announce
results accessibly. Quote → Review → Fund → Track is the connected hiring stepper;
job history is not a prerequisite step. No transaction is confirmed without its
real receipt. Expiry invalidates the session plan, not historical evidence.

After a local mutation, a scoped event refreshes the current agent/history and
marks back navigation for a new server read. A non-sensitive 30-second cookie
asks the frontend to skip its process cache. The Worker only bypasses its shared
catalogue cache for the frontend's authenticated refresh header. Public readers
keep the normal cache; no secret is sent to the browser. Both services need the
matching `BUYER_OBSERVATION_SECRET`; missing configuration is an unavailable
service, never a failed seller. Single-agent authenticated detail reads are fresh.

## Networks

## Negotiation profiles — detector v2

The marketplace extension is optional, not an admission standard. Resolution uses
an explicit seller schema first, then a documented supported SDK A2A wire profile
or bounded same-origin OpenAPI HTTP schema. Invalid explicit schemas fail closed.
SDK A2A recognition requires protocolVersion 0.3.0, negotiate-erc8183-job/negotiate,
and a skill description identifying task_description, terms, negotiation_hash and
provider_sig. This is a wire-profile declaration, not proof of installed software.
The common form has task description, deliverable and quality standards. Omitted
SDK evaluation settings are normalized by the SDK when constructing the request;
provided unsupported settings are rejected. Unknown input fields are not dropped.

HTTP discovery reads the origin's /openapi.json for the exact /negotiate path used
by the existing transport. No external refs, authentication bypass, custom headers,
remote servers, arbitrary routes or invented task parameters. A healthy SDK-like
status alone is insufficient. Unsupported optional schema features remain blocked
until they have a tested adapter. Existing Grid prefixed-json remains supported.

Migration 0026 records detectorVersion, negotiationProfile and schemaSource.
Historical rows remain version 0. A bounded bootstrap revisit targets only old
parameter/schema failures, preserves quote evidence and counters, and never resets
pending queue leases. Shared failures must come from the current detector version.
Schema hashes bind provenance and form requirements; quote signatures still bind
the original SDK request/response, not our presentation metadata.

No new production hireable-agent count is claimed by these local changes. Review
docs/IMPLEMENTATION_SDK_NEGOTIATION.md for test and rollout status.

### Network execution boundaries

Current catalogue and dynamic quote verification are Mainnet (56). Indexed jobs
support 56 and 97. First reuse network selection inside job history; propagate it
through queries, totals, cursors and explorer links. This does not switch the
identity's registration network or make a seller support Testnet negotiation.
Full Testnet hiring inventory needs network-scoped identities, schemas, endpoints,
contract/token pins and verification. Never join agents by numeric ID alone.

## Rollout acceptance

- [x] Implement shared compatibility persistence and remove declaration-only CTAs locally.
- [x] Allow first-time compatible A2A, HTTP and MCP requests without historical admission.
- [x] Align automatic probes with actual schemas and explicit safe samples.
- [x] Separate migrated quote counters, wallet attribution and deduplicated totals.
- [x] Apply shared catalogue eligibility, filters and scoped mutation refresh locally.
- [x] Implement history buttons, disclosure chevrons, copy feedback and five-row pages.
- [x] Add network-scoped job history without claiming Testnet catalogue support.
- [x] Cover schema compatibility, strict MCP handshake, fallback, stale evidence,
      scoped mutations, pagination and eligibility/facet agreement with local tests.
- [ ] Verify browser back navigation against deployed services and real receipts
      in the authorized end-to-end hiring flow.
- [ ] Verify deployed APIs, D1 facets and a complete authorized Testnet hire.

These checks describe local implementation, not a successful remote rollout.
Apply `0024_negotiation_compatibility.sql` before deploying the new Worker, then
deploy the frontend. Existing capabilities start with pending compatibility;
historical quote evidence is not backfilled into invented schema verification.
Refresh discovery through user checks and bounded scheduled work before enabling
or announcing the reduced hiring inventory. Do not mark production or full
Testnet hiring acceptance complete from local unit tests alone.

## Audit snapshot, not evergreen product counters

On 2026-09-05, 304169 had no recorded quote requests. Job 56585 was Completed
provider-wallet activity, not independently attributed to that agent. Grid
303779 had four tracked requests (two successful, two failed), plus 24 migrated
quote observations. Its indexed job 56696 was Submitted. These facts explain
the UI defects; query current data for demos rather than hardcoding this snapshot.
