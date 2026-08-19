import type { HostedSellerMessage } from "../entities/hosted-erc8183-seller.js";
import type { HostedErc8183SellerRepository } from "../../data/repositories/hosted-erc8183-seller-repository.js";

export class HandleHostedSellerMessage {
  constructor(private readonly repository: HostedErc8183SellerRepository) {}

  execute(message: HostedSellerMessage) {
    return this.repository.handleMessage(message);
  }
}
