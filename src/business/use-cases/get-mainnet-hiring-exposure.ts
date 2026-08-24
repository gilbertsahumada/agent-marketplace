import type { MainnetDemoPublicConfig } from "../entities/mainnet-browser-demo.js";
import type { PublicVerificationSnapshot } from "../entities/public-verification-snapshot.js";
import {
  Erc8183SpikeDisabledError,
  Erc8183SpikeUnavailableError,
} from "../errors/erc8183-spike-errors.js";
import { hireableReleaseAgents } from "../policies/release-qualification-policy.js";

export interface MainnetHiringSnapshotReader {
  getSnapshot(): PublicVerificationSnapshot;
}

export interface MainnetHiringConfigReader {
  getPublicConfig(): MainnetDemoPublicConfig;
}

export interface MainnetHiringExposure {
  qualifiedSeller: { agentId: string; name: string } | null;
  demoConfig: MainnetDemoPublicConfig | null;
}

export class GetMainnetHiringExposure {
  constructor(
    private readonly snapshots: MainnetHiringSnapshotReader,
    private readonly configs: MainnetHiringConfigReader,
    private readonly now: () => number = Date.now,
  ) {}

  execute(): MainnetHiringExposure {
    const qualified = hireableReleaseAgents(this.snapshots.getSnapshot(), this.now());
    const qualifiedSeller = qualified[0] ?? null;
    const operatedSeller = qualified.find((agent) => agent.operator === "marketplace") ?? null;
    if (!operatedSeller) {
      return {
        qualifiedSeller: qualifiedSeller
          ? { agentId: qualifiedSeller.agentId, name: qualifiedSeller.name }
          : null,
        demoConfig: null,
      };
    }

    try {
      const demoConfig = this.configs.getPublicConfig();
      return {
        qualifiedSeller: { agentId: qualifiedSeller!.agentId, name: qualifiedSeller!.name },
        demoConfig: String(demoConfig.agentId) === operatedSeller.agentId ? demoConfig : null,
      };
    } catch (error) {
      if (!(error instanceof Erc8183SpikeDisabledError) && !(error instanceof Erc8183SpikeUnavailableError)) {
        throw error;
      }
      return {
        qualifiedSeller: { agentId: qualifiedSeller!.agentId, name: qualifiedSeller!.name },
        demoConfig: null,
      };
    }
  }
}
