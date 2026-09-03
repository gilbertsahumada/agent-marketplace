import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertQuoteWithinDemoCeiling, reportHireEvent } from "../src/demo/agent-buyer-cli.ts";

const NOW = 1_788_000_000_000;

function quote(overrides: Partial<Parameters<typeof assertQuoteWithinDemoCeiling>[0]> = {}) {
  return {
    envelope: {},
    chainId: 97,
    priceRaw: "1",
    quoteExpiresAt: Math.floor(NOW / 1_000) + 600,
    tokenSymbol: "U",
    ...overrides,
  };
}

describe("agent buyer demo", () => {
  it("accepts a quote inside the demo ceiling", () => {
    expect(() => assertQuoteWithinDemoCeiling(quote(), NOW)).not.toThrow();
  });

  it("refuses to sign outside BSC Testnet", () => {
    expect(() => assertQuoteWithinDemoCeiling(quote({ chainId: 56 }), NOW)).toThrow("Testnet");
  });

  it("enforces the spend ceiling before any signature", () => {
    expect(() => assertQuoteWithinDemoCeiling(quote({ priceRaw: "2" }), NOW)).toThrow("ceiling");
    expect(() => assertQuoteWithinDemoCeiling(quote({ priceRaw: "0" }), NOW)).toThrow("positive");
  });

  it("rejects an expired quote", () => {
    expect(() => assertQuoteWithinDemoCeiling(quote({ quoteExpiresAt: Math.floor(NOW / 1_000) - 1 }), NOW)).toThrow("expired");
  });

  it("keeps custody local and reuses the UI validation module", () => {
    const source = readFileSync("src/demo/agent-buyer-cli.ts", "utf8");
    expect(source).toMatch(/validateHirePlan/);
    expect(source).toMatch(/AGENT_BUYER_PRIVATE_KEY/);
    // The key only ever feeds the local account; it is never interpolated into a request body.
    expect(source).not.toMatch(/postJson\([^)]*PRIVATE_KEY/);
    expect(source).not.toMatch(/src\/(?:data\/observation|trust8004)|catalog-agents/);
  });

  describe("hire event reporting", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("posts the same five-key contract as the browser demo", async () => {
      const calls: Array<{ url: string; body: unknown }> = [];
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return Response.json({ persistence: "recorded" }, { status: 201 });
      }));
      const lines: string[] = [];
      await reportHireEvent("https://marketplace.example", { phase: "created", jobId: "551", txHash: `0x${"ab".repeat(32)}` }, (line) => lines.push(line));
      expect(calls).toEqual([{
        url: "https://marketplace.example/api/marketplace/hire-events",
        body: { agentId: "1866", chainId: 97, phase: "created", jobId: "551", txHash: `0x${"ab".repeat(32)}` },
      }]);
      expect(lines).toEqual(["hire-event created: recorded"]);
    });

    it.each<[string, () => Promise<Response>]>([
      ["a rejected claim", async () => Response.json({ persistence: "rejected" }, { status: 409 })],
      ["a server failure", async () => new Response(null, { status: 500 })],
      ["a transport error", async () => { throw new Error("offline"); }],
    ])("never interrupts the hire on %s", async (_label, response) => {
      vi.stubGlobal("fetch", vi.fn(response));
      const lines: string[] = [];
      await expect(reportHireEvent("https://marketplace.example", { phase: "clicked", jobId: null, txHash: null }, (line) => lines.push(line))).resolves.toBeUndefined();
      expect(lines[0]).toMatch(/^hire-event clicked: not recorded \(/);
    });

    it("wires every reportable phase after the signature boundary", () => {
      const source = readFileSync("src/demo/agent-buyer-cli.ts", "utf8");
      const dryRunReturn = source.indexOf("nothing signed.");
      for (const phase of ["clicked", "created", "funded", "submitted"]) {
        const call = source.indexOf(`phase: "${phase}"`);
        expect(call, phase).toBeGreaterThan(dryRunReturn);
      }
    });
  });
});
