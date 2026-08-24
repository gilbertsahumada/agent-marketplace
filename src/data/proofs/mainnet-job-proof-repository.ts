import envelopeJson from "./bsc-mainnet-primary.json" with { type: "json" };
import type { MainnetJobProof } from "../../business/entities/mainnet-job-proof.js";

export interface MainnetJobProofRepository {
  getPrimary(): MainnetJobProof | null;
}

function parse(value: unknown): MainnetJobProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mainnet proof envelope must be an object");
  const envelope = value as Record<string, unknown>;
  if (envelope.schemaVersion !== 1) throw new Error("Mainnet proof envelope schema is unsupported");
  if (envelope.proof === null) return null;
  if (!envelope.proof || typeof envelope.proof !== "object" || Array.isArray(envelope.proof)) throw new Error("Mainnet proof is invalid");
  const proof = envelope.proof as Record<string, unknown>;
  if (
    proof.schemaVersion !== 1 || proof.chainId !== 56 ||
    typeof proof.agentId !== "string" || typeof proof.jobId !== "string" ||
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

export class StaticMainnetJobProofRepository implements MainnetJobProofRepository {
  getPrimary(): MainnetJobProof | null { return parse(envelopeJson); }
}
