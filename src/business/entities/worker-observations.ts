export const OBSERVATION_CATEGORIES = [
  "rebalancing", "grid_trading", "yield_optimisation", "health_factor_monitoring",
] as const;
export type ObservationCategory = typeof OBSERVATION_CATEGORIES[number];
export interface WorkerObservation {
  probedAt: number;
  probeCategory: ObservationCategory | null;
  outcome: "quote_verified" | "protocol_valid" | "quote_rejected" | "quote_invalid" | "reachable" | "unreachable" | "unsafe_url" | "error";
  quoteExpiresAt: number | null;
  observedMetadataUpdatedAt: number | null;
  quoteNegotiatedAt: number | null;
  errorCode: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
}
export interface WorkerObservationTarget {
  agentId: string;
  chainId: 56;
  transport: "a2a" | "erc8183_http";
  endpoint: string;
  name: string | null;
  categories: ObservationCategory[];
  declarationState: "current" | "removed" | "metadata_unavailable";
  currentMetadataUpdatedAt: number | null;
  lastMetadataCheckedAt: number;
  attemptCount?: number;
  firstProbedAt?: number | null;
  lastProbedAt?: number | null;
  latest: WorkerObservation | null;
  latestByCategory: Partial<Record<ObservationCategory, WorkerObservation>>;
}
export interface WorkerObservationFeed {
  schemaVersion: 1;
  generatedAt: number;
  monitoring?: {
    lastSchedulerAttemptAt: number | null;
    lastSchedulerPhase: "header" | "sweep" | "probe" | null;
    lastSchedulerOutcome: "completed" | "failed" | "duplicate" | "locked" | null;
    producerEnabled?: boolean;
    consumerEnabled?: boolean;
    cronIntervalMinutes?: number;
  };
  targets: WorkerObservationTarget[];
}
export type ObservationFeedResult =
  | { status: "available"; feed: WorkerObservationFeed }
  | { status: "unavailable"; feed: null };

export function observationTargetsByAgentId(
  feed: WorkerObservationFeed | null,
): Map<string, WorkerObservationTarget[]> {
  const grouped = new Map<string, WorkerObservationTarget[]>();
  for (const target of feed?.targets ?? []) {
    grouped.set(target.agentId, [...(grouped.get(target.agentId) ?? []), target]);
  }
  return grouped;
}
