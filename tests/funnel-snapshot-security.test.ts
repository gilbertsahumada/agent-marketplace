import { describe, expect, it } from "vitest";
import {
  isPublicHttpsEndpoint,
  runFunnelSnapshot,
} from "../src/trust8004/funnel-snapshot.ts";

const identityReader = {
  registryAddress: "0x1111111111111111111111111111111111111111" as const,
  assertChain: async () => undefined,
  getBlockNumber: async () => 123n,
  readIdentity: async () => ({
    owner: "0x2222222222222222222222222222222222222222" as const,
    agentWallet: "0x0000000000000000000000000000000000000000" as const,
    metadataUri: null,
  }),
};

describe("WP0 endpoint network safety", () => {
  it.each([
    "https://0.255.255.255/a2a",
    "https://10.255.255.255/a2a",
    "https://100.64.0.1/a2a",
    "https://127.255.255.255/a2a",
    "https://169.254.255.255/a2a",
    "https://172.31.255.255/a2a",
    "https://192.0.0.1/a2a",
    "https://192.0.2.1/a2a",
    "https://192.168.255.255/a2a",
    "https://198.18.0.1/a2a",
    "https://198.51.100.1/a2a",
    "https://203.0.113.1/a2a",
    "https://224.0.0.1/a2a",
    "https://240.0.0.1/a2a",
    "https://255.255.255.255/a2a",
  ])("rejects reserved IPv4 endpoint %s", (endpoint) => {
    expect(isPublicHttpsEndpoint(endpoint)).toBe(false);
  });

  it.each([
    "https://[::]/a2a",
    "https://[::1]/a2a",
    "https://[64:ff9b::1]/a2a",
    "https://[64:ff9b:1::1]/a2a",
    "https://[100::1]/a2a",
    "https://[2001::1]/a2a",
    "https://[2001:2::1]/a2a",
    "https://[2001:10::1]/a2a",
    "https://[2001:20::1]/a2a",
    "https://[2001:db8::1]/a2a",
    "https://[2002::1]/a2a",
    "https://[fc00::1]/a2a",
    "https://[fdff:ffff::1]/a2a",
    "https://[fe80::1]/a2a",
    "https://[febf:ffff::1]/a2a",
    "https://[fec0::1]/a2a",
    "https://[feff:ffff::1]/a2a",
    "https://[ff00::1]/a2a",
  ])("rejects reserved IPv6 endpoint %s", (endpoint) => {
    expect(isPublicHttpsEndpoint(endpoint)).toBe(false);
  });

  it.each([
    "https://[::ffff:10.0.0.1]/a2a",
    "https://[::ffff:127.0.0.1]/a2a",
    "https://[::ffff:169.254.1.1]/a2a",
    "https://[::ffff:172.16.0.1]/a2a",
    "https://[::ffff:192.168.0.1]/a2a",
  ])("rejects IPv4-mapped private endpoint %s", (endpoint) => {
    expect(isPublicHttpsEndpoint(endpoint)).toBe(false);
  });

  it.each([
    "https://8.8.8.8/a2a",
    "https://[2606:4700:4700::1111]/a2a",
  ])("retains known public IP endpoint %s", (endpoint) => {
    expect(isPublicHttpsEndpoint(endpoint)).toBe(true);
  });
});

describe("WP0 response transport safety", () => {
  it("cancels an unbounded streamed body as soon as it exceeds maxResponseBytes", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new TextEncoder().encode("123456789"));
          return;
        }
        controller.enqueue(new Uint8Array(1_024));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = (async () => new Response(body, {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

    await expect(runFunnelSnapshot({
      identityReader,
      fetch: fetchImpl,
      maxResponseBytes: 8,
      minimumRequestIntervalMs: 1_100,
    })).rejects.toThrow("WP0_RESPONSE_TOO_LARGE");
    expect(cancelled).toBe(true);
    expect(pulls).toBe(1);
  });

  it("uses error redirect handling and never follows a 3xx response", async () => {
    const redirectModes: (RequestRedirect | undefined)[] = [];
    let requests = 0;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      requests += 1;
      redirectModes.push(init?.redirect);
      return new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/large.json" },
      });
    }) as typeof fetch;

    await expect(runFunnelSnapshot({
      identityReader,
      fetch: fetchImpl,
      minimumRequestIntervalMs: 1_100,
    })).rejects.toThrow("WP0_HTTP:302");
    expect(requests).toBe(1);
    expect(redirectModes).toEqual(["error"]);
  });
});
