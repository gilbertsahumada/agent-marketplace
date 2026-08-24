import "server-only";
import { GetHostedSellerAgentCard } from "../business/use-cases/get-hosted-seller-agent-card.js";
import { GetHostedSellerDeliverable } from "../business/use-cases/get-hosted-seller-deliverable.js";
import { HandleHostedSellerMessage } from "../business/use-cases/handle-hosted-seller-message.js";
import { MainnetGridSellerRepository } from "./grid-seller-repository.js";

const repository = new MainnetGridSellerRepository();

export const getMainnetGridSellerAgentCard = new GetHostedSellerAgentCard(repository);
export const handleMainnetGridSellerMessage = new HandleHostedSellerMessage(repository);
export const getMainnetGridSellerDeliverable = new GetHostedSellerDeliverable(repository);
