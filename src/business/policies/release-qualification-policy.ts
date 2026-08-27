import type {
  PublicAgentVerification,
  PublicVerificationSnapshot,
} from "../entities/public-verification-snapshot.ts";

export const VERIFICATION_CLOCK_SKEW_MS = 5 * 60 * 1_000;
export const MAX_RELEASE_QUOTE_AGE_MS = 60 * 1_000;

export function isReleaseQuoteCurrent(
  observedAt: string,
  now = Date.now(),
): boolean {
  const observedAtMs = Date.parse(observedAt);
  return Number.isFinite(observedAtMs)
    && observedAtMs <= now + VERIFICATION_CLOCK_SKEW_MS
    && now - observedAtMs <= MAX_RELEASE_QUOTE_AGE_MS;
}

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
    && agent.selection !== "operator_explicit"
    && isReleaseQuoteCurrent(agent.qualification.observedAt, now);
}
