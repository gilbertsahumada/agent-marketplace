import { keccak256, toBytes } from "viem";
import type { AgentEvidencePassport, EvidencePassportCheck, EvidencePassportState } from "../entities/evidence-passport.ts";
import type { HireabilityStatus, MarketplaceAgent } from "../entities/marketplace-agent.ts";
import type { MainnetJobProof } from "../entities/mainnet-job-proof.ts";
import type { PublicAgentVerification, PublicVerificationSnapshot } from "../entities/public-verification-snapshot.ts";
import { isReleaseAgentHireable, isVerificationSnapshotCurrent } from "./release-qualification-policy.ts";

export interface EvidencePassportInput {
  chainId: 56;
  agentId: string;
  name: string;
  operator: "third_party" | "marketplace";
  indexedAt: string;
  onchainIdentity: {
    status: "not_requested" | "match" | "mismatch" | "unavailable";
    observedAt: string | null;
    blockNumber: string | null;
  };
  verification: {
    freshness: "current" | "stale";
    identityStatus: "match" | "mismatch" | "read_error";
    endpointStatus: "verified" | "failed" | "not_probed";
    observedAt: string;
    staleAfter: string;
  } | null;
  hireability: {
    canHire: boolean;
    status: HireabilityStatus;
    observedAt: string;
  };
  jobProofs: MainnetJobProof[];
  generatedAt: string;
}

export function deriveAgentPassportState(
  agent: MarketplaceAgent,
  provenAgentId?: string,
): EvidencePassportState {
  if (
    agent.onchainIdentity.status === "mismatch"
    || agent.onchainIdentity.status === "unavailable"
    || agent.verification?.freshness === "stale"
    || agent.verification?.identity.status === "mismatch"
    || agent.verification?.identity.status === "read_error"
    || agent.verification?.identity.walletAttribution?.status === "ambiguous"
    || agent.verification?.tools.reachability === "failed"
  ) return "attention";
  if (agent.onchainIdentity.status === "match" && agent.agentId === provenAgentId) return "job_proven";
  if (agent.hireability.canHire) return "hireable";
  if (
    agent.verification?.freshness === "current"
    && agent.verification.identity.status === "match"
    && agent.verification.tools.reachability === "verified"
  ) return "evaluated";
  return "registered";
}

