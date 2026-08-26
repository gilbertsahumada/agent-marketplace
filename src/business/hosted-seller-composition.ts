import "server-only";
import { hostedErc8183SellerRepository } from "../data/hosted-seller-composition.ts";
import { GetHostedSellerAgentCard } from "./use-cases/get-hosted-seller-agent-card.ts";
import { GetHostedSellerDeliverable } from "./use-cases/get-hosted-seller-deliverable.ts";
import { HandleHostedSellerMessage } from "./use-cases/handle-hosted-seller-message.ts";

export const getHostedSellerAgentCard = new GetHostedSellerAgentCard(
  hostedErc8183SellerRepository,
);
export const handleHostedSellerMessage = new HandleHostedSellerMessage(
  hostedErc8183SellerRepository,
);
export const getHostedSellerDeliverable = new GetHostedSellerDeliverable(
  hostedErc8183SellerRepository,
);
