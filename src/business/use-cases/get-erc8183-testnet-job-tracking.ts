import type { PublicJobProofRepository } from "../../data/proofs/public-job-proof-record.ts";
import type { Erc8183SpikeRepository } from "../../data/repositories/erc8183-spike-repository.ts";
import { DEMO_AGENT_BUYER } from "../entities/demo-agent-buyer.ts";
import type { BuyerIdentity, Erc8183TestnetJobTracking } from "../entities/erc8183-testnet-job-tracking.ts";
import type { VerifiedHireEvent, VerifiedHireEventReader } from "../entities/verified-hire-event.ts";
import { InvalidErc8183SpikeInputError } from "../errors/erc8183-spike-errors.ts";
import { Erc8183SpikeDisabledError, Erc8183SpikeUnavailableError } from "../errors/erc8183-spike-errors.ts";
import { assertTrackableFixtureJob } from "../policies/erc8183-spike-policy.ts";

const UNKNOWN_BUYER: BuyerIdentity = { kind: "unknown", agentId: null, verified: false, registry: null };

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export class GetErc8183TestnetJobTracking {
  constructor(
    private readonly jobs: Erc8183SpikeRepository,
    private readonly proofs: PublicJobProofRepository,
    private readonly hireEvents?: VerifiedHireEventReader,
    private readonly demoBuyer: { address: string; agentId: number | null } = DEMO_AGENT_BUYER,
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
      const buyerIdentity = await this.resolveBuyerIdentity(job.buyer);
      return { liveStatus: "verified", job, snapshot, verifiedPhases, buyerIdentity };
    } catch (error) {
      if (snapshot && (error instanceof Erc8183SpikeDisabledError || error instanceof Erc8183SpikeUnavailableError)) {
        const buyerIdentity = await this.resolveBuyerIdentity(snapshot.buyer);
        return { liveStatus: "unavailable", job: null, snapshot, verifiedPhases, buyerIdentity };
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

  // Delegation is a fact about the buyer address, verified against the
  // ERC-8004 registry only when the demo buyer declares an agent id and the
  // repository can read chain; every other case is labelled, not claimed.
  private async resolveBuyerIdentity(buyer: string | null | undefined): Promise<BuyerIdentity> {
    if (!buyer || !sameAddress(buyer, this.demoBuyer.address)) return UNKNOWN_BUYER;
    const agentId = this.demoBuyer.agentId;
    if (agentId === null || !this.jobs.readAgentWallet) {
      return { kind: "demo_agent", agentId: agentId === null ? null : String(agentId), verified: false, registry: null };
    }
    try {
      const identity = await this.jobs.readAgentWallet(BigInt(agentId));
      const verified = sameAddress(identity.agentWallet, buyer) || sameAddress(identity.owner, buyer);
      return { kind: "demo_agent", agentId: String(agentId), verified, registry: identity.registry };
    } catch {
      return { kind: "demo_agent", agentId: String(agentId), verified: false, registry: null };
    }
  }
}
