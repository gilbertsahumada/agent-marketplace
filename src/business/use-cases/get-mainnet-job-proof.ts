import type { MainnetJobProof } from "../entities/mainnet-job-proof.ts";
import {
  InvalidPublicJobProofIdError,
  PublicJobProofNotFoundError,
} from "../errors/public-job-proof-errors.ts";

export interface MainnetJobProofReader { getPrimary(): MainnetJobProof | null }

export class GetMainnetJobProof {
  constructor(private readonly reader: MainnetJobProofReader) {}
  execute(): MainnetJobProof | null { return this.reader.getPrimary(); }
}

export class GetPublicMainnetJobProof {
  constructor(private readonly reader: MainnetJobProofReader) {}

  execute(input: { jobId: string }): MainnetJobProof {
    if (!/^[1-9]\d*$/.test(input.jobId)) throw new InvalidPublicJobProofIdError();
    const proof = this.reader.getPrimary();
    if (!proof || proof.jobId !== input.jobId) throw new PublicJobProofNotFoundError(input.jobId);
    return proof;
  }
}
