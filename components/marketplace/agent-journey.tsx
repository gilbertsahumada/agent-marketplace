import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BadgeCheck, BriefcaseBusiness, CircleAlert, CircleDashed, FileText, RadioTower, ShieldCheck } from "lucide-react";
import type { AgentJourneyModel, AgentJourneyStage, AgentJourneyStageState } from "./agent-journey-state";
import { Button } from "@/components/ui/button";

const stageIcons = {
  declared: FileText,
  availability: RadioTower,
  quote: BadgeCheck,
  hire: ShieldCheck,
  jobs: BriefcaseBusiness,
} as const;

const stateStyles: Record<AgentJourneyStageState, { icon: string; text: string }> = {
  verified: { icon: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300", text: "text-emerald-200" },
  current: { icon: "border-cyan-400/50 bg-cyan-400/10 text-cyan-200", text: "text-cyan-200" },
  attention: { icon: "border-amber-400/50 bg-amber-400/10 text-amber-200", text: "text-amber-200" },
  locked: { icon: "border-zinc-700 bg-zinc-950 text-zinc-500", text: "text-zinc-500" },
};

function stageIcon(state: AgentJourneyStageState) {
  if (state === "verified") return <span aria-hidden="true" className="text-sm">✓</span>;
  if (state === "attention") return <CircleAlert aria-hidden="true" className="size-4" />;
  if (state === "current") return <CircleDashed aria-hidden="true" className="size-4" />;
  return <span aria-hidden="true" className="size-2 rounded-full bg-current" />;
}

function JourneyStage({ kind, stage }: { kind: keyof typeof stageIcons; stage: AgentJourneyStage }) {
  const Icon = stageIcons[kind];
  const styles = stateStyles[stage.state];
  return (
    <li className="relative min-w-0" data-journey-state={stage.state}>
      <div className="flex items-start gap-3">
        <span className={`relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border ${styles.icon}`}>
          <Icon aria-hidden="true" className="size-4" />
          <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border border-background bg-background text-[10px] font-semibold">
            {stageIcon(stage.state)}
          </span>
        </span>
        <div className="min-w-0 pt-0.5">
          <p className={`text-sm font-medium ${stage.state === "locked" ? "text-zinc-400" : "text-zinc-100"}`}>{stage.label}</p>
          <p className={`mt-1 text-xs leading-relaxed ${styles.text}`}>{stage.detail}</p>
        </div>
      </div>
    </li>
  );
}

export function AgentJourney({
  model,
  lastCheckedAt,
  attemptCount,
}: {
  model: AgentJourneyModel;
  lastCheckedAt?: string;
  attemptCount?: number;
}) {
  return (
    <section aria-labelledby="agent-journey-title" className="mt-6 rounded-xl border border-white/10 bg-white/[0.015] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-eyebrow text-zinc-500">Buyer journey</p>
          <h2 className="mt-1 text-base font-medium text-white" id="agent-journey-title">Readiness at a glance</h2>
        </div>
        <p aria-live="polite" className="max-w-md text-right text-xs leading-relaxed text-zinc-400">{model.nextAction}</p>
      </div>
      <ol aria-label="Agent hiring readiness" className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
        <JourneyStage kind="declared" stage={model.declared} />
        <JourneyStage kind="availability" stage={model.availability} />
        <JourneyStage kind="quote" stage={model.quote} />
        <JourneyStage kind="hire" stage={model.hire} />
        <JourneyStage kind="jobs" stage={model.jobs} />
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.07] pt-3 text-[11px] text-zinc-500">
        <span>Every state is derived from shared marketplace evidence.</span>
        {typeof attemptCount === "number" ? <span>{attemptCount} platform attempt{attemptCount === 1 ? "" : "s"}</span> : null}
        {lastCheckedAt ? <time dateTime={lastCheckedAt}>Last checked {lastCheckedAt}</time> : null}
      </div>
    </section>
  );
}

export function HiringUnavailable({
  model,
  validationAvailable,
  notice,
}: {
  model: AgentJourneyModel;
  validationAvailable: boolean;
  notice?: ReactNode;
}) {
  const locked = model.hire.state === "locked";
  return (
    <section aria-labelledby="hire-flow-title" className="mt-6 scroll-mt-6 rounded-xl border border-white/10 bg-white/[0.015] p-5" id="hire-flow">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border ${stateStyles[model.hire.state].icon}`}>
          {locked ? <ShieldCheck aria-hidden="true" className="size-4" /> : <CircleAlert aria-hidden="true" className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="font-eyebrow text-zinc-500">Hiring</p>
          <h2 className="mt-1 text-base font-medium text-white" id="hire-flow-title">
            {locked ? "Hiring unavailable for this agent." : model.hire.label}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">{model.hire.detail}</p>
        </div>
      </div>
      {notice ? <div className="mt-4">{notice}</div> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/[0.07] pt-4">
        {validationAvailable && model.availability.state !== "verified" ? (
          <Button asChild size="sm" variant="outline">
            <Link href="#validation">Check availability<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
          </Button>
        ) : null}
        <span className="text-xs text-zinc-500">{model.nextAction}</span>
      </div>
    </section>
  );
}
