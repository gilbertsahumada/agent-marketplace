import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentProfile } from "@/components/marketplace/agent-profile";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { getAgentEvidencePassport } from "@/src/business/composition";
import { MarketplaceAgentNotFoundError, MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ agentId: string }> }): Promise<Metadata> {
  const { agentId } = await params;
  return { title: `Agent ${agentId}` };
}

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const { agent, passport } = await getAgentEvidencePassport.executeWithAgent({ agentId });
    return <AgentProfile agent={agent} passport={passport} />;
  } catch (error) {
    if (error instanceof MarketplaceAgentNotFoundError) notFound();
    if (error instanceof MarketplaceDataUnavailableError) {
      return <CatalogUnavailable retryHref={`/agents/${agentId}`} />;
    }
    throw error;
  }
}
