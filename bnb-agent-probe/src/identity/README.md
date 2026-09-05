# Job → agent identity resolution

## Responsibilities

- `shared/agent-identity.ts`: dependency-free types, supported registry addresses,
  address normalization, explicit owner-fallback policy and freshness/batch limits.
- `src/business/use-cases/resolve-job-agents.ts`: resolves lists or single jobs,
  partitions by chain, deduplicates requests, and classifies evidence. No React or RPC.
- `src/data/observation/agent-identity-feed.ts`: cached, strictly parsed Worker adapter.
- `bnb-agent-probe/src/identity/repository.ts`: indexed wallet lookups and lightweight
  name/ID lookups, batched below D1 parameter limits. No full-profile fetches.
- `bnb-agent-probe/src/identity/indexer.ts`: background discovery and refresh using
  block-pinned registry reads. RPC failures do not become empty wallet snapshots.
- `components/marketplace/job-agent-cell.tsx`: shared table/detail presentation and
  chain/registry-aware profile navigation. No data access.

`ResolveJobAgents.execute(jobs)` accepts one or many `{chainId, jobId, provider}`
references and returns results keyed by `chainId:jobId`. Consumers must not key by
job ID alone. The Worker currently has one configured Commerce deployment per chain.
Supporting another Commerce contract on the same chain requires adding that address
to job identity keys throughout the existing ledger, not just this resolver.

## Evidence semantics

Recorded hire attribution takes precedence. Multiple registered identities remain
ambiguous. A current `getAgentWallet` match is an observed wallet association, not
proof that this identity performed a historical job. Shared wallets are not unique
attribution, even when only one candidate's observation is fresh. Replies contain at
most ten candidates per wallet and an explicit truncation flag; truncation is always
ambiguous. Observations older than 24 hours are labelled stale.

Owner fallback is explicit in `providerIdentity`. Existing hire verification/probing
retain their opt-in behavior. The reverse index and profile job lookup deliberately
do **not** substitute `ownerOf` for `agentWallet`. The index reads `ownerOf` to confirm
that the identity still exists. A successful zero wallet invalidates the former wallet
mapping. An older queued snapshot cannot overwrite a newer block.

Unavailable/malformed feeds are not reported as no matches and never hide job rows.
Names are catalog metadata, not onchain proof. Profiles currently support mainnet:
testnet identities are shown with their ID and network, without a misleading mainnet
profile link. No testnet names are borrowed from the mainnet catalog.

## Migration and activation order

Migration **0023_agent_identity_index.sql is required before deploying the new Worker**.
It adds one table and two indexes. It does not update/delete jobs or hire events.
The table starts empty; migration alone does not discover agent wallets.

Run from the repository's `bnb-agent-probe` directory. First inspect pending migrations
and back up the selected remote database using the existing operational procedure.
The apply command applies **all pending migrations**, not just 0023.

Local:

```sh
npm run migrations:list:local
npm run migrate:local
```

Staging (configured database):

```sh
npx wrangler d1 migrations list bnb-agent-probe-staging --remote --env staging
npx wrangler d1 migrations apply bnb-agent-probe-staging --remote --env staging
```

Then deploy the Worker and marketplace. Set `AGENT_IDENTITY_INDEX_ENABLED=1` in the
selected Worker's environment to enable background wallet discovery. This flag is
off when omitted. It requires the existing scheduler/queue to be active, global and
producer kill switches off, and the corresponding `BSC_RPC_URL` / `BSC_TESTNET_RPC_URL`.
Do not enable production from the checked-in placeholder configuration: production
currently has a placeholder D1 ID and no cron schedule.

The scheduler enqueues one bounded identity job per configured chain per tick.
Each run considers up to 20 catalog discovery IDs, 10 due refresh IDs, and 10 known
hire/probe IDs (deduplicated). Successful snapshots refresh after 12 hours; failed
individual reads back off for an hour without extending the evidence freshness.
Watch `identity.index.completed` (`checked`, `stored`) and queue failures/quotas.
The new work consumes additional D1/RPC/queue resources and is intentionally opt-in.

Mainnet discovery sweeps the existing partial catalog. Testnet discovery is limited
to IDs from recorded verified hires; a full testnet registry catalog is not present.
Coverage grows gradually, depends on cron frequency and read budgets, and is **not a
complete registry census**. Registered associations can already display names before
their wallets are swept. Never promise that every job will resolve to an agent.

Verification after rollout:

1. Read `/job-agent-identities?chainId=56&jobIds=<indexed-job-id>` on the Worker;
   verify names/IDs, registered evidence, candidates, and partial coverage.
2. Confirm `identity.index.completed` reports stored rows after enabling the flag.
3. Open Jobs and a job detail; verify name search and internal mainnet links.
4. Check testnet does not link to a same-numbered mainnet profile.

Rollback: disable the identity index flag, then roll back application/Worker code.
Leave the additive table intact; dropping it is not needed for rollback.

## Tests

Marketplace: resolver precedence, ambiguity, freshness, failures, batch sizes,
network isolation, strict feed parsing, component links and page integration.
Worker: migration-backed repository reads, candidate truncation, registered evidence,
wallet rotation/zeroing, out-of-order snapshots, block-pinned reads and RPC failures.
Worker integration tests apply migrations only to an isolated local test database.
