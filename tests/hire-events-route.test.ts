import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_AGENT_BUYER } from "../src/business/entities/demo-agent-buyer.ts";

const recordHireEvent = vi.fn();

vi.mock("@/src/business/composition", () => ({ recordHireEvent }));

const route = await import("../app/api/marketplace/hire-events/route.ts");

function post(body: unknown, headers: Record<string, string> = {}) {
  return route.POST(new Request("http://local/api/marketplace/hire-events", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const funded = { agentId: "303779", chainId: 56, phase: "funded", jobId: "551", txHash: `0x${"ab".repeat(32)}` };

describe("same-origin hire event controller", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards only the sanitized contract and maps the persistence status", async () => {
    for (const [status, code] of [["recorded", 201], ["duplicate", 200], ["rejected", 409], ["failed", 202], ["not_configured", 202]] as const) {
      recordHireEvent.mockResolvedValueOnce({ status });
      const response = await post(funded, { "x-forwarded-for": "203.0.113.1", cookie: "session=abc" });
      expect(response.status).toBe(code);
      expect(await response.json()).toEqual({ persistence: status });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(recordHireEvent).toHaveBeenCalledTimes(5);
    expect(recordHireEvent).toHaveBeenLastCalledWith(funded);
    expect(recordHireEvent.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it("accepts telemetry without a job reference on either BSC network", async () => {
    recordHireEvent.mockResolvedValue({ status: "recorded" });
    const response = await post({ agentId: "1866", chainId: 97, phase: "clicked", jobId: null, txHash: null });
    expect(response.status).toBe(201);
    expect(recordHireEvent).toHaveBeenCalledWith({ agentId: "1866", chainId: 97, phase: "clicked", jobId: null, txHash: null });
  });

  it("rejects malformed events without forwarding them", async () => {
    const invalid = [
      { ...funded, phase: "settled" },
      { ...funded, txHash: "0x1234" },
      { ...funded, jobId: null },
      { ...funded, chainId: 1 },
      { ...funded, agentId: "abc" },
      { ...funded, buyer: DEMO_AGENT_BUYER.address },
      { agentId: "303779", chainId: 56, phase: "clicked", jobId: "551", txHash: null },
      "not json",
      [],
    ];
    for (const body of invalid) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const wrongType = await route.POST(new Request("http://local/api/marketplace/hire-events", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(funded),
    }));
    expect(wrongType.status).toBe(400);
    const tooLarge = await post({ ...funded, txHash: `0x${"a".repeat(2_000)}` });
    expect(tooLarge.status).toBe(413);
    expect(recordHireEvent).not.toHaveBeenCalled();
  });
});
