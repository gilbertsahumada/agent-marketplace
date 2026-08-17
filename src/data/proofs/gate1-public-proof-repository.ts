import type {
  Gate1TransactionPhase,
  PublicJobProofLiveEvidenceRecord,
  PublicJobProofRecord,
  PublicJobProofRepository,
} from "./public-job-proof-record.js";
import {
  createGate1ProofReader,
  sanitizeGate1ProofError,
  verifyGate1Proof,
} from "../../readiness/gate1.js";
import type { Gate1Proof } from "../../readiness/types.js";
import { GATE1_JOB_514_MANIFEST } from "./gate1-job-514.js";

export type Gate1LiveProofLoader = () => Promise<Gate1Proof>;

export interface Gate1PublicProofRepositoryOptions {
  loadLiveProof?: Gate1LiveProofLoader;
  now?: () => number;
}

const LIVE_PROOF_TTL_MS = 60_000;

async function defaultLiveProofLoader(): Promise<Gate1Proof> {
  return verifyGate1Proof(await createGate1ProofReader());
}

function unavailableLiveProof(error: unknown, now: () => number): PublicJobProofLiveEvidenceRecord {
  return {
    status: "unavailable",
    source: "onchain:bsc-testnet-rpc",
    observedAt: new Date(now()).toISOString(),
    observedState: null,
    buyer: null,
    seller: null,
    agentWallet: null,
    paymentToken: null,
    budgetRaw: null,
    deadline: null,
    submittedAt: null,
    deliverableHash: null,
    transactions: {},
    checks: {},
    error: sanitizeGate1ProofError(error),
  };
}

function liveEvidence(proof: Gate1Proof): PublicJobProofLiveEvidenceRecord {
  const transactions: PublicJobProofLiveEvidenceRecord["transactions"] = {};
  for (const phase of Object.keys(GATE1_JOB_514_MANIFEST.transactions) as Gate1TransactionPhase[]) {
    const transaction = proof.transactions[phase];
    if (transaction) transactions[phase] = transaction;
  }
  return {
    status: proof.status === "read_error" ? "unavailable" : proof.status,
    source: proof.provenance,
    observedAt: proof.observedAt,
    observedState: proof.observedState,
    buyer: proof.buyer,
    seller: proof.provider,
    agentWallet: proof.agentWallet,
    paymentToken: proof.paymentToken,
    budgetRaw: proof.budget,
    deadline: proof.deadline,
    submittedAt: proof.submittedAt,
    deliverableHash: proof.deliverableHash,
    transactions,
    checks: proof.checks,
    error: proof.error
      ? { ...proof.error, message: sanitizeGate1ProofError(proof.error.message).message }
      : null,
  };
}

export class Gate1PublicProofRepository implements PublicJobProofRepository {
  private readonly loadLiveProof: Gate1LiveProofLoader;
  private readonly now: () => number;
  private liveCache: {
    expiresAt: number;
    value: Promise<PublicJobProofLiveEvidenceRecord>;
  } | null = null;

  constructor(options: Gate1PublicProofRepositoryOptions = {}) {
    this.loadLiveProof = options.loadLiveProof ?? defaultLiveProofLoader;
    this.now = options.now ?? Date.now;
  }

  async findByJobId(jobId: string): Promise<PublicJobProofRecord | null> {
    if (jobId !== GATE1_JOB_514_MANIFEST.jobId) return null;
    const live = await this.getLiveEvidence();
    return {
      schemaVersion: 1,
      snapshot: structuredClone(GATE1_JOB_514_MANIFEST),
      live: structuredClone(live),
    };
  }

  private getLiveEvidence(): Promise<PublicJobProofLiveEvidenceRecord> {
    const currentTime = this.now();
    if (this.liveCache && this.liveCache.expiresAt > currentTime) return this.liveCache.value;
    const value = this.readLiveEvidence();
    this.liveCache = { expiresAt: currentTime + LIVE_PROOF_TTL_MS, value };
    return value;
  }

  private async readLiveEvidence(): Promise<PublicJobProofLiveEvidenceRecord> {
    try {
      return liveEvidence(await this.loadLiveProof());
    } catch (error) {
      return unavailableLiveProof(error, this.now);
    }
  }
}
