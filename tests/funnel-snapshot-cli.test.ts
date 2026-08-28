import { describe, expect, it, vi } from "vitest";
import { createFunnelIdentityReader } from "../src/trust8004/funnel-snapshot-cli.ts";

const REGISTRY = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const AGENT_WALLET = "0x3333333333333333333333333333333333333333";

describe("WP0 funnel snapshot CLI identity reader", () => {
  it("pins ownerOf and getAgentWallet to the requested cutoff block", async () => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "ownerOf") return OWNER;
      if (functionName === "getAgentWallet") return AGENT_WALLET;
      throw new Error(`Unexpected contract read: ${functionName}`);
    });
    const cutoffBlock = 123_456n;
    const reader = createFunnelIdentityReader({
      client: { readContract } as never,
      registryAddress: REGISTRY,
    });

    await reader.readIdentity("42", cutoffBlock);

    expect(readContract).toHaveBeenCalledTimes(2);
    expect(readContract).toHaveBeenNthCalledWith(1, expect.objectContaining({
      functionName: "ownerOf",
      blockNumber: cutoffBlock,
    }));
    expect(readContract).toHaveBeenNthCalledWith(2, expect.objectContaining({
      functionName: "getAgentWallet",
      blockNumber: cutoffBlock,
    }));
  });
});
