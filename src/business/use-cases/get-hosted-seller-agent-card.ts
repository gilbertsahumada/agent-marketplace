import type { HostedErc8183SellerRepository } from "../../data/repositories/hosted-erc8183-seller-repository.js";

export class GetHostedSellerAgentCard {
  constructor(private readonly repository: HostedErc8183SellerRepository) {}

  execute() {
    return this.repository.getAgentCard();
  }
}
