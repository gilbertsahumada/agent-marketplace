import { expect, it } from "vitest";
import { discoveryInventory } from "../src/trust8004/discovery-audit";
const item = (agentId: string, chainId = 97) => ({ agentId, chainId, services: [{ name: "ERC-8183", endpoint: "https://seller.example/erc8183/status" }] });
it("separates identities from shared endpoint work without mixing networks", () => {
  const inventory = discoveryInventory([item("1"), item("2")], 97);
  expect(inventory.registered).toBe(2);
  expect(inventory.safeOperationalAgents).toBe(2);
  expect(inventory.targets).toHaveLength(1);
  expect(inventory.targets[0]?.agents).toEqual(["1", "2"]);
  expect(() => discoveryInventory([item("1", 56)], 97)).toThrow("AUDIT_CHAIN_MISMATCH");
  expect(() => discoveryInventory([item("1"), item("1")], 97)).toThrow("AUDIT_DUPLICATE_IDENTITY");
});
it("does not probe unsafe or merely web declarations", () => {
  const inventory = discoveryInventory([{ agentId: "1", chainId: 97, services: [{ name: "ERC-8183", endpoint: "http://localhost:3000/status" }, { name: "web", endpoint: "https://seller.example" }] }], 97);
  expect(inventory.withDeclarations).toBe(1);
  expect(inventory.targets).toHaveLength(0);
});
