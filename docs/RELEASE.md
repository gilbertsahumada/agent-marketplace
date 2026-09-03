# Release gate (WP7)

The journey the release must demonstrate end to end, with every fact keeping its
provenance:

```text
Discover   catalogue / funnel with fallback        GET /api/marketplace/agents
Understand provenance and freshness visible        GET /api/marketplace/agents/:id
Compare    four categories present                 GET /api/marketplace/compare
Hire       fresh quote + intent + non-custodial     /api/marketplace/demo/erc8183/*
Track      state read directly from BSC            GET /api/marketplace/jobs/testnet/:id
Result     verifiable evidence / hash              GET /api/marketplace/proofs/jobs/*
```

The gate is a repeatable checklist, not a judgement call. Every step below is a
command and its expected result; nothing here creates infrastructure or touches
a secret. Production stays safe-off until the operator completes the steps in
"Production", which only the account owner can run.

## 1. Local gate (both packages)

```bash
npm test                               # marketplace, all suites
npm run typecheck
npm run build                          # webpack build (never `npx next build`)
npm --prefix bnb-agent-probe run check # typecheck, manifest, unit + Workerd suites, three dry-runs
```

All four must exit 0. A skipped or flaky suite is a failed gate.

## 2. Staging smoke, switches off

Deploy the candidate to staging with the checked-in safe-off values (see the
promotion runbook in `bnb-agent-probe/README.md`), apply migrations, then:

```bash
npm --prefix bnb-agent-probe run smoke -- \
  https://bnb-agent-probe-staging.<account>.workers.dev \
  https://<marketplace-origin> --expect-kill-switch 1
```

The smoke script only issues GETs: Worker `/health`, `/catalog-agents?limit=1`,
`/hire-events?chainId=56&agentId=303779`; marketplace
`/api/marketplace/agents?limit=1`, `/api/marketplace/agents/303779/passport`,
`/api/marketplace/jobs/testnet/551`. It exits non-zero when any status, shape or
the expected kill-switch state disagrees, and prints one line per target.

## 3. Staging smoke, switches on

Enable in a commit (`KILL_SWITCH=0`, `PRODUCER_KILL_SWITCH=0`, the Cron
trigger) and deploy. A temporary flip is acceptable for the observation window
but must be mirrored by the commit, because `test/scaffold.test.ts` pins the
checked-in values:

```bash
npx wrangler deploy --env staging --keep-vars --var KILL_SWITCH:0 --var PRODUCER_KILL_SWITCH:0
npm --prefix bnb-agent-probe run smoke -- <worker-origin> <marketplace-origin> --expect-kill-switch 0
```

Then observe at least two complete `HEADER → SWEEP → PROBE` rotations:
`/health` must report `status: "ok"` and `last_header_summary`,
`last_sweep_summary`, `last_probe_summary` with `status: "ok"` and fresh
`updatedAt` values, and the D1 read/write counts of each tick must stay under
the pinned `D1_ROWS_READ_PER_RUN` / `D1_ROWS_WRITTEN_PER_RUN`.

## 4. Kill switch and rollback

Prove the off path before calling the release good:

```bash
npx wrangler deploy --env staging --keep-vars --var KILL_SWITCH:1 --var PRODUCER_KILL_SWITCH:1
npm --prefix bnb-agent-probe run smoke -- <worker-origin> <marketplace-origin> --expect-kill-switch 1
npm --prefix bnb-agent-probe run rollback:wp2-activation            # dry run: prints the plan
npm --prefix bnb-agent-probe run rollback:wp2-activation -- --execute  # removes the Cron, verifies switches
```

`/health` keeps answering with the switches on; public reads keep serving from
D1 and the Workers Cache; the Queue drains without new producer ticks. The plan
restore (`CLOUDFLARE_WORKERS_PLAN=free`) is a separate commit, described in the
probe README.

## 5. Observability

- Worker: `observability.enabled` is on in `wrangler.jsonc`; `/health` is the
  sanitized status surface (plan, scheduler mode, switches, budgets, last phase
  summaries). Structured `wp2.scheduler.attempt` and `catalog.*` log lines carry
  every tick's queries, rows and wall time.
- Marketplace: Vercel function logs; the same-origin routes answer with
  `cache-control: no-store` and map every failure to a typed error body.
- Evidence: each staging candidate is captured as a versioned record under
  `evidence/` (see `evidence/catalog-paid-staging-2026-09-02.json` for the shape).

## 6. Production (operator steps)

Production is bound to a placeholder D1 id and has no Cron. Only the account
owner can perform these, in this order:

1. `npx wrangler d1 create bnb-agent-probe` and replace the placeholder
   `database_id` in the top-level `d1_databases` block of `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply bnb-agent-probe --remote`.
3. `npx wrangler queues create bnb-agent-probe`.
4. Secrets on the production Worker: `SHARED_SECRET`, `BUYER_OBSERVATION_SECRET`,
   `BSC_RPC_URL`, `BSC_TESTNET_RPC_URL` (`npx wrangler secret put <NAME>`).
5. Marketplace environment (Vercel): `OBSERVATIONS_URL`,
   `BUYER_OBSERVATION_ALLOWED_ORIGIN`, `BUYER_OBSERVATION_SECRET` pointing at the
   production Worker origin.
6. `npx wrangler deploy` with the checked-in safe-off values
   (`CLOUDFLARE_WORKERS_PLAN=free`, `KILL_SWITCH=1`, `PRODUCER_KILL_SWITCH=1`,
   no Cron), then the smoke with `--expect-kill-switch 1`.
7. Only after steps 1–6 and a passing staging gate: one commit that enables the
   production Cron and switches, deployed and smoked with `--expect-kill-switch 0`.

Until step 7 lands, the live observation data plane is the Paid staging Worker
and its D1, reached by production through `OBSERVATIONS_URL` (DECISIONS,
2026-09-02).
