import Link from "next/link";
import { ArrowUpRight, Bot, Fingerprint, ShieldCheck, Split } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EvidenceRail } from "./evidence-rail";
import type {
  AgentCardViewModel,
  MarketplaceCategory,
} from "./presentation-types";
import { VerificationDrift } from "./verification-drift";
import { hireabilityLabels } from "./view-models";

const categoryLabels: Record<MarketplaceCategory, string> = {
  rebalancing: "Rebalancing",
  grid_trading: "Grid trading",
  yield_optimisation: "Yield optimisation",
  health_factor_monitoring: "Health factor",
};

const passportLabels: Record<AgentCardViewModel["passportState"], string> = {
  registered: "Registered",
  evaluated: "Evaluated",
  hireable: "Hireable",
  job_proven: "Job proven",
  attention: "Attention",
};

export function AgentCard({ agent }: { agent: AgentCardViewModel }) {
  const isHireable = agent.hireability === "hireable";
  const canRequestQuote = agent.quoteRequestAvailable === true;
  const hireabilityLabel = agent.hireability === "listed_only" && canRequestQuote
    ? "Quote on request"
    : hireabilityLabels[agent.hireability];

  return (
    <Card className="marketplace-surface marketplace-agent-evidence-card h-full gap-4 py-5" data-passport-state={agent.passportState}>
      <CardHeader className="gap-3 px-5">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-zinc-300">
            <Bot aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="truncate text-base">{agent.name}</CardTitle>
              <Badge
                variant="outline"
                className={
                  isHireable
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400"
                }
              >
                {isHireable && <ShieldCheck aria-hidden="true" />}
                {hireabilityLabel}
              </Badge>
            </div>
            <p className="font-stat mt-1 text-[11px] text-zinc-400">
              BSC · Agent #{agent.agentId}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link
                className="inline-flex items-center gap-1.5 text-xs text-zinc-400 underline decoration-zinc-700 underline-offset-4 hover:text-white"
                href={agent.passportHref}
                prefetch={false}
              >
                <Fingerprint aria-hidden="true" className="size-3" />
                Passport · {passportLabels[agent.passportState]}
              </Link>
              <Link
                aria-label={`Compare ${agent.name}`}
                className="inline-flex items-center gap-1.5 text-xs text-zinc-400 underline decoration-zinc-700 underline-offset-4 hover:text-white"
                href={`/compare?agentId=${agent.agentId}`}
                prefetch={false}
              >
                <Split aria-hidden="true" className="size-3" />
                Compare
              </Link>
            </div>
            {agent.operator === "marketplace" && <Badge className="mt-2 border-cyan-400/30 bg-cyan-400/10 text-cyan-200" variant="outline">Marketplace-operated · not official BNB reference</Badge>}
          </div>
        </div>

        <p className="line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
          {agent.description}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {agent.categories.map((category) => (
            <Badge className="bg-white/5 text-zinc-300" key={category} variant="secondary">
              {categoryLabels[category]}
            </Badge>
          ))}
        </div>
      </CardHeader>

      <CardContent className="mt-auto px-5">
        <EvidenceRail
          ariaLabel={`Evidence for ${agent.name}`}
          compact
          steps={agent.evidence}
        />
        {agent.verification && <VerificationDrift compact verification={agent.verification} />}
      </CardContent>

      <CardFooter className="justify-between gap-3 border-white/10 bg-zinc-950/40 px-5 py-3">
        {typeof agent.trustScore === "number" ? (
          <div>
            <p className="font-stat text-sm font-semibold text-white">{agent.trustScore}/100</p>
            <p className="text-[10px] text-zinc-400">Trust score · derived</p>
          </div>
        ) : (
          <p className="text-xs text-zinc-400">Trust score unavailable</p>
        )}
        <Button asChild size="sm" variant={canRequestQuote ? "default" : "outline"}>
          <Link href={canRequestQuote ? `/hire/${agent.agentId}` : agent.href} prefetch={false}>
            {canRequestQuote ? "Get fresh quote" : "View evidence"}
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
