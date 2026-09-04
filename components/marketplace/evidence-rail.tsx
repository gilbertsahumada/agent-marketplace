"use client";

import {
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  FileCheck2,
  CircleDashed,
  CircleOff,
  Globe2,
  ReceiptText,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProvenanceBadge } from "./provenance-badge";
import type {
  EvidenceKind,
  EvidenceStatus,
  EvidenceStepViewModel,
} from "./presentation-types";

const statusStyles: Record<EvidenceStatus, string> = {
  verified: "border-emerald-400/70 bg-emerald-400/10 text-emerald-300",
  failed: "border-red-400/70 bg-red-400/[0.06] text-zinc-500",
  current: "border-cyan-400/60 bg-cyan-400/10 text-cyan-300",
  unavailable: "border-zinc-700 bg-zinc-950 text-zinc-500",
  unknown: "border-zinc-700 bg-zinc-950 text-zinc-500",
};

const kindIcons = {
  declared: FileCheck2,
  reachable: Globe2,
  quote: ReceiptText,
  job: BriefcaseBusiness,
} satisfies Record<EvidenceKind, typeof FileCheck2>;

const statusLabels: Record<EvidenceStatus, string> = {
  verified: "Verified",
  failed: "Check failed",
  current: "In progress",
  unavailable: "Unavailable",
  unknown: "Not checked",
};

const provenanceLabels: Record<EvidenceStepViewModel["provenance"], string> = {
  declared: "Declared",
  observed: "Marketplace",
  onchain: "Onchain",
  derived: "Derived",
  not_probed: "Not checked",
  unavailable: "Unavailable",
};

function StepTimestamp({ iso }: { iso: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <span>{iso}</span>;
  const formatted = `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
  return <time dateTime={iso} title={iso}>{formatted}</time>;
}

function StatusIcon({ status }: { status: EvidenceStatus }) {
  if (status === "verified") return <Check aria-hidden="true" className="size-3" />;
  if (status === "failed") return <X aria-hidden="true" className="size-3" />;
  if (status === "current") return <CircleDashed aria-hidden="true" className="size-3" />;
  if (status === "unavailable") return <CircleOff aria-hidden="true" className="size-3" />;
  return <CircleDashed aria-hidden="true" className="size-3" />;
}

function EvidenceIcon({ step, compact = false }: { step: EvidenceStepViewModel; compact?: boolean }) {
  const KindIcon = kindIcons[step.kind];
  return (
    <span
      data-evidence-status={step.status}
      className={cn(
        "relative flex items-center justify-center rounded-full border bg-background",
        compact ? "size-8" : "size-10",
        statusStyles[step.status],
        step.status === "unknown" && "border-dashed",
      )}
    >
      <KindIcon aria-hidden="true" className={compact ? "size-3.5" : "size-4"} />
      <span className={cn(
        "absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border border-background",
        compact ? "size-3.5" : "size-4",
        step.status === "verified" && "bg-emerald-500 text-zinc-950",
        step.status === "failed" && "bg-red-500 text-white",
        step.status !== "verified" && step.status !== "failed" && "bg-zinc-800 text-zinc-200",
      )}>
        <StatusIcon status={step.status} />
      </span>
    </span>
  );
}

export function EvidenceRail({
  steps,
  compact = false,
  density = compact ? "compact" : "full",
  ariaLabel = "Evidence progress",
}: {
  steps: EvidenceStepViewModel[];
  compact?: boolean;
  density?: "full" | "compact" | "summary" | "table";
  ariaLabel?: string;
}) {
  const condensed = density !== "full";
  const summary = density === "summary" || density === "table";
  const table = density === "table";

  return (
    <TooltipProvider>
      <ol
        aria-label={ariaLabel}
        className={cn(
          "grid",
          summary
            ? cn("evidence-rail-summary grid-cols-4", table ? "gap-1" : "gap-1.5 sm:gap-2")
            : "gap-4 md:grid-cols-4 md:gap-3",
          condensed && !summary && "gap-3 md:gap-2",
        )}
      >
        {steps.map((step) => (
          <li
            className={cn("evidence-step min-w-0", summary ? "px-0" : "pl-12 md:pl-0")}
            data-status={step.status}
            key={step.kind}
          >
            <div className={cn(
              "flex min-w-0",
              summary
                ? "flex-col items-center gap-0 text-center"
                : "items-start gap-2 md:flex-col md:items-center md:gap-0 md:text-center",
            )}>
              {summary ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={`${step.label}: ${statusLabels[step.status]}`}
                      className="relative cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      type="button"
                    >
                      <EvidenceIcon compact={table} step={step} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    className="flex max-w-72 flex-col items-start gap-1 border border-zinc-700 bg-zinc-900 p-3 text-left text-zinc-100"
                    sideOffset={8}
                  >
                    <p className="font-semibold">{step.label}</p>
                    <p className="text-cyan-300">{provenanceLabels[step.provenance]} · {statusLabels[step.status]}</p>
                    <p className="leading-relaxed text-zinc-300">{step.detail}</p>
                    {step.timestamp && <p className="text-zinc-400"><StepTimestamp iso={step.timestamp} /></p>}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="absolute left-0 top-0 md:relative"><EvidenceIcon step={step} /></span>
              )}

              <div className={cn(
                "min-w-0",
                summary ? table ? "mt-1.5 w-full" : "mt-2 w-full" : "md:mt-3",
                condensed && !summary && "md:mt-2",
              )}>
                <div className={cn("flex flex-wrap items-center gap-1.5", summary ? "justify-center" : "md:justify-center")}>
                  <p className={cn(
                    "font-semibold text-zinc-100",
                    summary ? table ? "text-[11px] leading-tight" : "text-[11px] leading-tight sm:text-xs" : "text-xs",
                  )}>{step.label}</p>
                  {density === "full" && <ProvenanceBadge provenance={step.provenance} />}
                  {density === "full" && (
                    <span className={cn("text-[10px] capitalize text-zinc-400", step.status === "verified" && "sr-only")}>
                      {statusLabels[step.status]}
                    </span>
                  )}
                </div>
                {density === "compact" && (
                  <p className="mt-1 text-[10px] text-zinc-400">{provenanceLabels[step.provenance]} · {statusLabels[step.status]}</p>
                )}
                {density === "full" && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>}
                {density === "full" && (step.source || step.timestamp) && (
                  <p className="font-stat mt-2 text-[10px] text-zinc-400">
                    {step.source && <span className="font-hash">{step.source}</span>}
                    {step.source && step.timestamp && " · "}
                    {step.timestamp && <StepTimestamp iso={step.timestamp} />}
                  </p>
                )}
                {density === "full" && step.link && (
                  <a
                    className="font-stat mt-1.5 inline-flex items-center gap-0.5 text-[10px] text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-primary hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={step.link.href}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {step.link.label}
                    <ArrowUpRight aria-hidden="true" className="size-3" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </TooltipProvider>
  );
}
