# Historical sparse-only reader experiment: gates initially blocked

This document preserves the earlier RED evidence, not the current release status. The approved combined-operation/current-projection implementation supersedes it; see `d1-public-projections-release.md` and `bnb-agent-probe/test/prototypes/public-current-day-cost.md` for the latest production-code results. Figures below are intentionally unchanged.

This is local evidence, not a deployment approval. No remote database, queues, cron, traffic, or configuration was changed. The reference is commit `1fe712a`, copied before reader edits into `bnb-agent-probe/test/fixtures/public-read-reference`. The enriched baseline JSON is immutable. Neither the empty-hiring A fixture nor a warmed response cache is used to claim the B objective.

## Measured result

The enriched fixture has two endpoints per agent, shared endpoints, current and removed identities, both networks, compatible and incompatible sellers, suspended/unsafe endpoints, expired compatibility, buyer quotes and later capability probes, browser observations, duplicate hire events, and historical attempts. At 20,000 agents it returns 7,388 hiring and 11,083 evaluation agents.

| 20k operation | Reference reads | Compact reads | Required maximum |
| --- | ---: | ---: | ---: |
| Global facets | 2,239,917 | 227,441 | 218,208 |
| Summary | 134,413 | 142,937 | Included in full-cold budget |
| Detail | 338 | 62 | Same output, bounded enrichment |
| Full cold, hiring | 1,221,818 | 518,409 | 122,181 |
| Full cold, evaluation | 1,631,632 | 636,830 | 163,163 |
| Full cold, filtered evaluation | 1,869,721 | 608,242 | 186,972 |

All public reads write zero rows. At 2k, global facets use 22,756 reads, below the 44,737 gate. The 20k profile remains deliberately failing. Full numerical metadata and reproducible commands are in `d1-public-projections-reader-evidence.json`; time values are summed local D1 query durations, not page latency.

Hiring cold reads decompose into 201,364 for list selection, 171,812 for scoped facets, 142,936 for summary, 2,294 for page enrichment, and three coverage lookups. The repeated current-state relation, not enrichment or a historical scan, now dominates.

## What changed safely

- Public readers require verified complete projection coverage. Unknown, corrupt or incomplete coverage gives `503` and `no-store`; no source-history fallback is attempted.
- Filter/count relations read compact endpoint evidence and job metrics. Current declarations, endpoint policy and capability state remain authoritative at read time. No availability, eligibility or suspension boolean is copied per agent.
- Quote admission continues using the original authoritative source reader. Detail keeps its existing bounded recent-history page; effective observations are fetched by projected primary-key IDs.
- Page enrichment occurs after filtering/counting/pagination. The last quote attempt and its request are only primary-key lookups, not historical reconstruction.
- Hiring candidates are selected before forming their full facet relation. Category membership is aggregated once per agent with duplicate-safe bit positions. Evidence for non-operational endpoints is not joined. Mandatory operational filtering can be applied at aggregation.
- Both summary existence joins preserve declaration/capability-first order. Query plans demonstrated that an otherwise innocent index could make SQLite start from all endpoints and create hundreds of millions of reads; `CROSS JOIN` prevents that reordering.

Public parity tests cover all filter families and self-exclusion, sparse metrics, exact expiry, both networks, page/cursor ordering including empty later pages, multiple/duplicate categories, late observation arrival, observation timestamp ties, immediate shared-endpoint blocks, and suspension. The old job numeric-key/text-guard regression is retained against the immutable source reader; compact facets explicitly avoid `hire_events`, `commerce_jobs` and `catalog_observations`.

## Index experiments: do not deploy them

Three covering indexes were created only inside an isolated diagnostic test database, explicitly selected, and verified with query plans. On the earlier compact reader they increased full-cold hiring from 671,820 to 762,562 and then 797,684 reads. Covering does not mean fewer billed D1 rows: the non-unique prefix ranges add index iteration. Their creation also cost 40,001, 18,001 and 20,021 writes. The production migration was not changed.

A unique partial completed-job index reduced global facets from 227,441 to 219,437 reads, with 11,348 reads and 1,334 writes at creation. It still misses the fixed 218,208 gate and does not resolve the integral budget. It is not included in production. The experiments clean up only their explicitly named test-owned indexes between fixture sizes.

