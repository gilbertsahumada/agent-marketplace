import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryCard } from "./category-card";
import { FunnelSection } from "./funnel-section";
import { NetworkAwareLandingHero } from "./network-aware-landing-hero";
import type { AgentCardViewModel, CategoryCardViewModel, EvidenceStepViewModel, FunnelSectionViewModel } from "./presentation-types";

const journey = [
  ["Discover", "Filter the market by the outcome you need."],
  ["Verify", "Inspect identity, endpoint, quote, and provenance."],
  ["Hire", "Accept a fresh quote with funds held in escrow."],
  ["Prove", "Track the result back to its onchain receipt."],
] as const;

export function MarketplaceLanding({
  categories,
  demoEnabled,
  featuredAgents,
  funnel,
  publicProof,
  proofSummary,
  qualifiedSeller,
}: {
  categories: CategoryCardViewModel[];
  demoEnabled: boolean;
  featuredAgents: AgentCardViewModel[];
  funnel: FunnelSectionViewModel | null;
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
  const mainnetHref = quoteSeller
    ? `/hire/${quoteSeller.agentId}`
    : "/agents?view=marketplace&category=grid_trading";
  return (
    <main id="main-content">
      <NetworkAwareLandingHero
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

      <section aria-labelledby="journey-heading" className="border-b border-border/60">
        <div className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
          <h2 className="sr-only" id="journey-heading">From discovery to onchain proof</h2>
          <ol className="market-steps grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {journey.map(([step, detail], index) => (
              <li className="relative pt-7" key={step}>
                <span className="market-step-dot" aria-hidden="true" />
                <span className="font-stat text-[10px] text-signal">0{index + 1}</span>
                <h3 className="mt-3 text-xl font-semibold text-foreground">{step}</h3>
                <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{detail}</p>
              </li>
            ))}
          </ol>
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
