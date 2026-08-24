import type { PublicVerificationSnapshot } from "../entities/public-verification-snapshot.js";
import type { MarketplaceCategorySummary } from "../entities/marketplace-agent.js";
import { MARKETPLACE_CATEGORIES } from "../entities/marketplace-agent.js";
import type { GetPublicVerificationSnapshot } from "./get-public-verification-snapshot.js";

export interface MarketplaceLandingCatalog {
  source: "release_snapshot";
  snapshot: PublicVerificationSnapshot;
  categories: MarketplaceCategorySummary[];
}

export class GetMarketplaceLandingCatalog {
  constructor(private readonly getSnapshot: GetPublicVerificationSnapshot) {}

  execute(): MarketplaceLandingCatalog {
    const snapshot = this.getSnapshot.execute();
    return {
      source: "release_snapshot",
      snapshot,
      categories: MARKETPLACE_CATEGORIES.map((category) => {
        const count = snapshot.agents.filter((agent) => agent.categories.includes(category)).length;
        return { category, count, status: count > 0 ? "candidates" as const : "unverified" as const };
      }),
    };
  }
}
