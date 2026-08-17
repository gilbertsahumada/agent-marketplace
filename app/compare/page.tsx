import type { Metadata } from "next";
import { ComparePage } from "@/components/marketplace/compare-page";
import { compareMarketplaceAgents } from "@/src/business/composition";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare agents" };

export default async function CompareRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const selected = Array.isArray(params.agentId) ? params.agentId : params.agentId ? [params.agentId] : [];
  const comparison = selected.length >= 2 && selected.length <= 3
    ? await compareMarketplaceAgents.execute({ agentIds: selected })
    : undefined;
  return <ComparePage comparison={comparison} selected={selected} />;
}
