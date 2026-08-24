import type { PublicVerificationSnapshot } from "../entities/public-verification-snapshot.js";
import type { MarketplaceCategorySummary } from "../entities/marketplace-agent.js";
import { MARKETPLACE_CATEGORIES } from "../entities/marketplace-agent.js";
import type { GetPublicVerificationSnapshot } from "./get-public-verification-snapshot.js";
import { hireableReleaseAgents } from "../policies/release-qualification-policy.js";

export interface MarketplaceLandingCatalog {
  source: "release_snapshot";
  snapshot: PublicVerificationSnapshot;
  categories: MarketplaceCategorySummary[];
  qualifiedSeller: { agentId: string; name: string } | null;
}

export class GetMarketplaceLandingCatalog {
  constructor(
    private readonly getSnapshot: GetPublicVerificationSnapshot,
    private readonly now: () => number = Date.now,
  ) {}

  execute(): MarketplaceLandingCatalog {
    const snapshot = this.getSnapshot.execute();
    const qualifiedSeller = hireableReleaseAgents(snapshot, this.now())[0] ?? null;
    return {
      source: "release_snapshot",
      snapshot,
      qualifiedSeller: qualifiedSeller
        ? { agentId: qualifiedSeller.agentId, name: qualifiedSeller.name }
        : null,
      categories: MARKETPLACE_CATEGORIES.map((category) => {
        const count = snapshot.agents.filter((agent) => agent.categories.includes(category)).length;
        return { category, count, status: count > 0 ? "candidates" as const : "unverified" as const };
      }),
    };
  }
}
