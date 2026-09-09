"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { AgentAvatar } from "./agent-avatar";
import { agentActionIcon, agentJourneyAction, marketplaceStatus, trust8004AgentHref } from "./agent-card";
import type { AgentCardViewModel } from "./presentation-types";
import styles from "./service-cover.module.css";

// Decorative summaries of provider declarations, not verified capabilities or filter categories.
export function serviceArtwork(agent: AgentCardViewModel) {
  const category = agent.categories[0];
  const description = agent.description.toLowerCase();
  if (category === "grid_trading" || /grid (planning|trading|trader|plans)/.test(description)) return { title: "Grid\nplanning", background: "#28352b", color: "#e7ee5b", kind: "grid" };
  if (category === "rebalancing" || /rebalanc/.test(description)) return { title: /liquidity|range/.test(description) ? "Liquidity range\nrebalancer" : "Portfolio\nrebalancing", background: "#20364b", color: "#99ccec", kind: "range" };
  if (category === "yield_optimisation" || /yield optimi[sz]/.test(description)) return { title: "Yield\noptimization", background: "#362d4d", color: "#d2b2f4", kind: "yield" };
  if (category === "health_factor_monitoring" || /health factor|liquidation risk/.test(description)) return { title: "Health factor\nmonitoring", background: "#49342d", color: "#f4bb94", kind: "monitor" };
  if (/explains.*job.escrow/.test(description)) return { title: "Job-escrow\nexplained", background: "#3d3828", color: "#d9c994", kind: "yield" };
  if (/monitoring|monitor/.test(description)) return { title: "Recurring\nmonitoring", background: "#203c37", color: "#b4d9c6", kind: "monitor" };
  return { title: `Agent\n#${agent.agentId}`, background: "#292e36", color: "#b9bec7", kind: "generic" };
}

function ServiceAvatar({ agent }: { agent: AgentCardViewModel }) {
  if (agent.imageUrl) return <AgentAvatar className="rounded-full" name={agent.name} imageUrl={agent.imageUrl} />;
  return <span aria-label={`${agent.name} initials`} className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 bg-zinc-800 text-[10px] font-medium text-zinc-200">{agent.name.trim().slice(0, 2).toUpperCase() || "AG"}</span>;
}

export function ServiceCover({ agent, showOperator = false }: { agent: AgentCardViewModel; showOperator?: boolean }) {
  const art = serviceArtwork(agent);
  return <div className="relative w-full overflow-hidden rounded-xl border border-border" data-testid="service-cover">
    <svg aria-hidden="true" viewBox="0 0 400 245" className="block h-auto w-full">
      <rect width="400" height="245" fill={art.background} />
      <g transform="translate(8 5) scale(0.96)">
      <text x="26" y="36" fill={art.color} fontSize="12">Service illustration</text>
      {art.title.split("\n").map((line, index) => <text key={index} x="25" y={72 + index * 36} fill="#f5f5ef" fontSize="31" fontWeight="500">{line}</text>)}
      <g className={styles.graphic} data-artwork={art.kind}>
      {art.kind === "grid" ? Array.from({ length: 7 }, (_, i) => <g key={i}><path d={`M28 ${125 + i * 13}H372`} stroke={art.color} opacity=".2" /><rect x={40 + i * 44} y={190 - i * 10} width="9" height={16 + i * 3} fill={art.color} /></g>)
        : art.kind === "yield" ? Array.from({ length: 4 }, (_, i) => <rect key={i} x="28" y={130 + i * 22} width={305 - i * 48} height="11" rx="3" fill={art.color} opacity={1 - i * .18} />)
          : art.kind === "monitor" ? <path d="M28 190H85l15-40 24 60 27-80 25 60h42l20-36 21 36h112" fill="none" stroke={art.color} strokeWidth="3" />
            : art.kind === "range" || art.kind === "generic" ? <><rect x="140" y="120" width="130" height="100" fill={art.color} opacity=".12" /><path d="M28 200C90 212 85 138 142 165S205 186 226 142 290 176 370 115" fill="none" stroke={art.color} strokeWidth="3" /></>
              : <g fill="none" stroke={art.color} opacity=".4"><rect x="28" y="125" width="100" height="85" rx="12" /><rect x="150" y="125" width="100" height="85" rx="12" /><path d="M128 168h22m100 0h100" /><circle cx="355" cy="168" r="12" /></g>}
      </g>
      </g>
    </svg>
    {showOperator && agent.operator === "marketplace" && <span className="pointer-events-none absolute top-9 -right-12 w-52 rotate-45 bg-primary py-1.5 text-center text-[10px] font-semibold leading-4 text-primary-foreground shadow-sm">Marketplace operated</span>}
  </div>;
}

function IdentityLink({ agent }: { agent: AgentCardViewModel }) {
  return <a className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline" href={trust8004AgentHref(agent.agentId, agent.chainId)} target="_blank" rel="noopener noreferrer" aria-label={`Agent ${agent.agentId} on Trust8004 (opens in a new tab)`}>#{agent.agentId}<ExternalLink aria-hidden="true" className="size-3" /></a>;
}

