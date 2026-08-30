import { describe, expect, it, vi } from "vitest";
import {
  computeCatalogSnapshotSha256,
  runCatalogSnapshot,
  type CatalogSnapshotCheckpoint,
} from "../src/trust8004/catalog-snapshot.ts";
import { parseCatalogSnapshotCliOptions } from "../src/trust8004/catalog-snapshot-cli.ts";
import { parseCatalogD1SeedOptions } from "../src/trust8004/catalog-d1-seed-cli.ts";

const items = [
  { chainId: 56, agentId: "1", metadataReasonCode: "ok", services: [] },
  {
    chainId: 56,
    agentId: "2",
    metadataReasonCode: "ok",
    services: [{ name: "A2A", endpoint: "https://seller.example/a2a" }],
  },
  {
    chainId: 56,
    agentId: "3",
    metadataReasonCode: "ok",
    mcpEndpoint: "https://mcp.example/rpc",
    services: [{ name: "ERC8183", endpoint: "https://seller.example/jobs" }],
  },
];

describe("catalog snapshot v2", () => {
  it("requires an explicit source artifact for a D1 seed", () => {
    expect(parseCatalogD1SeedOptions(["--input", "evidence/catalog.json"])).toEqual({
      input: expect.stringMatching(/evidence\/catalog\.json$/),
      output: expect.stringMatching(/evidence\/catalog\.json\.d1\.sql$/),
    });
    expect(() => parseCatalogD1SeedOptions([])).toThrow("--input is required");
  });
  it("uses an explicit resumable checkpoint beside the selected artifact", () => {
    const options = parseCatalogSnapshotCliOptions(
      ["--output", "evidence/catalog.json", "--resume"],
      "2026-08-30T00:00:00.000Z",
    );
    expect(options.output).toMatch(/evidence\/catalog\.json$/);
    expect(options.checkpoint).toBe(`${options.output}.checkpoint.json`);
    expect(options.resume).toBe(true);
  });

  it("materializes every registered identity and only dynamic safe candidates", async () => {
    const checkpoint = vi.fn();
    const snapshot = await runCatalogSnapshot({
      generatedAt: "2026-08-30T00:00:00.000Z",
      pageSize: 2,
      fetchPage: async (offset, limit) => ({
        items: items.slice(offset, offset + limit),
        total: items.length,
        offset,
        limit,
      }),
      onCheckpoint: checkpoint,
    });

    expect(snapshot.registeredAgentIds).toEqual(["1", "2", "3"]);
    expect(snapshot.candidates.map((entry) => entry.agentId)).toEqual(["2", "3"]);
    expect(snapshot.stats).toEqual({
      registered: 3,
      candidates: 2,
      declarations: 3,
      safeDeclarations: 3,
      unsafeDeclarations: 0,
      sharedOrigins: 1,
    });
    expect(snapshot.scan).toMatchObject({ complete: true, nextOffset: 3, pages: 2 });
    expect(snapshot.sourceSha256).toBe(computeCatalogSnapshotSha256(snapshot));
    expect(checkpoint).toHaveBeenCalledTimes(2);
  });

  it("resumes from a versioned checkpoint without refetching earlier pages", async () => {
    const resume: CatalogSnapshotCheckpoint = {
      schemaVersion: 2,
      generatedAt: "2026-08-30T00:00:00.000Z",
      chainId: 56,
      pageSize: 2,
      expectedTotal: 3,
      nextOffset: 2,
      pages: 1,
      registeredAgentIds: ["1", "2"],
      candidates: [],
    };
    const fetchPage = vi.fn(async (offset: number, limit: number) => ({
      items: items.slice(offset, offset + limit),
      total: items.length,
      offset,
      limit,
    }));

    const snapshot = await runCatalogSnapshot({ pageSize: 2, fetchPage, resume });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(2, 2);
    expect(snapshot.registeredAgentIds).toEqual(["1", "2", "3"]);
  });

  it("accepts append-only total growth while rejecting offset drift, total regression and duplicate identities", async () => {
    await expect(runCatalogSnapshot({
      pageSize: 2,
      fetchPage: async () => ({ items: [], total: 0, offset: 1, limit: 2 }),
    })).rejects.toThrow("CATALOG_PAGE_OFFSET_MISMATCH");

    const growingItems = [...items, { chainId: 56, agentId: "4", metadataReasonCode: "ok", services: [] }];
    const growing = await runCatalogSnapshot({
      pageSize: 2,
      fetchPage: async (offset) => ({
        items: growingItems.slice(offset, offset + 2),
        total: offset === 0 ? 3 : 4,
        offset,
        limit: 2,
      }),
    });
    expect(growing.stats.registered).toBe(4);

    await expect(runCatalogSnapshot({
      pageSize: 2,
      fetchPage: async (offset) => ({
        items: offset === 0 ? items.slice(0, 2) : [],
        total: offset === 0 ? 3 : 2,
        offset,
        limit: 2,
      }),
    })).rejects.toThrow("CATALOG_TOTAL_REGRESSION");

    await expect(runCatalogSnapshot({
      pageSize: 2,
      fetchPage: async () => ({ items: [items[0]!, items[0]!], total: 2, offset: 0, limit: 2 }),
    })).rejects.toThrow("CATALOG_DUPLICATE_AGENT_ID:1");
  });
});
