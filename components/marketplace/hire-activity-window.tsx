import type { HireActivity } from "@/src/business/entities/hire-job";
import type { VerifiedHirePhase } from "@/src/business/entities/verified-hire-event";

export const HIRE_PHASES: readonly VerifiedHirePhase[] = ["created", "funded", "submitted", "settled", "refunded"];
const PHASE_LABELS: Record<VerifiedHirePhase, string> = {
  created: "Created", funded: "Funded", submitted: "Submitted", settled: "Settled", refunded: "Refunded",
};
export const ACTIVITY_NOTE = "Counts phase events indexed since the ledger started; earlier jobs are present by state only.";

export function hirePhaseLabel(phase: VerifiedHirePhase): string {
  return PHASE_LABELS[phase];
}

// Trailing window of phase events: totals per phase, then one row per UTC day
// that had any. Activity only; a settled count proves phases, not deliverables.
export function HireActivityWindow({ activity }: { activity: HireActivity }) {
  const title = `Last ${activity.days} days`;
  const totalsLabel = `Phase totals, last ${activity.days} days`;
  return (
    <section aria-labelledby="recent-activity" className="rounded-xl border border-white/10 bg-white/[0.015] px-5 py-4">
      <h2 className="text-sm font-medium text-zinc-300" id="recent-activity">{title}</h2>
      <ul aria-label={totalsLabel} className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
        {HIRE_PHASES.map((phase) => (
          <li className="flex flex-col" key={phase}>
            <span className="text-xs text-zinc-500">{hirePhaseLabel(phase)}</span>
            <span className="font-stat text-zinc-200">{activity.totals[phase].toLocaleString("en")}</span>
          </li>
        ))}
      </ul>
      {activity.byDay.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Phase events per UTC day</caption>
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="py-1 pr-4 font-medium" scope="col">Day</th>
                {HIRE_PHASES.map((phase) => (
                  <th className="py-1 pr-4 text-right font-medium" key={phase} scope="col">{hirePhaseLabel(phase)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activity.byDay.map((row) => (
                <tr className="border-t border-white/10" key={row.day}>
                  <th className="py-1.5 pr-4 font-normal text-zinc-300" scope="row">{row.day}</th>
                  {HIRE_PHASES.map((phase) => (
                    <td className="font-stat py-1.5 pr-4 text-right text-zinc-200" key={phase}>{row[phase].toLocaleString("en")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">No phase events indexed in this window.</p>
      )}
      <p className="mt-3 text-xs text-zinc-500">{ACTIVITY_NOTE}</p>
    </section>
  );
}
