import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentProfile } from "@/components/marketplace/agent-profile";
import { getMarketplaceAgent } from "@/src/business/composition";
import { MarketplaceAgentNotFoundError } from "@/src/business/errors/marketplace-errors";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ agentId: string }> }): Promise<Metadata> {
  const { agentId } = await params;
  return { title: `Agent ${agentId}` };
}

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  try {
    return <AgentProfile agent={await getMarketplaceAgent.execute({ agentId })} />;
  } catch (error) {
    if (error instanceof MarketplaceAgentNotFoundError) notFound();
    throw error;
  }
}
