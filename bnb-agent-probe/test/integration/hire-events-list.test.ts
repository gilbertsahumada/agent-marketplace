import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createWorker } from "../../src/index";
import type { Env } from "../../src/types";

const NOW = 1_788_000_000_000;
const TX = (seed: string) => `0x${seed.repeat(32)}`;

async function seed(rows: Array<{
  agentId: string; chainId: 56 | 97; phase: string; provenance: "chain_verified" | "marketplace_observed";
  jobId: string | null; txHash: string | null; occurredAt: number;
}>): Promise<void> {
  for (const row of rows) {
    await env.DB.prepare(
      `INSERT INTO hire_events (eventKey, agentId, chainId, phase, provenance, jobId, txHash, blockNumber, occurredAt, verifiedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.txHash === null ? crypto.randomUUID() : `${row.chainId}:${row.txHash}:${row.phase}`,
      row.agentId, row.chainId, row.phase, row.provenance, row.jobId, row.txHash,
      row.txHash === null ? null : "4242", row.occurredAt, row.txHash === null ? null : NOW,
    ).run();
  }
}

function get(query: string, overrides: Partial<Env> = {}) {
  return createWorker({ now: () => NOW }).fetch(
    new Request(`https://worker.test/hire-events${query}`),
    { ...env, ...overrides } as unknown as Env,
    createExecutionContext(),
  );
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM hire_events").run();
});

// The first test of a file pays the isolated-storage migration cost; under the
// full suite's parallel Workerd runs that exceeded the 10 s default twice.
describe("GET /hire-events", { timeout: 30_000 }, () => {
  it("lists only chain-verified phases of one agent on one chain, newest first", async () => {
    await seed([
      { agentId: "1866", chainId: 97, phase: "created", provenance: "chain_verified", jobId: "551", txHash: TX("aa"), occurredAt: NOW - 2_000 },
      { agentId: "1866", chainId: 97, phase: "funded", provenance: "chain_verified", jobId: "551", txHash: TX("bb"), occurredAt: NOW - 1_000 },
      { agentId: "1866", chainId: 97, phase: "clicked", provenance: "marketplace_observed", jobId: null, txHash: null, occurredAt: NOW },
      { agentId: "1866", chainId: 56, phase: "funded", provenance: "chain_verified", jobId: "9", txHash: TX("cc"), occurredAt: NOW },
      { agentId: "303779", chainId: 97, phase: "funded", provenance: "chain_verified", jobId: "8", txHash: TX("dd"), occurredAt: NOW },
    ]);
    const response = await get("?chainId=97&agentId=1866");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=60");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      chainId: 97,
      agentId: "1866",
      events: [
        { phase: "funded", jobId: "551", quoteRequestId: null, txHash: TX("bb"), blockNumber: "4242", occurredAt: NOW - 1_000, verifiedAt: NOW },
        { phase: "created", jobId: "551", quoteRequestId: null, txHash: TX("aa"), blockNumber: "4242", occurredAt: NOW - 2_000, verifiedAt: NOW },
      ],
    });
  });

  it("answers an empty list for an agent without verified history", async () => {
    const response = await get("?chainId=56&agentId=303779");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: 1, chainId: 56, agentId: "303779", events: [] });
  });

  it.each([
    "",
    "?chainId=56",
    "?agentId=1866",
    "?chainId=1&agentId=1866",
    "?chainId=97&agentId=0",
    "?chainId=97&agentId=1866&limit=5",
  ])("rejects the query %s", async (query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("serves repeated reads from the Workers Cache with the short window when caching is on", async () => {
    await seed([
      { agentId: "1866", chainId: 97, phase: "funded", provenance: "chain_verified", jobId: "551", txHash: TX("ee"), occurredAt: NOW },
    ]);
    const query = `?chainId=97&agentId=1866`;
    const warm = await get(query, { CATALOG_RESPONSE_CACHE_SECONDS: "300" });
    expect(warm.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=30");
    await env.DB.prepare("DELETE FROM hire_events").run();
    const hit = await get(query, { CATALOG_RESPONSE_CACHE_SECONDS: "300" });
    expect((await hit.json() as { events: unknown[] }).events).toHaveLength(1);
  });
});
