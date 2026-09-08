// Marketplace-operated sellers on the fixed production origin. The Worker
// probes each one with the exact A2A message route its Agent Card must
// declare; Agent IDs are filled in after each ERC-8004 registration.
// This module intentionally has no imports so it stays Worker-safe.

export interface HostedSellerManifestEntry {
  readonly slug: "grid" | "rebalance" | "yield" | "loan-health";
  readonly agentId: string | null;
  readonly endpoint: string;
  readonly messageUrl: string;
  readonly category: "grid_trading" | "rebalancing" | "yield_optimisation" | "health_factor_monitoring";
}

export const HOSTED_SELLER_ORIGIN = "https://bnb-agent-marketplace-ruby.vercel.app";

export const HOSTED_SELLERS: readonly HostedSellerManifestEntry[] = [
  { slug: "grid", agentId: "303779", endpoint: `${HOSTED_SELLER_ORIGIN}/grid`, messageUrl: `${HOSTED_SELLER_ORIGIN}/api/sellers/grid/a2a`, category: "grid_trading" },
  { slug: "rebalance", agentId: "341563", endpoint: `${HOSTED_SELLER_ORIGIN}/rebalance`, messageUrl: `${HOSTED_SELLER_ORIGIN}/api/sellers/rebalance/a2a`, category: "rebalancing" },
  { slug: "yield", agentId: "341564", endpoint: `${HOSTED_SELLER_ORIGIN}/yield`, messageUrl: `${HOSTED_SELLER_ORIGIN}/api/sellers/yield/a2a`, category: "yield_optimisation" },
  { slug: "loan-health", agentId: "341565", endpoint: `${HOSTED_SELLER_ORIGIN}/loan-health`, messageUrl: `${HOSTED_SELLER_ORIGIN}/api/sellers/loan-health/a2a`, category: "health_factor_monitoring" },
];

/** The message route a hosted seller's card must declare, or null for any other endpoint. */
export function expectedHostedSellerMessageUrl(endpoint: string, agentId: string): string | null {
  const entry = HOSTED_SELLERS.find((seller) => seller.endpoint === endpoint && seller.agentId === agentId);
  return entry?.messageUrl ?? null;
}
