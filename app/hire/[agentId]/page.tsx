import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarketplaceAgent } from "@/src/business/composition";
import { MarketplaceAgentNotFoundError } from "@/src/business/errors/marketplace-errors";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/marketplace/page-primitives";

export const dynamic = "force-dynamic";

export default async function HirePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    const agent = await getMarketplaceAgent.execute({ agentId });
    return (
      <main id="main-content" className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
        <PageIntro eyebrow="Hire eligibility" title={agent.name}>This screen validates whether the selected agent has enough ERC-8183 evidence. It does not simulate a quote or transaction.</PageIntro>
        <Alert className="mt-8 border-amber-400/20 bg-amber-400/5">
          <AlertTitle>{agent.hireability.canHire ? "Seller is eligible" : "Hiring is not available for this seller"}</AlertTitle>
          <AlertDescription>{agent.hireability.reason}</AlertDescription>
        </Alert>
        <div className="mt-6 flex flex-wrap gap-3"><Button asChild variant="outline"><Link href={`/agents/${agentId}`}>Return to profile</Link></Button><Button asChild variant="outline"><Link href="/jobs/testnet/551">View browser-wallet proof</Link></Button></div>
      </main>
    );
  } catch (error) {
    if (error instanceof MarketplaceAgentNotFoundError) notFound();
    throw error;
  }
}
