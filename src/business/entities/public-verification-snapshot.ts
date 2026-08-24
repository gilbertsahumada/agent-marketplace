import type { MarketplaceCategory } from "./marketplace-agent.js";

export type PublicVerificationFreshness = "current" | "stale";

export interface PublicAgentVerification {
  agentId: string;
  name: string;
  categories: MarketplaceCategory[];
  identity: {
    status: "match" | "mismatch" | "read_error";
    mismatchFields: Array<"owner" | "metadata_uri">;
    observedAt: string;
    provenance: readonly ["declared", "onchain"];
  };
  tools: {
    status: "observed" | "not_probed";
    declaredOnly: string[];
    observedOnly: string[];
    observedAt: string | null;
    provenance: "observed" | "not_probed";
  };
}

export interface PublicVerificationSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  staleAfter: string;
  chainId: 56;
  blockNumber: string;
  registryAddress: string;
  source: "marketplace-verification-release-snapshot";
  agents: PublicAgentVerification[];
}
