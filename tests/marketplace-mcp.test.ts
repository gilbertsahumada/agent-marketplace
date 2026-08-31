import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { marketplaceMcpTools } from "../src/marketplace-mcp.ts";

const ORIGIN = "https://marketplace.example";

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

  it("exposes the five journey tools with honest descriptions", () => {
    const tools = marketplaceMcpTools({ origin: ORIGIN });
    expect(tools.map((entry) => entry.name)).toEqual([
      "search_agents",
      "get_passport",
      "compare_agents",
      "request_quote",
      "get_job_status",
    ]);
    const search = tools.find((entry) => entry.name === "search_agents")!;
    expect(search.description).toMatch(/never implies ERC-8183 hireability/);
    const quote = tools.find((entry) => entry.name === "request_quote")!;
    expect(quote.description).toMatch(/envelope/);
    expect(quote.description).toMatch(/free and signs nothing/);
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
