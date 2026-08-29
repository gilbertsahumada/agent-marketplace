import Link from "next/link";
import { notFound } from "next/navigation";
import { getMainnetHiringExposure, getMarketplaceAgent, listMarketplaceAgents } from "@/src/business/composition";
import { selectHireAlternative } from "@/src/business/policies/marketplace-agent-policy";
import { MarketplaceAgentNotFoundError, MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Breadcrumb, PageIntro } from "@/components/marketplace/page-primitives";

export const dynamic = "force-dynamic";

export default async function HirePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const [agent, catalog] = await Promise.all([
      getMarketplaceAgent.execute({ agentId }),
      listMarketplaceAgents.execute({ view: "marketplace", page: 1, limit: 12 }),
    ]);
    const alternative = selectHireAlternative(agent, catalog.items);
    const mainnetExposure = getMainnetHiringExposure.execute();
    const demoEnabled = Reflect.get(process.env, "ERC8183_BROWSER_SPIKE_ENABLED") === "true";
    const selectedDemoAvailable = agent.hireability.canHire
      && String(mainnetExposure.demoConfig?.agentId) === agent.agentId;
    return (
      <main id="main-content" className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumb
          current="Hire"
          trail={[{ href: "/agents", label: "Agents" }, { href: `/agents/${agentId}`, label: agent.name }]}
        />
        <PageIntro eyebrow="Hire eligibility" title={agent.name}>This screen validates whether the selected agent has enough ERC-8183 evidence. It does not simulate a quote or transaction.</PageIntro>
        <Alert className="mt-8 border-amber-400/20 bg-amber-400/5">
          <AlertTitle>{agent.hireability.canHire ? "Seller is eligible" : "Hiring is not available for this seller"}</AlertTitle>
          <AlertDescription>{agent.hireability.reason}</AlertDescription>
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
