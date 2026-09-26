# Delivery B: release gates and rollback

Status: local validation; **not deployed**. Delivery A remains the serving version.

## Evidence and scope

- Worker complete integration suite, including daily scenarios: 66 files / 615 tests passed in 434 seconds; unit suite: 670 passed. Subsequent release-executor accounting correction: 13/13 focused tests and types passed; separate DDL measurements: 2/2 passed. These later cases have not been represented as a second complete suite run.
- Frontend: 167 files / 1,557 tests passed, including four additional streaming cases. Types and production build passed. Test DOM attempted ordinary external link navigation, blocked by the sandbox; no seller requests or remote D1 load tests.
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
6. Deploy the reviewed B Worker, preserving cron empty, paused queues, background pause flags and the exact remote `STAGING_MANUAL_RUN` value. Verify those controls again after deployment. Then publish the matching frontend through the existing Vercel integration. Do not deploy from the unrelated root working tree.
7. Perform only bounded functional checks. Record exact Worker version and frontend commit, migration state, checks and timestamps. Disable/remove the temporary maintenance entrypoint after verified completion; retain its ledger and migration evidence.
8. Update the existing read-only monitoring automation to the actual release versions. Compare 48 attributable hours using Analytics/logs, normalized by operations/cache/route mix. Inaccessible telemetry is a stated evidence blocker, never a zero or invented reduction. C and the full initiative remain open.

## Cache and rollback

Coverage is checked on cold reads; cache hits deliberately do not query D1. Changing a checkpoint does **not** invalidate an already cached response. Before an intentional rebuild, account for existing cache TTLs (Worker and frontend) or explicitly purge/version the relevant cache. Do not claim immediate fail-closed behavior for warmed caches, and do not add a D1 coverage read per cache hit.

If B regresses, restore the prior frontend first (it does not require the combined endpoint), then the known-compatible A Worker using the same configuration-preserving checks. Do not restore an old full configuration or reactivate background processes. Additive tables and source data remain intact. Do not drop projections or triggers impulsively: A can coexist with them, and removing triggers would invalidate projection completeness. Preserve later unrelated commits and deploy only the reviewed revert. Recheck functional health, configuration and the deployment IDs.

## Outstanding release gates

**Current blocking admission decision:** after charging every authenticated status, confirmation and rejected control attempt, the original 7,000,000-unit overhead lane cannot cover approximately 1,022 work/confirmation pairs at 5,000 units per request (10,220,000 units, before other controls). The implementation must deny work rather than exceed that lane. A redistribution inside the unchanged 250,000,000-unit cap was requested explicitly: base 12m, measured/reconciled current work 60m, C 150m, overhead 28m. The separate inner current backfill reservation ceiling would remain 84m; it must not be conflated with the outer reconciled spending lane. **This redistribution is not yet approved or implemented.** No remote migration or deployment is authorized by the local test results alone.

The new DDL-only local test measures 166 reads / 44 writes (44,166 weighted units), excluding the separately measured 8k-observation index (16,113 reads / 8,001 writes). A proposed 250,000-unit fixed-DDL/preflight allowance is conservative for that fixture, not a universal bound; see `public-projection-ddl-cost.{json,md}`. Fresh index cardinality, previous reads and external DDL must be admitted before execution, not retroactively.

Metadata-only remote preflight at 2026-09-26 19:43 UTC confirmed A version `5b098a2f-46af-4b9d-8b64-1021716f674c`, D1 production storage, the expected DB binding, empty cron, both queues paused, both background pause flags set to 1, and `STAGING_MANUAL_RUN=0`. No D1 query was executed by this check. Recheck immediately before mutation; this is not migration/schema verification.

- Approve the requested reserve redistribution and explicit prior-read/external-DDL precharges, then rerun and independently review the final temporary migration executor.
- Fresh remote preflight, backup verification and final construction admission.
- PR/CI/review, merge, staged migrations/backfills, Worker and frontend publication.
- Attributable 48-hour production savings evidence; historical route/cache telemetry access has previously been unavailable.

No pending gate is represented as completed by this document.
