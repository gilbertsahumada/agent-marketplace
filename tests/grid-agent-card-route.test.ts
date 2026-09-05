import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { agentCardUrl } from "../src/a2a.ts";
import { GET } from "../app/grid/.well-known/agent-card.json/route.ts";

const ORIGIN = "https://bnb-agent-marketplace-ruby.vercel.app";
const ENDPOINT = `${ORIGIN}/grid`;
const TEST_PRIVATE_KEY = `0x${"11".repeat(32)}` as const;

afterEach(() => vi.unstubAllEnvs());

describe("Grid Agent Card route", () => {
  it("serves the real operated Grid card at the URL derived from its registered endpoint", async () => {
    vi.stubEnv("ERC8183_MAINNET_SELLER_ENABLED", "true");
    vi.stubEnv("ERC8183_MAINNET_SELLER_ORIGIN", ORIGIN);
    vi.stubEnv("MAINNET_SELLER_PRIVATE_KEY", TEST_PRIVATE_KEY);
    vi.stubEnv(
      "ERC8183_MAINNET_SELLER_ADDRESS",
      privateKeyToAccount(TEST_PRIVATE_KEY).address,
    );

    expect(agentCardUrl(ENDPOINT)).toBe(`${ENDPOINT}/.well-known/agent-card.json`);

    const response = await GET();
    const card = await response.json();

    expect(response.status).toBe(200);
    expect(card).toMatchObject({
      protocolVersion: "0.3.0",
      name: "marketplace-operated-grid-planner",
      url: `${ORIGIN}/api/sellers/grid/a2a`,
      preferredTransport: "JSONRPC",
      capabilities: { streaming: false, pushNotifications: false },
    });
    expect(card.skills.map(({ id }: { id: string }) => id)).toEqual([
      "negotiate-erc8183-job",
      "negotiate",
      "notify_funded",
    ]);
    expect(card.description).toMatch(/no trading or custody/i);
    expect(card.description).toMatch(/not an official BNB reference agent/i);
    const contract = card.capabilities.extensions[0].params;
    expect(contract.inputSchema.required).toEqual(["pair", "lowerPrice", "upperPrice", "capital", "gridCount"]);
    expect(contract.inputSchema.properties.gridCount).toMatchObject({ minimum: 2, maximum: 100 });
    expect(contract.taskDescriptionPrefix).toBe("GRID_PLAN_V1:");
    expect(contract.terms.deliverables).toMatch(/Grid plan/);
  });
});
