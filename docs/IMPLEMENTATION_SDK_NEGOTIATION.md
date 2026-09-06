# SDK negotiation interoperability

Status: local implementation validated; publication and remote rollout tracked below.

## Delivery boundaries
- [x] Publish previous changes separately: PR #107, main target; frontend 1001 tests, Worker 891 tests, typechecks and production build passed.
- [x] Start `codex/sdk-negotiation-profiles` from that delivery, without merging it implicitly.
- [x] Introduce versioned SDK input profile with bounded schema and provenance.
- [x] Recognize documented A2A SDK negotiation declarations without the marketplace extension.
- [x] Read bounded same-origin OpenAPI request schemas for HTTP; no remote refs or invented body.
- [x] Preserve explicit seller schemas, including Grid, before applying fallback profiles.
- [x] Persist detector version and provenance; do not inherit old unsupported results across detector versions.
- [x] Reuse the existing browser/Worker execution and quote verification; no duplicated quote endpoint.
- [x] Confirm the common form works with the existing renderer; no invented service examples.
- [x] Test invalid URLs, generic MCP, ambiguous declarations, schema changes, and unchanged signatures.
- [x] Run frontend and Worker suites, typechecks, and production build.
- [x] Run a bounded external read-only discovery pilot; separate discovery from quote validation.
- [x] Run external quote pilot on Mainnet without funding; two accepted responses with valid registry-bound signatures, both above the unchanged price cap.
- [x] Update public seller docs and internal eligibility docs.
- [ ] Publish implementation separately and report remaining rollout blockers.

## Recognition is not settlement approval
The reviewed SDK commit is `bab27109237d509c780a36cf831dcfce70aabafe`.
Its NegotiationRequest uses task_description and terms.deliverables/quality_standards;
its A2A reference advertises negotiate-erc8183-job and these data fields.
Health, name, Studio branding, or historical jobs alone are not schema evidence.
Explicit incompatible schemas must fail closed, not fall through to a generic form.
Unknown required parameters and unsupported OpenAPI constructs block automatic forms.
Profiles identify a wire contract, not the installed SDK version or software provenance.

Keep shared capability freshness separate from session quote expiry. Verify the original
signed result against buyer request, provider identity, network, contracts, token, price
and time before enabling funding. No automatic contract allowlist expansion.

## Scope and rollout
Preserve Grid's prefixed-json contract, payment recovery, jobs, receipts and history.
Do not delete demo routes until all consumers are migrated and tested.
Testnet catalogue support is not Testnet quote/funding support; that remains gated on
network-specific verification and approved pins. Do not promote agents on discovery alone.
Migration 0025 belongs to PR #107; new schema changes must be additive and separately applied.
Do not reset all failures or repeat still-valid successful quotes. Revisit old structural
schema failures in bounded batches after deploying a newer detector.

## Still pending, not claimed complete
- [ ] Merge the two reviewed deliveries in order and apply migrations 0025 then 0026.
- [ ] Deploy Worker/frontend and confirm live forms and ledger persistence through the UI.
- [x] Seller-defined pricing: remove the marketplace's 0.01 U commercial cap. Accept positive uint256 signed prices; bind each prepared payment and exact approval to that quote. The Grid seller's own price and isolated demo limits remain unchanged.
- [ ] Deploy the pricing change and request fresh external quotes; historical pilot quotes cannot authorize payment.
- [ ] Implement specialized task-schema adapters such as ChainHelix (not silently bypassed).
- [ ] Add supported HTTP profiles when neither OpenAPI nor an explicit schema is available;
      a generic SDK-like health/status response alone is deliberately insufficient.
- [ ] Complete Testnet quote execution and network-specific settlement admission.

Results and measured scope: SDK_NEGOTIATION_PILOT_2026-09-06.md.
The existing seller-client remains the shared discovery entry point; profile and
OpenAPI resolution are extracted into dedicated modules rather than adding another
parallel discovery API. Provider resolution is shared by Worker and hiring preflight.
