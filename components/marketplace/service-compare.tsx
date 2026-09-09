"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeftRight, ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { NetworkSelector } from "./network-selector";
import { PaginationLinks } from "./page-primitives";
import { ServiceCover } from "./service-card";
import { marketplaceStatus, trust8004AgentHref } from "./agent-card";
import type { AgentCardViewModel } from "./presentation-types";

export function ServiceCompare({ network, candidates, agents, selected, unavailable, q, page, total }: {
  network: "mainnet" | "testnet"; candidates: AgentCardViewModel[]; agents: AgentCardViewModel[];
  selected: string[]; unavailable: string[]; q: string; page: number; total: number;
}) {
  const [ids, setIds] = useState(selected);
  const href = (nextPage: number) => {
    const params = new URLSearchParams({network, q, page: String(nextPage)});
    ids.forEach(id => params.append("agentId", id));
    return `/compare?${params}`;
  };
  const count = (value?: number) => value === undefined ? "Not recorded" : value.toLocaleString("en");
  return <main id="main-content" className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-3xl font-medium">Compare services</h1><p className="mt-2 text-sm text-muted-foreground">Choose 2–3 agents for the same need. Compare what they offer, not a universal score.</p></div>
      <NetworkSelector network={network} hrefs={{mainnet:"/compare?network=mainnet", testnet:"/compare?network=testnet"}} />
    </header>
    <form action="/compare" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="network" value={network} />
      {ids.map(id => <input key={id} type="hidden" name="agentId" value={id} />)}
      <Field className="min-w-0 flex-1"><FieldLabel htmlFor="compare-search">Find an agent</FieldLabel><Input id="compare-search" name="q" defaultValue={q} placeholder="Search by name or agent ID" /></Field>
      <Button type="submit" variant="outline"><Search data-icon="inline-start" />Search</Button>
    </form>
    <form action="/compare" className="flex flex-col gap-4">
      <input type="hidden" name="network" value={network} /><input type="hidden" name="q" value={q} /><input type="hidden" name="page" value={page} />
      {ids.map(id => <input key={id} type="hidden" name="agentId" value={id} />)}
      <FieldGroup tabIndex={0} aria-label="Available agents, scroll for more" className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map(agent => <Field key={agent.agentId} orientation="horizontal" className="min-w-0 rounded-lg border p-3">
          <input id={`compare-${agent.agentId}`} type="checkbox" className="size-4 shrink-0 accent-primary" checked={ids.includes(agent.agentId)} disabled={!ids.includes(agent.agentId) && ids.length >= 3} onChange={event => setIds(current => event.target.checked ? [...current, agent.agentId] : current.filter(id => id !== agent.agentId))} />
          <FieldLabel htmlFor={`compare-${agent.agentId}`} className="min-w-0 flex-1"><span className="truncate" title={agent.name}>{agent.name}</span><span className="text-xs text-muted-foreground">#{agent.agentId}</span></FieldLabel>
        </Field>)}
      </FieldGroup>
      {candidates.length === 0 && <p className="text-sm text-muted-foreground">No agents match this search. Try another name or ID.</p>}
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={ids.length < 2 || ids.length > 3}><ArrowLeftRight data-icon="inline-start" />Compare selected ({ids.length}/3)</Button>{ids.length > 0 && <Button type="button" variant="ghost" onClick={() => setIds([])}>Clear selection</Button>}<span className="text-xs text-muted-foreground">Selection stays while you search or change pages.</span></div>
      {ids.length > 0 && <div aria-label="Selected agents" className="flex flex-wrap gap-2">{ids.map(id => <Button key={id} type="button" size="sm" variant="outline" aria-label={`Remove agent ${id} from comparison`} onClick={() => setIds(current => current.filter(value => value !== id))}>#{id} ×</Button>)}</div>}
    </form>
    <PaginationLinks page={page} pageSize={24} shown={candidates.length} total={total} totalPages={Math.ceil(total / 24)} hrefFor={href} />
    {unavailable.length > 0 && <p role="alert">Current data unavailable for: {unavailable.map(id => `#${id}`).join(", ")}. Retry before deciding.</p>}
    {ids.join(",") !== selected.join(",") && agents.length > 0 && <p role="status" className="text-sm text-muted-foreground">Selection changed. Choose Compare selected to update the results below.</p>}
    {agents.length > 0 && <section aria-label="Service comparison" className={cn("grid items-stretch gap-4 md:grid-cols-2", agents.length === 3 && "xl:grid-cols-3")}>
      {agents.map(agent => <Card key={agent.agentId} className="min-w-0 overflow-hidden">
        <CardHeader><CardTitle className="min-h-10 wrap-anywhere">{agent.name}</CardTitle><a className="inline-flex items-center gap-1 text-xs text-primary" href={trust8004AgentHref(agent.agentId, agent.chainId)} target="_blank" rel="noopener noreferrer">Identity · #{agent.agentId}<ExternalLink aria-label="Opens in a new tab" className="size-3" /></a></CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4"><ServiceCover agent={agent} />
          <p className="h-24 overflow-y-auto text-sm wrap-anywhere" tabIndex={0} aria-label={`Service description for ${agent.name}`}>{agent.description || "No service description declared."}</p>
          <dl className="flex flex-col gap-3 text-sm">
            {[["Availability", marketplaceStatus(agent).label], ["Jobs registered", count(agent.jobCount)], ["Completed", count(agent.completedJobCount)], ["Operator", agent.operator === "marketplace" ? "Marketplace team" : "Independent provider"], ["Price", "After your own quotation"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b pb-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right">{value}</dd></div>)}
          </dl>
        </CardContent>
        <CardFooter><Button asChild variant="outline" className="w-full"><Link href={`/hire/${agent.agentId}?network=${network}`}>Explore service</Link></Button></CardFooter>
      </Card>)}
    </section>}
    <p className="text-xs text-muted-foreground">Availability is not a quote for your job. Registered or completed jobs are not a quality rating. No quote or transaction is sent by comparing.</p>
  </main>;
}
