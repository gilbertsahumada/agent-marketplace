"use client";

import * as React from "react";
import { CircleHelp } from "lucide-react";
import { Bar, BarChart } from "recharts";
import type { HireActivity, HireActivityCounts } from "@/src/business/entities/hire-job";
import { HIRE_PHASES, type VerifiedHirePhase } from "@/src/business/entities/verified-hire-event";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AsciiClouds } from "./ascii-clouds";

const DAY_MS = 86_400_000;
const ZERO_COUNTS: HireActivityCounts = { created: 0, funded: 0, submitted: 0, settled: 0, refunded: 0 };

export const PHASE_LABELS: Record<VerifiedHirePhase, string> = {
  created: "Created",
  funded: "Funded",
  submitted: "Submitted",
  settled: "Settled",
  refunded: "Refunded",
};

export const PHASE_DESCRIPTIONS: Record<VerifiedHirePhase, string> = {
  created: "JobCreated events indexed onchain during the selected period.",
  funded: "JobFunded events indexed onchain during the selected period.",
  submitted: "JobSubmitted events indexed onchain during the selected period.",
  settled: "JobCompleted events indexed onchain during the selected period.",
  refunded: "Refund events indexed onchain during the selected period.",
};

const chartConfig = Object.fromEntries(HIRE_PHASES.map((phase) => [
  phase,
  { label: PHASE_LABELS[phase], color: "var(--signal)" },
])) as ChartConfig;

export function dailyActivitySeries(activity: HireActivity): HireActivity["byDay"] {
  const end = new Date(activity.to);
  if (!Number.isFinite(end.getTime()) || !Number.isSafeInteger(activity.days) || activity.days < 1) return activity.byDay;

  const rows = new Map(activity.byDay.map((row) => [row.day, row]));
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Array.from({ length: activity.days }, (_, index) => {
    const day = new Date(endDay - (activity.days - index - 1) * DAY_MS).toISOString().slice(0, 10);
    return rows.get(day) ?? { day, ...ZERO_COUNTS };
  });
}

function formatDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function HireActivityChart({ activity }: { activity: HireActivity }) {
  const data = React.useMemo(() => dailyActivitySeries(activity), [activity]);

  return (
    <TooltipProvider delayDuration={180}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {HIRE_PHASES.map((phase) => (
          <Card className="jobs-activity-card relative min-h-40 gap-0 overflow-hidden py-0 ring-0" key={phase}>
            <AsciiClouds className="jobs-activity-ascii-clouds" />
            <CardHeader className="relative z-10 gap-1 px-4 pt-4 pb-0">
              <div className="flex items-center gap-1">
                <CardTitle className="text-sm font-normal text-muted-foreground">{PHASE_LABELS[phase]}</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={`About the ${PHASE_LABELS[phase]} metric`}
                      className="rounded-full text-muted-foreground hover:bg-signal/10 hover:text-signal"
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <CircleHelp aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64 leading-relaxed" side="top" sideOffset={8}>
                    {PHASE_DESCRIPTIONS[phase]}
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="font-stat text-[28px] leading-none font-medium tracking-tight text-foreground tabular-nums">
                {activity.totals[phase].toLocaleString("en")}
              </p>
            </CardHeader>
            <CardContent className="relative z-10 mt-auto px-3 pt-3 pb-3">
              <ChartContainer
                aria-label={`${PHASE_LABELS[phase]} events per UTC day over the last ${activity.days} days`}
                className="h-20 w-full"
                config={chartConfig}
                initialDimension={{ width: 240, height: 80 }}
                role="img"
              >
                <BarChart accessibilityLayer barCategoryGap="20%" data={data} margin={{ top: 3, right: 0, bottom: 0, left: 0 }}>
                  <ChartTooltip
                    cursor={{ fill: "color-mix(in oklab, var(--signal) 7%, transparent)" }}
                    content={<ChartTooltipContent hideIndicator labelFormatter={(value) => formatDay(String(value))} />}
                  />
                  <Bar dataKey={phase} fill={`var(--color-${phase})`} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        ))}
      </div>
    </TooltipProvider>
  );
}
