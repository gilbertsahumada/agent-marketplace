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
import { GATE6A_JOB_551_MANIFEST } from "./gate6a-job-551.js";
import type { Erc8183JobFacts } from "../../business/entities/erc8183-browser-spike.js";

export type Gate1LiveProofLoader = () => Promise<Gate1Proof>;

export interface Gate1PublicProofRepositoryOptions {
  loadLiveProof?: Gate1LiveProofLoader;
  loadGate6aJob?: () => Promise<Erc8183JobFacts>;
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
  private readonly loadGate6aJob: (() => Promise<Erc8183JobFacts>) | null;
  private readonly now: () => number;
  private readonly liveCache = new Map<string, {
    expiresAt: number;
    value: Promise<PublicJobProofLiveEvidenceRecord>;
  }>();

  constructor(options: Gate1PublicProofRepositoryOptions = {}) {
    this.loadLiveProof = options.loadLiveProof ?? defaultLiveProofLoader;
    this.loadGate6aJob = options.loadGate6aJob ?? null;
    this.now = options.now ?? Date.now;
  }

  async findByJobId(jobId: string): Promise<PublicJobProofRecord | null> {
    const snapshot = await this.findSnapshotByJobId(jobId);
    if (!snapshot) return null;
    const live = await this.getLiveEvidence(jobId);
    return {
      schemaVersion: 1,
      snapshot,
      live: structuredClone(live),
    };
  }

  async findSnapshotByJobId(jobId: string) {
    if (jobId === GATE1_JOB_514_MANIFEST.jobId) return structuredClone(GATE1_JOB_514_MANIFEST);
    if (jobId === GATE6A_JOB_551_MANIFEST.jobId) return structuredClone(GATE6A_JOB_551_MANIFEST);
    return null;
  }

  private getLiveEvidence(jobId: string): Promise<PublicJobProofLiveEvidenceRecord> {
    const currentTime = this.now();
    const cached = this.liveCache.get(jobId);
    if (cached && cached.expiresAt > currentTime) return cached.value;
    const value = this.readLiveEvidence(jobId);
    this.liveCache.set(jobId, { expiresAt: currentTime + LIVE_PROOF_TTL_MS, value });
    return value;
  }

  private async readLiveEvidence(jobId: string): Promise<PublicJobProofLiveEvidenceRecord> {
    try {
      if (jobId === GATE6A_JOB_551_MANIFEST.jobId) {
        if (!this.loadGate6aJob) throw new Error("Gate 6A live reader is unavailable");
        return gate6aLiveEvidence(await this.loadGate6aJob());
      }
      return liveEvidence(await this.loadLiveProof());
    } catch (error) {
      return unavailableLiveProof(error, this.now);
    }
  }
}

function timestampFromSeconds(value: string): PublicJobProofLiveEvidenceRecord["deadline"] {
  if (!/^\d+$/.test(value)) return null;
  const milliseconds = Number(BigInt(value) * 1_000n);
  if (!Number.isSafeInteger(milliseconds)) return null;
  return { unix: value, iso: new Date(milliseconds).toISOString() };
}

function gate6aLiveEvidence(job: Erc8183JobFacts): PublicJobProofLiveEvidenceRecord {
  const snapshot = GATE6A_JOB_551_MANIFEST;
  const deadline = timestampFromSeconds(job.deadline);
  const submittedAt = timestampFromSeconds(job.submittedAt);
  const checks = {
    stateMatches: job.status === snapshot.lifecycle.expectedState || job.status === "COMPLETED",
    buyerMatches: job.buyer.toLowerCase() === snapshot.buyer.toLowerCase(),
    providerMatches: job.provider.toLowerCase() === snapshot.seller.toLowerCase(),
    paymentTokenMatches: job.quotedToken?.toLowerCase() === snapshot.payment.token.toLowerCase(),
    budgetMatches: job.budgetRaw === snapshot.payment.budgetRaw,
    deadlineMatches: deadline?.unix === snapshot.lifecycle.deadline.unix,
    submittedAtMatches: submittedAt?.unix === snapshot.lifecycle.submittedAt.unix,
    deliverableHashMatches: job.deliverableHash.toLowerCase() === snapshot.deliverable.hash.toLowerCase(),
    resultHashVerified: job.result?.hashVerified === true,
  };
  return {
    status: Object.values(checks).every(Boolean) ? "verified" : "mismatch",
    source: "onchain:bsc-testnet-rpc",
    observedAt: new Date().toISOString(),
    observedState: job.status,
    buyer: job.buyer,
    seller: job.provider,
    agentWallet: job.provider,
    paymentToken: job.quotedToken,
    budgetRaw: job.budgetRaw,
    deadline,
    submittedAt,
    deliverableHash: job.deliverableHash,
    transactions: {},
    checks,
    error: null,
  };
}
