import type { MainnetDemoPublicConfig } from "../entities/mainnet-browser-demo.ts";
import type { ObservationFeedResult, WorkerObservationTarget } from "../entities/worker-observations.ts";
import {
  Erc8183SpikeDisabledError,
  Erc8183SpikeUnavailableError,
} from "../errors/erc8183-spike-errors.ts";

export interface MainnetHiringObservationReader {
  getObservations(): Promise<ObservationFeedResult>;
}

export interface MainnetHiringConfigReader {
  getPublicConfig(): MainnetDemoPublicConfig;
}

export interface MainnetHiringExposure {
  qualifiedSeller: { agentId: string; name: string } | null;
  demoConfig: MainnetDemoPublicConfig | null;
}

const OBSERVATION_MAX_AGE_MS = 60_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5_000;

export class GetMainnetHiringExposure {
  constructor(
    private readonly observations: MainnetHiringObservationReader,
    private readonly configs: MainnetHiringConfigReader,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(): Promise<MainnetHiringExposure> {
    const result = await this.observations.getObservations();
    if (result.status === "unavailable") return unavailable();
    const now = this.now();
    if (result.feed.generatedAt > now + MAX_FUTURE_CLOCK_SKEW_MS
      || now - result.feed.generatedAt > OBSERVATION_MAX_AGE_MS) return unavailable();
    let demoConfig: MainnetDemoPublicConfig;
    try {
      demoConfig = this.configs.getPublicConfig();
    } catch (error) {
      if (!(error instanceof Erc8183SpikeDisabledError) && !(error instanceof Erc8183SpikeUnavailableError)) {
        throw error;
      }
      return unavailable();
    }

    const targets = result.feed.targets.filter((target) =>
      target.agentId === String(demoConfig.agentId)
      && target.declarationState === "current"
      && endpointOrigin(target.endpoint) === demoConfig.sellerOrigin,
    );
    const seller = targets[0] ?? null;
    return {
      qualifiedSeller: seller === null ? null : {
        agentId: seller.agentId,
        name: seller.name ?? `Agent ${seller.agentId}`,
      },
      demoConfig: targets.some((target) => hasCurrentQuote(target, now)) ? demoConfig : null,
    };
  }
}

function endpointOrigin(endpoint: string): string | null {
  try {
    return new URL(endpoint).origin;
  } catch {
    return null;
  }
}

function hasCurrentQuote(target: WorkerObservationTarget, now: number): boolean {
  const latest = target.latestByCategory.grid_trading ?? null;
  return latest?.outcome === "quote_verified"
    && latest.probedAt <= now
    && now - latest.probedAt <= OBSERVATION_MAX_AGE_MS
    && latest.quoteNegotiatedAt !== null
    && latest.quoteNegotiatedAt <= now
    && now - latest.quoteNegotiatedAt <= OBSERVATION_MAX_AGE_MS
    && latest.quoteExpiresAt !== null
    && latest.quoteExpiresAt > now
    && target.currentMetadataUpdatedAt === latest.observedMetadataUpdatedAt;
}

function unavailable(): MainnetHiringExposure {
  return { qualifiedSeller: null, demoConfig: null };
}
