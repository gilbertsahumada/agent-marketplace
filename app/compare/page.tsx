import type { Metadata } from "next";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { ComparePage } from "@/components/marketplace/compare-page";
import { compareMarketplaceAgents, getMainnetJobProof, getWorkerObservations, listMarketplaceAgents } from "@/src/business/composition";
import { MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare agents" };

export default async function CompareRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const selected = Array.isArray(params.agentId) ? params.agentId : params.agentId ? [params.agentId] : [];
  try {
    const [catalog, comparison, observations] = await Promise.all([
      listMarketplaceAgents.execute({ view: "marketplace", page: 1, limit: 12 }),
      selected.length >= 2 && selected.length <= 3
        ? compareMarketplaceAgents.execute({ agentIds: selected })
        : Promise.resolve(undefined),
      getWorkerObservations(),
    ]);
    const mainnetProof = getMainnetJobProof.execute();
    return (
      <ComparePage
        candidates={catalog.items.map(({ agentId, name }) => ({ agentId, name }))}
        comparison={comparison}
        observations={observations}
        selected={selected}
        {...(mainnetProof ? { provenAgentId: mainnetProof.agentId } : {})}
      />
    );
  } catch (error) {
    if (!(error instanceof MarketplaceDataUnavailableError)) throw error;
    const retry = new URLSearchParams();
    for (const agentId of selected) retry.append("agentId", agentId);
    return <CatalogUnavailable retryHref={`/compare?${retry.toString()}`} />;
  }
}
