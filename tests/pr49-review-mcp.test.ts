import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { createMarketplaceMcpServer, marketplaceMcpTools } from "../src/marketplace-mcp.ts";

const ORIGIN = "https://marketplace.example";

function recordingFetch(response: () => Response) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, requestInit?: RequestInit) => {
    requests.push({ url: String(input), init: requestInit });
    return response();
  });
  return { requests, fetch: fetchMock as unknown as typeof globalThis.fetch };
}

// PR49 review F1 (defect): package.json "bin" points at dist/marketplace-*-bin.js, but
// `tsc -p tsconfig.build.json` infers rootDir as the repo root (the program includes
// evidence/*.json via the JSON import in src/data/observation/funnel-evidence-repository.ts),
// so the entry points are actually emitted at dist/src/marketplace-*-bin.js.
// Verified empirically by compiling with tsconfig.build.json to a scratch outDir.
describe("F1: package.json bin paths match the tsc build output layout", () => {
  it("each bin entry points at a file the build emits (dist/src/<name>.js)", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      bin: Record<string, string>;
    };
    const buildConfig = JSON.parse(readFileSync("tsconfig.build.json", "utf8")) as {
      compilerOptions: { outDir: string; rootDir?: string };
    };
    expect(buildConfig.compilerOptions.outDir).toBe("dist");
    // No explicit rootDir, and the program spans src/ and evidence/ (JSON import), so
    // the inferred rootDir is the repo root and src files land under dist/src/.
    expect(buildConfig.compilerOptions.rootDir).toBeUndefined();

    const binEntries = Object.entries(packageJson.bin);
    expect(binEntries.length).toBeGreaterThan(0);
    for (const [name, binPath] of binEntries) {
      // The emitted layout mirrors the source tree from the repo root.
      expect(binPath, `bin "${name}" must point inside the emitted layout`).toMatch(/^dist\/src\//);
      const source = binPath.replace(/^dist\//, "").replace(/\.js$/, ".ts");
      expect(existsSync(source), `bin "${name}" (${binPath}) must map back to ${source}`).toBe(true);
    }
  });
});

// PR49 review F2 (defect): readJson runs before the response.ok check, so a non-JSON
// 5xx body (e.g. an HTML gateway page) throws "Marketplace API returned invalid JSON"
// instead of resolving to an isError result carrying HTTP_504.
describe("F2: non-JSON error bodies still surface the HTTP status as an isError result", () => {
  it("resolves a 504 HTML gateway page to an isError result containing HTTP_504", async () => {
    const { fetch } = recordingFetch(() => new Response("<html>gateway</html>", { status: 504 }));
    const search = marketplaceMcpTools({ origin: ORIGIN, fetch })
      .find((tool) => tool.name === "search_agents")!;
    const result = await search.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("HTTP_504");
  });
});

// F5/F6 server-level harness: real Server wired over an in-memory transport pair.
describe("createMarketplaceMcpServer over an in-memory transport", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  async function connect(options: Parameters<typeof createMarketplaceMcpServer>[0] = {}) {
    const server = createMarketplaceMcpServer({ origin: ORIGIN, ...options });
    const client = new Client({ name: "test", version: "0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  // PR49 review F6a (coverage gap): server wiring for tools/list was untested.
  it("F6a: tools/list returns exactly the seven journey tools with object input schemas", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_agents",
      "get_passport",
      "compare_agents",
      "request_quote",
      "get_job_status",
      "list_jobs",
      "my_jobs",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.type, `${tool.name} inputSchema`).toBe("object");
    }
  });

  // PR49 review F6b (coverage gap): a handler that throws must come back as an
  // isError tool result, not crash the transport.
  it("F6b: a tools/call with invalid arguments resolves as an isError tool result", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "get_passport",
      arguments: { agentId: "notanumber" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain("agentId must be a numeric agent id");
  });

  // PR49 review F6c (coverage gap): the DI fetch passed through
  // createMarketplaceMcpServer options must drive real tool calls end to end.
  it("F6c: tools/call search_agents hits the documented URL and returns the JSON payload", async () => {
    const payload = { items: [{ agentId: "1" }] };
    const { requests, fetch } = recordingFetch(() => Response.json(payload));
    const client = await connect({ fetch });
    const result = await client.callTool({ name: "search_agents", arguments: { q: "grid" } });
    expect(result.isError).toBeUndefined();
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/api/marketplace/agents");
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: "marketplace", q: "grid" });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0]!.text)).toEqual(payload);
  });

  // PR49 review F5 (spec deviation): the MCP spec expects a protocol error
  // (McpError, e.g. InvalidParams/MethodNotFound) for an unknown tool, not an
  // isError tool result. Today the server resolves with isError instead.
  it("F5: calling an unknown tool rejects with a protocol-level McpError", async () => {
    const client = await connect();
    await expect(
      client.callTool({ name: "no_such_tool", arguments: {} }),
    ).rejects.toBeInstanceOf(McpError);
  });
});
