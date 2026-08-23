import {
  BadgeCheck,
  Blocks,
  Check,
  CircleDashed,
  CircleOff,
  FileText,
  RadioTower,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProvenanceBadge } from "./provenance-badge";
import type {
  EvidenceKind,
  EvidenceStatus,
  EvidenceStepViewModel,
} from "./presentation-types";

const kindStyles: Record<EvidenceKind, string> = {
  declared: "border-indigo-400/50 bg-indigo-400/10 text-indigo-300",
  reachable: "border-cyan-400/50 bg-cyan-400/10 text-cyan-300",
  quote: "border-primary/60 bg-primary/10 text-primary",
  job: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
};

const kindIcons = {
  declared: FileText,
  reachable: RadioTower,
  quote: BadgeCheck,
  job: Blocks,
} satisfies Record<EvidenceKind, typeof FileText>;

const statusLabels: Record<EvidenceStatus, string> = {
  verified: "verified",
  current: "in progress",
  unavailable: "unavailable",
  unknown: "not observed",
};

function StatusIcon({ status }: { status: EvidenceStatus }) {
  if (status === "verified") return <Check aria-hidden="true" className="size-3" />;
  if (status === "current") return <CircleDashed aria-hidden="true" className="size-3" />;
  if (status === "unavailable") return <CircleOff aria-hidden="true" className="size-3" />;
  return <CircleDashed aria-hidden="true" className="size-3" />;
}

export function EvidenceRail({
  steps,
  compact = false,
  ariaLabel = "Evidence progress",
}: {
  steps: EvidenceStepViewModel[];
  compact?: boolean;
  ariaLabel?: string;
}) {
  return (
    <ol
      aria-label={ariaLabel}
      className={cn(
        "grid gap-4 md:grid-cols-4 md:gap-3",
        compact && "gap-3 md:gap-2",
      )}
    >
      {steps.map((step) => {
        const KindIcon = kindIcons[step.kind];
        const isActive = step.status === "verified" || step.status === "current";

        return (
          <li
            className="evidence-step min-w-0 pl-12 md:pl-0"
            data-status={step.status}
            key={step.kind}
          >
            <div className="flex min-w-0 items-start gap-2 md:block">
              <div
                className={cn(
                  "absolute left-0 top-0 z-10 flex size-10 items-center justify-center rounded-full border bg-background md:relative",
                  isActive ? kindStyles[step.kind] : "border-zinc-700 text-zinc-500",
                  step.status === "unknown" && "border-dashed",
                )}
              >
                <KindIcon aria-hidden="true" className="size-4" />
                <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border border-background bg-zinc-800 text-zinc-200">
                  <StatusIcon status={step.status} />
                </span>
              </div>

              <div className={cn("min-w-0 md:mt-3", compact && "md:mt-2")}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-xs font-semibold text-zinc-100">{step.label}</p>
                  {!compact && <ProvenanceBadge provenance={step.provenance} />}
                  {!compact && (
                    <span className="text-[10px] capitalize text-zinc-400">
                      {statusLabels[step.status]}
                    </span>
                  )}
                </div>
                {compact && (
                  <p className="mt-1 text-[10px] capitalize text-zinc-400">
                    {step.provenance} · {statusLabels[step.status]}
                  </p>
                )}
                {!compact && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {step.detail}
                  </p>
                )}
                {!compact && (step.source || step.timestamp) && (
                  <p className="font-stat mt-2 text-[10px] text-zinc-400">
                    {[step.source, step.timestamp].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
