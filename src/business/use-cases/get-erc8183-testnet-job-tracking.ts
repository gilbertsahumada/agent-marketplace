import type { PublicJobProofRepository } from "../../data/proofs/public-job-proof-record.ts";
import type { Erc8183SpikeRepository } from "../../data/repositories/erc8183-spike-repository.ts";
import type { Erc8183TestnetJobTracking } from "../entities/erc8183-testnet-job-tracking.ts";
import type { VerifiedHireEvent, VerifiedHireEventReader } from "../entities/verified-hire-event.ts";
import { InvalidErc8183SpikeInputError } from "../errors/erc8183-spike-errors.ts";
import { Erc8183SpikeDisabledError, Erc8183SpikeUnavailableError } from "../errors/erc8183-spike-errors.ts";
import { assertTrackableFixtureJob } from "../policies/erc8183-spike-policy.ts";

export class GetErc8183TestnetJobTracking {
  constructor(
    private readonly jobs: Erc8183SpikeRepository,
    private readonly proofs: PublicJobProofRepository,
    private readonly hireEvents?: VerifiedHireEventReader,
  ) {}

  async execute(input: { jobId: string }): Promise<Erc8183TestnetJobTracking> {
    if (!/^[1-9]\d*$/.test(input.jobId)) {
      throw new InvalidErc8183SpikeInputError("jobId must be a positive integer");
    }
    const [snapshot, verifiedPhases] = await Promise.all([
      this.proofs.findSnapshotByJobId(input.jobId),
      this.readVerifiedPhases(input.jobId),
    ]);
    try {
      const job = await this.jobs.getJob(BigInt(input.jobId));
      assertTrackableFixtureJob(job, this.jobs.allowlist);
      return { liveStatus: "verified", job, snapshot, verifiedPhases };
    } catch (error) {
      if (snapshot && (error instanceof Erc8183SpikeDisabledError || error instanceof Erc8183SpikeUnavailableError)) {
        return { liveStatus: "unavailable", job: null, snapshot, verifiedPhases };
      }
      throw error;
    }
  }

  // The Worker keys verified events by the seller agent of the allowlisted
  // deployment; this job's phases are the subset with the matching jobId.
  private async readVerifiedPhases(jobId: string): Promise<VerifiedHireEvent[]> {
    if (!this.hireEvents) return [];
    try {
      const events = await this.hireEvents.listByAgent({
        chainId: this.jobs.allowlist.chainId,
        agentId: String(this.jobs.allowlist.agentId),
      });
      return (events ?? []).filter((event) => event.jobId === jobId);
    } catch {
      return [];
    }
  }
}
