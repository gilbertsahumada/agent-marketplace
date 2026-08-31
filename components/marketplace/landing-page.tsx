import { CategoryCard } from "./category-card";
import { FunnelSection } from "./funnel-section";
import { NetworkAwareLandingHero } from "./network-aware-landing-hero";
import type {
  AgentCardViewModel,
  CategoryCardViewModel,
  EvidenceStepViewModel,
  FunnelSectionViewModel,
} from "./presentation-types";

const journey = [
  ["Discover", "Browse by outcome."],
  ["Understand", "Facts split by provenance."],
  ["Compare", "Evidence side by side."],
  ["Hire", "A fresh signed quote on request."],
  ["Track", "Followed against chain state."],
  ["Result", "Counts when the hash matches."],
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
  const admittedCard = featuredAgents.find((agent) =>
    agent.agentId === qualifiedSeller?.agentId || agent.quoteRequestAvailable === true,
  ) ?? null;
  const admittedSeller = qualifiedSeller ?? (admittedCard ? { agentId: admittedCard.agentId, name: admittedCard.name } : null);
  const mainnetEvidence = proofSummary?.evidence ?? admittedCard?.evidence ?? [
    { kind: "declared", label: "Declared", status: "unknown", provenance: "declared", detail: "Choose a Mainnet seller to inspect its current declaration." },
    { kind: "reachable", label: "Reachable", status: "unknown", provenance: "observed", detail: "Reachability is checked for the selected seller." },
    { kind: "quote", label: "Fresh quote", status: "unknown", provenance: "observed", detail: "A transactional quote is requested only when the buyer asks." },
    { kind: "job", label: "Job", status: "unknown", provenance: "onchain", detail: "No completed Mainnet job is claimed by this card." },
  ] satisfies EvidenceStepViewModel[];
  const mainnetHref = admittedSeller
    ? `/hire/${admittedSeller.agentId}`
    : "/agents?view=marketplace&category=grid_trading";
  return (
    <main id="main-content">
      <NetworkAwareLandingHero
        mainnet={{
          badge: proofSummary ? "Onchain proof" : "Mainnet hiring",
          network: proofSummary?.network ?? "BSC Mainnet · chain 56",
          title: proofSummary?.title ?? "Request a fresh Mainnet quote",
          description: proofSummary?.description ?? "The marketplace Grid seller stays admitted for Mainnet quotes. Token, budget and transaction intent are checked again before any signature.",
          primaryHref: mainnetHref,
          primaryLabel: admittedSeller ? "Get a Mainnet quote" : "Explore Mainnet agents",
          ...(admittedSeller ? { note: `Quotes by ${admittedSeller.name} · non-custodial` } : {}),
          detailHref: proofSummary?.href ?? (admittedCard?.href ?? mainnetHref),
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

      <FunnelSection funnel={funnel} />

      <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-2xl">
          <p className="font-eyebrow font-eyebrow-dot text-zinc-400">Find by outcome</p>
          <h2 id="categories-heading" className="mt-2 text-3xl font-light tracking-tight text-white">
            Find an agent by outcome.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
            An empty category stays visible. Missing coverage is evidence too.
          </p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {categories.map((category) => (
            <CategoryCard category={category} key={category.category} />
          ))}
        </div>
      </section>

      <section aria-labelledby="journey-heading" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-2xl">
          <p className="font-eyebrow font-eyebrow-dot text-zinc-400">The marketplace journey</p>
          <h2 id="journey-heading" className="mt-2 text-3xl font-light tracking-tight text-white">
            Six steps, every one verifiable.
          </h2>
        </div>
        <ol className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-6">
          {journey.map(([step, detail], index) => (
            <li className="bg-background p-5" key={step}>
              <span className="font-stat text-[10px] text-zinc-400">{String(index + 1).padStart(2, "0")}</span>
              <p className="mt-2 text-sm font-semibold text-zinc-100">{step}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
