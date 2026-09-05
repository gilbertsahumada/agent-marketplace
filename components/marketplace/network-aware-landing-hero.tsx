"use client";

import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { useAccount, useChainId } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AsciiBnbMark } from "./ascii-bnb-mark";
import type { EvidenceStepViewModel, LedgerPulseViewModel } from "./presentation-types";

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

// Indexed Commerce state next to the mark. Every figure comes from the
// observation Worker's indexer; nothing here is a track record, so the copy
// says "indexed" and "activity" and never grades a job.
function LedgerPulse({ pulse }: { pulse: LedgerPulseViewModel | null }) {
  if (pulse === null) {
    return (
      <div className="market-pulse" role="status">
        <p className="market-pulse__eyebrow">ERC-8183 Commerce · BSC Mainnet</p>
        <p className="market-pulse__figure market-pulse__figure--muted">indexer unreachable</p>
        <p className="market-pulse__line">Live counts return when the observation Worker answers. Nothing is estimated in the meantime.</p>
      </div>
    );
  }

  return (
    <dl className="market-pulse" aria-label="Indexed ERC-8183 Commerce state on BSC Mainnet">
      <div className="market-pulse__hero">
        <dt className="market-pulse__eyebrow">{pulse.network}</dt>
        <dd className="market-pulse__figure"><strong>{pulse.jobsIndexed}</strong> jobs indexed</dd>
      </div>
      {pulse.window ? (
        <div className="market-pulse__line">
          <dt>last {pulse.window.days} days</dt>
          <dd>{pulse.window.created} created · {pulse.window.settled} settled · {pulse.window.refunded} refunded</dd>
        </div>
      ) : null}
      <div className="market-pulse__line">
        <dt>hired here</dt>
        <dd>{pulse.processedHere}</dd>
      </div>
      {pulse.indexedThrough ? (
        <div className="market-pulse__line">
          <dt>indexed through</dt>
          <dd>block {pulse.indexedThrough.blockNumber} · {pulse.indexedThrough.ago}</dd>
        </div>
      ) : null}
      <div className="market-pulse__line market-pulse__line--note">
        <dt className="sr-only">note</dt>
        <dd>On-chain state and activity. A settled job proves the phase, not the deliverable.</dd>
      </div>
    </dl>
  );
}

function LiveMarketplacePanel({ presentation, pulse }: { presentation: LandingHeroPresentation; pulse: LedgerPulseViewModel | null }) {
  const verifiedCount = presentation.evidence.filter((step) => step.status === "verified").length;
  const live = pulse !== null;

  return (
    <div className="market-terminal" aria-label="Indexed marketplace ledger feed">
      <div className="market-terminal__bar">
        <span className="flex items-center gap-2">
          <span className="market-terminal__lights" aria-hidden="true"><i /><i /><i /></span>
          <strong>marketplace-feed</strong>
          <span className="text-muted-foreground">· chain 56</span>
        </span>
        <Badge className={live ? "market-live-badge" : "market-live-badge market-live-badge--off"} variant="outline">
          <span className="market-live-dot" aria-hidden="true" /> {live ? "LIVE" : "OFFLINE"}
        </Badge>
      </div>

      <div className="market-terminal__body">
        <div className="market-stage">
          <AsciiBnbMark />
          <LedgerPulse pulse={pulse} />
        </div>

        {pulse !== null && pulse.recent.length > 0 ? (
          <ol className="market-log" aria-label="Most recently updated indexed jobs">
            {pulse.recent.map((job, index) => (
              <li className="market-log__row" style={{ "--row-delay": `${index * 0.72}s` } as CSSProperties} key={job.jobId}>
                <span className="market-log__time">{job.updatedAgo}</span>
                <span className="market-log__action">{job.status}</span>
                <Link href={job.href}>
                  Job #{job.jobId} · buyer {job.buyerShort}{job.marketplace ? " · hired here" : ""}
                </Link>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="market-terminal__status">
          <span><ShieldCheck aria-hidden="true" /> {presentation.badge}</span>
          <strong>{verifiedCount}/4 checks</strong>
        </div>
        <div className="market-terminal__meter" aria-hidden="true"><span style={{ width: `${verifiedCount * 25}%` }} /></div>
        <div className="market-terminal__footer">
          <span>{presentation.network}</span>
          <span className="market-terminal__links">
            {live ? <Link href="/jobs">All indexed jobs</Link> : null}
            <Link href={presentation.detailHref}>{presentation.detailLabel} <ArrowRight aria-hidden="true" /></Link>
          </span>
        </div>
      </div>
    </div>
  );
}

export function NetworkAwareLandingHero({ mainnet, testnet, ledgerPulse = null }: {
  mainnet: LandingHeroPresentation;
  testnet: LandingHeroPresentation;
  ledgerPulse?: LedgerPulseViewModel | null;
}) {
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

        <LiveMarketplacePanel presentation={presentation} pulse={ledgerPulse} />
      </div>
    </section>
  );
}
