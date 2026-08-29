import { describe, expect, it, vi } from "vitest";

import {
  CatalogBodyLimitError,
  CatalogRedirectError,
  CatalogTimeoutError,
  Trust8004CatalogClient,
} from "../src/trust8004/client.ts";

const payload = JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 });

describe("trust8004 catalog client", () => {
  it("requests BSC chain 56 with JSON accept header and HEADER ordering", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(payload));
    const client = new Trust8004CatalogClient({
      baseUrl: "https://trust8004.xyz/api/app/",
      timeoutMs: 1_000,
      maxResponseBytes: 16 * 1_024 * 1_024,
      fetch: fetchImpl,
    });

    await client.listHeader(25);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.pathname).toBe("/api/app/agents");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      chainId: "56",
      limit: "25",
      offset: "0",
      sortBy: "registered",
      sortOrder: "desc",
    });
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    expect(init?.redirect).toBe("manual");
  });

  it("exports ascending SWEEP pagination", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ items: [], total: 100, limit: 10, offset: 20 }),
    ));
    const client = new Trust8004CatalogClient({
      baseUrl: "https://trust8004.xyz/api/app",
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
      fetch: fetchImpl,
    });

    await client.listSweepPage(10, 20);

    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      chainId: "56",
      limit: "10",
      offset: "20",
      sortBy: "registered",
      sortOrder: "asc",
    });
  });

  it("loads the observed BSC detail route with the same bounded request policy", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      chainId: 56,
      agentId: "303779",
      name: "Grid Agent",
      registeredAt: 1_770_000_000_000,
      metadataUpdatedAt: 1_770_000_000_001,
      metadataReasonCode: "ok",
      services: [{ name: "A2A", endpoint: "https://grid.example.com/a2a" }],
      endpoints: [],
    })));
    const client = new Trust8004CatalogClient({
      baseUrl: "https://trust8004.xyz/api/app",
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
      fetch: fetchImpl,
    });

    const agent = await client.getAgent("303779");

    expect(agent).toMatchObject({
      chainId: 56,
      agentId: "303779",
      name: "Grid Agent",
      metadataUpdatedAt: 1_770_000_000_001,
    });
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).pathname)
      .toBe("/api/app/agents/56:303779");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks redirects without following them and never retries", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302,
      headers: { location: "https://other.example/agents" },
    }));
    const client = new Trust8004CatalogClient({
      baseUrl: "https://trust8004.xyz/api/app",
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
      fetch: fetchImpl,
    });

    await expect(client.listHeader(25)).rejects.toBeInstanceOf(CatalogRedirectError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects content-length and streamed bodies above the configured cap", async () => {
    const declared = new Trust8004CatalogClient({
      baseUrl: "https://trust8004.xyz/api/app",
      timeoutMs: 1_000,
      maxResponseBytes: 8,
      fetch: async () => new Response("{}", { headers: { "content-length": "9" } }),
    });
    await expect(declared.listHeader(1)).rejects.toBeInstanceOf(CatalogBodyLimitError);

    const streamed = new Trust8004CatalogClient({
      baseUrl: "https://trust8004.xyz/api/app",
      timeoutMs: 1_000,
      maxResponseBytes: 8,
      fetch: async () => new Response("123456789"),
    });
    await expect(streamed.listHeader(1)).rejects.toBeInstanceOf(CatalogBodyLimitError);
  });

  it("aborts at the configured timeout and makes one attempt", async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const client = new Trust8004CatalogClient({
      baseUrl: "https://trust8004.xyz/api/app",
      timeoutMs: 5,
      maxResponseBytes: 1_024,
      fetch: fetchImpl,
    });

    await expect(client.listHeader(1)).rejects.toBeInstanceOf(CatalogTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies the timeout to body streaming, not only response headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    })));
    const client = new Trust8004CatalogClient({
      baseUrl: "https://trust8004.xyz/api/app",
      timeoutMs: 5,
      maxResponseBytes: 1_024,
      fetch: fetchImpl,
    });

    await expect(client.listHeader(1)).rejects.toBeInstanceOf(CatalogTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
