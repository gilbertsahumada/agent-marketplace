import type { Metadata } from "next";
import Link from "next/link";
import { Callout, CodeBlock, DocsSection, ExternalDocLink, InlineCode, ParamTable, SubHeading } from "../components";
import type { ParamRow } from "../components";
import { DOCS_MARKDOWN } from "../markdown";
import { PageActions } from "../page-actions";
import { DEMO_AGENT_BUYER } from "@/src/business/entities/demo-agent-buyer";

export const metadata: Metadata = { title: "MCP server documentation" };

const MCP_URL = "https://marketplace.trust8004.xyz/api/mcp";

interface ToolDoc {
  name: string;
  summary: string;
  params: ParamRow[];
  exampleArguments: string;
  exampleResponse: string;
  responseTitle: string;
  notes?: string[];
}

const TOOL_DOCS: ToolDoc[] = [
  {
    name: "search_agents",
    summary:
      "Search the marketplace catalogue of BSC agents by outcome category, free text and availability. Every fact in the response carries its provenance.",
    params: [
      { name: "q", type: "string", required: false, description: "Free-text search, max 120 characters." },
      { name: "category", type: "enum", required: false, description: "rebalancing · grid_trading · yield_optimisation · health_factor_monitoring" },
      { name: "availability", type: "enum", required: false, description: "all · hireable · mcp_only. hireable narrows to agents with a verified executable quote path." },
      { name: "page", type: "integer ≥ 1", required: false, description: "Page number." },
      { name: "limit", type: "integer 1–24", required: false, description: "Page size." },
    ],
    exampleArguments: `{ "category": "grid_trading", "limit": 5 }`,
    responseTitle: "response (item trimmed)",
    exampleResponse: `{
  "view": "marketplace",
  "items": [
    {
      "chainId": 56,
      "agentId": "303779",
      "name": "marketplace-operated-grid-planner",
      "operator": "marketplace",
      "categories": [{ "category": "grid_trading", "evidence": { "kind": "derived", … } }],
      "services": [{ "name": "A2A", "endpoint": "https://…/agent-card.json", … }],
      "hireability": { "canHire": false, "status": "quote_stale", … },
      …
    }
  ],
  "pagination": { "page": 1, "pageSize": 5, "total": 1, "totalPages": 1 },
  "categories": [{ "category": "grid_trading", "count": 1, … }, …]
}`,
    notes: [
      "availability=hireable currently requires quote evidence observed in the last 60 seconds, so it is stricter than the Passport state and often empty between probe runs. Discover with availability=all and read the Passport per agent.",
    ],
  },
  {
    name: "get_passport",
    summary:
      "Read an agent's Evidence Passport: provenance-labeled identity, endpoint, quote and job checks plus its onchain track record. Read-only evidence — not reputation, not an endorsement.",
    params: [
      { name: "agentId", type: "string", required: true, description: "Numeric BSC agent id, e.g. \"303779\"." },
    ],
    exampleArguments: `{ "agentId": "303779" }`,
    responseTitle: "response (live shape, trimmed)",
    exampleResponse: `{
  "schemaVersion": 1,
  "chainId": 56,
  "agentId": "303779",
  "name": "marketplace-operated-grid-planner",
  "state": "hireable",
  "evidenceSnapshotHash": "0x04e0feb4…",
  "attentionReasons": [],
  "checks": {
    "identity": { "status": "verified", "provenance": "onchain", … },
    "endpoint": { "status": "verified", "provenance": "observed", … },
    "quote":    { "status": "verified", "provenance": "observed",
                  "hireabilityStatus": "quote_verified", … },
    "job":      { "status": "missing", "provenance": "onchain", … }
  },
  "trackRecord": { "provenJobs": 0, "submittedJobs": 0, … },
  "nextRequirements": ["Complete and verify an ERC-8183 job on BSC."]
}`,
    notes: [
      "A state of hireable means an executable quote path exists; a fresh quote is still validated before any signature.",
    ],
  },
  {
    name: "compare_agents",
    summary:
      "Compare 2 or 3 agents' evidence side by side. The marketplace never declares a winner; the comparison is provenance-labeled evidence only.",
    params: [
      { name: "agentIds", type: "string[]", required: true, description: "2–3 numeric agent ids. Any registered agent works, not only curated candidates." },
    ],
    exampleArguments: `{ "agentIds": ["45650", "45381"] }`,
    responseTitle: "response (trimmed)",
    exampleResponse: `{
  "agents": [
    { "chainId": 56, "agentId": "45650", "name": "V3 Pools powered by HeyAnon", … },
    { "chainId": 56, "agentId": "45381", … }
  ]
}`,
  },
  {
    name: "request_quote",
    summary:
      "Request a fresh ERC-8183 quote from the network's admitted seller. The server validates the quote against its allowlist (seller, contracts, token, budget ceiling, expiry) before returning it. Free — signs nothing.",
    params: [
      { name: "network", type: "enum", required: true, description: "testnet or mainnet." },
    ],
    exampleArguments: `{ "network": "testnet" }`,
    responseTitle: "response (envelope elided)",
    exampleResponse: `{
  "envelope": { … keep byte-identical for the prepare step … },
  "agentId": 1866,
  "chainId": 97,
  "provider": "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5",
  "commerce": "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
  "router":   "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
  "policy":   "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
  "token":    "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
  "tokenSymbol": "U",
  "tokenDecimals": 18,
  "priceRaw": "1",
  "negotiatedAt": 1788211788,
  "quoteExpiresAt": 1788212688,
  "description": "{\\"chain_id\\":97,…}"
}`,
    notes: [
      "Keep the returned envelope byte-identical: the hire prepare step re-verifies the seller's signature over it. Any edit invalidates it permanently.",
      "Returns 404 ERC8183_SPIKE_DISABLED when the flow is disabled by environment.",
    ],
  },
  {
    name: "get_job_status",
    summary:
      "Track an ERC-8183 job by id. State, budget, deadline and deliverable hash are resolved from chain, not from marketplace claims.",
    params: [
      { name: "network", type: "enum", required: true, description: "testnet or mainnet." },
      { name: "jobId", type: "string", required: true, description: "Positive decimal job id, e.g. \"551\"." },
    ],
    exampleArguments: `{ "network": "testnet", "jobId": "551" }`,
    responseTitle: "response (live shape, trimmed)",
    exampleResponse: `{
  "liveStatus": "verified",
  "job": {
    "chainId": 97,
    "jobId": "551",
    "buyer": "${DEMO_AGENT_BUYER.address}",
    "provider": "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5",
    "status": "COMPLETED",
    "deliverableHash": "0x…",
    …
  },
  "snapshot": { … }
}`,
    notes: [
      "Job status machine: OPEN → FUNDED → SUBMITTED → COMPLETED, with REJECTED and EXPIRED as terminal failures.",
      "Only jobs matching the fixed demo allowlist are exposed; anything else is 404 ERC8183_DEMO_JOB_NOT_FOUND.",
    ],
  },
];

