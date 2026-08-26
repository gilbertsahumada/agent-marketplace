import { beforeEach, describe, expect, it, vi } from "vitest";
import { Erc8183DemoJobNotFoundError, Erc8183SpikeDisabledError } from "../src/business/errors/erc8183-spike-errors.ts";

const executeQuote = vi.fn();
const executePrepare = vi.fn();
const executeNotify = vi.fn();
const executeStatus = vi.fn();

vi.mock("@/src/business/composition", () => ({
  requestErc8183Quote: { execute: executeQuote },
  prepareErc8183Hire: { execute: executePrepare },
  notifyFundedJob: { execute: executeNotify },
  getErc8183TestnetJobTracking: { execute: executeStatus },
}));

const quoteRoute = await import("../app/api/marketplace/demo/erc8183/quote/route.ts");
const prepareRoute = await import("../app/api/marketplace/demo/erc8183/prepare/route.ts");
const notifyRoute = await import("../app/api/marketplace/demo/erc8183/notify/route.ts");
const statusRoute = await import("../app/api/marketplace/jobs/testnet/[jobId]/route.ts");

describe("Gate 6A thin controllers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes exactly one use case for each valid request", async () => {
    executeQuote.mockResolvedValue({ agentId: 1866 });
    executePrepare.mockResolvedValue({ maximumSignatures: 5 });
    executeNotify.mockResolvedValue({ acknowledged: true });
    executeStatus.mockResolvedValue({ liveStatus: "verified", job: { jobId: "900" }, snapshot: null });
    const buyer = "0x1111111111111111111111111111111111111111";
    expect((await quoteRoute.POST()).status).toBe(200);
    expect((await prepareRoute.POST(new Request("http://local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buyer, quote: {} }),
    }))).status).toBe(200);
    expect((await notifyRoute.POST(new Request("http://local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buyer, jobId: "900" }),
    }))).status).toBe(200);
    expect((await statusRoute.GET(new Request("http://local"), { params: Promise.resolve({ jobId: "900" }) })).status).toBe(200);
    expect(executeQuote).toHaveBeenCalledOnce();
    expect(executePrepare).toHaveBeenCalledOnce();
    expect(executeNotify).toHaveBeenCalledOnce();
    expect(executeStatus).toHaveBeenCalledOnce();
  });

  it("rejects invalid input before invoking business", async () => {
    const response = await notifyRoute.POST(new Request("http://local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buyer: "not-an-address", jobId: "0" }),
    }));
    expect(response.status).toBe(400);
    expect(executeNotify).not.toHaveBeenCalled();
  });

  it("never returns secrets from an unknown failure", async () => {
    executeQuote.mockRejectedValue(new Error("Authorization: Bearer secret private_key=0xdead /Users/alice/.env"));
    const response = await quoteRoute.POST();
    expect(response.status).toBe(500);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toMatch(/secret|private_key|Users|Bearer/i);
    expect(serialized).toContain("INTERNAL_ERROR");
  });

  it("returns a not-found response while the spike is disabled", async () => {
    executeQuote.mockRejectedValue(new Erc8183SpikeDisabledError());
    const response = await quoteRoute.POST();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "ERC8183_SPIKE_DISABLED" } });
  });

  it("does not expose jobs outside the fixed Testnet demo", async () => {
    executeStatus.mockRejectedValue(new Erc8183DemoJobNotFoundError());
    const response = await statusRoute.GET(new Request("http://local"), { params: Promise.resolve({ jobId: "900" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "ERC8183_DEMO_JOB_NOT_FOUND", message: "The Testnet demo job was not found." },
    });
  });
});
