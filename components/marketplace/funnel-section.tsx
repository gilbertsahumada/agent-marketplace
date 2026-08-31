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

function stageCountValue(stage: FunnelStageViewModel): number | null {
  if (stage.count === null) return null;
  const value = Number(stage.count.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function FunnelBar({ stage, total }: { stage: FunnelStageViewModel; total: number | null }) {
  if (stage.count === null || stage.provenance === null) {
    return (
      <li className="flex flex-col gap-1 border-t border-dashed border-white/10 py-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="w-full shrink-0 text-sm font-semibold text-zinc-500 sm:w-56">{stage.label}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
          <CircleDashed aria-hidden="true" className="size-3" />
          <span>Pending observation</span>
          <span>· {stage.detail}</span>
        </span>
      </li>
    );
  }
  const value = stageCountValue(stage);
  const ratio = total && value !== null ? Math.max((value / total) * 100, 5) : 100;
  return (
    <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-full shrink-0 sm:w-56">
        <span className="block text-sm font-semibold text-zinc-100">{stage.label}</span>
        <span className="block text-[11px] leading-snug text-zinc-500">{stage.detail}</span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="flex h-8 items-center rounded-lg border border-white/15 bg-gradient-to-r from-white/20 to-white/5 px-3"
          style={{ width: `${ratio}%`, minWidth: "3.5rem" }}
        >
          <span className="font-stat text-sm font-bold text-white">{stage.count}</span>
        </span>
        {stage.share !== null && <span className="font-stat text-xs text-zinc-500">{stage.share}</span>}
      </span>
      <span className="shrink-0 sm:w-24 sm:text-right">
        <ProvenanceBadge provenance={stage.provenance} />
      </span>
    </li>
  );
}

export function FunnelSection({ funnel }: { funnel: FunnelSectionViewModel | null }) {
  const registered = funnel?.stages[0]?.count ?? null;
  const registeredTotal = funnel?.stages[0] ? stageCountValue(funnel.stages[0]) : null;
  const hiring = funnel?.stages.find((stage) => stage.label === "Declares ERC-8183 hiring")?.count ?? null;
  return (
    <section aria-labelledby="funnel-heading" className="border-b border-white/10 bg-zinc-950/40">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-3xl">
          <p className="font-eyebrow font-eyebrow-dot text-zinc-400">The measurable funnel</p>
          <h2 className="mt-2 text-3xl font-light tracking-tight text-white" id="funnel-heading">
            {registered && hiring
              ? <>{registered} registered. {hiring} declare hiring. <span className="text-primary">We measure the difference.</span></>
              : "Most registered agents cannot be hired."}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
            A registration is only a name in a registry. No composite scores, no stored booleans.
          </p>
        </div>

        {funnel && (
          <>
            <ol className="mt-8 max-w-5xl">
              {funnel.stages.map((stage) => (
                <FunnelBar key={stage.label} stage={stage} total={registeredTotal} />
              ))}
            </ol>
            <p className="mt-3 font-stat text-xs text-zinc-500">
              Source {funnel.citation.artifact} · SHA-256 {funnel.citation.sha256.slice(0, 8)}…{funnel.citation.sha256.slice(-8)} ·
              block {funnel.citation.blockNumber} · {funnel.citation.generatedAt}
            </p>
          </>
        )}

        <Accordion className="mt-10 rounded-2xl border border-white/10 bg-zinc-950/60 px-6" collapsible type="single">
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
