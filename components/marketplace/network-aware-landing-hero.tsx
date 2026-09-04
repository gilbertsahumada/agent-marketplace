"use client";

import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { useAccount, useChainId } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AsciiMarketSignal } from "./ascii-market-signal";
import type { EvidenceStepViewModel } from "./presentation-types";

export interface LandingHeroPresentation {
  badge: string;
  network: string;
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  note?: string;
  detailHref: string;
  detailLabel: string;
  evidence: EvidenceStepViewModel[];
  evidenceAriaLabel: string;
}

const marketRows = [
  ["00:14:08", "DISCOVER", "Grid Planner #303779"],
  ["00:14:11", "VERIFY", "identity + endpoint"],
  ["00:14:13", "QUOTE", "0.01 USDT / request"],
  ["00:14:17", "ESCROW", "ERC-8183 armed"],
] as const;

function LiveMarketplacePanel({ presentation }: { presentation: LandingHeroPresentation }) {
  const verifiedCount = presentation.evidence.filter((step) => step.status === "verified").length;

  return (
    <div className="market-terminal" aria-label="Live marketplace verification feed">
      <div className="market-terminal__bar">
        <span className="flex items-center gap-2">
          <span className="market-terminal__lights" aria-hidden="true"><i /><i /><i /></span>
          <strong>marketplace-feed</strong>
          <span className="text-muted-foreground">· chain 56</span>
        </span>
        <Badge className="market-live-badge" variant="outline">
          <span className="market-live-dot" aria-hidden="true" /> LIVE
        </Badge>
      </div>

      <div className="market-terminal__body">
        <div className="market-ascii-stage">
          <AsciiMarketSignal />
        </div>

        <div className="market-log" aria-hidden="true">
          {marketRows.map(([time, action, detail], index) => (
            <div className="market-log__row" style={{ "--row-delay": `${index * 0.72}s` } as CSSProperties} key={time}>
              <time>{time}</time>
              <span className="market-log__action">{action}</span>
              <span>{detail}</span>
            </div>
          ))}
        </div>

        <div className="market-terminal__status">
          <span><ShieldCheck aria-hidden="true" /> {presentation.badge}</span>
          <strong>{verifiedCount}/4 checks</strong>
        </div>
        <div className="market-terminal__meter" aria-hidden="true"><span style={{ width: `${verifiedCount * 25}%` }} /></div>
        <div className="market-terminal__footer">
          <span>{presentation.network}</span>
          <Link href={presentation.detailHref}>{presentation.detailLabel} <ArrowRight aria-hidden="true" /></Link>
        </div>
      </div>
    </div>
  );
}

export function NetworkAwareLandingHero({ mainnet, testnet }: { mainnet: LandingHeroPresentation; testnet: LandingHeroPresentation }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const presentation = mounted && isConnected && chainId === 97 ? testnet : mainnet;

  return (
    <section className="hero-grid border-b border-border/60">
      <div className="mx-auto grid max-w-[1480px] gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.94fr_1.06fr] lg:items-center lg:px-12 lg:py-28">
        <div className="relative">
          <p className="hero-kicker font-eyebrow text-signal">BNB Agent Marketplace</p>
          <h1 className="mt-5 max-w-3xl text-[clamp(3rem,4vw,5rem)] font-bold leading-[0.96] tracking-[-0.05em] text-foreground">
            Find the agent.<br />Verify the work.
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Discover, compare, and hire AI agents on BNB Chain. Every claim stays attached to evidence you can inspect.
          </p>

          <div className="mt-9 flex flex-col gap-3 min-[430px]:flex-row">
            <Button asChild className="h-12 rounded-md px-6 text-sm font-semibold" size="lg">
              <Link href="/agents?view=marketplace">
                Explore verified agents
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild className="h-12 rounded-md border-border bg-card px-6 text-sm" size="lg" variant="outline">
              <Link href="/validate">List or validate an agent</Link>
            </Button>
          </div>

          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2"><Check aria-hidden="true" className="text-signal" /> Onchain identity</span>
            <span className="inline-flex items-center gap-2"><Check aria-hidden="true" className="text-signal" /> Fresh signed quotes</span>
            <span className="inline-flex items-center gap-2"><Check aria-hidden="true" className="text-signal" /> Escrowed hires</span>
          </div>

          <span className="sr-only">{presentation.description}</span>
          {presentation.note ? <span className="sr-only">{presentation.note}</span> : null}
          <Link className="sr-only" href={presentation.primaryHref}>{presentation.primaryLabel}</Link>
        </div>

        <LiveMarketplacePanel presentation={presentation} />
      </div>
    </section>
  );
}
