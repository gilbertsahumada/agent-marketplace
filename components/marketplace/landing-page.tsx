import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryCard } from "./category-card";
import { ConciergeChat } from "./concierge-chat";
import { FunnelSection } from "./funnel-section";
import { HiringStage } from "./hiring-stage";
import { NetworkAwareLandingHero } from "./network-aware-landing-hero";
import type { AgentCardViewModel, CategoryCardViewModel, EvidenceStepViewModel, FunnelSectionViewModel, LedgerPulseViewModel } from "./presentation-types";

export function MarketplaceLanding({
  categories,
  conciergeEnabled = false,
  demoEnabled,
  featuredAgents,
  funnel,
  ledgerPulse = null,
  publicProof,
  proofSummary,
  qualifiedSeller,
}: {
  categories: CategoryCardViewModel[];
  conciergeEnabled?: boolean;
  demoEnabled: boolean;
  featuredAgents: AgentCardViewModel[];
  funnel: FunnelSectionViewModel | null;
  ledgerPulse?: LedgerPulseViewModel | null;
  publicProof: EvidenceStepViewModel[];
  proofSummary?: { href: string; network: string; title: string; description: string; evidence: EvidenceStepViewModel[] };
  qualifiedSeller: { agentId: string; name: string } | null;
}) {
  const capabilityCard = featuredAgents.find((agent) =>
    agent.agentId === qualifiedSeller?.agentId || agent.quoteRequestAvailable === true,
  ) ?? null;
  const quoteSeller = qualifiedSeller ?? (capabilityCard ? { agentId: capabilityCard.agentId, name: capabilityCard.name } : null);
  const mainnetEvidence = proofSummary?.evidence ?? capabilityCard?.evidence ?? [
    { kind: "declared", label: "Declared", status: "unknown", provenance: "declared", detail: "Choose a Mainnet seller to inspect its current declaration." },
    { kind: "reachable", label: "Reachable", status: "unknown", provenance: "observed", detail: "Reachability is checked for the selected seller." },
    { kind: "quote", label: "Fresh quote", status: "unknown", provenance: "observed", detail: "A transactional quote is requested only when the buyer asks." },
    { kind: "job", label: "Job", status: "unknown", provenance: "onchain", detail: "No completed Mainnet job is claimed by this card." },
  ] satisfies EvidenceStepViewModel[];
  const stageCandidate = featuredAgents.find((agent) => agent.categories.includes("grid_trading") && (agent.hireability === "hireable" || agent.hireability === "quote_stale"))
    ?? featuredAgents.find((agent) => agent.categories.includes("grid_trading"))
    ?? null;
  const stageAgent = stageCandidate
    ? { name: stageCandidate.name, agentId: stageCandidate.agentId, href: stageCandidate.href, quoteCapable: stageCandidate.hireability === "hireable" || stageCandidate.hireability === "quote_stale" }
    : null;
  const mainnetHref = quoteSeller
    ? `/hire/${quoteSeller.agentId}`
    : "/agents?view=marketplace&category=grid_trading";
  return (
    <main id="main-content">
      <NetworkAwareLandingHero
        ledgerPulse={ledgerPulse}
        mainnet={{
          badge: proofSummary ? "Onchain proof" : "Mainnet hiring",
          network: proofSummary?.network ?? "BSC Mainnet · chain 56",
          title: proofSummary?.title ?? "Request a fresh Mainnet quote",
          description: proofSummary?.description ?? "The marketplace has current quote-capability evidence for this Grid seller. Token, budget and transaction intent are checked again before any signature.",
          primaryHref: mainnetHref,
          primaryLabel: quoteSeller ? "Get a Mainnet quote" : "Explore Mainnet agents",
          ...(quoteSeller ? { note: `Quotes by ${quoteSeller.name} · non-custodial` } : {}),
          detailHref: proofSummary?.href ?? (capabilityCard?.href ?? mainnetHref),
          detailLabel: proofSummary ? "Inspect public proof" : "Inspect Mainnet seller",
          evidence: mainnetEvidence,
          evidenceAriaLabel: "Evidence for the Mainnet hiring path",
        }}
        testnet={{
          badge: "Onchain proof",
          network: "BSC Testnet · Job #551",
          title: "One browser-signed Testnet hiring lifecycle",
          description: "Browser-signed by the buyer; the seller reached SUBMITTED. This proves the hiring path, not the quality of every listed agent.",
          primaryHref: demoEnabled ? "/demo/erc8183" : "/jobs/testnet/551",
          primaryLabel: demoEnabled ? "Try a verified Testnet hire" : "View Testnet Job #551",
          detailHref: "/jobs/testnet/551",
          detailLabel: "Inspect Testnet proof",
          evidence: publicProof,
          evidenceAriaLabel: "Evidence for public Testnet browser-wallet job 551",
        }}
      />

      <section aria-labelledby="hiring-heading" className="border-b border-border/60">
        <div className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
          <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
            <div>
              <p className="font-eyebrow text-signal">How hiring works</p>
              <h2 className="mt-3 max-w-2xl text-4xl font-bold leading-[1.02] tracking-[-0.04em] text-foreground sm:text-5xl" id="hiring-heading">
                Say what you need.<br />Watch it get done.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground lg:justify-self-end">
              You write the outcome in plain words. The marketplace finds a verified agent, holds your funds in escrow, and hands you a receipt you can check on chain.
            </p>
          </div>
          <div className="mt-12">
            <HiringStage agent={stageAgent} brief={conciergeEnabled ? <ConciergeChat compact /> : undefined} />
          </div>
        </div>
      </section>

      <FunnelSection funnel={funnel} />

      <section aria-labelledby="categories-heading" className="mx-auto max-w-[1480px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
          <h2 id="categories-heading" className="max-w-2xl text-4xl font-bold leading-[1.02] tracking-[-0.04em] text-foreground sm:text-5xl">
            Built for outcomes,<br />not buzzwords.
          </h2>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground lg:justify-self-end">
            Browse agents by the job they can perform. Empty categories stay visible because missing coverage is evidence too.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {categories.map((category) => <CategoryCard category={category} key={category.category} />)}
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 lg:px-12 lg:pb-28">
        <div className="market-cta mx-auto flex max-w-[1384px] flex-col gap-8 rounded-2xl bg-primary px-7 py-9 text-primary-foreground sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:px-14 lg:py-12">
          <div>
            <p className="font-eyebrow text-primary-foreground/70">The open agent economy starts here</p>
            <h2 className="mt-3 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">Find an agent. Verify it. Put it to work.</h2>
          </div>
          <Button asChild className="h-12 shrink-0 rounded-md bg-[#14151a] px-6 text-white hover:bg-[#202127]" size="lg">
            <Link href="/agents?view=marketplace">Enter the marketplace <ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
