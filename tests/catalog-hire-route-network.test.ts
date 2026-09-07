import { afterEach, expect, it, vi } from "vitest";
import { Erc8183SpikeUnavailableError } from "../src/business/errors/erc8183-spike-errors";
import { POST as prepare } from "../app/api/marketplace/agents/[agentId]/hire/prepare/route";
import { POST as notify } from "../app/api/marketplace/agents/[agentId]/hire/notify/route";
import { GET as job } from "../app/api/marketplace/agents/[agentId]/hire/jobs/[jobId]/route";

vi.mock("../src/mainnet/catalog-hire", async importOriginal => ({
  ...await importOriginal<typeof import("../src/mainnet/catalog-hire")>(),
  resolveCatalogHireTarget: vi.fn(async () => { throw new Erc8183SpikeUnavailableError(); }),
}));
afterEach(() => vi.unstubAllEnvs());

it.each([56, 97])("labels disabled prepare responses with network %s", async chain => {
  vi.stubEnv("ERC8183_TESTNET_HIRE_ENABLED", "false");
  vi.stubEnv("ERC8183_MAINNET_WRITES_ENABLED", "false");
  const response = await prepare(new Request(`https://example.test/prepare?chainId=${chain}`, { method: "POST" }), { params: Promise.resolve({ agentId: "2197" }) });
  expect(response.status).toBe(404);
  expect((await response.json()).error.message).toContain(chain === 97 ? "Testnet" : "Mainnet");
});

it.each([56, 97])("labels notify and job failures with network %s", async chain => {
  const response = await notify(new Request(`https://example.test/notify?chainId=${chain}`, { method: "POST", body: JSON.stringify({ quoteRequestId: 727 }) }), { params: Promise.resolve({ agentId: "2197" }) });
  const status = await job(new Request(`https://example.test/jobs/1?chainId=${chain}&quoteRequestId=727`), { params: Promise.resolve({ agentId: "2197", jobId: "1" }) });
  for (const result of [response, status]) {
    expect(result.status).toBe(503);
    expect((await result.json()).error.message).toContain(chain === 97 ? "Testnet" : "Mainnet");
  }
});
