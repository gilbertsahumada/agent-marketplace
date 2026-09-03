import { describe, expect, it } from "vitest";
import { buildSmokePlan, evaluate, normalizeOrigin, parseArguments, runSmoke } from "../scripts/smoke";

const WORKER = "https://bnb-agent-probe-staging.example.workers.dev";
const MARKETPLACE = "https://marketplace.example";

const HEALTHY = {
  "/health": { status: "ok", plan: "paid", schedulerMode: "single_phase", killSwitch: true, producerKillSwitch: true },
  "/catalog-agents?limit=1": { items: [] },
  "/hire-events?chainId=56&agentId=303779": { schemaVersion: 1, chainId: 56, agentId: "303779", events: [] },
  "/api/marketplace/agents?limit=1": { items: [] },
  "/api/marketplace/agents/303779/passport": { schemaVersion: 1, checks: { hireActivity: { status: "missing" } } },
  "/api/marketplace/jobs/testnet/551": { liveStatus: "unavailable" },
} as const;

function fakeFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = `${url.pathname}${url.search}`;
    const override = overrides[key];
    if (override) return override();
    const body = HEALTHY[key as keyof typeof HEALTHY];
    return body ? Response.json(body) : new Response(null, { status: 404 });
  }) as typeof fetch;
}

describe("release smoke", () => {
  it("plans read-only GETs against both origins in journey order", () => {
    const plan = buildSmokePlan(WORKER, MARKETPLACE);
    expect(plan.map(({ url }) => url)).toEqual([
      `${WORKER}/health`,
      `${WORKER}/catalog-agents?limit=1`,
      `${WORKER}/hire-events?chainId=56&agentId=303779`,
      `${MARKETPLACE}/api/marketplace/agents?limit=1`,
      `${MARKETPLACE}/api/marketplace/agents/303779/passport`,
      `${MARKETPLACE}/api/marketplace/jobs/testnet/551`,
    ]);
  });

  it("accepts only clean https origins (loopback http for local runs)", () => {
    expect(normalizeOrigin("https://worker.example/", "worker origin")).toBe("https://worker.example");
    expect(normalizeOrigin("http://localhost:3000", "marketplace origin")).toBe("http://localhost:3000");
    for (const bad of ["worker.example", "http://worker.example", "https://worker.example/health", "https://u:p@worker.example", "https://worker.example/?x=1"]) {
      expect(() => normalizeOrigin(bad, "worker origin"), bad).toThrow(/origin/);
    }
  });

  it("passes a healthy pair and reports every target on its own line", async () => {
    const results = await runSmoke(buildSmokePlan(WORKER, MARKETPLACE, { expectKillSwitch: true }), fakeFetch());
    const { ok, lines } = evaluate(results);
    expect(ok).toBe(true);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(`ok   worker health ${WORKER}/health -> 200`);
  });

  it("fails on a disagreeing kill switch, a wrong shape, a non-200 and a transport error", async () => {
    const results = await runSmoke(buildSmokePlan(WORKER, MARKETPLACE, { expectKillSwitch: false }), fakeFetch({
      "/catalog-agents?limit=1": () => Response.json({ error: "internal" }, { status: 503 }),
      "/api/marketplace/agents/303779/passport": () => Response.json({ schemaVersion: 1, checks: {} }),
      "/api/marketplace/jobs/testnet/551": () => { throw new Error("socket hang up"); },
    }));
    const { ok, lines } = evaluate(results);
    expect(ok).toBe(false);
    expect(lines[0]).toContain("FAIL worker health");
    expect(lines[0]).toContain("killSwitch is true, expected false");
    expect(lines[1]).toContain("-> 503");
    expect(lines[4]).toContain("hireActivity");
    expect(lines[5]).toBe(`FAIL marketplace testnet job ${MARKETPLACE}/api/marketplace/jobs/testnet/551 (socket hang up)`);
    expect(lines[2]).toMatch(/^ok {3}worker hire events/);
  });

  it("never passes an empty plan", () => {
    expect(evaluate([]).ok).toBe(false);
  });

  it("parses the two origins and the optional kill-switch expectation", () => {
    expect(parseArguments([WORKER, MARKETPLACE])).toEqual({ workerOrigin: WORKER, marketplaceOrigin: MARKETPLACE, options: {} });
    expect(parseArguments([WORKER, "--expect-kill-switch", "1", MARKETPLACE]).options).toEqual({ expectKillSwitch: true });
    expect(() => parseArguments([WORKER])).toThrow(/Usage/);
    expect(() => parseArguments([WORKER, MARKETPLACE, "--expect-kill-switch", "yes"])).toThrow(/0 or 1/);
    expect(() => parseArguments([WORKER, MARKETPLACE, "--verbose"])).toThrow(/Unknown flag/);
  });
});