export function ServiceCard({ agent, registry = false }: { agent: AgentCardViewModel; registry?: boolean }) {
  const [open, setOpen] = useState(false);
  const status = marketplaceStatus(agent, registry);
  const action = agentJourneyAction(agent);
  const ActionIcon = agentActionIcon(action.label);
  const description = agent.description.trim() || "No service description declared.";
  const count = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toLocaleString("en-US") : "—";
  return <Dialog open={open} onOpenChange={setOpen}>
    <article className="group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors duration-300 ease-out hover:border-primary/25 hover:bg-[color-mix(in_srgb,var(--card),white_3%)] focus-within:border-primary/25 focus-within:bg-[color-mix(in_srgb,var(--card),white_3%)] motion-reduce:transition-none [&_button]:cursor-pointer" aria-label={`${agent.name} service`} onClick={event => {
      if ((event.target as Element).closest("a, button")) return;
      setOpen(true);
    }}>
      <DialogTrigger asChild><button type="button" className="w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary [&>div]:rounded-none [&>div]:border-0" aria-label={`Explore ${agent.name}`}><ServiceCover agent={agent} showOperator /></button></DialogTrigger>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <div className="shrink-0 [&_[data-slot=avatar]]:size-6"><ServiceAvatar agent={agent} /></div>
        <span className="min-w-0 flex-1 truncate" title={agent.name}>{agent.name}</span><IdentityLink agent={agent} />
      </div>
      <DialogTrigger asChild><button type="button" className="h-[4.5em] line-clamp-3 text-left text-base leading-normal font-medium wrap-anywhere hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{description}</button></DialogTrigger>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><status.icon aria-hidden="true" className="size-3.5" />{status.label}</p>
      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{agent.quoteRequestAvailable ? "Price after quotation" : "Quote unavailable"}</span><DialogTrigger asChild><Button variant="link">Explore service<ExternalLink aria-hidden="true" data-icon="inline-end" /></Button></DialogTrigger></div>
      <Link className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-primary" href={`/compare?network=${agent.chainId === 97 ? "testnet" : "mainnet"}&agentId=${agent.agentId}`}>Compare this service</Link>
      </div>
    </article>
    <DialogContent className="agents-catalog max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[960px]">
      <DialogHeader className="min-w-0 pr-8 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="size-11 shrink-0 [&>span]:size-11 [&>span]:text-sm"><ServiceAvatar agent={agent} /></span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <DialogTitle className="wrap-anywhere leading-snug">{agent.name}</DialogTitle>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <DialogDescription className="inline-flex items-center gap-1.5 text-xs"><img alt="" width={16} height={16} className="size-4 shrink-0" src="/logo/SVG/BNB Chain_Symbol_Yellow.svg" />{agent.chainId === 97 ? "BSC Testnet" : "BSC Mainnet"}</DialogDescription>
              <span aria-hidden="true" className="text-muted-foreground">·</span>
              <a className="inline-flex items-center gap-1 text-primary hover:underline" href={trust8004AgentHref(agent.agentId, agent.chainId)} target="_blank" rel="noopener noreferrer" aria-label={`Identity for agent ${agent.agentId} (opens in a new tab)`}>Identity · #{agent.agentId}<ExternalLink aria-hidden="true" className="size-3" /></a>
            </div>
          </div>
        </div>
      </DialogHeader>
      <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <section className="flex min-w-0 flex-col gap-4" aria-label="Service information">
          {agent.operator === "marketplace" && <p className="text-xs text-muted-foreground">Operated by the marketplace team.</p>}
          <dl aria-label="Agent job history" className="flex gap-8 border-y border-border py-4">
            <div className="flex flex-col-reverse gap-1"><dt className="text-xs text-muted-foreground">Jobs registered</dt><dd className="text-3xl font-medium tabular-nums">{count(agent.jobCount)}</dd></div>
            <div className="flex flex-col-reverse gap-1"><dt className="text-xs text-muted-foreground">Completed</dt><dd className="text-3xl font-medium tabular-nums">{count(agent.completedJobCount)}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">{agent.jobCount === 0 ? "No associated jobs recorded yet." : "Recorded for this agent. Completion is not a quality rating."}</p>
          <div className="grid gap-4 lg:grid-cols-[160px_minmax(0,1fr)]">
            <div className="hidden sm:block"><ServiceCover agent={agent} /></div>
            <div className="min-w-0"><h3 className="mb-2 text-sm font-medium">About this service</h3><p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap wrap-anywhere">{description}</p></div>
          </div>
        </section>
        <aside className="flex flex-col gap-4 rounded-xl border border-border p-5" aria-label="Request a quote">
          <h3 className="text-lg font-medium">Your job, your quote</h3><p className="text-xs text-muted-foreground">{status.label}</p>
          <p className="text-sm text-muted-foreground">Describe what you need, then review the agent’s price and terms.</p>
          <div className="mt-auto flex justify-between gap-3 text-xs"><span>Price</span><span>{agent.quoteRequestAvailable ? "After quotation" : "Unavailable"}</span></div>
          {action.disabled ? <Button disabled>{action.label}</Button> : <Button asChild><Link href={action.href} prefetch={false}><ActionIcon aria-hidden="true" data-icon="inline-start" />{action.label}</Link></Button>}
          <p className="text-xs text-muted-foreground">Opening the service does not send a transaction.</p>
        </aside>
      </div>
    </DialogContent>
  </Dialog>;
}
