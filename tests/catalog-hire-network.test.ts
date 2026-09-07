import { afterEach, expect, it, vi } from "vitest";
import { ERC8183Client } from "@bnbagent/sdk/erc8183";
import { CatalogErc8183Repository } from "../src/mainnet/catalog-erc8183-repository";
import { ERC8183_MAINNET } from "../src/mainnet/contracts";
import { TESTNET_CLOSURE_PINS } from "../src/data/erc8183/testnet-closure-pins";
import { catalogHireNetwork, catalogHireWritesEnabled } from "../src/mainnet/catalog-hire-network";

afterEach(() => vi.restoreAllMocks());
const target = { agentId: 2177, endpoint: "https://seller.example/a2a", transport: "a2a", requestHash: `0x${"a".repeat(64)}`, provider: "0x1111111111111111111111111111111111111111" as const };

it("does not let one network's write flag authorize another", () => {
  expect(catalogHireWritesEnabled(97, { ERC8183_MAINNET_WRITES_ENABLED: "true" })).toBe(false);
  expect(catalogHireWritesEnabled(56, { ERC8183_TESTNET_HIRE_ENABLED: "true" })).toBe(false);
  expect(catalogHireWritesEnabled(97, { ERC8183_TESTNET_HIRE_ENABLED: "true" })).toBe(true);
  expect(catalogHireWritesEnabled(97, {})).toBe(false);
});

it("parses only an unambiguous supported hire network", () => {
  expect(catalogHireNetwork(new Request("https://example.test/hire?chainId=97"))).toBe(97);
  expect(catalogHireNetwork(new Request("https://example.test/hire"))).toBe(56);
  for (const query of ["chainId=1", "chainId=97&chainId=56", "chainId="]) {
    expect(() => catalogHireNetwork(new Request(`https://example.test/hire?${query}`))).toThrow();
  }
});

it.each([56, 97] as const)("pins contracts for network %s without substituting the demo seller", chainId => {
  const repository = new CatalogErc8183Repository({ ...target, chainId });
  const pins = chainId === 97 ? TESTNET_CLOSURE_PINS : ERC8183_MAINNET;
  expect(repository.allowlist).toMatchObject({ chainId, agentId: 2177, seller: target.provider, commerce: pins.commerce, router: pins.router, policy: pins.policy, token: pins.token });
});

it("rejects a Mainnet RPC before reading Testnet buyer balances", async () => {
  const getBalance = vi.fn();
  const create = vi.spyOn(ERC8183Client, "create").mockResolvedValue({ publicClient: { getChainId: async () => 56, getBalance } } as unknown as ERC8183Client);
  const repository = new CatalogErc8183Repository({ ...target, chainId: 97 });
  await expect(repository.getBuyerFacts(target.provider)).rejects.toThrow("RPC is not connected to the selected network");
  expect(getBalance).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledWith({ network: expect.objectContaining({ commerceContract: TESTNET_CLOSURE_PINS.commerce, registryContract: TESTNET_CLOSURE_PINS.registry }) });
});