## Structural diagnosis and next design decision

These measurements do not prove that every conceivable SQL implementation is impossible. They do show that adding generic covering indexes, removing historical scans, and retaining the current three independent relations does not meet the objective.

For the current hiring-first structure, list and facets each (a) establish valid hiring tuples from capability, current declaration, current endpoint policy and evidence; then (b) read all current endpoints of those selected agents to preserve every facet family. The latter cannot discard the other endpoint merely because the first is requestable. With 7,388 selected agents and two endpoints each, the repeated tuple work alone already consumes the shared budget before the summary is considered. The measured summary alone is larger than the entire 122,181 hiring budget.

Including raw latest capability columns in the compact endpoint row is compatible with the safety model only if every capability writer updates that row in the same transaction, sparse rows also exist for capability-only agents, and backfill verifies these fields. It would remove one capability join; declarations and endpoint policy still must be read. An optimistic estimate removing those capability visits saves on the order of 68k reads from the 518k hiring flow, not the roughly 396k needed. This is an estimate, not a benchmark or an approved schema change. It cannot independently make 90% viable.

A larger change needs an explicit decision and a measured prototype: reuse a single current-state evaluation for cards, facets and both scope counters, and reduce the underlying tuple work further. A combined operation alone is not proven sufficient: the current scoped-facet relation already costs 171,812 reads before unscoped summary work. Persisted cross-request aggregates would need dependency/version and expiration semantics that preserve immediate global blocks without unsafe fan-out or copied permanent policy booleans; that is additional design, not hidden inside this patch. No such new model, endpoint contract, cache, or projection has been implemented here.

### Concrete options and additional authority

1. **Raw capability fields in the existing endpoint projection.** Add state, compatibility state/hash/check/expiry, capability expiry, success/failure fields and last-attempt ID. No derived eligibility or availability flag. Capability insert/update/delete triggers must maintain these fields atomically, including capability-only tuples with no observations. Coverage needs a new version and complete source equivalence before activation. Declarations and endpoint policy remain live joins; expiry is evaluated from timestamps. Estimated hiring cold cost remains around 450k reads, so this option is insufficient for 90% on its own.

2. **One additive public view operation plus a denser current-declaration read model.** Keep the existing public endpoints/contracts and quote admission unchanged, but let the frontend consume one new response containing cards, facets and both scope counters. Use a single SQL snapshot/one `nowMs` to share the filtering relation. At `(agentKey, endpointKey)` grain, store raw current declaration data, agent filter/order fields, raw capability columns and compact historical evidence. Continue joining the authoritative shared endpoint for policy; never fan out global endpoint blocks or copy policy booleans. This eliminates repeated agent/declaration/capability joins as well as three independent evaluations. An optimistic work estimate is roughly 40k compact tuples + 40k endpoint seeks + grouped-agent/counter/page work, around 100k–170k reads depending on materialization and reuse. Only the low end would satisfy the 122,181 hiring gate; this is a candidate for a benchmark, **not proof of 90%**. Category virtual-table steps and repeated grouped-result scans must be included, not silently excluded.

   This is broader than the present sparse evidence+metrics design. Agent metadata changes would update each of that agent's endpoint rows (not every agent sharing a global endpoint); declaration lifecycle changes update their exact tuple; capability/evidence writes update the same tuple atomically. Raw timestamps preserve exact expiration without sweeps. Backfill must include observation-free declarations and concurrent agent/capability/declaration changes, and its coverage gate must verify all copied raw fields. It needs explicit approval for an additional operation/frontend consumption path, the new projection grain/fields and agent-local write amplification. It also needs the weighted daily workload replay before any acceptance. There is no demonstrated guarantee that this option reaches 90%.

No policy-dependent persisted boolean rollup or silent cache warm-up is proposed as a substitute for the hard cold-request target. If the dense shared-operation prototype still fails, the current evidence does not justify claiming the requested economic outcome; a further explicit product/architecture decision is necessary.

Do not activate these readers as a completed cost solution or mark the initiative achieved until the fixed enriched full-cold gates and weighted daily write/read economics are genuinely satisfied.
