import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { Trust8004CatalogClient } from "../../src/trust8004/client";
import { enqueueCatalogDiscoveryPage, processNextCatalogIngestTask } from "../../src/phases/catalog-ingest";
import { catalogNegotiationInputResponse, createCatalogQuoteRequestResponse, catalogQuoteBrowserResultResponse, catalogQuoteHistoryResponse } from "../../src/routes/catalog-quotes";
import { probeA2aSeller } from "../../src/lib/seller-client";
import { loadConfig } from "../../src/config";
import type { Env } from "../../src/types";
import type { D1DatabaseLike } from "../../src/db/client";

it("persists and returns a real external Testnet quote without creating a job", async () => {
  const db = env.DB as unknown as D1DatabaseLike;
  const catalog = new Trust8004CatalogClient({ chainId: 97, baseUrl: "https://trust8004.xyz/api/app", timeoutMs: 10000, maxResponseBytes: 1000000 });
  const agent = await catalog.getAgent("2197");
  await enqueueCatalogDiscoveryPage(db, [agent], { nowMs: Date.now(), source: "header", chainId: 97 });
  for (let n = 0; n < 5; n++) {
    const result = await processNextCatalogIngestTask(db, { nowMs: Date.now(), maxDeclarations: 8, fetchAgent: (id, chain) => {
      expect(chain).toBe(97); return catalog.getAgent(id);
    } });
    if (result.status === "idle") break;
  }
  const input = await catalogNegotiationInputResponse(env.DB, "2197", { chainId: 97, nowMs: Date.now() });
  const discovered = await input.json() as { endpointKey: string; contractHash: string };
  expect(input.status, JSON.stringify(discovered)).toBe(200);
  const start = await createCatalogQuoteRequestResponse(new Request("https://local/catalog-quotes/2197?chainId=97", {
    method: "POST", body: JSON.stringify({ schemaVersion: 2, ...discovered, parameters: {
      task_description: "Quote for a read-only monitoring checklist on Testnet. No transactions or fund management.",
      terms: { deliverables: "A short monitoring checklist", quality_standards: "Explain inputs and alerts; no transaction execution" },
    }, contract: undefined, transport: undefined }),
  }), env.DB, { nowMs: Date.now() });
  const registered = await start.json() as { attemptId: string; requestId: number; target: string; request: Record<string, unknown> };
  expect(start.status, JSON.stringify(registered)).toBe(201);
  const seller = await probeA2aSeller({ endpoint: registered.target, request: registered.request, fetch, timeoutMs: 20000, maxResponseBytes: 65536, requireNotifyFunded: false });
  const result = await catalogQuoteBrowserResultResponse(new Request("https://local/result?chainId=97", {
    method: "POST", body: JSON.stringify({ schemaVersion: 1, envelope: seller.quote }),
  }), env.DB, registered.attemptId, {
    nowMs: Date.now(), expectedAgentId: "2197", config: loadConfig({}),
    env: { ...env, BSC_TESTNET_RPC_URL: "https://data-seed-prebsc-2-s2.binance.org:8545" } as unknown as Env,
  });
  const verified = await result.json() as { status: string; quote: { chainId: number }; requestId: number };
  expect(result.status, JSON.stringify(verified)).toBe(201);
  expect(verified).toMatchObject({ status: "succeeded", quote: { chainId: 97 } });
  const history = await catalogQuoteHistoryResponse(new Request("https://local/history?chainId=97"), env.DB, "2197");
  expect(await history.json()).toMatchObject({ counts: { buyerRequests: 1, buyerSucceeded: 1 } });
  const mainnet = await catalogQuoteHistoryResponse(new Request("https://local/history?chainId=56"), env.DB, "2197");
  expect(await mainnet.json()).toMatchObject({ counts: { buyerRequests: 0 } });
  console.log(JSON.stringify({ stage: "external_testnet_quote_persisted", agentId: "2197", requestId: verified.requestId, chainId: 97, transactionsSent: 0 }));
});
