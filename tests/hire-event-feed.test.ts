import { afterEach, describe, expect, it, vi } from "vitest";
import { getVerifiedHireEvents, parseVerifiedHireEvents } from "../src/data/observation/hire-event-feed.ts";

const ENV = { OBSERVATIONS_URL: "https://probe.example.workers.dev/observations" };
const TX = `0x${"ab".repeat(32)}`;

function feed(overrides: Record<string, unknown> = {}, event: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    chainId: 56,
    agentId: "303779",
    events: [{
      phase: "funded", jobId: "56662", txHash: TX, blockNumber: "118077300",
      occurredAt: 1_788_000_000_000, verifiedAt: null, ...event,
    }],
    ...overrides,
  };
}

describe("verified hire event feed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses only the allowlisted fields and converts timestamps to ISO", () => {
    expect(parseVerifiedHireEvents(feed({}, { extra: "dropped" }), { chainId: 56, agentId: "303779" })).toEqual([{
      chainId: 56, agentId: "303779", phase: "funded", jobId: "56662", txHash: TX,
      blockNumber: "118077300", occurredAt: new Date(1_788_000_000_000).toISOString(), verifiedAt: null,
    }]);
  });

  it.each<[string, unknown]>([
    ["schema", feed({ schemaVersion: 2 })],
    ["chain", feed({ chainId: 97 })],
    ["agent", feed({ agentId: "1" })],
    ["phase", feed({}, { phase: "clicked" })],
    ["tx hash", feed({}, { txHash: "0x12" })],
    ["job id", feed({}, { jobId: "-1" })],
    ["timestamp", feed({}, { occurredAt: "yesterday" })],
    ["events", feed({ events: null })],
  ])("rejects a malformed %s instead of returning a partial history", (_label, value) => {
    expect(() => parseVerifiedHireEvents(value, { chainId: 56, agentId: "303779" })).toThrow("HIRE_EVENT_FEED_INVALID");
  });

  it("reads the Worker route for one agent on one chain", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return Response.json(feed());
    }));
    const events = await getVerifiedHireEvents({ chainId: 56, agentId: "303779", env: ENV });
    expect(events).toHaveLength(1);
    expect(requested[0]).toBe(
      "https://probe.example.workers.dev/hire-events?chainId=56&agentId=303779",
    );
  });

  it.each<[string, () => Promise<Response>, Record<string, string | undefined>]>([
    ["missing origin", async () => Response.json(feed()), {}],
    ["non-https origin", async () => Response.json(feed()), { OBSERVATIONS_URL: "http://probe.example/observations" }],
    ["upstream failure", async () => new Response(null, { status: 503 }), ENV],
    ["malformed payload", async () => Response.json({ schemaVersion: 1 }), ENV],
    ["transport error", async () => { throw new Error("offline"); }, ENV],
  ])("fails closed to null on %s", async (_label, response, env) => {
    vi.stubGlobal("fetch", vi.fn(response));
    await expect(getVerifiedHireEvents({ chainId: 97, agentId: "1866", env })).resolves.toBeNull();
  });

  it("rejects an invalid agent id before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getVerifiedHireEvents({ chainId: 56, agentId: "0x1", env: ENV })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
