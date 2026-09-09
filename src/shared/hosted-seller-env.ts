// Environment variable names for the marketplace-operated sellers. Pure and
// dependency-free so the Worker manifest generator, the readiness CLI and the
// server config can all agree on them.

export type HostedSellerSlugLike = "grid" | "rebalance" | "yield" | "loan-health";

export const HOSTED_SELLER_SLUGS_ORDERED: readonly HostedSellerSlugLike[] = ["grid", "rebalance", "yield", "loan-health"];

// The Grid seller keeps its original variable names; the others carry their
// slug in the name. One wallet per seller keeps provider attribution unambiguous.
// Only public identity names live here; the signer variable is named in the
// server-only config so no client-reachable module mentions it.
export function hostedSellerEnvKey(slug: HostedSellerSlugLike): string | null {
  return slug === "grid" ? null : ({ rebalance: "REBALANCE", yield: "YIELD", "loan-health": "HEALTH" } as const)[slug];
}

export function hostedSellerEnvNames(slug: HostedSellerSlugLike): { address: string; agentId: string } {
  const key = hostedSellerEnvKey(slug);
  if (key === null) {
    return { address: "ERC8183_MAINNET_SELLER_ADDRESS", agentId: "ERC8183_MAINNET_SELLER_AGENT_ID" };
  }
  return { address: `ERC8183_MAINNET_SELLER_${key}_ADDRESS`, agentId: `ERC8183_MAINNET_SELLER_${key}_AGENT_ID` };
}

/** Public wallet addresses of every configured seller; never reads keys. */
export function configuredHostedSellerAddresses(
  env: Readonly<Record<string, string | undefined>>,
  slugs: readonly HostedSellerSlugLike[] = HOSTED_SELLER_SLUGS_ORDERED,
): Array<{ slug: HostedSellerSlugLike; address: string }> {
  return slugs.flatMap((slug) => {
    const raw = Reflect.get(env, hostedSellerEnvNames(slug).address)?.trim();
    return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? [{ slug, address: raw }] : [];
  });
}

/** Agent IDs of every seller whose identity is configured; never reads keys. */
export function configuredHostedSellerAgentIds(
  env: Readonly<Record<string, string | undefined>>,
  slugs: readonly HostedSellerSlugLike[] = HOSTED_SELLER_SLUGS_ORDERED,
): Array<{ slug: HostedSellerSlugLike; agentId: string }> {
  return slugs.flatMap((slug) => {
    const raw = Reflect.get(env, hostedSellerEnvNames(slug).agentId)?.trim();
    return raw && /^\d+$/.test(raw) && BigInt(raw) > 0n ? [{ slug, agentId: BigInt(raw).toString() }] : [];
  });
}
