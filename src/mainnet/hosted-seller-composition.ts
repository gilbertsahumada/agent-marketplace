import "server-only";
import type { HostedSellerSlug } from "../business/entities/hosted-seller-service.ts";
import { GetHostedSellerAgentCard } from "../business/use-cases/get-hosted-seller-agent-card.ts";
import { GetHostedSellerDeliverable } from "../business/use-cases/get-hosted-seller-deliverable.ts";
import { HandleHostedSellerMessage } from "../business/use-cases/handle-hosted-seller-message.ts";
import { hostedSellerService } from "../business/policies/hosted-seller-catalog.ts";
import { MainnetHostedSellerRepository } from "./hosted-seller-repository.ts";

export interface HostedSellerUseCases {
  getAgentCard: GetHostedSellerAgentCard;
  handleMessage: HandleHostedSellerMessage;
  getDeliverable: GetHostedSellerDeliverable;
}

const useCases = new Map<HostedSellerSlug, HostedSellerUseCases>();

// One repository per seller, created on first use so a request for one
// seller never initialises another seller's signer.
export function hostedSellerUseCases(slug: HostedSellerSlug): HostedSellerUseCases {
  let current = useCases.get(slug);
  if (!current) {
    const repository = new MainnetHostedSellerRepository(hostedSellerService(slug));
    current = {
      getAgentCard: new GetHostedSellerAgentCard(repository),
      handleMessage: new HandleHostedSellerMessage(repository),
      getDeliverable: new GetHostedSellerDeliverable(repository),
    };
    useCases.set(slug, current);
  }
  return current;
}
