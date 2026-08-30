import Link from "next/link";
import { ArrowRight, CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AgentCard } from "./agent-card";
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
  ["Discover", "Browse BSC candidates by outcome, without learning protocol vocabulary first."],
  ["Understand", "Declared, observed, onchain and derived facts stay visibly separate."],
  ["Compare", "Evidence is aligned side by side. The marketplace names no universal winner."],
  ["Hire", "A compatible seller admitted by the marketplace can issue a fresh ERC-8183 quote on request."],
  ["Track", "The job is followed against direct chain state, never a stored boolean."],
  ["Result", "A deliverable counts once its hash matches what was committed onchain."],
] as const;

export function MarketplaceLanding({
  categories,
  observationSnapshot,
  demoEnabled,
  featuredAgents,
  funnel,
  publicProof,
  proofSummary,
  qualifiedSeller,
}: {
  categories: CategoryCardViewModel[];
  observationSnapshot: { generatedAt: string; staleAfter: string } | null;
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
          description: proofSummary?.description ?? "Choose the marketplace-operated Grid seller to negotiate a new ERC-8183 quote. Wallet, token, budget and transaction intent are checked again before any signature.",
          primaryHref: mainnetHref,
          primaryLabel: admittedSeller ? `Get fresh Mainnet quote from ${admittedSeller.name}` : "Explore Mainnet agents",
          detailHref: proofSummary?.href ?? (admittedCard?.href ?? mainnetHref),
          detailLabel: proofSummary ? "Inspect public proof" : "Inspect Mainnet seller",
          evidence: mainnetEvidence,
          evidenceAriaLabel: "Evidence for the Mainnet hiring path",
        }}
        testnet={{
          badge: "Onchain proof",
          network: "BSC Testnet · Job #551",
          title: "One browser-signed Testnet hiring lifecycle",
          description: "Every buyer transaction was signed in the browser and the seller reached SUBMITTED. This proves the Testnet hiring path works — not the quality of every listed agent.",
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
            Four categories. Equal visibility.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
            An empty category remains visible. Missing coverage is evidence too; it is never filled with invented sellers.
          </p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {categories.map((category) => (
            <CategoryCard category={category} key={category.category} />
          ))}
        </div>
      </section>

      <section aria-labelledby="candidates-heading" className="border-y border-white/10 bg-zinc-950/40">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="font-eyebrow font-eyebrow-dot text-zinc-400">Current BSC observations</p>
              <h2 id="candidates-heading" className="mt-2 text-3xl font-light tracking-tight text-white">
                Candidates with honest activation states.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
                MCP availability can support discovery, but it does not prove ERC-8183 hireability. {qualifiedSeller ? "A compatible seller admitted by the marketplace can always be asked for a fresh transactional quote." : "Marketplace Grid remains admitted for on-demand Mainnet quotes; the verified Testnet journey remains available as historical proof."}
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/agents">
                View full catalogue
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
            </Button>
          </div>

          {observationSnapshot ? (
            <Alert className="mt-8 border-indigo-400/30 bg-indigo-400/[0.06] text-indigo-100">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Current observation window</AlertTitle>
              <AlertDescription>
                Generated {new Date(observationSnapshot.generatedAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })} and reusable only through {new Date(observationSnapshot.staleAfter).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}. Identity and declarations come from live trust8004 data; Hire always requests a new quote.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="mt-8 border-amber-400/30 bg-amber-400/[0.06] text-amber-100">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Current verification temporarily unavailable</AlertTitle>
              <AlertDescription>
                Live trust8004 declarations remain visible, but current reachability and shared quote evidence are unavailable until the observation Worker responds. Compatible sellers admitted by the marketplace can still issue a fresh quote for this session.
              </AlertDescription>
            </Alert>
          )}

          {featuredAgents.length > 0 ? (
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {featuredAgents.map((agent) => (
                <AgentCard agent={agent} key={agent.agentId} />
              ))}
            </div>
          ) : (
            <Alert className="mt-8 border-zinc-800 bg-zinc-950">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>No candidates in this snapshot</AlertTitle>
              <AlertDescription>Refresh the catalogue later or inspect the public Gate 1 proof.</AlertDescription>
            </Alert>
          )}
        </div>
      </section>

      <section aria-labelledby="journey-heading" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-2xl">
          <p className="font-eyebrow font-eyebrow-dot text-zinc-400">The marketplace journey</p>
          <h2 id="journey-heading" className="mt-2 text-3xl font-light tracking-tight text-white">
            Technical proof, progressively disclosed.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
            Start with the outcome you need. Identity, endpoint checks, quote signatures, and transaction details remain available when you want to inspect them.
          </p>
        </div>
        <ol className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
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
