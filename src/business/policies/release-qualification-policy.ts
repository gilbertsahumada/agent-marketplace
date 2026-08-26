import type {
  PublicAgentVerification,
  PublicVerificationSnapshot,
} from "../entities/public-verification-snapshot.ts";

export const VERIFICATION_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export function isVerificationSnapshotCurrent(
  snapshot: PublicVerificationSnapshot,
  now = Date.now(),
): boolean {
  return Date.parse(snapshot.generatedAt) <= now + VERIFICATION_CLOCK_SKEW_MS
    && now <= Date.parse(snapshot.staleAfter);
}

export function hireableReleaseAgents(
  snapshot: PublicVerificationSnapshot,
  now = Date.now(),
): PublicAgentVerification[] {
  if (!isVerificationSnapshotCurrent(snapshot, now)) return [];
  return snapshot.agents.filter((agent) => isReleaseAgentHireable(agent, snapshot, now));
}

export function isReleaseAgentHireable(
  agent: PublicAgentVerification,
  snapshot: PublicVerificationSnapshot,
  now = Date.now(),
): boolean {
  return isVerificationSnapshotCurrent(snapshot, now)
    && agent.qualification.status === "qualified"
    && agent.selection !== "operator_explicit";
}
