import type { HostedSellerAgentCard } from "../entities/hosted-erc8183-seller.js";

export function hostedSellerAgentCard(origin: string): HostedSellerAgentCard {
  return {
    protocolVersion: "0.3.0",
    name: "hosted-erc8183-seller-fixture",
    description:
      "Testing infrastructure for the browser-wallet ERC-8183 spike; not a marketplace agent.",
    url: `${origin}/api/fixtures/erc8183/a2a`,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "negotiate-erc8183-job",
        name: "Negotiate a deterministic ERC-8183 fixture job",
        description: "Return a provider-signed one-raw-unit Testnet quote.",
        tags: ["erc8183", "testing", "bnb-chain"],
      },
      {
        id: "notify_funded",
        name: "Submit a funded ERC-8183 fixture job",
        description: "Verify a FUNDED job and publish a deterministic result.",
        tags: ["erc8183", "testing", "bnb-chain"],
      },
    ],
  };
}
