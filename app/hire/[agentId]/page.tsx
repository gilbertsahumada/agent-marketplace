import { notFound } from "next/navigation";
import { getAgentEvidencePassport, listAgentHireJobs } from "@/src/business/composition";
import { isCatalogSellerDeclaration } from "@/src/business/entities/catalog-candidate";
import { MarketplaceAgentNotFoundError, MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { AgentProfile, marketplaceAgentDisplayName } from "@/components/marketplace/agent-profile";
import { QuoteRequestPanel } from "@/components/marketplace/quote-request-panel";

export const dynamic = "force-dynamic";

export default async function HirePage({ params, searchParams }: { params: Promise<{ agentId: string }>; searchParams?: Promise<{ jobsBefore?: string; jobsNetwork?: string }> }) {
  const { agentId } = await params;
  const query = await searchParams;
  const before = query?.jobsBefore;
  const jobsChainId = query?.jobsNetwork === "testnet" ? 97 : 56;
  const jobsNetwork = jobsChainId === 97 ? "testnet" : "mainnet";
  const jobsBefore = before && /^(?:0|[1-9]\d{0,15})$/.test(before) ? before : undefined;
  try {
    const { agent, passport, catalogCandidate, jobProofs } = await getAgentEvidencePassport.executeWithAgent({ agentId });
    const hireJobsResult = await listAgentHireJobs.execute({ agent, chainId: jobsChainId, ...(jobsBefore ? { before: jobsBefore } : {}) });
    const hireJobs = hireJobsResult?.jobs ?? null;
    const normalizedState = catalogCandidate?.state;
    // Quote capability is a projection of the seller transport, not a manual
    // admission gate. A discovered seller can be asked for a buyer quote
    // immediately; the Worker will promote it to ready only after verification.
    const canRequestQuote = normalizedState?.canRequestQuote === true && normalizedState.commerceStatus !== "suspended";
    // Discovery is allowed for first-time sellers; a successful inspection
    // exposes the usable form in this same view. It never requires a past quote.
    const canDiscover = normalizedState?.commerceStatus !== "suspended"
      && (canRequestQuote || catalogCandidate?.declarations.some(isCatalogSellerDeclaration));
    // Every compatible catalog seller uses the same browser-first quote and
    // ERC-8183 stepper. The old 303779-only demo is intentionally no longer a
    // separate route: its verified quote is just another catalog request.
    const hireFlow = canDiscover ? (
      <QuoteRequestPanel agentId={agent.agentId} agentName={marketplaceAgentDisplayName(agent.name)} checkCompatibilityFirst={!canRequestQuote} />
    ) : null;
    return <AgentProfile
      agent={agent}
      catalogCandidate={catalogCandidate}
      hireFlow={hireFlow}
      hireFlowAvailable={canRequestQuote}
      hireJobs={hireJobs}
      jobsChainId={jobsChainId}
      {...(hireJobsResult?.totals ? { hireJobsTotals: hireJobsResult.totals } : {})}
      hireJobsMore={hireJobsResult?.nextBefore != null}
      {...(hireJobsResult?.nextBefore ? { jobsOlderHref: `/hire/${agentId}?jobsNetwork=${jobsNetwork}&jobsBefore=${hireJobsResult.nextBefore}#erc8183-history` } : {})}
      {...(jobsBefore ? { jobsNewestHref: `/hire/${agentId}?jobsNetwork=${jobsNetwork}#erc8183-history` } : {})}
      hireJobsScope={hireJobsResult?.scope ?? "agent"}
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
