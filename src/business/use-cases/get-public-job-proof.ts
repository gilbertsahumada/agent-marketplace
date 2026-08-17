import type { PublicJobProofRepository } from "../../data/proofs/public-job-proof-record.js";
import type { PublicJobProof } from "../entities/public-job-proof.js";
import {
  InvalidPublicJobProofIdError,
  PublicJobProofNotFoundError,
} from "../errors/public-job-proof-errors.js";

export class GetPublicJobProof {
  constructor(private readonly repository: PublicJobProofRepository) {}

  async execute(input: { jobId: string }): Promise<PublicJobProof> {
    const { jobId } = input;
    if (!/^[1-9]\d*$/.test(jobId)) throw new InvalidPublicJobProofIdError();
    const proof = await this.repository.findByJobId(jobId);
    if (!proof) throw new PublicJobProofNotFoundError(jobId);
    return proof;
  }
}
