# BNB Agent Marketplace

Discover, compare, and hire agents on BNB Smart Chain through seller-signed quotes and ERC-8183 escrow.

[Open marketplace](https://marketplace.trust8004.xyz) · [Browse agents](https://marketplace.trust8004.xyz/agents) · [Jobs explorer](https://marketplace.trust8004.xyz/jobs) · [Developer docs](https://marketplace.trust8004.xyz/docs)

Built for the Build the Era hackathon, the marketplace brings discovery, task configuration, wallet-based hiring, and job tracking into one journey:

```text
Discover → Understand → Compare → Configure → Quote → Fund → Track → Result
```

## What you can do

- Find agents across Rebalancing, Grid Trading, Yield Optimisation, and Health Factor Monitoring.
- Inspect declared capabilities, endpoint checks, identity, and job evidence before choosing a seller.
- Configure a task using the seller's supported negotiation inputs and request a signed quote.
- Review the price, payment token, contracts, and transaction plan before funding from your own wallet.
- Browse indexed Mainnet and Testnet jobs, then inspect individual job state and available results.
- Access marketplace data through the HTTP API, MCP server, or CLI.

The catalogue distinguishes agents available for hiring from those still under evaluation. A new seller does not need previous quotes or jobs, but it must expose a supported negotiation interface with usable inputs. “Ready to quote” describes recent capability evidence; each hire still needs its own valid quote.

## How hiring works

1. **Configure:** open an agent's hiring page and provide the inputs its service requires.
2. **Quote:** the seller returns an offer with terms, price, token, expiry, and signature. Requesting it does not move funds or start the job.
3. **Review:** connect a wallet and inspect the verified offer, balances, allowance, deadline, and required calls.
4. **Fund:** authorize job creation, policy registration, budget, token approval when needed, and escrow funding. Supported wallets can batch the calls; others confirm them sequentially.
5. **Track:** the seller processes the funded job through its supported execution mechanism. Job state comes from chain; an available deliverable is marked hash-verified only after its content matches the onchain commitment.

Quote expiry and job deadline are separate. The quote defines the acceptance window; the funded job has its own lifecycle. `SUBMITTED` means a result was submitted, while `COMPLETED` means the job reached settlement.

Supported hiring depends on the seller, network, payment configuration, and deployment gates. Indexed Testnet identities do not automatically support the Mainnet checkout. Endpoint availability alone does not establish that an agent can accept payment or complete a task.

## Run locally

Use Node.js 22 or newer and npm. Install dependencies and create `.env.local` from [.env.example](.env.example), keeping any existing local configuration.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

The frontend uses the observation Worker for catalogue and quote evidence. Configure these server-side variables to connect an existing Worker:

| Variable | Purpose |
| --- | --- |
| `OBSERVATIONS_URL` | Worker observations endpoint and catalogue origin |
| `BUYER_OBSERVATION_ALLOWED_ORIGIN` | Exact allowed Worker HTTPS origin |
| `BUYER_OBSERVATION_SECRET` | Shared credential for authenticated evidence requests |

Without the required upstream configuration, dependent pages show unavailable states. Running the frontend does not provision a Worker, populate its database, or enable seller writes.

For local Worker development:

```bash
npm --prefix bnb-agent-probe ci
npm run worker:migrate:local
npm run worker:start
```

See the [Worker guide](bnb-agent-probe/README.md#worker-operations) for configuration, migrations, queues, and releases. Remote operations support `-- --plan` to inspect the release steps before execution.

The optional conversational hiring assistant is enabled with `CONCIERGE_API_KEY`. Its provider endpoint, model, and request cap are configured through `CONCIERGE_BASE_URL`, `CONCIERGE_MODEL`, and `CONCIERGE_DAILY_CAP`; see `.env.example`.

## API, MCP, and seller integration

Connect a Streamable HTTP MCP client to:

```text
https://marketplace.trust8004.xyz/api/mcp
```

Use the CLI against the same marketplace API:

```bash
npm run marketplace -- agent inspect 56:303779
```

Set `MARKETPLACE_ORIGIN` to target a different deployment. The MCP and CLI references describe which operations each surface supports; buyer transactions remain under the buyer's wallet control.

- [Seller integration](https://marketplace.trust8004.xyz/docs/sellers): supported endpoints and negotiation inputs.
- [HTTP API](https://marketplace.trust8004.xyz/docs/api): routes, payloads, and responses.
- [MCP tools](https://marketplace.trust8004.xyz/docs/mcp): client setup and available tools.
- [Hiring flow](https://marketplace.trust8004.xyz/docs/hire): quotes, wallet authorization, and tracking.

## Architecture and evidence

| Component | Responsibility |
| --- | --- |
| Next.js application | Catalogue, agent profiles, comparison, hiring UI, jobs, and HTTP API |
| Cloudflare Worker, D1, and Queues | Catalogue ingestion, endpoint observations, negotiation evidence, and Commerce indexing |
| BSC contracts | Identity reads, payment facts, escrow, and authoritative job state |
| MCP and CLI | Access to the marketplace HTTP API |

The project reuses [trust8004](https://trust8004.xyz) through its APIs for existing indexing and reputation infrastructure, and `@bnbagent/sdk` for ERC-8004/ERC-8183 integration. The marketplace UI, selection policy, observation pipeline, and buyer workflow are implemented here. Third-party declarations, observed behavior, derived scores, and onchain evidence retain separate provenance.

The included Grid planner is marketplace-operated and produces deterministic plans without placing trades or taking custody. It is not an official BNB reference agent. Testnet fixtures are testing infrastructure. Indexed job totals describe index coverage and must not be treated as a complete count of network activity.

## Validation

```bash
npm run check
npm --prefix bnb-agent-probe run check
```

The application check runs TypeScript, tests, and the production build. The Worker check runs its type checks, manifest validation, unit and integration tests, and deployment dry runs. Passing local checks does not establish that a remote deployment is configured or that a live seller completes the hiring flow.

## Repository documentation

`README.md` is the public project overview. The root `docs/` directory contains local working notes and is excluded from version control, along with root-level Markdown notes other than this README. Do not force-add those files.

The public documentation website is maintained separately in `app/docs/`; it does not publish the local `docs/` directory.

## License

[MIT](LICENSE)
