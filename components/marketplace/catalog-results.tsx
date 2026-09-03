"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, LayoutGrid, List, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./agent-avatar";
import { AgentCard, agentJourneyAction, marketplaceStatus, trust8004AgentHref } from "./agent-card";
import { EvidenceRail } from "./evidence-rail";
import type { AgentCardViewModel, MarketplaceCategory } from "./presentation-types";
import { CatalogResultsSkeleton } from "./catalog-loading";
import { useCatalogNavigation } from "./catalog-navigation";

const categoryLabels: Record<MarketplaceCategory, string> = {
  rebalancing: "Rebalancing",
  grid_trading: "Grid trading",
  yield_optimisation: "Yield optimisation",
  health_factor_monitoring: "Health factor monitoring",
};

function outcomeLabel(agent: AgentCardViewModel) {
  return agent.categories.map((category) => categoryLabels[category]).join(" + ") || "Not classified";
}

function AgentComparisonTable({ agents, registry }: { agents: AgentCardViewModel[]; registry: boolean }) {
  return (
    <div className="marketplace-surface overflow-hidden rounded-xl border border-white/10">
      <Table aria-label="Agent comparison" containerLabel="Scrollable agent comparison">
        <TableHeader>
          <TableRow className="bg-white/[0.02] hover:bg-white/[0.02]">
            <TableHead className="h-10 min-w-56 px-4 text-xs font-medium text-zinc-400">Agent</TableHead>
            <TableHead className="h-10 min-w-36 text-xs font-medium text-zinc-400">Outcome</TableHead>
            <TableHead className="h-10 min-w-40 text-xs font-medium text-zinc-400">Hiring status</TableHead>
            <TableHead className="h-10 min-w-80 text-xs font-medium text-zinc-400">Evidence</TableHead>
            <TableHead className="h-10 min-w-24 text-xs font-medium text-zinc-400">Trust</TableHead>
            <TableHead className="h-10 min-w-32 px-4 text-right text-xs font-medium text-zinc-400">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => {
            const status = marketplaceStatus(agent, registry);
            const canRequestQuote = agent.quoteRequestAvailable === true;
            const action = agentJourneyAction(agent);
            return (
              <TableRow className={cn(canRequestQuote && "bg-primary/[0.02]")} key={agent.agentId}>
                <TableCell className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 [&_[data-slot=avatar]]:size-9">
                      <AgentAvatar {...(agent.imageUrl ? { imageUrl: agent.imageUrl } : {})} name={agent.name} />
                    </div>
                    <div className="min-w-0">
                      <p className="max-w-48 truncate text-sm font-medium text-white">
                        <Link className="hover:text-primary" href={`/hire/${agent.agentId}`} prefetch={false}>{agent.name}</Link>
                      </p>
                      <a
                        aria-label={`View ${agent.name} on trust8004 (opens in a new tab)`}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-white"
                        href={trust8004AgentHref(agent.agentId)}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Agent #{agent.agentId}
                        <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal text-sm text-zinc-300">{outcomeLabel(agent)}</TableCell>
                <TableCell>
                  <Badge className={cn("text-xs", status.className)} variant="outline">
                    {canRequestQuote && <ShieldCheck aria-hidden="true" />}
                    {status.label}
                  </Badge>
                </TableCell>
                <TableCell className="py-4">
                  <EvidenceRail ariaLabel={`Evidence for ${agent.name}`} density="table" steps={agent.evidence} />
                </TableCell>
                <TableCell className="text-sm text-zinc-400">{typeof agent.trustScore === "number" ? "Derived" : "Unavailable"}</TableCell>
                <TableCell className="px-4">
                  <div className="flex justify-end">
                    <Button asChild size="sm" variant={canRequestQuote ? "default" : "outline"}>
                      <Link href={action.href} prefetch={false}>
                        {action.label}
                        <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function CatalogResults({ agents, registry = false, toolbar, filters, emptyContent }: {
  agents: AgentCardViewModel[];
  registry?: boolean;
  toolbar?: ReactNode;
  filters?: ReactNode;
  emptyContent?: ReactNode;
}) {
  const { pending } = useCatalogNavigation();
  const visibleAgents = useMemo(() => {
    return [...agents].sort((left, right) => Number(right.quoteRequestAvailable === true) - Number(left.quoteRequestAvailable === true));
  }, [agents]);

  return (
    <Tabs className="gap-5" defaultValue="cards">
      <div className="grid items-center gap-3 min-[30rem]:grid-cols-[minmax(0,1fr)_auto]">
        {toolbar ?? <span />}
        <TabsList aria-label="Catalog layout" className="h-10 border border-white/10 bg-black/30 justify-self-start min-[30rem]:justify-self-end">
          <TabsTrigger className="h-full px-3" value="cards"><LayoutGrid aria-hidden="true" data-icon="inline-start" />Cards</TabsTrigger>
          <TabsTrigger className="h-full px-3" value="table"><List aria-hidden="true" data-icon="inline-start" />Table</TabsTrigger>
        </TabsList>
      </div>

      {filters}

      {pending ? (
        <CatalogResultsSkeleton />
      ) : visibleAgents.length > 0 ? (
        <>
          <TabsContent value="cards">
            <div className="grid gap-5 md:grid-cols-2">
              {visibleAgents.map((agent) => <AgentCard agent={agent} key={agent.agentId} registry={registry} />)}
            </div>
          </TabsContent>
          <TabsContent value="table"><AgentComparisonTable agents={visibleAgents} registry={registry} /></TabsContent>
        </>
      ) : (
        emptyContent ?? <p className="rounded-xl border border-white/10 p-6 text-sm text-zinc-400">No agents match this view.</p>
      )}
    </Tabs>
  );
}
