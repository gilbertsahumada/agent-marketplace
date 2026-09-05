import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileCheck2,
  LockKeyhole,
  ServerOff,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./agent-avatar";
import { EvidenceRail } from "./evidence-rail";
import { relativeAge } from "./relative-time";
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

function latestQuoteAttemptFailed(agent: AgentCardViewModel) {
  return agent.capabilityState === "failed"
    || agent.evidence.some((step) => step.kind === "quote" && step.status === "failed");
}

export function marketplaceStatus(agent: AgentCardViewModel, registry = false) {
  const connection = agent.evidence.find((step) => step.kind === "reachable");
  if (connection?.status === "failed") return {
    label: "Connection failed",
    className: "border-red-400/35 bg-red-400/10 text-red-300",
    icon: TriangleAlert,
  };
  if (connection?.status !== "verified" && agent.quoteRequestAvailable) return {
    label: "Check connection",
    className: "border-amber-400/35 bg-amber-400/10 text-amber-300",
    icon: Clock3,
  };
  const buyerAction = agent.buyerAction ?? (agent.quoteRequestAvailable === true ? "request_quote" : "unavailable");
  if (buyerAction === "prepare_hire") return {
    label: "Ready to hire",
    className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    icon: ShieldCheck,
  };
  if (buyerAction === "request_quote") {
    const failed = latestQuoteAttemptFailed(agent);
    const capabilityState = agent.capabilityState;
    if (capabilityState === "suspended" || capabilityState === "unsupported") return {
      label: "Not available",
      className: "border-zinc-700 bg-zinc-900 text-zinc-400",
      icon: LockKeyhole,
    };
    if (capabilityState === "failed" || failed) return {
      label: "Quote failed",
      className: "border-red-400/35 bg-red-400/10 text-red-300",
      icon: TriangleAlert,
    };
    if (capabilityState === "stale") return {
      label: "Capability stale",
      className: "border-amber-400/35 bg-amber-400/10 text-amber-300",
      icon: Clock3,
    };
    if (capabilityState === "discovered") return {
      label: "Quote available",
      className: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
      icon: FileCheck2,
    };
    return {
      label: capabilityState === "ready" ? "Ready to quote" : "Quote not checked",
      className: "border-primary/40 bg-primary/10 text-primary",
      icon: FileCheck2,
    };
  }
  if (registry) return {
    label: "Registered only",
    className: "border-zinc-700 bg-zinc-900 text-zinc-400",
    icon: FileCheck2,
  };
  if (agent.monitoring?.state === "feed_unavailable") return {
    label: "Monitoring unavailable",
    className: "border-zinc-700 bg-zinc-900 text-zinc-300",
    icon: ServerOff,
  };
  if (agent.monitoring?.state === "no_endpoint_declared") return {
    label: "No endpoint declared",
    className: "border-amber-400/35 bg-amber-400/10 text-amber-300",
    icon: CircleHelp,
  };
  if (agent.monitoring?.state === "not_monitored") return {
    label: "Awaiting check",
    className: "border-zinc-700 bg-zinc-900 text-zinc-300",
    icon: Clock3,
  };
  if (agent.monitoring?.source === "release_snapshot") return {
    label: "Verified in release",
    className: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
    icon: CheckCircle2,
  };
  if (agent.monitoring?.state === "never_probed" || !agent.monitoring) return {
    label: "Not checked yet",
    className: "border-amber-400/35 bg-amber-400/10 text-amber-300",
    icon: Clock3,
  };
  if (agent.evidence.some((step) => step.kind === "reachable" && step.status === "verified")) return {
    label: "Reachable only",
    className: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
    icon: CheckCircle2,
  };
  if (["quote_verified", "protocol_valid", "quote_rejected"].includes(agent.monitoring.latestOutcome ?? "")) return {
    label: "Reachability stale",
    className: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
    icon: Clock3,
  };
  return {
    label: "Check failed",
    className: "border-red-400/35 bg-red-400/10 text-red-300",
    icon: TriangleAlert,
  };
}

