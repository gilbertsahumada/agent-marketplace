import envelopeJson from "./bsc-mainnet-primary.json" with { type: "json" };
import historyJson from "./bsc-mainnet-history.json" with { type: "json" };
import type { MainnetJobProof } from "../../business/entities/mainnet-job-proof.ts";

export interface MainnetJobProofRepository {
  getPrimary(): MainnetJobProof | null;
  listByAgentId(agentId: string): MainnetJobProof[];
}

function parseProof(value: unknown): MainnetJobProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mainnet proof is invalid");
  const proof = value as Record<string, unknown>;
  if (
    proof.schemaVersion !== 1 || proof.chainId !== 56 ||
    typeof proof.agentId !== "string" || typeof proof.jobId !== "string" || !/^[1-9]\d*$/.test(proof.jobId) ||
    typeof proof.buyer !== "string" || typeof proof.seller !== "string" || typeof proof.token !== "string" ||
    typeof proof.budgetRaw !== "string" || (proof.finalState !== "SUBMITTED" && proof.finalState !== "COMPLETED") ||
    typeof proof.deliverableHash !== "string" || proof.resultHashVerified !== true || proof.deterministicResultVerified !== true ||
    typeof proof.durationSeconds !== "string" || typeof proof.totalGasCostWei !== "string" ||
    typeof proof.capturedAt !== "string" || !Number.isFinite(Date.parse(proof.capturedAt)) ||
    !proof.transactions || typeof proof.transactions !== "object" || Array.isArray(proof.transactions)
  ) throw new Error("Mainnet proof fields are invalid");
  const serialized = JSON.stringify(proof);
  if (/private.?key|mnemonic|password|keystore|authorization|bearer|\/Users\//i.test(serialized)) {
    throw new Error("Mainnet proof contains a forbidden sensitive field");
  }
  return structuredClone(proof) as unknown as MainnetJobProof;
}

function parse(value: unknown): MainnetJobProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mainnet proof envelope must be an object");
  const envelope = value as Record<string, unknown>;
  if (envelope.schemaVersion !== 1) throw new Error("Mainnet proof envelope schema is unsupported");
  if (envelope.proof === null) return null;
  return parseProof(envelope.proof);
}

function parseHistory(value: unknown): MainnetJobProof[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mainnet proof history must be an object");
  const history = value as Record<string, unknown>;
  if (history.schemaVersion !== 1 || !Array.isArray(history.proofs)) throw new Error("Mainnet proof history schema is unsupported");
  return history.proofs.map(parseProof);
}

export class StaticMainnetJobProofRepository implements MainnetJobProofRepository {
  constructor(
    private readonly primaryEnvelope: unknown = envelopeJson,
    private readonly historyEnvelope: unknown = historyJson,
  ) {}

  getPrimary(): MainnetJobProof | null { return parse(this.primaryEnvelope); }
  listByAgentId(agentId: string): MainnetJobProof[] {
    const primary = this.getPrimary();
    const proofs = [...parseHistory(this.historyEnvelope), ...(primary ? [primary] : [])];
    const byJob = new Map<string, MainnetJobProof>();
    for (const proof of proofs.filter((candidate) => candidate.agentId === agentId)) {
      const existing = byJob.get(proof.jobId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(proof)) {
        throw new Error(`Mainnet proof history conflicts for job ${proof.jobId}`);
      }
      if (!existing) byJob.set(proof.jobId, proof);
    }
    return [...byJob.values()];
  }
}
