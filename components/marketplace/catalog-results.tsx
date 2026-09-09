"use client";

import { useMemo, type ReactNode } from "react";
import { AgentCard } from "./agent-card";
import type { AgentCardViewModel } from "./presentation-types";
import { CatalogResultsSkeleton } from "./catalog-loading";
import { ServiceCard } from "./service-card";
import { useCatalogNavigation } from "./catalog-navigation";

export function CatalogResults({ agents, registry = false, toolbar, filters, emptyContent }: {
  agents: AgentCardViewModel[];
  registry?: boolean;
  toolbar?: ReactNode;
  filters?: ReactNode;
  emptyContent?: ReactNode;
}) {
  const { pending } = useCatalogNavigation();
  const visibleAgents = useMemo(() => {
    const priority = (agent: AgentCardViewModel) => {
      if (agent.buyerAction === "prepare_hire") return 4;
      if (agent.buyerAction === "request_quote" || (agent.buyerAction === undefined && agent.quoteRequestAvailable === true)) return 3;
      if (agent.evidence.some((step) => step.kind === "reachable" && step.status === "verified")) return 2;
      if (agent.buyerAction === "check_availability") return 1;
      return 0;
    };
    return [...agents].sort((left, right) => priority(right) - priority(left));
  }, [agents]);

  return (
    <div aria-busy={pending} className="flex min-w-0 flex-col gap-5">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] lg:grid-cols-[minmax(0,1fr)_auto]">
        {toolbar ?? <span />}
      </div>

      {filters}

      {pending ? (
        <CatalogResultsSkeleton />
      ) : visibleAgents.length > 0 ? (
        <>

            <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleAgents.map((agent) => registry ? <AgentCard agent={agent} key={agent.agentId} registry /> : <ServiceCard agent={agent} key={agent.agentId} />)}
            </div>


        </>
      ) : (
        emptyContent ?? <p className="rounded-xl border border-white/10 p-6 text-sm text-zinc-400">No agents match this view.</p>
      )}
    </div>
  );
}
