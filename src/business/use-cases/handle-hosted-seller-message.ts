import type { HostedSellerMessage } from "../entities/hosted-erc8183-seller.ts";
import type { HostedErc8183SellerRepository } from "../../data/repositories/hosted-erc8183-seller-repository.ts";

export class HandleHostedSellerMessage {
  constructor(private readonly repository: HostedErc8183SellerRepository) {}

  execute(message: HostedSellerMessage) {
    return this.repository.handleMessage(message);
  }
}
