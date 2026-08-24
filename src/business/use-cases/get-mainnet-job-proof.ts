import type { MainnetJobProof } from "../entities/mainnet-job-proof.js";

export interface MainnetJobProofReader { getPrimary(): MainnetJobProof | null }

export class GetMainnetJobProof {
  constructor(private readonly reader: MainnetJobProofReader) {}
  execute(): MainnetJobProof | null { return this.reader.getPrimary(); }
}
