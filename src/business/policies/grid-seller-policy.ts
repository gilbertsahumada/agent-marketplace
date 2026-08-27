import type { HostedSellerAgentCard } from "../entities/hosted-erc8183-seller.ts";

export function gridSellerAgentCard(origin: string): HostedSellerAgentCard {
  return {
    protocolVersion: "0.3.0",
    name: "marketplace-operated-grid-planner",
    description: "Marketplace-operated Grid seller. It computes deterministic plans and performs no trading or custody. Not an official BNB reference agent.",
    url: `${origin}/api/sellers/grid/a2a`,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
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