export function agentJourneyAction(agent: AgentCardViewModel): { href: string; label: string; disabled?: boolean } {
  const action = agent.buyerAction ?? (agent.quoteRequestAvailable === true ? "request_quote" : "unavailable");
  const connection = agent.evidence.find((step) => step.kind === "reachable");
  if ((action === "prepare_hire" || action === "request_quote") && connection?.status !== "verified") {
    return {
      href: `/hire/${agent.agentId}#validation`,
      label: connection?.status === "failed" ? "Retry availability" : "Check availability",
    };
  }
  if (action === "prepare_hire") {
    return { href: `/hire/${agent.agentId}#hire-flow`, label: "Hire agent" };
  }
  if (action === "request_quote") return {
    href: `/hire/${agent.agentId}#hire-flow`,
    label: latestQuoteAttemptFailed(agent) ? "Retry quote" : "Request quote",
  };
  if (action === "check_availability") {
    const reachableNow = agent.evidence.some((step) => step.kind === "reachable" && step.status === "verified");
    return reachableNow
      ? { href: `/hire/${agent.agentId}`, label: "View details" }
      : { href: `/hire/${agent.agentId}#validation`, label: "Check availability" };
  }
  // An MCP-only listing can still expose a public endpoint that a buyer may
  // inspect. It must not be presented as quote-capable until the exact MCP
  // negotiation tool has been proven, so route it to diagnostics instead of
  // disabling the only useful action.
  if (agent.hireability === "mcp_only") {
    return { href: `/hire/${agent.agentId}#validation`, label: "Check availability" };
  }
  return { href: `/hire/${agent.agentId}`, label: "Not available", disabled: true };
}

function formatObservationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date).replace(",", "") + " UTC";
}

type ObservationPresentation = {
  label: string;
  detail: string;
  tone: string;
  icon: LucideIcon;
};

const FAILED_OUTCOMES = new Set([
  "quote_invalid",
  "quote_rejected",
  "unreachable",
  "unsafe_url",
  "error",
]);

const SUCCESS_OUTCOMES = new Set(["quote_verified", "protocol_valid", "reachable"]);

function declaredTransport(agent: AgentCardViewModel) {
  return agent.protocols?.find((protocol) => protocol !== "Web") ?? "Endpoint";
}

function platformObservation(agent: AgentCardViewModel): ObservationPresentation {
  const monitoring = agent.monitoring;
  const reachability = agent.evidence.find((step) => step.kind === "reachable")?.status;
  const latestOutcome = monitoring?.latestOutcome;
  const transport = declaredTransport(agent);
  if (monitoring?.state === "feed_unavailable") return {
    label: "Monitoring unavailable",
    detail: "The marketplace observation feed is not connected, so no reachability claim is being made.",
    tone: "text-zinc-400",
    icon: ServerOff,
  };
  if (monitoring?.state === "no_endpoint_declared") return {
    label: "No endpoint declared",
    detail: "This agent has no eligible public protocol endpoint for a marketplace check.",
    tone: "text-amber-300",
    icon: CircleHelp,
  };
  if (!monitoring || monitoring.state === "not_monitored" || monitoring.state === "never_probed") {
    return {
      label: "Not checked yet",
      detail: "No marketplace check has been recorded for this endpoint yet. The next check is read-only.",
      tone: "text-amber-300",
      icon: Clock3,
    };
  }
  if (monitoring.source === "release_snapshot" && (reachability === "verified" || SUCCESS_OUTCOMES.has(latestOutcome ?? ""))) {
    return {
      label: "Verified in release",
      detail: `The ${transport} endpoint responded during release verification. This is historical evidence, not a live check.`,
      tone: "text-cyan-200",
      icon: CheckCircle2,
    };
  }
  if (latestOutcome === "quote_rejected") return {
    label: "Reachable now",
    detail: `The ${transport} endpoint responded, but the latest quote was rejected. Reachability and quote status are shown separately.`,
    tone: "text-cyan-200",
    icon: CheckCircle2,
  };
  if (reachability === "failed" || FAILED_OUTCOMES.has(latestOutcome ?? "")) return {
    label: "Check failed",
    detail: monitoring.latestErrorCode
      ? `The latest bounded marketplace check failed (${monitoring.latestErrorCode}). Run a new check to try again.`
      : "The latest bounded marketplace check could not verify the endpoint. Run a new check to try again.",
    tone: "text-red-300",
    icon: TriangleAlert,
  };
  if (reachability === "verified") {
    return {
      label: "Reachable now",
      detail: `The ${transport} endpoint returned a valid response inside the current monitoring window.`,
      tone: "text-emerald-300",
      icon: CheckCircle2,
    };
  }
  if (SUCCESS_OUTCOMES.has(latestOutcome ?? "")) {
    return {
      label: "Check is stale",
      detail: `A previous ${transport} response exists, but it is outside the current monitoring window. Run a new check for a current result.`,
      tone: "text-amber-300",
      icon: Clock3,
    };
  }
  return {
    label: "Not checked yet",
    detail: "No current marketplace check is available for this endpoint.",
    tone: "text-amber-300",
    icon: Clock3,
  };
}