export function deriveSnapshotAgentPassportState(
  agent: PublicAgentVerification,
  snapshot: PublicVerificationSnapshot,
  now: number,
  provenAgentId?: string,
): EvidencePassportState {
  if (
    !isVerificationSnapshotCurrent(snapshot, now)
    || agent.identity.status === "mismatch"
    || agent.identity.status === "read_error"
    || agent.tools.reachability === "failed"
  ) return "attention";
  if (agent.identity.status === "match" && agent.agentId === provenAgentId) return "job_proven";
  if (isReleaseAgentHireable(agent, snapshot, now)) return "hireable";
  if (agent.identity.status === "match" && agent.tools.reachability === "verified") return "evaluated";
  return "registered";
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function identityCheck(input: EvidencePassportInput): EvidencePassportCheck {
  if (input.onchainIdentity.status === "match") {
    return {
      status: "verified",
      provenance: "onchain",
      observedAt: input.onchainIdentity.observedAt,
      detail: "The indexed identity matches a direct BSC ERC-8004 read.",
    };
  }
  if (input.onchainIdentity.status === "mismatch") {
    return {
      status: "failed",
      provenance: "onchain",
      observedAt: input.onchainIdentity.observedAt,
      detail: "The indexed identity does not match the direct BSC ERC-8004 read.",
    };
  }
  return {
    status: "unavailable",
    provenance: "unavailable",
    observedAt: input.onchainIdentity.observedAt,
    detail: "A direct BSC ERC-8004 identity match is not currently available.",
  };
}

function endpointCheck(input: EvidencePassportInput): EvidencePassportCheck {
  const verification = input.verification;
  if (
    verification?.freshness === "stale"
    && (verification.endpointStatus === "verified" || input.hireability.status === "quote_verified")
  ) {
    return {
      status: "stale",
      provenance: "observed",
      observedAt: input.hireability.status === "quote_verified"
        ? input.hireability.observedAt
        : verification.observedAt,
      detail: "The endpoint observation exists but is outside its freshness window.",
    };
  }
  if (input.hireability.status === "quote_verified") {
    return {
      status: "verified",
      provenance: "observed",
      observedAt: input.hireability.observedAt,
      detail: "The seller endpoint returned a signed ERC-8183 quote that passed marketplace validation.",
    };
  }
  if (!verification || verification.endpointStatus === "not_probed") {
    return {
      status: "not_probed",
      provenance: "not_probed",
      observedAt: verification?.observedAt ?? null,
      detail: "The marketplace has not completed a bounded endpoint probe.",
    };
  }
  if (verification.freshness === "stale") {
    return {
      status: "stale",
      provenance: "observed",
      observedAt: verification.observedAt,
      detail: "The endpoint observation exists but is outside its freshness window.",
    };
  }
  return verification.endpointStatus === "verified"
    ? {
        status: "verified",
        provenance: "observed",
        observedAt: verification.observedAt,
        detail: "The marketplace observed a protocol-valid endpoint response.",
      }
    : {
        status: "failed",
        provenance: "observed",
        observedAt: verification.observedAt,
        detail: "A bounded probe did not establish a protocol-valid endpoint response.",
      };
}

function quoteCheck(input: EvidencePassportInput): AgentEvidencePassport["checks"]["quote"] {
  if (input.hireability.status === "quote_stale") {
    return {
      status: "stale",
      provenance: "observed",
      observedAt: input.hireability.observedAt,
      detail: "A signed ERC-8183 quote was verified previously, but it is outside the 60-second hireable-now window.",
      hireabilityStatus: input.hireability.status,
    };
  }
  if (input.verification?.freshness === "stale" && input.hireability.status === "quote_verified") {
    return {
      status: "stale",
      provenance: "observed",
      observedAt: input.hireability.observedAt,
      detail: "A quote was verified previously, but its qualification evidence is stale.",
      hireabilityStatus: input.hireability.status,
    };
  }
  return input.hireability.status === "quote_verified"
    ? {
        status: "verified",
        provenance: "observed",
        observedAt: input.hireability.observedAt,
        detail: "A current signed ERC-8183 quote passed marketplace qualification.",
        hireabilityStatus: input.hireability.status,
      }
    : {
        status: "missing",
        provenance: "derived",
        observedAt: input.hireability.observedAt,
        detail: "No current signed ERC-8183 quote qualifies this agent for hiring.",
        hireabilityStatus: input.hireability.status,
      };
}

export function buildEvidencePassport(input: EvidencePassportInput): AgentEvidencePassport {
  const proofsByJob = new Map<string, MainnetJobProof>();
  for (const proof of input.jobProofs.filter(
    (candidate) => candidate.chainId === input.chainId && candidate.agentId === input.agentId,
  )) {
    const key = `${proof.chainId}:${proof.jobId}`;
    const existing = proofsByJob.get(key);
    if (existing && canonicalJson(existing) !== canonicalJson(proof)) {
      throw new Error(`Evidence Passport contains conflicting proofs for job ${proof.jobId}`);
    }
    if (!existing) proofsByJob.set(key, proof);
  }
  const jobProofs = [...proofsByJob.values()]
    .sort((left, right) => {
      const timestampOrder = Date.parse(right.capturedAt) - Date.parse(left.capturedAt);
      if (timestampOrder !== 0) return timestampOrder;
      if (/^\d+$/.test(left.jobId) && /^\d+$/.test(right.jobId)) {
        const leftId = BigInt(left.jobId);
        const rightId = BigInt(right.jobId);
        return leftId === rightId ? 0 : rightId > leftId ? 1 : -1;
      }
      return right.jobId.localeCompare(left.jobId);
    });
  const latestJob = jobProofs[0] ?? null;
  const identity = identityCheck(input);
  const endpoint = endpointCheck(input);
  const quote = quoteCheck(input);
  const job: EvidencePassportCheck = latestJob
    ? {
        status: "verified",
        provenance: "onchain",
        observedAt: latestJob.capturedAt,
        detail: `ERC-8183 Job ${latestJob.jobId} has a hash-verified deterministic result.`,
      }
    : {
        status: "missing",
        provenance: "onchain",
        observedAt: null,
        detail: "No hash-verified BSC Mainnet job is linked to this agent.",
      };

  const attentionReasons: string[] = [];
  if (input.verification?.freshness === "stale") attentionReasons.push("Verification evidence is stale.");
  if (input.verification?.freshness === "current" && input.verification.endpointStatus === "failed") {
    attentionReasons.push("The bounded endpoint evaluation failed.");
  }
  if (input.onchainIdentity.status === "mismatch" || input.verification?.identityStatus === "mismatch") {
    attentionReasons.push("Indexed identity does not match the direct BSC read.");
  }
  if (input.onchainIdentity.status === "unavailable" || input.verification?.identityStatus === "read_error") {
    attentionReasons.push("Direct BSC identity evidence is currently unavailable.");
  }
  if (input.hireability.status === "wallet_ambiguous") {
    attentionReasons.push("Seller wallet attribution is ambiguous across the evaluated Agent IDs.");
  }

  let state: EvidencePassportState = "registered";
  if (endpoint.status === "verified" && identity.status === "verified") state = "evaluated";
  if (quote.status === "verified" && input.hireability.canHire && identity.status === "verified") state = "hireable";
  if (latestJob && identity.status === "verified") state = "job_proven";
  if (attentionReasons.length > 0) state = "attention";

  const trackRecord = {
    provenJobs: jobProofs.length,
    sampleSize: jobProofs.length,
    submittedJobs: jobProofs.filter(({ finalState }) => finalState === "SUBMITTED").length,
    completedJobs: jobProofs.filter(({ finalState }) => finalState === "COMPLETED").length,
    latestJobId: latestJob?.jobId ?? null,
    latestCapturedAt: latestJob?.capturedAt ?? null,
    latestDurationSeconds: latestJob?.durationSeconds ?? null,
    latestGasCostWei: latestJob?.totalGasCostWei ?? null,
  };
  const nextRequirements = state === "attention"
    ? [...attentionReasons]
    : state === "registered"
      ? ["Run a bounded marketplace endpoint evaluation."]
      : state === "evaluated"
        ? [quote.status === "verified"
            ? "Submit this evidence snapshot for marketplace promotion review."
            : "Verify a current signed ERC-8183 quote."]
        : state === "hireable"
          ? ["Complete and verify an ERC-8183 job on BSC."]
          : [];
  const evidenceSnapshotHash = keccak256(toBytes(canonicalJson({
    schemaVersion: 1,
    chainId: input.chainId,
    agentId: input.agentId,
    operator: input.operator,
    indexedAt: input.indexedAt,
    onchainIdentity: input.onchainIdentity,
    verification: input.verification,
    hireability: input.hireability,
    jobProofs,
  })));

  return {
    schemaVersion: 1,
    chainId: input.chainId,
    agentId: input.agentId,
    name: input.name,
    operator: input.operator,
    state,
    evidenceSnapshotHash,
    generatedAt: input.generatedAt,
    attentionReasons,
    checks: { identity, endpoint, quote, job },
    trackRecord,
    nextRequirements,
  };
}
