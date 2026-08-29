export const OBSERVATION_CATEGORIES = [
  "rebalancing", "grid_trading", "yield_optimisation", "health_factor_monitoring",
] as const;
export type ObservationCategory = typeof OBSERVATION_CATEGORIES[number];
export interface WorkerObservation {
  probedAt: number;
  probeCategory: ObservationCategory | null;
  outcome: "quote_verified" | "protocol_valid" | "quote_rejected" | "quote_invalid" | "reachable" | "unreachable" | "unsafe_url" | "error";
  quoteExpiresAt: number | null;
  errorCode: string | null;
}
export interface WorkerObservationTarget {
  agentId: string;
  name: string | null;
  categories: ObservationCategory[];
  declarationState: "current" | "removed" | "metadata_unavailable";
  latest: WorkerObservation | null;
  latestByCategory: Partial<Record<ObservationCategory, WorkerObservation>>;
}
export interface WorkerObservationFeed {
  schemaVersion: 1;
  generatedAt: number;
  targets: WorkerObservationTarget[];
}
export type ObservationFeedResult =
  | { status: "available"; feed: WorkerObservationFeed }
  | { status: "unavailable"; feed: null };
