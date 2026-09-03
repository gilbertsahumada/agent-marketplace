import Link from "next/link";
import { ArrowUpRight, ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentAvatar } from "./agent-avatar";
import { EvidenceRail } from "./evidence-rail";
import type { AgentCardViewModel, MarketplaceCategory } from "./presentation-types";

const categoryLabels: Record<MarketplaceCategory, string> = {
  rebalancing: "Rebalancing",
  grid_trading: "Grid trading",
  yield_optimisation: "Yield optimisation",
  health_factor_monitoring: "Health factor",
};

export function trust8004AgentHref(agentId: string) {
  return `https://trust8004.xyz/agents/56:${agentId}`;
}

export function marketplaceStatus(agent: AgentCardViewModel, registry = false) {
  if (agent.quoteRequestAvailable === true) return {
    label: "Hireable on Mainnet",
    className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  };
  if (registry) return {
    label: "Registered only",
    className: "border-zinc-700 bg-zinc-900 text-zinc-400",
  };
  if (agent.monitoring?.state === "feed_unavailable") return {
    label: "Monitoring unavailable",
    className: "border-zinc-700 bg-zinc-900 text-zinc-300",
  };
  if (agent.monitoring?.state === "no_endpoint_declared") return {
    label: "No endpoint declared",
    className: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  };
  if (agent.monitoring?.state === "not_monitored") return {
    label: "Not monitored",
    className: "border-zinc-700 bg-zinc-900 text-zinc-300",
  };
  if (agent.monitoring?.source === "release_snapshot") return {
    label: "Verified in release",
    className: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
  };
  if (agent.monitoring?.state === "never_probed" || !agent.monitoring) return {
    label: "Never probed",
    className: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  };
  if (["quote_verified", "protocol_valid", "quote_rejected"].includes(agent.monitoring.latestOutcome ?? "")) return {
    label: "Observed reachable",
    className: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
  };
  return {
    label: "Last probe failed",
    className: "border-red-400/35 bg-red-400/10 text-red-300",
  };
}

export function agentJourneyAction(agent: AgentCardViewModel): { href: string; label: string } {
  const action = agent.buyerAction ?? (agent.quoteRequestAvailable === true ? "request_quote" : "unavailable");
  if (action === "prepare_hire" || action === "request_quote") {
    return { href: `/hire/${agent.agentId}#hire-flow`, label: "Hire agent" };
  }
  if (action === "check_availability") return { href: `/hire/${agent.agentId}#validation`, label: "Hire agent" };
  return { href: `/hire/${agent.agentId}`, label: "View agent" };
}

export function AgentCard({ agent, registry = false }: { agent: AgentCardViewModel; registry?: boolean }) {
  const canRequestQuote = agent.quoteRequestAvailable === true;
  const status = marketplaceStatus(agent, registry);
  const action = agentJourneyAction(agent);

  return (
    <Card className="marketplace-surface marketplace-agent-evidence-card h-full gap-4 py-5" data-passport-state={agent.passportState}>
      <CardHeader className="gap-4 px-5">
        <div className="flex items-start gap-3">
          <AgentAvatar {...(agent.imageUrl ? { imageUrl: agent.imageUrl } : {})} name={agent.name} />
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-2 text-base leading-tight">
              <Link className="hover:text-primary" href={`/hire/${agent.agentId}`} prefetch={false}>{agent.name}</Link>
            </CardTitle>
            <a
              aria-label={`View ${agent.name} on trust8004 (opens in a new tab)`}
              className="font-stat mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white"
              href={trust8004AgentHref(agent.agentId)}
              rel="noopener noreferrer"
              target="_blank"
            >
              BSC Mainnet · Agent #{agent.agentId}
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          </div>
        </div>

        <div className="flex min-h-5 flex-wrap gap-1.5">
          <Badge
            className={status.className}
            title={agent.monitoring?.state === "probed"
              ? `${agent.monitoring.attemptCount === undefined ? "Attempt count unavailable" : `${agent.monitoring.attemptCount} ${agent.monitoring.source === "release_snapshot" ? "release verification attempt" : "attempts"}`}${agent.monitoring.lastAttemptAt ? ` · last ${agent.monitoring.lastAttemptAt}` : ""}`
              : undefined}
            variant="outline"
          >
            {canRequestQuote && <ShieldCheck aria-hidden="true" />}
            {status.label}
          </Badge>
          {agent.categories.length > 0 ? agent.categories.map((category) => (
            <Badge className="bg-white/5 text-zinc-300" key={category} variant="secondary">
              {categoryLabels[category]}
            </Badge>
          )) : <span className="text-xs text-zinc-500">No marketplace outcome assigned</span>}
        </div>
      </CardHeader>

      <CardContent className="mt-auto px-5">
        <EvidenceRail ariaLabel={`Evidence for ${agent.name}`} density="summary" steps={agent.evidence} />
      </CardContent>

      <CardFooter className="border-white/10 bg-zinc-950/40 px-5 py-3">
        <Button asChild className="w-full" size="sm" variant={action.label === "Hire agent" ? "default" : "outline"}>
          <Link href={action.href} prefetch={false}>
            {action.label}
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