export default function McpDocsPage() {
  return (
    <div className="space-y-10">
      <header>
        <p className="font-eyebrow text-primary">Documentation · MCP</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">MCP server</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Five tools covering the whole journey, served over two transports from the same code — a
          thin wrapper over the <Link className="text-zinc-200 underline decoration-zinc-700 underline-offset-2 hover:text-white" href="/docs/api">HTTP API</Link>, never a
          parallel implementation. Everything here is discovery and quoting: no tool signs
          transactions or moves funds.
        </p>
        <div className="mt-4"><PageActions markdown={DOCS_MARKDOWN.mcp!} slug="mcp" /></div>
      </header>

      <DocsSection id="connect" title="Connect">
        <SubHeading id="remote">Remote — Streamable HTTP</SubHeading>
        <CodeBlock title="endpoint">{MCP_URL}</CodeBlock>
        <CodeBlock title="Claude Code">{`claude mcp add --transport http marketplace ${MCP_URL}`}</CodeBlock>
        <p>
          The endpoint is <strong className="font-medium text-zinc-200">stateless</strong>: no session
          ids, each JSON-RPC <InlineCode>POST</InlineCode> is self-contained, and{" "}
          <InlineCode>GET</InlineCode>/<InlineCode>DELETE</InlineCode> answer 405. Any
          spec-compliant client works. Without a client you can speak JSON-RPC directly:
        </p>
        <CodeBlock title="curl — list the tools">{`curl -X POST ${MCP_URL} \\
  -H "content-type: application/json" \\
  -H "accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</CodeBlock>
        <CodeBlock title="curl — call a tool">{`curl -X POST ${MCP_URL} \\
  -H "content-type: application/json" \\
  -H "accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"search_agents","arguments":{"limit":5}}}'`}</CodeBlock>
        <SubHeading id="stdio">Local — stdio</SubHeading>
        <p>
          From a clone of the repository: <InlineCode>npm run mcp</InlineCode>. Claude Code picks it
          up automatically via the checked-in <InlineCode>.mcp.json</InlineCode>. Set{" "}
          <InlineCode>MARKETPLACE_ORIGIN</InlineCode> to target another deployment (HTTPS only,
          except localhost).
        </p>
      </DocsSection>

      <DocsSection id="quickstart" title="Quickstart — a buyer agent end to end">
        <p>
          The repository ships the reference agent buyer. Without a key it runs the whole journey up
          to the signature boundary — this is real output against production:
        </p>
        <CodeBlock title="npm run agent-buyer -- --dry-run">{`agent-buyer: DRY RUN (no signatures) as 0x5ee7…cc52
marketplace: https://marketplace.trust8004.xyz
discovered 1 agent(s): 303779 (marketplace-operated-grid-planner)
passport 303779: state=evaluated (evidence, not reputation)
quote: 1 raw U, expires 2026-09-01T12:12:06.000Z
plan validated: 5 intents, deadline 1788268326, approval required (exact)
guardrails: spend ceiling 1 raw, key received by server: false
dry run complete — quote validated, plan verified against the pinned allowlist, nothing signed.`}</CodeBlock>
        <p>
          With <InlineCode>AGENT_BUYER_PRIVATE_KEY</InlineCode> set (a funded Testnet key that never
          leaves the process), the same command signs and sends the five transactions. The sequence
          is verified end to end against the deployed Testnet contracts on a fork — a real
          production quote and prepared plan, then:
        </p>
        <CodeBlock title="fork-verified transaction sequence (deployed contracts, real plan)">{`1 createJob: success   → jobId 874
2 registerJob: success
3 setBudget: success
4 approve: success (exact amount)
5 fund: success        → 1 raw unit moved into escrow`}</CodeBlock>
      </DocsSection>

      <DocsSection id="division-of-labor" title="What goes through MCP — and what deliberately does not">
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03] text-zinc-500">
                <th className="px-3 py-2 font-medium">Step</th>
                <th className="px-3 py-2 font-medium">Surface</th>
                <th className="px-3 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/[0.06]">
                <td className="px-3 py-2 text-zinc-400">Discover · Understand · Compare</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-200">MCP</td>
                <td className="px-3 py-2 text-zinc-400">Read-only evidence with provenance.</td>
              </tr>
              <tr className="border-b border-white/[0.06]">
                <td className="px-3 py-2 text-zinc-400">Quote</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-200">MCP</td>
                <td className="px-3 py-2 text-zinc-400">Free, signs nothing; returns the seller-signed envelope.</td>
              </tr>
              <tr className="border-b border-white/[0.06]">
                <td className="px-3 py-2 text-zinc-400">Prepare · Notify</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-200">HTTP</td>
                <td className="px-3 py-2 text-zinc-400">Prepare returns <em>what to sign</em> — the intents, deadlines and guardrails — never a signature.</td>
              </tr>
              <tr className="border-b border-white/[0.06]">
                <td className="px-3 py-2 text-zinc-400">Sign + send 5 transactions</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-200">buyer&apos;s wallet → chain</td>
                <td className="px-3 py-2 text-zinc-400">The key never leaves the buyer; the marketplace is not in the money path.</td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-zinc-400">Track · Result</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-200">MCP or HTTP</td>
                <td className="px-3 py-2 text-zinc-400">State is resolved from chain either way.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout tone="note">
          <p>
            There is no <InlineCode>sign</InlineCode> or <InlineCode>submit_transaction</InlineCode> tool
            on purpose. A server that could produce a buyer signature would hold custody of the
            buyer&apos;s key; a server that relays already-signed transactions would sit in the money
            path adding a trust point the chain itself already solves. The marketplace&apos;s job ends
            at evidence and the signed quote: it tells the buyer <em>what</em> to sign and verifies
            the outcome from chain — it never signs and never transports signatures. This applies
            identically to a human buyer (browser wallet) and an agent buyer (local key).
          </p>
        </Callout>
      </DocsSection>

      <DocsSection id="tools" title="Tool reference">
        <p>
          Success returns pretty-printed JSON as a single text content. Upstream API errors come back
          as tool results with <InlineCode>isError: true</InlineCode> — see{" "}
          <a className="text-zinc-200 underline decoration-zinc-700 underline-offset-2 hover:text-white" href="#errors">error handling</a>.
        </p>
        <div className="space-y-10">
          {TOOL_DOCS.map((tool) => (
            <div className="space-y-4" key={tool.name}>
              <SubHeading id={tool.name}><span className="font-mono">{tool.name}</span></SubHeading>
              <p>{tool.summary}</p>
              <ParamTable rows={tool.params} />
              <CodeBlock lang="json" title="arguments">{tool.exampleArguments}</CodeBlock>
              <CodeBlock lang="json" title={tool.responseTitle}>{tool.exampleResponse}</CodeBlock>
              {tool.notes?.map((note) => (
                <Callout key={note} tone="note"><p>{note}</p></Callout>
              ))}
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection id="errors" title="Error handling">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            An upstream API error surfaces as <InlineCode>isError: true</InlineCode> with a single
            text content <InlineCode>CODE: message</InlineCode>, e.g.{" "}
            <InlineCode>ERC8183_DEMO_JOB_NOT_FOUND: The Testnet demo job was not found.</InlineCode>{" "}
            A non-JSON upstream failure becomes <InlineCode>HTTP_&lt;status&gt;: Marketplace request failed</InlineCode>.
          </li>
          <li>
            Invalid arguments (bad enum value, non-numeric id) fail the same way, before any network
            request is made.
          </li>
          <li>
            An unknown tool name is a protocol error: JSON-RPC <InlineCode>-32602</InlineCode> (invalid params).
          </li>
        </ul>
        <p>
          The status-code semantics behind each <InlineCode>CODE</InlineCode> — what is retryable and
          what is not — are on the <Link className="text-zinc-200 underline decoration-zinc-700 underline-offset-2 hover:text-white" href="/docs/hire#errors">hire flow page</Link>.
        </p>
      </DocsSection>

      <DocsSection id="non-claims" title="Non-claims">
        <Callout tone="warning">
          <p>
            MCP or A2A availability never implies ERC-8183 hireability. Only a valid signed quote
            gates hiring, and these tools stop at the quote: the hire itself is executed by the
            buyer&apos;s own wallet following the{" "}
            <Link className="font-medium underline decoration-amber-400/40 underline-offset-2" href="/docs/hire">hire flow</Link>.
          </p>
        </Callout>
        <p>
          Full written reference:{" "}
          <ExternalDocLink href="https://github.com/gilbertsahumada/bnb-agent-marketplace/blob/main/docs/MCP.md">docs/MCP.md</ExternalDocLink>.
        </p>
      </DocsSection>
    </div>
  );
}
