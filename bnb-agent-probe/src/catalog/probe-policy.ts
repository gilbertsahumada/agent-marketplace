import type { WorkerConfig } from "../config";
import type { CatalogProbeProtocol, CatalogProbeTarget } from "../phases/catalog-probe";

const MINUTE = 60_000;

export interface CatalogProbeSchedulePolicy {
  readonly priorityRefreshMs: number;
  readonly refreshMsByProtocol: Readonly<Record<CatalogProbeProtocol, number>>;
  readonly failureBackoffMs: readonly number[];
}

export function catalogProbeSchedulePolicy(config: WorkerConfig): CatalogProbeSchedulePolicy {
  return {
    priorityRefreshMs: config.catalogPriorityRefreshMinutes * MINUTE,
    refreshMsByProtocol: {
      a2a: config.catalogA2aRefreshMinutes * MINUTE,
      mcp: config.catalogMcpRefreshMinutes * MINUTE,
      erc8183_http: config.catalogErc8183RefreshMinutes * MINUTE,
    },
    failureBackoffMs: config.catalogFailureBackoffMinutes.map((minutes) => minutes * MINUTE),
  };
}

export function catalogProbeTimeoutMs(config: WorkerConfig, protocol: CatalogProbeProtocol): number {
  if (protocol === "a2a") return config.catalogA2aTimeoutMs;
  if (protocol === "mcp") return config.catalogMcpTimeoutMs;
  return config.catalogErc8183TimeoutMs;
}

export function catalogProbeFreshnessMs(config: WorkerConfig, target: CatalogProbeTarget): number {
  const policy = catalogProbeSchedulePolicy(config);
  return target.priority >= 100 ? policy.priorityRefreshMs : policy.refreshMsByProtocol[target.protocol];
}
