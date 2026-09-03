import { notFound } from "next/navigation";
import { getAgentEvidencePassport, getMainnetBrowserDemoConfig } from "@/src/business/composition";
import { catalogCandidateCard } from "@/components/marketplace/catalog-candidate-view-model";
import { MarketplaceAgentNotFoundError, MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";
import { Erc8183SpikeDisabledError, Erc8183SpikeUnavailableError } from "@/src/business/errors/erc8183-spike-errors";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AgentProfile, marketplaceAgentDisplayName } from "@/components/marketplace/agent-profile";
import { Erc8183MainnetDemo } from "@/components/spikes/erc8183-browser-spike";

export const dynamic = "force-dynamic";

export default async function HirePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const { agent, passport, catalogCandidate, jobProofs } = await getAgentEvidencePassport.executeWithAgent({ agentId });
    const current = catalogCandidate ? catalogCandidateCard(catalogCandidate) : null;
    const buyerAction = current?.buyerAction ?? "unavailable";
    const normalizedState = catalogCandidate?.state;
    const canRequestQuote = normalizedState?.commerceStatus === "admitted"
      && normalizedState.canRequestQuote
      && (buyerAction === "request_quote"
        || (buyerAction === "prepare_hire" && normalizedState.canPrepareHire));
    let selectedConfig = null;
    if (canRequestQuote) {
      try {
        const config = getMainnetBrowserDemoConfig.execute();
        if (String(config.agentId) === agent.agentId) selectedConfig = config;
      } catch (error) {
        if (!(error instanceof Erc8183SpikeDisabledError) && !(error instanceof Erc8183SpikeUnavailableError)) throw error;
      }
    }
    const hireNotice = canRequestQuote && !selectedConfig ? (
      <Alert className="border-amber-400/20 bg-amber-400/5">
        <AlertTitle>Fresh quotes are temporarily unavailable</AlertTitle>
        <AlertDescription>The seller supports the hiring transport, but the on-demand quote service is not configured right now. No Testnet substitute was selected.</AlertDescription>
      </Alert>
    ) : null;
    const hireFlow = canRequestQuote && selectedConfig
      ? <Erc8183MainnetDemo config={selectedConfig} agentName={marketplaceAgentDisplayName(agent.name)} embedded />
      : null;
    return <AgentProfile
      agent={agent}
      catalogCandidate={catalogCandidate}
      hireFlow={hireFlow}
      hireFlowAvailable={selectedConfig !== null}
      hireNotice={hireNotice}
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
