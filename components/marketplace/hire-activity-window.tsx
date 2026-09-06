import Link from "next/link";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { HireActivity } from "@/src/business/entities/hire-job";
import { HireActivityChart } from "./hire-activity-chart";

const ACTIVITY_NOTE = "Counts phase events indexed since the ledger started; earlier jobs are present by state only.";

export function HireActivityWindow({ activity, periodHrefs }: {
  activity: HireActivity;
  periodHrefs?: Record<7 | 30 | 90, string>;
}) {
  const hrefs = periodHrefs ?? {
    7: `/jobs?chainId=${activity.chainId}&days=7`,
    30: `/jobs?chainId=${activity.chainId}`,
    90: `/jobs?chainId=${activity.chainId}&days=90`,
  };

  return (
    <section aria-labelledby="recent-activity">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-medium" id="recent-activity">ERC-8183 activity</h2>
        <details className="group/period relative">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal [&::-webkit-details-marker]:hidden">
            <CalendarDays aria-hidden="true" className="size-4" />
            Past {activity.days} days
            <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open/period:rotate-180" />
          </summary>
          <div className="absolute top-11 left-0 z-20 min-w-40 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl">
            {([7, 30, 90] as const).map((days) => (
              <Link
                aria-current={activity.days === days ? "true" : undefined}
                className="block rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-muted aria-current:bg-muted aria-current:text-signal"
                href={hrefs[days]}
                key={days}
              >Past {days} days</Link>
            ))}
          </div>
        </details>
      </div>
      <HireActivityChart activity={activity} />
      <p className="sr-only">{ACTIVITY_NOTE}</p>
    </section>
  );
}
