import { MarketplaceLanding } from "@/components/marketplace/landing-page";
import type { CategoryCardViewModel } from "@/components/marketplace/presentation-types";
import { catalogCandidateCard } from "@/components/marketplace/catalog-candidate-view-model";
import { ledgerPulseViewModel } from "@/components/marketplace/ledger-pulse-view-model";
import { getCatalogCandidatePage, getHireLedger, getMainnetJobProof, isConciergeConfigured, listMarketplaceAgents } from "@/src/business/composition";

export const dynamic = "force-dynamic";

const categoryCopy = {
  rebalancing: ["Rebalancing", "Maintain a target allocation or liquidity position as market conditions change."],
  grid_trading: ["Grid trading", "Place disciplined orders across a price range with clearly bounded execution rules."],
  yield_optimisation: ["Yield optimisation", "Evaluate and manage yield opportunities without turning projections into guarantees."],
  health_factor_monitoring: ["Health factor monitoring", "Track lending risk and surface conditions that may require user action."],
} as const;

// A short trailing window: the hero reads as a pulse, /jobs keeps the 30-day view.
const LEDGER_PULSE_DAYS = 7;

export default async function HomePage() {
  // The ledger readers answer null when the observation Worker cannot be
  // read; the landing then says activity is unavailable instead of zeros.
  const [catalog, normalizedCatalog, ledgerSummary, ledgerActivity, ledgerPage] = await Promise.all([
    listMarketplaceAgents.execute({ view: "marketplace", page: 1, limit: 12 }),
    getCatalogCandidatePage({ status: "declared", page: 1, limit: 12 }),
    getHireLedger.summary({ chainId: 56 }),
    getHireLedger.activity({ chainId: 56, days: LEDGER_PULSE_DAYS }),
    getHireLedger.listRecentJobs({ chainId: 56 }),
  ]);
  const mainnetProof = getMainnetJobProof.execute();
  const categories: CategoryCardViewModel[] = catalog.categories.map(({ category, count, status }) => ({
    category,
    title: categoryCopy[category][0],
    description: categoryCopy[category][1],
    href: `/agents?view=marketplace&category=${category}`,
    availability: status === "unverified" ? "empty" : "listed",
    availabilityLabel: status === "unverified" ? "Unverified · empty" : `${count} candidate${count === 1 ? "" : "s"}`,
  }));
  const now = Date.now();
  const ledgerPulse = ledgerPulseViewModel({ summary: ledgerSummary, activity: ledgerActivity, page: ledgerPage }, now);
  const featuredAgents = normalizedCatalog?.items.map((agent) => catalogCandidateCard(agent, now)) ?? [];
  const qualified = featuredAgents.find((agent) => agent.hireability === "hireable") ?? null;
  return (
    <MarketplaceLanding
      categories={categories}
      conciergeEnabled={isConciergeConfigured()}
      featuredAgents={featuredAgents}
      ledgerPulse={ledgerPulse}
      proofSummary={mainnetProof ? {
        href: "/proof/mainnet",
        title: "Grid plan for BNB/USDT",
        description: `Requested, paid, delivered and paid out on BNB Chain. The result was checked against what the agent committed to. Task #${mainnetProof.jobId}.`,
      } : null}
      qualifiedSeller={qualified ? { agentId: qualified.agentId, name: qualified.name } : null}
    />
  );
}
