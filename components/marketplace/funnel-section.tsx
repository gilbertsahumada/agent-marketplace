import { CircleDashed, Lock } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProvenanceBadge } from "./provenance-badge";
import type { FunnelSectionViewModel, FunnelStageViewModel, ProvenanceKind } from "./presentation-types";

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

function EvidenceMetric({ stage }: { stage: FunnelStageViewModel }) {
  if (stage.count === null || stage.provenance === null) {
    return (
      <li className="evidence-metric evidence-metric--pending">
        <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
          <CircleDashed aria-hidden="true" className="size-3" /> Not published
        </span>
        <strong className="mt-8 block text-xl text-zinc-400">Awaiting complete verification</strong>
        <span className="mt-3 block text-sm font-semibold text-zinc-200">{stage.label}</span>
        <span className="mt-2 block text-xs leading-relaxed text-zinc-500">{stage.detail}</span>
      </li>
    );
  }
  return (
    <li className="evidence-metric">
      <span>
        <ProvenanceBadge provenance={stage.provenance} />
      </span>
      <strong className="font-stat mt-7 block text-4xl font-bold tracking-[-0.04em] text-white sm:text-5xl">{stage.count}</strong>
      <span className="mt-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
        {stage.label}
        {stage.share !== null && <small className="font-stat text-xs font-normal text-zinc-500">{stage.share}</small>}
      </span>
      <span className="mt-2 block text-xs leading-relaxed text-zinc-500">{stage.detail}</span>
    </li>
  );
}

export function FunnelSection({ funnel }: { funnel: FunnelSectionViewModel | null }) {
  return (
    <section aria-labelledby="funnel-heading" className="border-b border-border/60 bg-card/35">
      <div className="mx-auto max-w-[1480px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
            <p className="font-eyebrow text-primary">Evidence, not estimates</p>
            <h2 className="mt-4 text-4xl font-bold leading-[1.03] tracking-[-0.04em] text-foreground sm:text-5xl" id="funnel-heading">
              Know what is proven. <span className="text-primary">Know what is only declared.</span>
            </h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground lg:justify-self-end">
            Every figure is tied to a reproducible snapshot. Missing verification stays visibly unpublished—never converted into a zero or a marketing claim.
          </p>
        </div>

        {funnel && (
          <>
            <ol className="mt-12 grid overflow-hidden rounded-2xl border border-border bg-background/45 sm:grid-cols-2 lg:grid-cols-4">
              {funnel.stages.map((stage) => (
                <EvidenceMetric key={stage.label} stage={stage} />
              ))}
            </ol>
            <div className="evidence-citation mt-4 font-stat text-[11px] text-zinc-500">
              <span><small>Scan opened</small>{new Date(funnel.citation.generatedAt).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</span>
              <span><small>Opening BSC block</small>{funnel.citation.blockNumber}</span>
              <span><small>Snapshot hash</small>{funnel.citation.sha256.slice(0, 10)}…{funnel.citation.sha256.slice(-10)}</span>
              <span><small>Artifact</small>{funnel.citation.artifact}</span>
            </div>
          </>
        )}

        <Accordion className="mt-10 rounded-2xl border border-border bg-background/45 px-6" collapsible type="single">
          <AccordionItem className="border-b-0" value="hireable-now">
            <AccordionTrigger className="py-4 text-sm font-semibold text-zinc-200 hover:no-underline">
              What “Hireable now” means here
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-6 pb-2 pt-1 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
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
                <div className="flex flex-col gap-4">
                  <Card className="marketplace-surface py-5">
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
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </section>
  );
}
