import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMarketplaceMcpRequest, marketplaceMcpTools } from "../src/marketplace-mcp.ts";
import { GET as mcpRouteGet, POST as mcpRoutePost } from "../app/api/mcp/route.ts";

const ORIGIN = "https://marketplace.example";
const BUYER = "0x5ee7A8a4C0aB3b8b7d5C1f2E3a4b5C6d7E8f9a10";
const PROVIDER = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5";

function jsonFetch(payload: unknown, init?: { status?: number }) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, requestInit?: RequestInit) => {
    requests.push({ url: String(input), init: requestInit });
    return Response.json(payload, { status: init?.status ?? 200 });
  });
  return { requests, fetch: fetchMock as unknown as typeof globalThis.fetch };
}

function tool(name: string, fetchImplementation: typeof globalThis.fetch) {
  const found = marketplaceMcpTools({ origin: ORIGIN, fetch: fetchImplementation })
    .find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("marketplace mcp server", () => {
  it("stays a thin wrapper with no business or chain dependencies", () => {
    const source = readFileSync("src/marketplace-mcp.ts", "utf8");
    expect(source).not.toMatch(/src\/(?:data|trust8004|readiness|verification|business)|@bnbagent\/sdk|\bviem\b/);
  });

  it("exposes the seven journey tools with honest descriptions", () => {
    const tools = marketplaceMcpTools({ origin: ORIGIN });
    expect(tools.map((entry) => entry.name)).toEqual([
      "search_agents",
      "get_passport",
      "compare_agents",
      "request_quote",
      "get_job_status",
      "list_jobs",
      "my_jobs",
    ]);
    const search = tools.find((entry) => entry.name === "search_agents")!;
    expect(search.description).toMatch(/never implies ERC-8183 hireability/);
    const quote = tools.find((entry) => entry.name === "request_quote")!;
    expect(quote.description).toMatch(/envelope/);
    expect(quote.description).toMatch(/free and signs nothing/);
    const listJobs = tools.find((entry) => entry.name === "list_jobs")!;
    expect(listJobs.description).toMatch(/not a track record/);
    expect(listJobs.description).toMatch(/proves the phase, not the deliverable/);
    expect(listJobs.description).toMatch(/chain-verified hire event/);
    expect(listJobs.inputSchema).toMatchObject({ required: ["network"] });
    const myJobs = tools.find((entry) => entry.name === "my_jobs")!;
    expect(myJobs.description).toMatch(/no session/);
    expect(myJobs.description).toMatch(/not a track record/);
    expect(myJobs.inputSchema).toMatchObject({ required: ["network", "buyer"] });
  });

  it("builds the documented catalogue URL with filters", async () => {
    const { requests, fetch } = jsonFetch({ items: [] });
    const result = await tool("search_agents", fetch).handler({
      q: "grid",
      category: "grid_trading",
      availability: "hireable",
      page: 2,
      limit: 12,
    });
    expect(result.isError).toBeUndefined();
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/api/marketplace/agents");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: "marketplace",
      q: "grid",
      category: "grid_trading",
      availability: "hireable",
      page: "2",
      limit: "12",
    });
    expect(requests[0]!.init).toMatchObject({ method: "GET", headers: { accept: "application/json" } });
  });

  it("rejects unknown filter values before any request", async () => {
    const { requests, fetch } = jsonFetch({});
    await expect(tool("search_agents", fetch).handler({ availability: "sometimes" }))
      .rejects.toThrow("availability must be one of");
    expect(requests).toHaveLength(0);
  });

  it("routes passport, compare and job tools to the documented paths", async () => {
    const { requests, fetch } = jsonFetch({ ok: true });
    await tool("get_passport", fetch).handler({ agentId: "303779" });
    await tool("compare_agents", fetch).handler({ agentIds: ["1", "2", "3"] });
    await tool("get_job_status", fetch).handler({ network: "testnet", jobId: "551" });
    expect(requests.map((entry) => entry.url)).toEqual([
      `${ORIGIN}/api/marketplace/agents/303779/passport`,
      `${ORIGIN}/api/marketplace/compare?agentId=1&agentId=2&agentId=3`,
      `${ORIGIN}/api/marketplace/jobs/testnet/551`,
    ]);
  });

  it("posts the quote request to the selected network", async () => {
    const { requests, fetch } = jsonFetch({ priceRaw: "1" });
    await tool("request_quote", fetch).handler({ network: "mainnet" });
    expect(requests[0]!.url).toBe(`${ORIGIN}/api/marketplace/demo/erc8183-mainnet/quote`);
    expect(requests[0]!.init).toMatchObject({ method: "POST" });
  });

  it("routes the ledger tools to /api/marketplace/jobs with chainId and one identity filter", async () => {
    const { requests, fetch } = jsonFetch({ chainId: 56, jobs: [], nextBefore: null });
    await tool("list_jobs", fetch).handler({ network: "mainnet", provider: PROVIDER });
    await tool("list_jobs", fetch).handler({ network: "testnet", agentId: "1866", before: "874" });
    await tool("list_jobs", fetch).handler({ network: "mainnet" });
    await tool("my_jobs", fetch).handler({ network: "testnet", buyer: BUYER, before: "551" });
    expect(requests.map((entry) => entry.url)).toEqual([
      `${ORIGIN}/api/marketplace/jobs?chainId=56&provider=${PROVIDER}`,
      `${ORIGIN}/api/marketplace/jobs?chainId=97&agentId=1866&before=874`,
      `${ORIGIN}/api/marketplace/jobs?chainId=56`,
      `${ORIGIN}/api/marketplace/jobs?chainId=97&buyer=${BUYER}&before=551`,
    ]);
    for (const entry of requests) {
      expect(entry.init).toMatchObject({ method: "GET", headers: { accept: "application/json" } });
    }
  });

  it("rejects ambiguous or malformed ledger filters before any request", async () => {
    const { requests, fetch } = jsonFetch({});
    const listJobs = tool("list_jobs", fetch);
    await expect(listJobs.handler({ network: "mainnet", buyer: BUYER, provider: PROVIDER }))
      .rejects.toThrow("at most one of buyer, provider or agentId");
    await expect(listJobs.handler({ network: "mainnet", buyer: BUYER, agentId: "1" }))
      .rejects.toThrow("at most one of buyer, provider or agentId");
    await expect(listJobs.handler({ network: "mainnet", buyer: "0x1234" }))
      .rejects.toThrow("buyer must be an EVM address");
    await expect(listJobs.handler({ network: "mainnet", provider: "not-an-address" }))
      .rejects.toThrow("provider must be an EVM address");
    await expect(listJobs.handler({ network: "mainnet", agentId: "abc" }))
      .rejects.toThrow("agentId must be a numeric agent id");
    await expect(listJobs.handler({ network: "mainnet", before: "0" }))
      .rejects.toThrow("before must be a positive decimal job id");
    await expect(listJobs.handler({ buyer: BUYER }))
      .rejects.toThrow("network must be one of");
    const myJobs = tool("my_jobs", fetch);
    await expect(myJobs.handler({ network: "testnet" }))
      .rejects.toThrow("buyer must be a non-empty string");
    await expect(myJobs.handler({ network: "testnet", buyer: "0xnope" }))
      .rejects.toThrow("buyer must be an EVM address");
    expect(requests).toHaveLength(0);
  });

  it("surfaces API error codes as tool errors instead of throwing", async () => {
    const { fetch } = jsonFetch(
      { error: { code: "ERC8183_SPIKE_DISABLED", message: "The experimental Testnet flow is disabled." } },
      { status: 404 },
    );
    const result = await tool("request_quote", fetch).handler({ network: "testnet" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("ERC8183_SPIKE_DISABLED: The experimental Testnet flow is disabled.");
  });

  it("rejects malformed ids and unsafe origins", async () => {
    const { fetch } = jsonFetch({});
    await expect(tool("get_passport", fetch).handler({ agentId: "not-a-number" }))
      .rejects.toThrow("numeric");
    await expect(tool("get_job_status", fetch).handler({ network: "testnet", jobId: "0" }))
      .rejects.toThrow("positive");
    expect(() => marketplaceMcpTools({ origin: "http://evil.example" })).toThrow("HTTPS");
  });
});

function rpcRequest(body: unknown): Request {
  return new Request("https://marketplace.example/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

describe("remote streamable http endpoint", () => {
  it("answers initialize statelessly through the route", async () => {
    const response = await mcpRoutePost(rpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0.0.1" } },
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.serverInfo.name).toBe("bnb-agent-marketplace");
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  it("lists the seven tools without a prior session", async () => {
    const { fetch } = jsonFetch({});
    const response = await handleMarketplaceMcpRequest(
      rpcRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      { origin: ORIGIN, fetch },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.tools.map((entry: { name: string }) => entry.name)).toEqual([
      "search_agents",
      "get_passport",
      "compare_agents",
      "request_quote",
      "get_job_status",
      "list_jobs",
      "my_jobs",
    ]);
  });

  it("executes a tool call end to end over http", async () => {
    const { requests, fetch } = jsonFetch({ items: [], pagination: { total: 0 } });
    const response = await handleMarketplaceMcpRequest(
      rpcRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "search_agents", arguments: { availability: "hireable" } },
      }),
      { origin: ORIGIN, fetch },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.isError).toBeUndefined();
    expect(payload.result.content[0].type).toBe("text");
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(url.origin).toBe(ORIGIN);
    expect(url.searchParams.get("availability")).toBe("hireable");
  });

  it("rejects non-POST methods as stateless", async () => {
    const response = await mcpRouteGet();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("serves a real MCP client speaking streamable http end to end", async () => {
    const { requests, fetch } = jsonFetch({ items: [], pagination: { total: 0 } });
    const transport = new StreamableHTTPClientTransport(new URL("https://marketplace.example/api/mcp"), {
      fetch: (url, init) => handleMarketplaceMcpRequest(new Request(url, init), { origin: ORIGIN, fetch }),
    });
    const client = new Client({ name: "e2e-suite", version: "0.0.1" });
    // The SDK's client transport type clashes with its own Transport interface
    // under exactOptionalPropertyTypes; the runtime shapes are identical.
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((entry) => entry.name)).toEqual([
        "search_agents",
        "get_passport",
        "compare_agents",
        "request_quote",
        "get_job_status",
        "list_jobs",
        "my_jobs",
      ]);
      const result = await client.callTool({ name: "search_agents", arguments: { availability: "hireable" } });
      expect(result.isError).toBeFalsy();
      const marketplaceCalls = requests.filter(({ url }) => url.includes("/api/marketplace/"));
      expect(marketplaceCalls).toHaveLength(1);
      expect(new URL(marketplaceCalls[0]!.url).searchParams.get("availability")).toBe("hireable");
    } finally {
      await client.close();
    }
  });
});
