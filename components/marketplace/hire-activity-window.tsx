import type { HireActivity } from "@/src/business/entities/hire-job";
import { HIRE_PHASES, type VerifiedHirePhase } from "@/src/business/entities/verified-hire-event";

const PHASE_LABELS: Record<VerifiedHirePhase, string> = {
  created: "Created", funded: "Funded", submitted: "Submitted", settled: "Settled", refunded: "Refunded",
};
const ACTIVITY_NOTE = "Counts phase events indexed since the ledger started; earlier jobs are present by state only.";

// Trailing window of phase events: totals per phase, then one row per UTC day
// that had any. Activity only; a settled count proves phases, not deliverables.
export function HireActivityWindow({ activity }: { activity: HireActivity }) {
  const title = `Last ${activity.days} days`;
  const totalsLabel = `Phase totals, last ${activity.days} days`;
  return (
    <section aria-labelledby="recent-activity" className="border-b border-border/60 pb-6">
      <h2 className="text-xl font-medium" id="recent-activity">{title}</h2>
      <ul aria-label={totalsLabel} className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
        {HIRE_PHASES.map((phase) => (
          <li className="flex flex-col" key={phase}>
            <span className="text-sm text-muted-foreground">{PHASE_LABELS[phase]}</span>
            <span className="mt-1 text-2xl tabular-nums">{activity.totals[phase].toLocaleString("en")}</span>
          </li>
        ))}
      </ul>
      {activity.byDay.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="jobs-table max-w-3xl">
            <caption className="sr-only">Phase events per UTC day</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {HIRE_PHASES.map((phase) => (
                  <th key={phase} scope="col">{PHASE_LABELS[phase]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activity.byDay.map((row) => (
                <tr key={row.day}>
                  <th scope="row">{row.day}</th>
                  {HIRE_PHASES.map((phase) => (
                    <td className="tabular-nums" key={phase}>{row[phase].toLocaleString("en")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No phase events indexed in this window.</p>
      )}
      <p className="mt-3 text-sm text-muted-foreground">{ACTIVITY_NOTE}</p>
    </section>
  );
}
