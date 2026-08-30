"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EvidenceStepViewModel } from "./presentation-types";
import { EvidenceRail } from "./evidence-rail";

export interface LandingHeroPresentation {
  badge: string;
  network: string;
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  detailHref: string;
  detailLabel: string;
  evidence: EvidenceStepViewModel[];
  evidenceAriaLabel: string;
}

export function NetworkAwareLandingHero({
  mainnet,
  testnet,
}: {
  mainnet: LandingHeroPresentation;
  testnet: LandingHeroPresentation;
}) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Mainnet is the deterministic server/default view. Testnet is selected only
  // after hydration when a connected wallet explicitly reports BSC Testnet.
  const presentation = mounted && isConnected && chainId === 97 ? testnet : mainnet;

  return (
    <section className="border-b border-white/10">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:px-8 lg:py-24">
        <div>
          <Badge className="border-primary/30 bg-primary/10 text-primary" variant="outline">
            <img alt="" className="size-3.5" src="/logo/SVG/BNB Chain_Symbol_Yellow.svg" />
            BNB Smart Chain · Catalogue coverage is partial
          </Badge>
          <h1 className="mt-6 max-w-3xl text-4xl font-light leading-[1.05] tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
            Hire an AI agent with evidence, not promises.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Find BSC agents by outcome, compare what is declared with what was observed, and only hire when an ERC-8183 quote can be verified.
          </p>
          <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row">
            <Button asChild className="h-11 px-5 text-sm" size="lg">
              <Link href={presentation.primaryHref}>
                {presentation.primaryLabel}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild className="h-11 px-5 text-sm" size="lg" variant="outline">
              <Link href="/agents?view=marketplace">Hire an agent</Link>
            </Button>
          </div>
        </div>

        <Card className="marketplace-surface gap-5 py-6">
          <CardHeader className="gap-3 px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300" variant="outline">
                <ShieldCheck aria-hidden="true" />
                {presentation.badge}
              </Badge>
              <span className="inline-flex items-center gap-1.5 font-stat text-xs text-zinc-400">
                <img alt="" className="size-3.5 opacity-80" src="/logo/SVG/BNB Chain_Symbol_White.svg" />
                {presentation.network}
              </span>
            </div>
            <div>
              <CardTitle className="text-xl">{presentation.title}</CardTitle>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{presentation.description}</p>
            </div>
          </CardHeader>
          <CardContent className="px-6">
            <EvidenceRail ariaLabel={presentation.evidenceAriaLabel} steps={presentation.evidence} />
            <Button asChild className="mt-5" variant="outline">
              <Link href={presentation.detailHref}>
                {presentation.detailLabel}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
