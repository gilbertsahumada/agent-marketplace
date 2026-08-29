import Link from "next/link";
import { notFound } from "next/navigation";
import { getMainnetHiringExposure, getMarketplaceAgent, getWorkerObservations, listMarketplaceAgents } from "@/src/business/composition";
import { agentCardWithObservations } from "@/components/marketplace/view-models";
import { observationTargetsByAgentId } from "@/src/business/entities/worker-observations";
import { MarketplaceAgentNotFoundError, MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Breadcrumb, PageIntro } from "@/components/marketplace/page-primitives";

export const dynamic = "force-dynamic";

export default async function HirePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const [agent, catalog, observations] = await Promise.all([
      getMarketplaceAgent.execute({ agentId }),
      listMarketplaceAgents.execute({ view: "marketplace", page: 1, limit: 12 }),
      getWorkerObservations(),
    ]);
    const targets = observationTargetsByAgentId(observations.feed);
    const current = agentCardWithObservations(
      agent, targets.get(agent.agentId) ?? [], observations.status === "available",
    );
    const alternative = catalog.items
      .filter((candidate) => candidate.agentId !== agent.agentId)
      .map((candidate) => agentCardWithObservations(
        candidate, targets.get(candidate.agentId) ?? [], observations.status === "available",
      ))
      .find((candidate) => candidate.hireability === "hireable") ?? null;
    const mainnetExposure = await getMainnetHiringExposure.execute();
    const demoEnabled = Reflect.get(process.env, "ERC8183_BROWSER_SPIKE_ENABLED") === "true";
    const selectedDemoAvailable = current.hireability === "hireable"
      && String(mainnetExposure.demoConfig?.agentId) === agent.agentId;
    const quoteEvidence = current.evidence.find((step) => step.kind === "quote");
    return (
      <main id="main-content" className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumb
          current="Hire"
          trail={[{ href: "/agents", label: "Agents" }, { href: `/agents/${agentId}`, label: agent.name }]}
        />
        <PageIntro eyebrow="Hire eligibility" title={agent.name}>This screen validates whether the selected agent has enough ERC-8183 evidence. It does not simulate a quote or transaction.</PageIntro>
        <Alert className="mt-8 border-amber-400/20 bg-amber-400/5">
          <AlertTitle>{current.hireability === "hireable" ? "Seller is eligible" : "Hiring is not available for this seller"}</AlertTitle>
          <AlertDescription>{quoteEvidence?.detail ?? "Current marketplace observations are unavailable."}</AlertDescription>
        </Alert>
        <div className="mt-6 flex flex-wrap gap-3">
          {selectedDemoAvailable ? <Button asChild><Link href="/demo/erc8183-mainnet">Continue to browser-wallet hire</Link></Button> : alternative ? <Button asChild><Link href={`/hire/${alternative.agentId}`}>Hire {alternative.name}</Link></Button> : demoEnabled ? <Button asChild><Link href="/demo/erc8183">Try the verified Testnet demo</Link></Button> : <Button asChild variant="outline"><Link href="/jobs/testnet/551">View browser-wallet proof</Link></Button>}
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
