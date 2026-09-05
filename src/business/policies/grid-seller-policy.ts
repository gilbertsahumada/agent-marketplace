import type { HostedSellerAgentCard } from "../entities/hosted-erc8183-seller.ts";
import { GRID_NEGOTIATION_TERMS } from "./grid-plan-policy.ts";

export function gridSellerAgentCard(origin: string): HostedSellerAgentCard {
  return {
    protocolVersion: "0.3.0",
    name: "marketplace-operated-grid-planner",
    description: "Marketplace-operated Grid seller. It computes deterministic plans and performs no trading or custody. Not an official BNB reference agent.",
    url: `${origin}/api/sellers/grid/a2a`,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false, extensions: [{
      uri: "https://marketplace.trust8004.xyz/extensions/negotiation-input/v1",
      description: "Marketplace-specific negotiation input contract; not an ERC-8183 or A2A standard schema.",
      required: false,
      params: {
        skill: "negotiate-erc8183-job",
        taskDescriptionPrefix: "GRID_PLAN_V1:",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["pair", "lowerPrice", "upperPrice", "capital", "gridCount"],
          properties: {
            pair: { type: "string", title: "Trading pair", pattern: "^[A-Z0-9]{2,12}/[A-Z0-9]{2,12}$" },
            lowerPrice: { type: "string", title: "Lower price", minLength: 1, maxLength: 40, description: "Positive decimal, up to 8 decimal places; must be below upperPrice." },
            upperPrice: { type: "string", title: "Upper price", minLength: 1, maxLength: 40, description: "Positive decimal, up to 8 decimal places; must exceed lowerPrice." },
            capital: { type: "string", title: "Simulated capital", minLength: 1, maxLength: 40, description: "Positive decimal, up to 8 decimal places; no funds are traded." },
            gridCount: { type: "integer", title: "Grid levels", minimum: 2, maximum: 100 },
          },
        },
        terms: {
          deliverables: GRID_NEGOTIATION_TERMS.deliverables,
          quality_standards: GRID_NEGOTIATION_TERMS.qualityStandards,
          evaluation_required: true,
          evaluator_type: "uma_oov3",
        },
      },
    }] },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "negotiate-erc8183-job",
        name: "Negotiate a deterministic Grid plan",
        description: "Quote a reproducible Grid calculation with no order execution or custody.",
        tags: ["erc8183", "grid-trading", "bnb-chain"],
      },
      {
        id: "negotiate",
        name: "Negotiate a deterministic Grid plan",
        description: "Quote a reproducible Grid calculation with no order execution or custody.",
        tags: ["erc8183", "grid-trading", "bnb-chain"],
      },
      {
        id: "notify_funded",
        name: "Compute and submit a funded Grid plan",
        description: "Verify a FUNDED job, compute its deterministic plan and submit the manifest hash.",
        tags: ["erc8183", "grid-trading", "bnb-chain"],
      },
    ],
  };
}
