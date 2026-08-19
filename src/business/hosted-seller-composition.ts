import "server-only";
import { hostedErc8183SellerRepository } from "../data/hosted-seller-composition.js";
import { GetHostedSellerAgentCard } from "./use-cases/get-hosted-seller-agent-card.js";
import { GetHostedSellerDeliverable } from "./use-cases/get-hosted-seller-deliverable.js";
import { HandleHostedSellerMessage } from "./use-cases/handle-hosted-seller-message.js";

export const getHostedSellerAgentCard = new GetHostedSellerAgentCard(
  hostedErc8183SellerRepository,
);
export const handleHostedSellerMessage = new HandleHostedSellerMessage(
  hostedErc8183SellerRepository,
);
export const getHostedSellerDeliverable = new GetHostedSellerDeliverable(
  hostedErc8183SellerRepository,
);
