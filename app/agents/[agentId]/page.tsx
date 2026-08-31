import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentProfile } from "@/components/marketplace/agent-profile";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { getAgentEvidencePassport, getWorkerObservations } from "@/src/business/composition";
import { MarketplaceAgentNotFoundError, MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ agentId: string }> }): Promise<Metadata> {
  const { agentId } = await params;
  return { title: `Agent ${agentId}` };
}

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const [{ agent, passport, catalogCandidate }, observations] = await Promise.all([
      getAgentEvidencePassport.executeWithAgent({ agentId }),
      getWorkerObservations(),
    ]);
    const targets = observations.feed?.targets.filter((candidate) => candidate.agentId === agentId) ?? [];
    return <AgentProfile
      agent={agent}
      observationTargets={targets}
      observationsAvailable={observations.status === "available"}
      passport={passport}
      catalogCandidate={catalogCandidate}
    />;
  } catch (error) {
    if (error instanceof MarketplaceAgentNotFoundError) notFound();
    if (error instanceof MarketplaceDataUnavailableError) {
      return <CatalogUnavailable retryHref={`/agents/${agentId}`} />;
    }
    throw error;
  }
}
