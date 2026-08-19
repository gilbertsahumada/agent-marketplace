import type { Erc8183SpikeRepository } from "../../data/repositories/erc8183-spike-repository.js";
import { InvalidErc8183SpikeInputError } from "../errors/erc8183-spike-errors.js";
import { assertTrackableFixtureJob } from "../policies/erc8183-spike-policy.js";

export class GetErc8183JobStatus {
  constructor(private readonly repository: Erc8183SpikeRepository) {}

  async execute(input: { jobId: string }) {
    if (!/^\d+$/.test(input.jobId) || input.jobId === "0") {
      throw new InvalidErc8183SpikeInputError("jobId must be a positive integer");
    }
    const job = await this.repository.getJob(BigInt(input.jobId));
    assertTrackableFixtureJob(job, this.repository.allowlist);
    return job;
  }
}
