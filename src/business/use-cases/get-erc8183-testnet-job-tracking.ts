import type { PublicJobProofRepository } from "../../data/proofs/public-job-proof-record.js";
import type { Erc8183SpikeRepository } from "../../data/repositories/erc8183-spike-repository.js";
import type { Erc8183TestnetJobTracking } from "../entities/erc8183-testnet-job-tracking.js";
import { InvalidErc8183SpikeInputError } from "../errors/erc8183-spike-errors.js";
import { Erc8183SpikeDisabledError, Erc8183SpikeUnavailableError } from "../errors/erc8183-spike-errors.js";
import { assertTrackableFixtureJob } from "../policies/erc8183-spike-policy.js";

export class GetErc8183TestnetJobTracking {
  constructor(
    private readonly jobs: Erc8183SpikeRepository,
    private readonly proofs: PublicJobProofRepository,
  ) {}

  async execute(input: { jobId: string }): Promise<Erc8183TestnetJobTracking> {
    if (!/^[1-9]\d*$/.test(input.jobId)) {
      throw new InvalidErc8183SpikeInputError("jobId must be a positive integer");
    }
    const snapshot = await this.proofs.findSnapshotByJobId(input.jobId);
    try {
      const job = await this.jobs.getJob(BigInt(input.jobId));
      assertTrackableFixtureJob(job, this.jobs.allowlist);
      return { liveStatus: "verified", job, snapshot };
    } catch (error) {
      if (snapshot && (error instanceof Erc8183SpikeDisabledError || error instanceof Erc8183SpikeUnavailableError)) {
        return { liveStatus: "unavailable", job: null, snapshot };
      }
      throw error;
    }
  }
}
