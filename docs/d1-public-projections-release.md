# Delivery B: release gates and rollback

Status (2026-09-27): release authorized; additive migrations applied and bounded
backfill underway. **B application readers are not deployed yet.** The serving
Worker remains PR172, with A public reads and authorized ERC-8183 indexing.

## Evidence and scope

- Integrated Worker suite: 67 files / 629 integration tests, 670 unit tests, types and dry runs passed. Subsequent release-executor corrections: 17 focused tests and types passed, including a complete 1,022-step rehearsal with confirmations.
- Integrated frontend: 169 files / 1,569 tests, types and production build passed. No seller requests or remote D1 load tests.
- Definitive recurring evidence: `bnb-agent-probe/test/prototypes/public-current-day-cost.{json,md}`. Production cold journey: `catalog-combined-production-cost-evidence.expanded.json` in the same folder. Earlier prototypes are historical, not release measurements.
- Representative 20k daily weighted units: 176,622,270 → 12,473,955 (−92.9375%); same 96 mutation groups and cold traversals. Adverse write-heavy 20k: 49,374,814 → 56,824,894 (+15.0888%); same 1,536 mutation groups. This is B public traffic and source writes, **not C scheduler/consumer validation**.
- Public cold 20k journeys improve 90.45–93.77%; cached responses retain zero D1 queries. No production invoice saving is inferred from fixtures.

The approved combined operation replaces three independent initial reads with one. The shell still streams immediately; cards, facets and totals resolve together. An initial combined failure affects all three sections. Section retries remain independent, as do the existing directory route and 15-second deadline. This is a deliberate change from independent initial section failure isolation.

## Staged publication — mandatory order

Local browser verification (controlled six-second HTTP fixture, no remote D1): desktop 1280×850 and mobile 390×844 render the shell and loading skeletons, disable filters while pending, then show cards/counts and enabled controls. Changing scope and Mainnet→Testnet replaces old cards with skeletons; the result links use the selected network. Back navigation restores Mainnet. Four uncached navigation attempts yielded four combined fixture requests and no separate facet/summary requests; hydration did not duplicate them. Browser error log was empty. The first production-mode preview correctly rejected plain HTTP; the local check used development mode without weakening production HTTPS validation.

1. Recheck remote `main`, concurrent changes, exact active Worker version, bindings, D1 migration ledger and actual schema. Preserve the submission branch and unrelated worktrees. Review fresh effective configuration; environment names do not identify production safely.
2. Review and admit construction against the shared 250,000,000 nominal weighted-unit cap (US$0.25 at the documented excess rates). Include previously consumed sizing reads, DDL/index construction, backup-related work, sparse/current backfills and control statements. Protect C's allocation. Estimates are not upper bounds; unknown or oversized work stops admission. Do not increase budgets to pass.
3. Create and verify a recoverable backup/bookmark, recording sanitized metadata and restoration procedure outside Git. A successful export alone is not verified recovery. No destructive restore against the live database.
4. Keep A serving. Apply additive migration 0036, then 0037; stop on any failure. Run authenticated, bounded migration steps through the separately reviewed temporary maintenance entrypoint, not the public application. It has no scheduled/queue handlers, seller calls or arbitrary SQL input. Admit DDL before executing it; the backfill ledger cannot retroactively authorize uncharged external operations.
5. Verify both sparse and current coverage checkpoints are complete and equivalence checks passed. **Do this before deploying the B Worker**, not merely before the frontend: existing list/detail/counter routes also depend on the new projections and can return 503 if coverage is missing.
6. Deploy the reviewed B Worker preserving the freshly verified configuration. Since the September 27 authorization, cron runs each minute for ERC-8183 indexing only: `BACKGROUND_INDEX_ONLY=1`, `BACKGROUND_INDEX_PAUSED=0`; its queue is active. Both older queues and jobs/maintenance remain paused, cost controls stay active, and the remote `STAGING_MANUAL_RUN` value is preserved (currently 0). Never restore the earlier all-paused configuration. Verify these controls again after deployment. Then publish the matching frontend through the existing Vercel integration. Do not deploy from the unrelated root working tree.
7. Perform only bounded functional checks. Record exact Worker version and frontend commit, migration state, checks and timestamps. Disable/remove the temporary maintenance entrypoint after verified completion; retain its ledger and migration evidence.
8. Update the existing read-only monitoring automation to the actual release versions. Compare 48 attributable hours using Analytics/logs, normalized by operations/cache/route mix. Inaccessible telemetry is a stated evidence blocker, never a zero or invented reduction. C and the full initiative remain open.

## Cache and rollback

Coverage is checked on cold reads; cache hits deliberately do not query D1. Changing a checkpoint does **not** invalidate an already cached response. Before an intentional rebuild, account for existing cache TTLs (Worker and frontend) or explicitly purge/version the relevant cache. Do not claim immediate fail-closed behavior for warmed caches, and do not add a D1 coverage read per cache hit.

If B regresses, restore the prior frontend first (it does not require the combined endpoint), then the known-compatible A Worker using the same configuration-preserving checks. Do not restore an old full configuration or reactivate background processes. Additive tables and source data remain intact. Do not drop projections or triggers impulsively: A can coexist with them, and removing triggers would invalidate projection completeness. Preserve later unrelated commits and deploy only the reviewed revert. Recheck functional health, configuration and the deployment IDs.

## Outstanding release gates

The earlier 7M overhead lane was disproved by a RED admission test. The final
executor uses lane ceilings (base 12M, current 84M, overhead 12M) plus an atomic
**shared 250M cap**, protecting C's 150M throughout. These ceilings are not
additive allocations. Confirmed measured work releases unused reservations;
unknown work does not. The inner current reservation ledger remains bounded
at 84M. See `pr171-release-controls.md` for the measured complete rehearsal
and the safely refused sparse page that motivated base-lane headroom.

The new DDL-only local test measures 166 reads / 44 writes (44,166 weighted units), excluding the separately measured 8k-observation index (16,113 reads / 8,001 writes). A proposed 250,000-unit fixed-DDL/preflight allowance is conservative for that fixture, not a universal bound; see `public-projection-ddl-cost.{json,md}`. Fresh index cardinality, previous reads and external DDL must be admitted before execution, not retroactively.

September 27 preflight confirmed PR172 Worker version
`9deb4de2-d382-4c5c-b982-586c34dcfb3a`, D1 production storage, expected binding,
7,877 observations and 40,767 current endpoint tuples. Sizing/schema/ledger
checks used 48,793 reads and no writes. Time Travel returned a recovery
bookmark, recorded outside Git; no destructive restore was executed.
Migrations 0036 then 0037 succeeded. External DDL/index work was conservatively
precharged 8.1M units; prior reads 1.05M. Do not describe reserved units as an
exact invoice or measured DDL cost.

- Complete current backfill and exact coverage checks; preserve receipts.
- Final CI/review, fresh configuration check, Worker publication, merge and frontend publication.
- Attributable 48-hour production savings evidence; historical route/cache telemetry access has previously been unavailable.

No pending gate is represented as completed by this document.
