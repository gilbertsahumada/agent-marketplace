import type { HireabilityStatus } from "./marketplace-agent.ts";

export type EvidencePassportState =
  | "registered"
  | "evaluated"
  | "hireable"
  | "job_proven"
  | "attention";

export type PassportCheckStatus =
  | "verified"
  | "missing"
  | "not_probed"
  | "failed"
  | "unavailable"
  | "stale";

export interface EvidencePassportCheck {
  status: PassportCheckStatus;
  provenance: "onchain" | "observed" | "derived" | "not_probed" | "unavailable";
  observedAt: string | null;
  detail: string;
}

export interface AgentEvidencePassport {
  schemaVersion: 1;
  chainId: 56;
  agentId: string;
  name: string;
  operator: "third_party" | "marketplace";
  state: EvidencePassportState;
  evidenceSnapshotHash: `0x${string}`;
  generatedAt: string;
  attentionReasons: string[];
  checks: {
    identity: EvidencePassportCheck;
    endpoint: EvidencePassportCheck;
    quote: EvidencePassportCheck & { hireabilityStatus: HireabilityStatus };
    job: EvidencePassportCheck;
  };
  trackRecord: {
    provenJobs: number;
    sampleSize: number;
    submittedJobs: number;
    completedJobs: number;
    latestJobId: string | null;
    latestCapturedAt: string | null;
    latestDurationSeconds: string | null;
    latestGasCostWei: string | null;
  };
  nextRequirements: string[];
}