export function AgentCard({ agent, registry = false }: { agent: AgentCardViewModel; registry?: boolean }) {
  const status = marketplaceStatus(agent, registry);
  const action = agentJourneyAction(agent);
  const observation = platformObservation(agent);
  const lastAttemptAt = agent.monitoring?.lastAttemptAt ?? null;
  const checkedAt = lastAttemptAt
    ? formatObservationTime(lastAttemptAt)
    : null;
  const observationSource = agent.monitoring?.source === "release_snapshot"
    ? "Release verification"
    : agent.monitoring?.source === "worker"
      ? "Marketplace Worker"
      : "Marketplace feed";
  const observationMeta = [
    agent.monitoring?.latestHttpStatus ? `HTTP ${agent.monitoring.latestHttpStatus}` : undefined,
    typeof agent.monitoring?.latestDurationMs === "number" && agent.monitoring.latestDurationMs > 0
      ? `${agent.monitoring.latestDurationMs} ms`
      : undefined,
  ].filter(Boolean).join(" · ");
  const quoteMeta = typeof agent.quoteRequestCount === "number"
    ? `${agent.quoteRequestCount.toLocaleString("en-US")} quote ${agent.quoteRequestCount === 1 ? "request" : "requests"}${typeof agent.quoteSuccessCount === "number" ? ` · ${agent.quoteSuccessCount.toLocaleString("en-US")} verified` : ""}`
    : null;
  const jobMeta = typeof agent.jobCount === "number"
    ? `${agent.jobCount.toLocaleString("en-US")} ${agent.jobCount === 1 ? "job" : "jobs"}${typeof agent.completedJobCount === "number" ? ` · ${agent.completedJobCount.toLocaleString("en-US")} completed` : ""}`
    : null;

  return (
    <Card className="marketplace-surface marketplace-agent-evidence-card h-full gap-0 overflow-hidden py-0" data-passport-state={agent.passportState}>
      <CardHeader className="gap-3 px-5 pb-3 pt-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 [&_[data-slot=avatar]]:size-11">
            <AgentAvatar {...(agent.imageUrl ? { imageUrl: agent.imageUrl } : {})} name={agent.name} />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-1 text-base leading-tight">
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

        <div className="flex min-h-5 flex-wrap items-center gap-1.5">
          <Badge
            className={status.className}
            title={status.label === "Reachable only"
              ? "The endpoint responds, but this agent is not enabled for marketplace quotes."
              : status.label === "Ready to quote"
                ? "This agent can return a fresh marketplace quote; requesting it sends no transaction."
                : status.label === "Quote failed"
                  ? "The last quote attempt failed. Retry the quote request to run the same bounded negotiation again."
                : agent.monitoring?.state === "probed"
                  ? `${agent.monitoring.attemptCount === undefined ? "Attempt count unavailable" : `${agent.monitoring.attemptCount} ${agent.monitoring.source === "release_snapshot" ? "release verification attempt" : "attempts"}`}${agent.monitoring.lastAttemptAt ? ` · last ${agent.monitoring.lastAttemptAt}` : ""}`
                  : undefined}
            variant="outline"
          >
            <status.icon aria-hidden="true" className="size-3.5" />
            {status.label}
          </Badge>
          {agent.categories.length > 0 ? agent.categories.map((category) => (
            <Badge className="bg-white/5 text-zinc-300" key={category} variant="secondary">
              {categoryLabels[category]}
            </Badge>
          )) : <span className="text-xs text-zinc-500">No marketplace outcome assigned</span>}
          {agent.protocols && agent.protocols.length > 0 && (
            <span aria-label="Declared protocols" className="contents">
              {agent.protocols.map((protocol) => <Badge aria-label={`Protocol ${protocol}`} className="border-white/10 bg-white/[0.04] text-[10px] tracking-wide text-zinc-400" key={protocol} variant="outline">{protocol}</Badge>)}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="mt-auto space-y-3 px-5 pb-4 pt-2">
        <EvidenceRail ariaLabel={`Evidence for ${agent.name}`} density="summary" steps={agent.evidence} />
        {(quoteMeta || jobMeta) ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 font-stat text-[11px] text-zinc-500">
            {quoteMeta ? <p data-quote-stats>{quoteMeta}</p> : null}
            {jobMeta ? <p data-job-stats>{jobMeta}</p> : null}
          </div>
        ) : null}
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-white/[0.07] pt-3" data-observation-status={observation.label}>
          <div className="flex min-w-0 items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={`Latest check: ${observation.label}`}
                    className={cn("inline-flex cursor-help items-center gap-1.5 rounded-sm text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", observation.tone)}
                    type="button"
                  >
                    <observation.icon aria-hidden="true" className="size-3.5" />
                    {observation.label}
                    <CircleHelp aria-hidden="true" className="size-3 opacity-60" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-80 border border-zinc-700 bg-zinc-900 p-3 text-left text-zinc-100" sideOffset={8}>
                  <p className="font-semibold">{observation.label}</p>
                  <p className="mt-1 leading-relaxed text-zinc-300">{observation.detail}</p>
                  <p className="mt-2 text-zinc-400">
                    {observationSource}
                    {typeof agent.monitoring?.attemptCount === "number"
                      ? ` · ${agent.monitoring.attemptCount} ${agent.monitoring.attemptCount === 1 ? "attempt" : "attempts"}`
                      : " · attempt count unavailable"}
                  </p>
                  {checkedAt && <p className="mt-1 text-zinc-400">Last checked {checkedAt}</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {checkedAt && lastAttemptAt && (
              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500" title={`Last checked ${checkedAt}`}>
                <Clock3 aria-hidden="true" className="size-3" />
                {relativeAge(lastAttemptAt)}
              </span>
            )}
          </div>
          {observationMeta && <span className="font-stat text-[11px] text-zinc-500">{observationMeta}</span>}
        </div>
      </CardContent>

      <CardFooter className="border-t border-white/10 bg-zinc-950/40 px-5 py-3">
        {action.disabled ? (
          <Button aria-disabled="true" className="h-9 w-full" disabled title="No compatible hiring transport is declared for this agent." variant="outline">
            {action.label}
            <LockKeyhole aria-hidden="true" data-icon="inline-end" />
          </Button>
        ) : (
          <Button asChild className="h-9 w-full" variant={action.label === "Hire agent" || action.label === "Request quote" || action.label === "Retry quote" ? "default" : "outline"}>
            <Link href={action.href} prefetch={false}>
              {action.label}
              <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
