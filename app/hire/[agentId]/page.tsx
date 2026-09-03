import { notFound } from "next/navigation";
import Link from "next/link";
import { getAgentEvidencePassport, getMainnetBrowserDemoConfig } from "@/src/business/composition";
import { catalogBlockingMessage, catalogCandidateCard } from "@/components/marketplace/catalog-candidate-view-model";
import { MarketplaceAgentNotFoundError, MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";
import { Erc8183SpikeDisabledError, Erc8183SpikeUnavailableError } from "@/src/business/errors/erc8183-spike-errors";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Breadcrumb, PageIntro } from "@/components/marketplace/page-primitives";
import { Erc8183MainnetDemo } from "@/components/spikes/erc8183-browser-spike";

export const dynamic = "force-dynamic";

export default async function HirePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const { agent, catalogCandidate } = await getAgentEvidencePassport.executeWithAgent({ agentId });
    const current = catalogCandidate ? catalogCandidateCard(catalogCandidate) : null;
    const buyerAction = current?.buyerAction ?? "unavailable";
    const canRequestQuote = buyerAction === "request_quote" || buyerAction === "prepare_hire";
    let selectedConfig = null;
    if (canRequestQuote) {
      try {
        const config = getMainnetBrowserDemoConfig.execute();
        if (String(config.agentId) === agent.agentId) selectedConfig = config;
      } catch (error) {
        if (!(error instanceof Erc8183SpikeDisabledError) && !(error instanceof Erc8183SpikeUnavailableError)) throw error;
      }
    }
    if (canRequestQuote && selectedConfig) {
      return <Erc8183MainnetDemo config={selectedConfig} agentName={agent.name} />;
    }
    return (
      <main id="main-content" className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumb
          current="Hire"
          trail={[{ href: "/agents", label: "Agents" }, { href: `/agents/${agentId}`, label: agent.name }]}
        />
        <PageIntro eyebrow="Fresh quote" title={agent.name}>A periodic observation is informative. Only a quote requested by you can start a hire.</PageIntro>
        <Alert className="mt-8 border-amber-400/20 bg-amber-400/5">
          <AlertTitle>{canRequestQuote ? "Fresh quotes are temporarily unavailable" : "This agent cannot be hired through the marketplace"}</AlertTitle>
          <AlertDescription>{canRequestQuote
            ? "The seller supports the hiring transport, but the on-demand quote service is not configured right now. No Testnet substitute was selected."
            : catalogBlockingMessage(current?.blockingReasons)}</AlertDescription>
        </Alert>
        <div className="mt-6 flex flex-wrap gap-3">
          {canRequestQuote && <Button asChild><Link href={`/hire/${agent.agentId}`}>Try again</Link></Button>}
          <Button asChild variant="outline"><Link href={`/agents/${agent.agentId}`}>View agent evidence</Link></Button>
        </div>
      </main>
    );
  } catch (error) {
    if (error instanceof MarketplaceAgentNotFoundError) notFound();
    if (error instanceof MarketplaceDataUnavailableError) {
      return <CatalogUnavailable retryHref={`/hire/${agentId}`} />;
    }
    throw error;
  }
}
