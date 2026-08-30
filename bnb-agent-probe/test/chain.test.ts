import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

import {
  BSC_COMMERCE,
  BSC_PAYMENT_TOKEN,
  BSC_POLICY,
  BSC_REGISTRY,
  BSC_ROUTER,
  createCountedBscClient,
  readProbeChainContext,
} from "../src/lib/chain";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const OWNER = "0x2222222222222222222222222222222222222222" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const NOW = 2_000_000_000;

function reader(overrides: Record<string, unknown> = {}) {
  return {
    getChainId: vi.fn(async () => 56),
    getBlock: vi.fn(async () => ({ number: 123n, timestamp: BigInt(NOW - 30) })),
    multicall: vi.fn(async () => [WALLET, OWNER, BSC_PAYMENT_TOKEN, true, 18]),
    ...overrides,
  };
}

describe("WP3 fixed-block chain context", () => {
  it("reads identity, contracts, policy and decimals at the same fresh block", async () => {
    const client = reader();
    const result = await readProbeChainContext(client as never, {
      agentId: "303779",
      nowSeconds: NOW,
    });

    expect(result).toMatchObject({
      provider: WALLET,
      walletSource: "agentWallet",
      blockNumber: 123n,
      blockTimestamp: BigInt(NOW - 30),
      commerce: BSC_COMMERCE,
      router: BSC_ROUTER,
      policy: BSC_POLICY,
      paymentToken: BSC_PAYMENT_TOKEN,
      tokenDecimals: 18,
      policyAllowlisted: true,
    });
    expect(client.multicall).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 123n }));
    const calls = client.multicall.mock.calls as unknown as Array<[
      { contracts: Array<{ address: Address }> },
    ]>;
    const contracts = calls[0]![0].contracts;
    expect(contracts).toHaveLength(5);
    expect(contracts.map((contract: { address: Address }) => contract.address)).toEqual([
      BSC_REGISTRY,
      BSC_REGISTRY,
      BSC_COMMERCE,
      BSC_ROUTER,
      BSC_PAYMENT_TOKEN,
    ]);
  });

  it("uses ownerOf only when getAgentWallet is zero", async () => {
    await expect(readProbeChainContext(reader({
      multicall: vi.fn(async () => [ZERO, OWNER, BSC_PAYMENT_TOKEN, true, 18]),
    }) as never, { agentId: "303779", nowSeconds: NOW })).resolves.toMatchObject({
      provider: OWNER,
      walletSource: "ownerOf",
    });
  });

  it("allows bounded future block skew caused by public RPC latency", async () => {
    await expect(readProbeChainContext(reader({
      getBlock: vi.fn(async () => ({ number: 123n, timestamp: BigInt(NOW + 5) })),
    }) as never, { agentId: "303779", nowSeconds: NOW })).resolves.toMatchObject({
      blockTimestamp: BigInt(NOW + 5),
    });
  });

  it.each([
    ["chain", { getChainId: vi.fn(async () => 97) }],
    ["stale block", { getBlock: vi.fn(async () => ({ number: 123n, timestamp: BigInt(NOW - 121) })) }],
    ["future block", { getBlock: vi.fn(async () => ({ number: 123n, timestamp: BigInt(NOW + 11) })) }],
    ["token", { multicall: vi.fn(async () => [WALLET, OWNER, OWNER, true, 18]) }],
    ["policy", { multicall: vi.fn(async () => [WALLET, OWNER, BSC_PAYMENT_TOKEN, false, 18]) }],
    ["decimals", { multicall: vi.fn(async () => [WALLET, OWNER, BSC_PAYMENT_TOKEN, true, 6]) }],
  ])("fails closed for invalid %s", async (_name, override) => {
    await expect(readProbeChainContext(reader(override) as never, {
      agentId: "303779",
      nowSeconds: NOW,
    })).rejects.toMatchObject({ code: expect.stringMatching(/^BSC_/) });
  });

  it.each([
    ["chain RPC", { getChainId: vi.fn(async () => { throw new Error("secret rpc detail"); }) }, "BSC_CHAIN_RPC"],
    ["block RPC", { getBlock: vi.fn(async () => { throw new Error("secret rpc detail"); }) }, "BSC_BLOCK_RPC"],
  ])("sanitizes an unavailable %s", async (_name, override, code) => {
    await expect(readProbeChainContext(reader(override) as never, {
      agentId: "303779",
      nowSeconds: NOW,
    })).rejects.toMatchObject({ code, message: code });
  });
});

describe("counted BSC RPC transport", () => {
  it("allows read-only RPC and rejects transaction methods before fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: "0x38",
    }), { headers: { "content-type": "application/json" } }));
    const client = createCountedBscClient({
      rpcUrl: "https://rpc.example.com/bsc",
      fetch: fetchImpl,
      deadlineMs: Date.now() + 5_000,
      now: Date.now,
    });

    await expect(client.getChainId()).resolves.toBe(56);
    await expect(client.request({
      method: "eth_sendTransaction" as never,
      params: [] as never,
    })).rejects.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      method: "eth_chainId",
    });
  });

  it("sanitizes an aborted RPC response stream", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.error(new DOMException("secret upstream detail", "AbortError"));
      },
    });
    const client = createCountedBscClient({
      rpcUrl: "https://rpc.example.com/bsc",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
        headers: { "content-type": "application/json" },
      })),
      deadlineMs: Date.now() + 5_000,
      now: Date.now,
    });

    await expect(readProbeChainContext(client as never, {
      agentId: "303779",
      nowSeconds: NOW,
    })).rejects.toMatchObject({ code: "BSC_CHAIN_RPC", message: "BSC_CHAIN_RPC" });
  });
});
