import { MarketplaceLanding } from "@/components/marketplace/landing-page";
import type { CategoryCardViewModel, EvidenceStepViewModel } from "@/components/marketplace/presentation-types";
import { agentCardViewModel } from "@/components/marketplace/view-models";
import { getPublicJobProof, listMarketplaceAgents } from "@/src/business/composition";

export const dynamic = "force-dynamic";

const categoryCopy = {
  rebalancing: ["Rebalancing", "Maintain a target allocation or liquidity position as market conditions change."],
  grid_trading: ["Grid trading", "Place disciplined orders across a price range with clearly bounded execution rules."],
  yield_optimisation: ["Yield optimisation", "Evaluate and manage yield opportunities without turning projections into guarantees."],
  health_factor_monitoring: ["Health factor monitoring", "Track lending risk and surface conditions that may require user action."],
} as const;

export default async function HomePage() {
  const [catalog, proof] = await Promise.all([
    listMarketplaceAgents.execute({ view: "marketplace", page: 1, limit: 12 }),
    getPublicJobProof.execute({ jobId: "551" }),
  ]);
  const categories: CategoryCardViewModel[] = catalog.categories.map(({ category, count, status }) => ({
    category,
    title: categoryCopy[category][0],
    description: categoryCopy[category][1],
    href: `/agents?view=marketplace&category=${category}`,
    availability: status === "unverified" ? "empty" : "listed",
    availabilityLabel: status === "unverified" ? "Unverified · empty" : `${count} candidate${count === 1 ? "" : "s"}`,
  }));
  const publicProof: EvidenceStepViewModel[] = [
    { kind: "declared", label: "Declared", status: "verified", provenance: "declared", detail: "Controlled test seller identity and terms were recorded.", source: proof.snapshot.source, timestamp: proof.snapshot.recordedAt },
    { kind: "reachable", label: "Reachable", status: "verified", provenance: "observed", detail: "The A2A seller completed negotiation and funding notification.", timestamp: proof.snapshot.transactions.fund.timestamp },
    { kind: "quote", label: "Quote verified", status: "verified", provenance: "observed", detail: "The buyer accepted a compatible signed quote.", timestamp: proof.snapshot.transactions.createJob.timestamp },
    { kind: "job", label: "Job proven", status: "verified", provenance: "onchain", detail: "The versioned evidence records browser-signed Job #551 reaching SUBMITTED on BSC Testnet.", source: proof.snapshot.transactions.submit.provenance, timestamp: proof.snapshot.transactions.submit.timestamp },
  ];
  return (
    <MarketplaceLanding
      categories={categories}
      demoEnabled={Reflect.get(process.env, "ERC8183_BROWSER_SPIKE_ENABLED") === "true"}
      featuredAgents={catalog.items.map(agentCardViewModel)}
      publicProof={publicProof}
    />
  );
}
