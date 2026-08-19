import { getAddress, type Address } from "viem";
import type { Erc8183SpikeRepository } from "../../data/repositories/erc8183-spike-repository.js";
import { InvalidErc8183SpikeInputError, Erc8183JobNotReadyError } from "../errors/erc8183-spike-errors.js";
import { assertExpectedJob } from "../policies/erc8183-spike-policy.js";

export class NotifyFundedJob {
  constructor(private readonly repository: Erc8183SpikeRepository) {}

  async execute(input: { jobId: string; buyer: Address }) {
    if (!/^\d+$/.test(input.jobId) || input.jobId === "0") {
      throw new InvalidErc8183SpikeInputError("jobId must be a positive integer");
    }
    const jobId = BigInt(input.jobId);
    const job = await this.repository.getJob(jobId);
    assertExpectedJob(job, {
      buyer: getAddress(input.buyer),
      seller: this.repository.allowlist.seller,
      allowlist: this.repository.allowlist,
    });
    if (job.status === "SUBMITTED" || job.status === "COMPLETED") {
      return { acknowledged: true as const, alreadySubmitted: true, job };
    }
    if (job.status !== "FUNDED") {
      throw new Erc8183JobNotReadyError("notify_funded requires an onchain FUNDED job");
    }
    return this.repository.notifyFunded(jobId);
  }
}
