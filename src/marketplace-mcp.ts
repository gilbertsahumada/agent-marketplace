import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_ORIGIN, normalizedOrigin } from "./marketplace-cli.ts";

const MAX_RESPONSE_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 40_000;
const AVAILABILITIES = ["all", "hireable", "mcp_only"] as const;
const CATEGORIES = ["rebalancing", "grid_trading", "yield_optimisation", "health_factor_monitoring"] as const;
const NETWORKS = ["testnet", "mainnet"] as const;

type ToolArguments = Record<string, unknown>;

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface MarketplaceMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: ToolArguments) => Promise<ToolResult>;
}

export interface MarketplaceMcpOptions {
  origin?: string;
  fetch?: typeof globalThis.fetch;
}

function requiredString(args: ToolArguments, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalEnum<T extends readonly string[]>(args: ToolArguments, name: string, values: T): T[number] | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${name} must be one of: ${values.join(", ")}`);
  }
  return value;
}

function agentIdString(value: string, name: string): string {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a numeric agent id`);
  return value;
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Marketplace response is too large");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Marketplace response is too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Marketplace API returned invalid JSON");
  }
}

function errorText(status: number, payload: unknown): string {
  const error = typeof payload === "object" && payload !== null
    ? (payload as { error?: { code?: unknown; message?: unknown } }).error
    : undefined;
  const code = typeof error?.code === "string" ? error.code.slice(0, 80) : `HTTP_${status}`;
  const message = typeof error?.message === "string" ? error.message.slice(0, 300) : "Marketplace request failed";
  return `${code}: ${message}`;
}

export function marketplaceMcpTools(options: MarketplaceMcpOptions = {}): MarketplaceMcpTool[] {
  const origin = normalizedOrigin(
    options.origin ?? process.env.MARKETPLACE_ORIGIN ?? DEFAULT_ORIGIN,
  );
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  async function call(path: string, init?: { method: "POST" }): Promise<ToolResult> {
    const response = await fetchImplementation(`${origin}${path}`, {
      method: init?.method ?? "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await readJson(response);
      } catch {
        payload = undefined;
      }
      return { content: [{ type: "text", text: errorText(response.status, payload) }], isError: true };
    }
    const payload = await readJson(response);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  return [
    {
      name: "search_agents",
      description: [
        "Search the marketplace catalogue of BSC agents by outcome category, free text and availability.",
        "MCP or A2A availability never implies ERC-8183 hireability; pass availability=hireable to list",
        "only agents the marketplace can actually hire (verified quote path). Every fact in the response",
        "carries its provenance (declared, observed, onchain or derived).",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Free-text search, max 120 characters" },
          category: { type: "string", enum: [...CATEGORIES] },
          availability: { type: "string", enum: [...AVAILABILITIES], description: "hireable = can be hired now; mcp_only = reachable via MCP but not hireable" },
          page: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 24 },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const params = new URLSearchParams({ view: "marketplace" });
        const q = args.q;
        if (q !== undefined) {
          if (typeof q !== "string") throw new Error("q must be a string");
          params.set("q", q);
        }
        const category = optionalEnum(args, "category", CATEGORIES);
        if (category) params.set("category", category);
        const availability = optionalEnum(args, "availability", AVAILABILITIES);
        if (availability) params.set("availability", availability);
        for (const name of ["page", "limit"] as const) {
          const value = args[name];
          if (value === undefined) continue;
          if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`${name} must be a positive integer`);
          }
          params.set(name, String(value));
        }
        return call(`/api/marketplace/agents?${params.toString()}`);
      },
    },
    {
      name: "get_passport",
      description: [
        "Read an agent's Evidence Passport: provenance-labeled identity, endpoint, quote and job checks",
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
      handler: async (args) => {
        const agentId = agentIdString(requiredString(args, "agentId"), "agentId");
        return call(`/api/marketplace/agents/${agentId}/passport`);
      },
    },
    {
      name: "compare_agents",
      description: [
        "Compare 2 or 3 agents' evidence side by side. The marketplace never declares a winner;",
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
      handler: async (args) => {
        const raw = args.agentIds;
        if (!Array.isArray(raw) || raw.length < 2 || raw.length > 3) {
          throw new Error("agentIds must be an array of 2 or 3 numeric agent ids");
        }
        const params = new URLSearchParams();
        for (const value of raw) {
          if (typeof value !== "string") throw new Error("agentIds must be an array of 2 or 3 numeric agent ids");
          params.append("agentId", agentIdString(value, "agentIds"));
        }
        return call(`/api/marketplace/compare?${params.toString()}`);
      },
    },
    {
      name: "request_quote",
      description: [
        "Request a fresh ERC-8183 quote from the network's admitted seller. The server validates the",
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
      handler: async (args) => {
        const network = optionalEnum(args, "network", NETWORKS);
        if (!network) throw new Error(`network must be one of: ${NETWORKS.join(", ")}`);
        const base = network === "mainnet" ? "/api/marketplace/demo/erc8183-mainnet" : "/api/marketplace/demo/erc8183";
        return call(`${base}/quote`, { method: "POST" });
      },
    },
    {
      name: "get_job_status",
      description: [
        "Track an ERC-8183 job by id. State (OPEN, FUNDED, SUBMITTED, COMPLETED, REJECTED, EXPIRED),",
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
      handler: async (args) => {
        const network = optionalEnum(args, "network", NETWORKS);
        if (!network) throw new Error(`network must be one of: ${NETWORKS.join(", ")}`);
        const jobId = requiredString(args, "jobId");
        if (!/^[1-9]\d*$/.test(jobId)) throw new Error("jobId must be a positive decimal integer");
        return call(`/api/marketplace/jobs/${network}/${jobId}`);
      },
    },
  ];
}

export function createMarketplaceMcpServer(options: MarketplaceMcpOptions = {}): Server {
  const tools = marketplaceMcpTools(options);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const server = new Server(
    { name: "bnb-agent-marketplace", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    }
    try {
      return await tool.handler(request.params.arguments ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool call failed";
      return { content: [{ type: "text", text: message }], isError: true };
    }
  });
  return server;
}
