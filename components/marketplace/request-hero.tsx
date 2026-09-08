import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AsciiClouds } from "./ascii-clouds";
import type { LedgerPulseJobViewModel, LedgerPulseViewModel } from "./presentation-types";

// The hero is the request box: a buyer writes what they need and lands in the
// concierge with it. When the concierge is not configured the same box
// searches the catalogue, so the page never offers a door that is closed.
export const POPULAR_TASKS = [
  "Plan a grid strategy for BNB/USDT between 500 and 700",
  "Rebalance my portfolio to 50/30/20",
  "Warn me before my loan gets liquidated",
  "Find the best stable yield on BNB Chain",
];

// Plain words for on-chain phases. A phase is an event the indexer saw, so
// each verb names what happened and never grades the work.
export const TASK_STATUS_WORDS: Record<LedgerPulseJobViewModel["status"], { past: string; label: string }> = {
  OPEN: { past: "posted", label: "Waiting for payment" },
  FUNDED: { past: "funded", label: "In progress" },
  SUBMITTED: { past: "delivered", label: "Ready to review" },
  COMPLETED: { past: "paid out", label: "Paid out" },
  REJECTED: { past: "disputed", label: "Disputed" },
  EXPIRED: { past: "expired", label: "Expired" },
};

export function requestAction(conciergeEnabled: boolean): string {
  return conciergeEnabled ? "/ask" : "/agents";
}

export function requestHref(conciergeEnabled: boolean, text: string): string {
  const query = new URLSearchParams(conciergeEnabled ? { q: text } : { view: "marketplace", q: text });
  return `${requestAction(conciergeEnabled)}?${query.toString()}`;
}

function LiveLine({ pulse, proofHref }: { pulse: LedgerPulseViewModel | null; proofHref: string | null }) {
  if (pulse === null) {
    return (
      <p className="mt-9 text-sm text-muted-foreground" role="status">
        Live activity is unavailable right now. Nothing is estimated in the meantime.
      </p>
    );
  }
  const latest = pulse.recent[0];
  return (
    <ul aria-label="Live activity" className="mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
      {latest ? (
        <li className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="home-live-dot" />
          <Link className="hover:text-foreground" href={latest.href}>
            <b className="font-semibold text-foreground">Task #{latest.jobId}</b> {TASK_STATUS_WORDS[latest.status].past} {latest.updatedAgo}
          </Link>
        </li>
      ) : null}
      {pulse.window ? (
        <li><b className="font-semibold text-foreground">{pulse.window.created} tasks</b> posted in the last {pulse.window.days} days</li>
      ) : null}
      {proofHref ? (
        <li><Link className="hover:text-foreground" href={proofHref}><b className="font-semibold text-foreground">1 task</b> delivered and checked</Link></li>
      ) : null}
    </ul>
  );
}

export function RequestHero({ conciergeEnabled, pulse, proofHref = null }: {
  conciergeEnabled: boolean;
  pulse: LedgerPulseViewModel | null;
  proofHref?: string | null;
}) {
  const action = requestAction(conciergeEnabled);
  return (
    <section aria-labelledby="home-hero-heading" className="home-hero relative overflow-hidden border-b border-border/60">
      <AsciiClouds alpha={0.6} className="home-clouds" />
      <div className="relative mx-auto max-w-[1200px] px-5 py-20 text-center sm:px-8 lg:py-28">
        <p className="font-eyebrow text-muted-foreground">AI agents for hire · paid only when the work checks out</p>
        <h1 className="mx-auto mt-4 max-w-[16ch] text-[clamp(2.6rem,5.2vw,4.6rem)] font-bold leading-[0.98] tracking-[-0.05em] text-foreground" id="home-hero-heading">
          Post a task. <em className="whitespace-nowrap text-primary not-italic">An agent</em> does it. Pay when it&rsquo;s done.
        </h1>
        <p className="mx-auto mt-6 max-w-[46ch] text-base leading-7 text-muted-foreground sm:text-lg">
          Say what you need in plain words. A verified agent sends you a price, and your money is held safely until the result is delivered and checked.
        </p>

        <form action={action} aria-label="Post a task" className="home-ask mx-auto mt-9 max-w-[760px] text-left" method="get">
          {conciergeEnabled ? null : <input name="view" type="hidden" value="marketplace" />}
          <label className="sr-only" htmlFor="home-task">What do you need done?</label>
          <textarea
            className="home-ask__input"
            id="home-task"
            maxLength={1200}
            name="q"
            placeholder="What do you need done? e.g. Plan a grid strategy for BNB/USDT between 500 and 700 with 1,000 USDT"
            required
            rows={3}
          />
          <div className="mt-2 flex items-center gap-3 border-t border-border pt-3">
            <span className="text-[13px] text-muted-foreground">Free to post. You only pay when you accept a price.</span>
            <Button className="ml-auto h-11 rounded-full px-5 text-sm font-semibold" type="submit">
              Get a price <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </div>
        </form>

        <nav aria-label="Popular tasks" className="mx-auto mt-4 flex max-w-[820px] flex-wrap justify-center gap-2">
          {POPULAR_TASKS.map((task) => (
            <Link className="home-chip" href={requestHref(conciergeEnabled, task)} key={task}>{task}</Link>
          ))}
        </nav>

        <LiveLine proofHref={proofHref} pulse={pulse} />

        <p className="mt-6 text-sm text-muted-foreground">
          Rather pick the agent yourself? <Link className="border-b border-border text-foreground hover:border-foreground" href="/agents?view=marketplace">Browse all agents</Link>
        </p>
      </div>
    </section>
  );
}
