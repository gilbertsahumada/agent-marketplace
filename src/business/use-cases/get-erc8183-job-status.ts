import type { Erc8183SpikeRepository } from "../../data/repositories/erc8183-spike-repository.ts";
import { InvalidErc8183SpikeInputError } from "../errors/erc8183-spike-errors.ts";
import { assertDemoJobId, assertTrackableFixtureJob } from "../policies/erc8183-spike-policy.ts";

export class GetErc8183JobStatus {
  constructor(private readonly repository: Erc8183SpikeRepository) {}

  async execute(input: { jobId: string }) {
    if (!/^\d+$/.test(input.jobId) || input.jobId === "0") {
      throw new InvalidErc8183SpikeInputError("jobId must be a positive integer");
    }
    // Decide by id first when the allowlist can; the chain is read only for
    // ids it cannot rule out, and the read result is still asserted.
    const allowlist = this.repository.allowlist;
    assertDemoJobId(input.jobId, allowlist);
    const job = await this.repository.getJob(BigInt(input.jobId));
    assertTrackableFixtureJob(job, allowlist);
    return job;
  }
}
