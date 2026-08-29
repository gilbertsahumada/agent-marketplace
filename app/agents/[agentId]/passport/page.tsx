import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EvidencePassportCard } from "@/components/marketplace/evidence-passport-card";
import { CatalogUnavailable } from "@/components/marketplace/catalog-unavailable";
import { Breadcrumb } from "@/components/marketplace/page-primitives";
import { getAgentEvidencePassport } from "@/src/business/composition";
import {
  InvalidMarketplaceInputError,
  MarketplaceAgentNotFoundError,
  MarketplaceDataUnavailableError,
} from "@/src/business/errors/marketplace-errors";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agentId: string }>;
}): Promise<Metadata> {
  const { agentId } = await params;
  return { title: `Agent ${agentId} Evidence Passport` };
}

export default async function EvidencePassportPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  try {
    const passport = await getAgentEvidencePassport.execute({ agentId });
    return (
      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
        <Breadcrumb
          current="Evidence Passport"
          trail={[{ href: "/agents", label: "Agents" }, { href: `/agents/${agentId}`, label: passport.name }]}
        />
        <div className="mb-8 max-w-3xl">
          <p className="font-eyebrow text-primary">Evidence, not endorsement</p>
          <h1 className="mt-3 text-3xl font-light tracking-tight text-white sm:text-4xl">A portable view of what this agent has actually proven.</h1>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">
            The Passport separates registry identity, endpoint observations, current ERC-8183 qualification and proven job history. Its status can weaken when evidence expires.
          </p>
        </div>
        <EvidencePassportCard
          apiHref={`/api/marketplace/agents/${agentId}/passport`}
          passport={passport}
        />
      </main>
    );
  } catch (error) {
    if (error instanceof InvalidMarketplaceInputError || error instanceof MarketplaceAgentNotFoundError) notFound();
    if (error instanceof MarketplaceDataUnavailableError) {
      return <CatalogUnavailable retryHref={`/agents/${agentId}/passport`} />;
    }
    throw error;
  }
}
