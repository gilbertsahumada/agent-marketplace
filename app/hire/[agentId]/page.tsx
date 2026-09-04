import { notFound } from "next/navigation";
import { getAgentEvidencePassport, listAgentHireJobs } from "@/src/business/composition";
import { catalogCandidateCard } from "@/components/marketplace/catalog-candidate-view-model";
import { MarketplaceAgentNotFoundError, MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { AgentProfile, marketplaceAgentDisplayName } from "@/components/marketplace/agent-profile";
import { QuoteRequestPanel } from "@/components/marketplace/quote-request-panel";

export const dynamic = "force-dynamic";

export default async function HirePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const { agent, passport, catalogCandidate, jobProofs } = await getAgentEvidencePassport.executeWithAgent({ agentId });
    const hireJobsResult = await listAgentHireJobs.execute({ agent });
    const hireJobs = hireJobsResult?.jobs ?? null;
    const current = catalogCandidate ? catalogCandidateCard(catalogCandidate) : null;
    const buyerAction = current?.buyerAction ?? "unavailable";
    const normalizedState = catalogCandidate?.state;
    // Quote capability is a projection of the seller transport, not a manual
    // admission gate. A discovered seller can be asked for a buyer quote
    // immediately; the Worker will promote it to ready only after verification.
    const canRequestQuote = normalizedState?.canRequestQuote === true
      && normalizedState.operationalStatus === "platform_reachable"
      && normalizedState.freshness === "live"
      && normalizedState?.commerceStatus !== "suspended"
      && (buyerAction === "request_quote"
        || (buyerAction === "prepare_hire" && normalizedState.canPrepareHire));
    // Every compatible catalog seller uses the same browser-first quote and
    // ERC-8183 stepper. The old 303779-only demo is intentionally no longer a
    // separate route: its verified quote is just another catalog request.
    const hireFlow = canRequestQuote ? (
      <QuoteRequestPanel agentId={agent.agentId} agentName={marketplaceAgentDisplayName(agent.name)} />
    ) : null;
    return <AgentProfile
      agent={agent}
      catalogCandidate={catalogCandidate}
      hireFlow={hireFlow}
      hireFlowAvailable={canRequestQuote}
      hireJobs={hireJobs}
      jobProofs={jobProofs}
      passport={passport}
    />;
  } catch (error) {
    if (error instanceof MarketplaceAgentNotFoundError) notFound();
    if (error instanceof MarketplaceDataUnavailableError) {
      return <CatalogUnavailable retryHref={`/hire/${agentId}`} />;
    }
    throw error;
  }
}
