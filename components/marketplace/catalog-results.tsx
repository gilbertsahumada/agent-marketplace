"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, LayoutGrid, List, LockKeyhole, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./agent-avatar";
import { AgentCard, marketplaceStatus, trust8004AgentHref } from "./agent-card";
import { EvidenceRail } from "./evidence-rail";
import type { AgentCardViewModel, MarketplaceCategory } from "./presentation-types";

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
            <TableHead className="min-w-64 px-4">Agent</TableHead>
            <TableHead className="min-w-44">Outcome</TableHead>
            <TableHead className="min-w-44">Hiring status</TableHead>
            <TableHead className="min-w-96">Evidence</TableHead>
            <TableHead>Trust</TableHead>
            <TableHead className="px-4 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => {
            const status = marketplaceStatus(agent, registry);
            const canRequestQuote = agent.quoteRequestAvailable === true;
            return (
              <TableRow className={cn(canRequestQuote && "bg-primary/[0.03]")} key={agent.agentId}>
                <TableCell className={cn("px-4 py-5", canRequestQuote && "border-l-2 border-l-primary")}>
                  <div className="flex items-center gap-3">
                    <AgentAvatar {...(agent.imageUrl ? { imageUrl: agent.imageUrl } : {})} name={agent.name} />
                    <div className="min-w-0">
                      <p className="max-w-52 truncate font-medium text-white">{agent.name}</p>
                      <a
                        aria-label={`View ${agent.name} on trust8004 (opens in a new tab)`}
                        className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white"
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
                <TableCell className="whitespace-normal text-zinc-300">{outcomeLabel(agent)}</TableCell>
                <TableCell>
                  <Badge className={status.className} variant="outline">
                    {canRequestQuote && <ShieldCheck aria-hidden="true" />}
                    {status.label}
                  </Badge>
                </TableCell>
                <TableCell className="py-5">
                  <EvidenceRail ariaLabel={`Evidence for ${agent.name}`} density="summary" steps={agent.evidence} />
                </TableCell>
                <TableCell className="text-zinc-400">{typeof agent.trustScore === "number" ? "Derived" : "Unavailable"}</TableCell>
                <TableCell className="px-4">
                  <div className="flex justify-end gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={agent.href} prefetch={false}>
                        View profile
                        <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
                      </Link>
                    </Button>
                    {canRequestQuote ? (
                      <Button asChild size="sm">
                        <Link href={`/hire/${agent.agentId}`} prefetch={false}>Hire agent</Link>
                      </Button>
                    ) : (
                      <Button disabled size="sm" title="Hiring is not available for this agent" variant="secondary">
                        Hire agent
                        <LockKeyhole aria-hidden="true" data-icon="inline-end" />
                      </Button>
                    )}
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

export function CatalogResults({ agents, registry = false, toolbar, emptyContent }: {
  agents: AgentCardViewModel[];
  registry?: boolean;
  toolbar?: ReactNode;
  emptyContent?: ReactNode;
}) {
  const visibleAgents = useMemo(() => {
    return [...agents].sort((left, right) => Number(right.quoteRequestAvailable === true) - Number(left.quoteRequestAvailable === true));
  }, [agents]);

  return (
    <Tabs className="gap-5" defaultValue="cards">
      <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        {toolbar ?? <span />}
        <TabsList aria-label="Catalog layout">
          <TabsTrigger value="cards"><LayoutGrid aria-hidden="true" data-icon="inline-start" />Cards</TabsTrigger>
          <TabsTrigger value="table"><List aria-hidden="true" data-icon="inline-start" />Table</TabsTrigger>
        </TabsList>
      </div>

      {visibleAgents.length > 0 ? (
        <>
          <TabsContent value="cards">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
