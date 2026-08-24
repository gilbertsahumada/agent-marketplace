import type { Metadata } from "next";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { ComparePage } from "@/components/marketplace/compare-page";
import { compareMarketplaceAgents } from "@/src/business/composition";
import { MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare agents" };

export default async function CompareRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const selected = Array.isArray(params.agentId) ? params.agentId : params.agentId ? [params.agentId] : [];
  let comparison;
  try {
    comparison = selected.length >= 2 && selected.length <= 3
      ? await compareMarketplaceAgents.execute({ agentIds: selected })
      : undefined;
  } catch (error) {
    if (!(error instanceof MarketplaceDataUnavailableError)) throw error;
    const retry = new URLSearchParams();
    for (const agentId of selected) retry.append("agentId", agentId);
    return <CatalogUnavailable retryHref={`/compare?${retry.toString()}`} />;
  }
  return <ComparePage comparison={comparison} selected={selected} />;
}
