import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { getCatalogCandidate, getCatalogCandidatePage } from "@/src/business/composition";
import { catalogCandidateCard } from "@/components/marketplace/catalog-candidate-view-model";
import { ServiceCompare } from "@/components/marketplace/service-compare";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare services" };

export default async function CompareRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.network !== undefined && params.network !== "mainnet" && params.network !== "testnet") notFound();
  const network = params.network === "testnet" ? "testnet" : "mainnet";
  const chainId = network === "testnet" ? 97 : 56;
  const selected = Array.isArray(params.agentId) ? params.agentId : params.agentId ? [params.agentId] : [];
  if (selected.length > 3 || new Set(selected).size !== selected.length || selected.some(id => !/^[1-9]\d{0,15}$/.test(id))) notFound();
  const page = typeof params.page === "string" && /^[1-9]\d{0,5}$/.test(params.page) ? Number(params.page) : 1;
  const q = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  const [catalog, records] = await Promise.all([
    getCatalogCandidatePage({ chainId, inventory: "registry", statuses: [], page, limit: 24, ...(q ? { q } : {}) }),
    Promise.all(selected.map(agentId => getCatalogCandidate({ chainId, agentId }))),
  ]);
  const retry = new URLSearchParams({ network, page: String(page), q });
  selected.forEach(id => retry.append("agentId", id));
  if (!catalog) return <CatalogUnavailable retryHref={`/compare?${retry}`} />;
  const now = Date.now();
  return <ServiceCompare key={retry.toString()} network={network} q={q} page={page} total={catalog.total}
    candidates={catalog.items.map(agent => catalogCandidateCard(agent, now))}
    selected={selected} agents={records.flatMap(record => record ? [catalogCandidateCard(record, now)] : [])}
    unavailable={selected.filter((_, index) => !records[index])} />;
}
