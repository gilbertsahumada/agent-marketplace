import type { MarketplaceCategory } from "./marketplace-agent.js";

export type PublicVerificationFreshness = "current" | "stale";

export interface PublicAgentVerification {
  agentId: string;
  name: string;
  categories: MarketplaceCategory[];
  operator: "third_party" | "marketplace";
  qualification: {
    status: "qualified" | "not_qualified" | "unavailable";
    observedAt: string;
    provenance: "derived:marketplace-seller-qualification";
  };
  identity: {
    status: "match" | "mismatch" | "read_error";
    mismatchFields: Array<"owner" | "metadata_uri">;
    observedAt: string;
    provenance: readonly ["declared", "onchain"];
  };
  tools: {
    status: "observed" | "not_probed";
    probeOutcomes: Array<
      | "protocol_valid"
      | "no_tools"
      | "unauthorized"
      | "timeout"
      | "unsafe_url"
      | "http_error"
      | "protocol_error"
      | "not_probed"
    >;
    reachability: "verified" | "failed" | "not_probed";
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
