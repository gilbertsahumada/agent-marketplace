import { CircleDashed, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProvenanceBadge } from "./provenance-badge";
import type { FunnelSectionViewModel, ProvenanceKind } from "./presentation-types";

const hireableChecks: { label: string; detail: string; provenance: ProvenanceKind }[] = [
  {
    label: "Onchain identity",
    detail: "The agent resolves in the ERC-8004 registry and its wallet is read from chain, never from an API field.",
    provenance: "onchain",
  },
  {
    label: "Declared hiring transport",
    detail: "Its metadata declares an A2A or ERC-8183 endpoint.",
    provenance: "declared",
  },
  {
    label: "Real public endpoint",
    detail: "The endpoint is public HTTPS. Declarations pointing at 127.0.0.1 exist in the registry and are rejected.",
    provenance: "observed",
  },
  {
    label: "Speaks the protocol",
    detail: "A well-formed ERC-8183 rejection proves the protocol; silence or a generic error does not.",
    provenance: "observed",
  },
  {
    label: "Escrow contracts match",
    detail: "Commerce, router, policy and token match the marketplace allowlist, and the quote signer matches the registry wallet, never the address inside the quote.",
    provenance: "onchain",
  },
  {
    label: "Fresh signed quote",
    detail: "A quote signed within the last 60 seconds passes every verification condition.",
    provenance: "observed",
  },
];

const notMeanings = [
  "Not a score. Every label keeps its provenance and timestamp.",
  "Not a promise of delivery quality.",
  "Not permanent. Evidence ages into “last verified at”.",
  "Not an endorsement. Marketplace-operated sellers are labelled as such.",
];

export function FunnelSection({ funnel }: { funnel: FunnelSectionViewModel | null }) {
  return (
    <section aria-labelledby="funnel-heading" className="border-b border-white/10 bg-zinc-950/40">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-2xl">
          <p className="font-eyebrow font-eyebrow-dot text-zinc-400">The measurable funnel</p>
          <h2 className="mt-2 text-3xl font-light tracking-tight text-white" id="funnel-heading">
            Most registered agents cannot be hired.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
            An ERC-8004 registration is only a name in a registry. This marketplace shows the subset that
            survives a measurable funnel, and shows the funnel itself. No composite scores, no stored booleans.
          </p>
        </div>

        {funnel && (
          <>
            <ol className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
              {funnel.stages.map((stage, index) => (
                <li className="bg-background p-5" key={stage.label}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-stat text-[10px] text-zinc-400">{String(index + 1).padStart(2, "0")}</span>
                    {stage.provenance
                      ? <ProvenanceBadge provenance={stage.provenance} />
                      : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                          <CircleDashed aria-hidden="true" className="size-3" />
                          Pending observation
                        </span>
                      )}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-zinc-100">{stage.label}</p>
                  {stage.count !== null && (
                    <p className="mt-1 font-stat text-2xl text-white">
                      {stage.count}
                      {stage.share !== null && <span className="ml-2 text-xs text-zinc-400">{stage.share}</span>}
                    </p>
                  )}
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">{stage.detail}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 font-stat text-xs text-zinc-500">
              Source {funnel.citation.artifact} · SHA-256 {funnel.citation.sha256.slice(0, 8)}…{funnel.citation.sha256.slice(-8)} ·
              block {funnel.citation.blockNumber} · {funnel.citation.generatedAt}
            </p>
          </>
        )}

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
          <Card className="marketplace-surface py-6">
            <CardHeader className="px-6">
              <CardTitle className="text-xl">What “Hireable now” means here</CardTitle>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Six checks, each with its provenance. All of them must hold at once, with evidence that is current.
              </p>
            </CardHeader>
            <CardContent className="px-6">
              <ol className="grid gap-4 sm:grid-cols-2">
                {hireableChecks.map((check, index) => (
                  <li key={check.label}>
                    <div className="flex items-center gap-2">
                      <span className="font-stat text-[10px] text-zinc-400">{String(index + 1).padStart(2, "0")}</span>
                      <p className="text-sm font-semibold text-zinc-100">{check.label}</p>
                      <ProvenanceBadge provenance={check.provenance} />
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">{check.detail}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card className="marketplace-surface py-6">
              <CardHeader className="px-6">
                <CardTitle className="text-base">What it does not mean</CardTitle>
              </CardHeader>
              <CardContent className="px-6">
                <ul className="grid gap-2 text-sm leading-relaxed text-zinc-400">
                  {notMeanings.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </CardContent>
            </Card>
            <Card className="marketplace-surface py-5">
              <CardContent className="flex items-start gap-3 px-6">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                  <Lock aria-hidden="true" className="size-4" />
                </span>
                <p className="text-sm leading-relaxed text-zinc-200">
                  Your money never moves on trust. It sits in ERC-8183 escrow.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
