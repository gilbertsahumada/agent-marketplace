import "server-only";
import { GetHostedSellerAgentCard } from "../business/use-cases/get-hosted-seller-agent-card.ts";
import { GetHostedSellerDeliverable } from "../business/use-cases/get-hosted-seller-deliverable.ts";
import { HandleHostedSellerMessage } from "../business/use-cases/handle-hosted-seller-message.ts";
import { MainnetGridSellerRepository } from "./grid-seller-repository.ts";

const repository = new MainnetGridSellerRepository();

export const getMainnetGridSellerAgentCard = new GetHostedSellerAgentCard(repository);
export const handleMainnetGridSellerMessage = new HandleHostedSellerMessage(repository);
export const getMainnetGridSellerDeliverable = new GetHostedSellerDeliverable(repository);
