import { expect, it } from "vitest";
import { sellerParameterExample, parameterPlaceholder } from "../components/marketplace/seller-parameter-examples";
import { normalizeNegotiationContract, validateParameters } from "../src/shared/negotiation-input";
import { gridSellerAgentCard } from "../src/business/policies/grid-seller-policy";

it("loads the existing Grid fixture with valid numeric types and bounds", () => {
  const card = gridSellerAgentCard("https://seller.example.com");
  const contract = normalizeNegotiationContract(card.capabilities.extensions![0]!.params);
  const example = sellerParameterExample(contract);
  expect(example).toEqual({ pair: "BNB/USDT", lowerPrice: "700", upperPrice: "900", capital: "1000", gridCount: 9 });
  expect(validateParameters(contract.inputSchema, example)).toBe(true);
  expect(parameterPlaceholder(contract.inputSchema.properties!.pair!, example!.pair)).toBe("e.g. BNB/USDT");
  expect(parameterPlaceholder(contract.inputSchema.properties!.gridCount!, example!.gridCount)).toBe("e.g. 9");
});

it("preserves nested published examples including false and zero", () => {
  const grid = normalizeNegotiationContract(gridSellerAgentCard("https://seller.example.com").capabilities.extensions![0]!.params);
  const contract = normalizeNegotiationContract({ ...grid, taskDescriptionPrefix: "CUSTOM_V1:", inputSchema: {
    type: "object", required: ["options"], properties: { options: { type: "object", required: ["enabled", "count"], properties: {
      enabled: { type: "boolean", examples: [false] }, count: { type: "integer", minimum: 0, examples: [-1, 0] },
    } } },
  } });
  expect(sellerParameterExample(contract)).toEqual({ options: { enabled: false, count: 0 } });
});
