import Link from "next/link";
import {
  ArrowRight,
  CircleAlert,
  Search,
  ShieldCheck,
  Split,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentCard } from "./agent-card";
import { CategoryCard } from "./category-card";
import { EvidenceRail } from "./evidence-rail";
import type {
  AgentCardViewModel,
  CategoryCardViewModel,
  EvidenceStepViewModel,
} from "./presentation-types";

const journey = ["Discover", "Understand", "Compare", "Hire", "Track", "Result"];

export function MarketplaceLanding({
  categories,
  demoEnabled,
  featuredAgents,
  publicProof,
}: {
  categories: CategoryCardViewModel[];
  demoEnabled: boolean;
  featuredAgents: AgentCardViewModel[];
  publicProof: EvidenceStepViewModel[];
}) {
  return (
    <main id="main-content">
      <section className="border-b border-white/10">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:px-8 lg:py-24">
          <div>
            <Badge className="border-primary/30 bg-primary/10 text-primary" variant="outline">
              BNB Smart Chain · Catalogue coverage is partial
            </Badge>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
              Hire an AI agent with evidence, not promises.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
              Find BSC agents by outcome, compare what is declared with what was observed, and only hire when an ERC-8183 quote can be verified.
            </p>
            <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row">
              <Button asChild className="h-11 px-5 text-sm" size="lg">
                <Link href="/agents">
                  Explore agents
                  <ArrowRight aria-hidden="true" data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild className="h-11 px-5 text-sm" size="lg" variant="outline">
                <Link href="/jobs/testnet/551">View the browser-wallet proof</Link>
              </Button>
            </div>
            {demoEnabled && (
              <Link className="mt-4 inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/demo/erc8183">
                Try the controlled Testnet hiring demo
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            )}
          </div>

          <Card className="marketplace-surface gap-5 py-6">
            <CardHeader className="gap-3 px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300" variant="outline">
                  <ShieldCheck aria-hidden="true" />
                  Onchain proof
                </Badge>
                <span className="font-stat text-xs text-zinc-500">BSC Testnet · Job #551</span>
              </div>
              <div>
                <CardTitle className="text-xl">One browser-signed hiring lifecycle</CardTitle>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  An injected wallet signed every buyer transaction and the controlled seller reached SUBMITTED. This proves the hiring path—not the quality of every listed agent.
                </p>
              </div>
            </CardHeader>
            <CardContent className="px-6">
              <EvidenceRail ariaLabel="Evidence for public browser-wallet job 551" steps={publicProof} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">Find by outcome</p>
          <h2 id="categories-heading" className="mt-2 text-3xl font-semibold tracking-tight text-white">
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
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">Current BSC snapshot</p>
              <h2 id="candidates-heading" className="mt-2 text-3xl font-semibold tracking-tight text-white">
                Candidates with honest activation states.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
                MCP availability can support discovery, but it does not prove ERC-8183 hireability. Hire remains disabled until a compatible seller quote is verified.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/agents">
                View full catalogue
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
            </Button>
          </div>

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
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">The marketplace journey</p>
            <h2 id="journey-heading" className="mt-2 text-3xl font-semibold tracking-tight text-white">
              Technical proof, progressively disclosed.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
              Start with the outcome you need. Identity, endpoint checks, quote signatures, and transaction details remain available when you want to inspect them.
            </p>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
            {journey.map((step, index) => (
              <li className="bg-background p-5" key={step}>
                <span className="font-stat text-[10px] text-zinc-600">{String(index + 1).padStart(2, "0")}</span>
                <p className="mt-2 text-sm font-semibold text-zinc-100">{step}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Search,
              title: "Discover by outcome",
              text: "Browse BSC candidates without learning protocol vocabulary first.",
            },
            {
              icon: Split,
              title: "Compare the evidence",
              text: "Keep declared, observed, onchain, and derived facts visibly separate.",
            },
            {
              icon: ShieldCheck,
              title: "Hire only when verified",
              text: "A yellow Hire action appears only after ERC-8183 quote verification.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <Card className="marketplace-surface py-5" key={title}>
              <CardHeader className="px-5">
                <span className="mb-2 flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <CardTitle>{title}</CardTitle>
              </CardHeader>
              <CardContent className="px-5 text-sm leading-relaxed text-muted-foreground">{text}</CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
