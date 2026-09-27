// Shared by runtime discovery and documentation; no handlers or network dependencies.
const AVAILABILITIES = ["all", "hireable", "mcp_only"] as const;
const CATEGORIES = ["rebalancing", "grid_trading", "yield_optimisation", "health_factor_monitoring"] as const;
const NETWORKS = ["testnet", "mainnet"] as const;
export interface McpToolMetadata { name: string; description: string; inputSchema: Record<string, unknown> }
export const MCP_TOOL_METADATA: McpToolMetadata[] = [
  {
      name: "search_agents",
      description: [
        "Search the default Mainnet catalogue by outcome category, free text and availability; this tool has no network argument.",
        "MCP or A2A availability never implies ERC-8183 hireability; pass availability=hireable to list",
        "agents with recent quote capability, not a buyer authorization to pay. Every fact in the response",
        "carries its provenance (declared, observed, onchain or derived).",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Free-text search, max 120 characters" },
          category: { type: "string", enum: [...CATEGORIES] },
          availability: { type: "string", enum: [...AVAILABILITIES], description: "hireable = recent quote capability; a fresh buyer quote is still required. mcp_only = reachable via MCP without hiring capability" },
          page: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 24 },
        },
        additionalProperties: false,
      },
  },
  {
      name: "get_passport",
      description: [
        "Read a Mainnet agent's Evidence Passport (no network argument): provenance-labeled identity, endpoint, quote and job checks",
        "plus its onchain track record. The passport is read-only evidence, not reputation or an",
        "endorsement. State 'hireable' means an executable quote path exists; a fresh quote is still",
        "validated before any signature.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: { agentId: { type: "string", description: "Numeric BSC agent id" } },
        required: ["agentId"],
        additionalProperties: false,
      },
  },
  {
      name: "compare_agents",
      description: [
        "Compare 2 or 3 Mainnet agents (no network argument). The marketplace never declares a winner;",
        "the comparison is provenance-labeled evidence only.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          agentIds: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3, description: "2-3 numeric agent ids" },
        },
        required: ["agentIds"],
        additionalProperties: false,
      },
  },
  {
      name: "request_quote",
      description: [
        "Request a fresh ERC-8183 quote from the fixed demo seller, not an arbitrary catalogue agent.",
        "Accepts network only: no agentId or custom buyer parameters. The server validates the",
        "quote against its allowlist (seller, contracts, token, budget ceiling, expiry) before returning",
        "it. Keep the returned 'envelope' byte-identical: the hire prepare step re-verifies the seller's",
        "signature over it. Requesting a quote is free and signs nothing. Returns 404",
        "ERC8183_SPIKE_DISABLED when the flow is disabled by environment.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: { network: { type: "string", enum: [...NETWORKS] } },
        required: ["network"],
        additionalProperties: false,
      },
  },
  {
      name: "get_job_status",
      description: [
        "Track an allowlisted fixed demo ERC-8183 job by id, not every indexed job.",
        "Testnet may return liveStatus=unavailable with job=null. Use list_jobs for indexed activity.",
        "State (OPEN, FUNDED, SUBMITTED, COMPLETED, REJECTED, EXPIRED),",
        "budget, deadline and deliverable hash are resolved from chain, not from marketplace claims.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          network: { type: "string", enum: [...NETWORKS] },
          jobId: { type: "string", description: "Positive decimal job id" },
        },
        required: ["network", "jobId"],
        additionalProperties: false,
      },
  },
  {
      name: "list_jobs",
      description: [
        "List ERC-8183 jobs indexed from the Commerce contract, newest first, optionally scoped to one",
        "buyer wallet, one provider wallet or one marketplace agent id. Each job carries its on-chain",
        "state (OPEN, FUNDED, SUBMITTED, COMPLETED, REJECTED, EXPIRED) and 'marketplace: true' when a",
        "chain-verified hire event exists for it — it does not mean the marketplace verified the",
        "deliverable. This is indexed activity, not a track record: a settled job proves the phase,",
        "not the deliverable. Page with 'before' = the nextBefore of the previous page.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          network: { type: "string", enum: [...NETWORKS] },
          buyer: { type: "string", description: "Buyer wallet (EVM address). At most one of buyer, provider, agentId." },
          provider: { type: "string", description: "Provider wallet (EVM address)" },
          agentId: { type: "string", description: "Marketplace agent id (numeric); only jobs with a chain-verified hire event for it" },
          before: { type: "string", description: "Positive decimal job id; returns older jobs" },
        },
        required: ["network"],
        additionalProperties: false,
      },
  },
  {
      name: "my_jobs",
      description: [
        "List the jobs created by the caller's own wallet, newest first, with their on-chain state.",
        "The marketplace has no session: pass the wallet address you sign with. Same ledger and",
        "shape as list_jobs — indexed activity, not a track record: a settled job proves the phase,",
        "not the deliverable.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          network: { type: "string", enum: [...NETWORKS] },
          buyer: { type: "string", description: "Your wallet (EVM address)" },
          before: { type: "string", description: "Positive decimal job id; returns older jobs" },
        },
        required: ["network", "buyer"],
        additionalProperties: false,
      },
  },
];

