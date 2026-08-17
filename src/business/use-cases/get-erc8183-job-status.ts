import type { Erc8183SpikeRepository } from "../../data/repositories/erc8183-spike-repository.js";
import { InvalidErc8183SpikeInputError } from "../errors/erc8183-spike-errors.js";

export class GetErc8183JobStatus {
  constructor(private readonly repository: Erc8183SpikeRepository) {}

  execute(input: { jobId: string }) {
    if (!/^\d+$/.test(input.jobId) || input.jobId === "0") {
      throw new InvalidErc8183SpikeInputError("jobId must be a positive integer");
    }
    return this.repository.getJob(BigInt(input.jobId));
  }
}
