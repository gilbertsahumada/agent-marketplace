import { InvalidHostedSellerRequestError } from "../errors/hosted-seller-errors.ts";
import type { HostedErc8183SellerRepository } from "../../data/repositories/hosted-erc8183-seller-repository.ts";

export class GetHostedSellerDeliverable {
  constructor(private readonly repository: HostedErc8183SellerRepository) {}

  execute(input: { jobId: string }) {
    if (!/^\d+$/.test(input.jobId) || input.jobId === "0") {
      throw new InvalidHostedSellerRequestError("jobId must be a positive integer");
    }
    return this.repository.getDeliverable(BigInt(input.jobId));
  }
}
