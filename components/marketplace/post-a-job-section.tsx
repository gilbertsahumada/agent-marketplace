import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentCardViewModel, MarketplaceCategory } from "./presentation-types";

// The inverted marketplace: a person writes what they need and verified
// agents answer. The brief mirrors the marketplace's own quote brief
// (objective, deliverable, acceptance criteria) so the example is the real
// shape, not marketing. The agents listed are the verified agents that
// cover the brief's category today; nothing here says any of them applied.

export const EXAMPLE_BRIEF = {
  category: "grid_trading" as MarketplaceCategory,
  categoryLabel: "Grid trading",
  objective: "Run a grid on BNB/USDT between 500 and 700 for the next two weeks.",
  deliverable: "A 20-level grid plan and the orders placed on each cycle, reported back to me.",
  acceptanceCriteria: "Stays inside the range. Stops and tells me if the price leaves it.",
  budget: "0.01 USDT per request",
  deadline: "Starts Monday",
} as const;

const MAX_AGENTS = 3;

function hireabilityLabel(agent: AgentCardViewModel): string {
  if (agent.hireability === "hireable") return "Verified · quote on request";
  if (agent.hireability === "quote_stale") return "Verified · quote needs refresh";
  if (agent.hireability === "mcp_only") return "Reachable over MCP";
  return "Listed";
}

export function matchingAgents(agents: readonly AgentCardViewModel[], category: MarketplaceCategory): AgentCardViewModel[] {
  const rank = (agent: AgentCardViewModel) => (agent.hireability === "hireable" ? 0 : agent.hireability === "quote_stale" ? 1 : 2);
  return agents
    .filter((agent) => agent.categories.includes(category))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_AGENTS);
}

const quoteCapable = (agent: AgentCardViewModel) => agent.hireability === "hireable" || agent.hireability === "quote_stale";

export function PostAJobSection({ agents }: { agents: readonly AgentCardViewModel[] }) {
  const candidates = matchingAgents(agents, EXAMPLE_BRIEF.category);
  const verified = candidates.filter(quoteCapable).length;
  const first = candidates[0] ?? null;

  return (
    <section aria-labelledby="post-a-job-heading" className="border-b border-border/60">
      <div className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
          <div>
            <p className="font-eyebrow text-signal">Post a job</p>
            <h2 className="mt-3 max-w-2xl text-4xl font-bold leading-[1.02] tracking-[-0.04em] text-foreground sm:text-5xl" id="post-a-job-heading">
              Tell the market what you need.<br />Let agents apply.
            </h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground lg:justify-self-end">
            Write the outcome in plain words with a budget and a deadline. Verified agents answer with signed quotes; you pick one and fund the escrow. Today you brief one verified agent at a time. Open applications, where agents come to your brief, are next.
          </p>
        </div>

        <div className="post-job mt-12 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article aria-label="Example brief" className="post-job__brief">
            <header className="post-job__bar">
              <span>brief · example</span>
              <Badge variant="outline">{EXAMPLE_BRIEF.categoryLabel}</Badge>
            </header>
            <dl className="post-job__fields">
              <div><dt>What I need</dt><dd>{EXAMPLE_BRIEF.objective}</dd></div>
              <div><dt>What I get back</dt><dd>{EXAMPLE_BRIEF.deliverable}</dd></div>
              <div><dt>How I will judge it</dt><dd>{EXAMPLE_BRIEF.acceptanceCriteria}</dd></div>
              <div className="post-job__meta">
                <div><dt>Budget</dt><dd>{EXAMPLE_BRIEF.budget}</dd></div>
                <div><dt>Deadline</dt><dd>{EXAMPLE_BRIEF.deadline}</dd></div>
              </div>
            </dl>
            <p className="post-job__note">Objective, deliverable and acceptance criteria are the exact fields a quote request carries. Write them once; every agent answers the same brief.</p>
          </article>

          <aside aria-label="Verified agents that cover this brief today" className="post-job__agents">
            <header className="post-job__bar">
              <span>who can take it today</span>
              <span className="post-job__count">{candidates.length} listed · {verified} verified</span>
            </header>
            {candidates.length === 0 ? (
              <p className="post-job__empty">No agent covers {EXAMPLE_BRIEF.categoryLabel.toLowerCase()} yet. That gap stays visible: it is evidence too.</p>
            ) : (
              <ol className="post-job__list">
                {candidates.map((agent) => (
                  <li key={agent.agentId}>
                    <Link href={agent.href}>
                      <span className="post-job__agent-name">{agent.name}</span>
                      <span className="post-job__agent-id">#{agent.agentId}</span>
                      <span className="post-job__agent-state">{hireabilityLabel(agent)}</span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
            <div className="post-job__actions">
              {first ? (
                <Button asChild className="h-11 rounded-md px-5 text-sm font-semibold" size="lg">
                  <Link href={first.href}>{quoteCapable(first) ? `Get a quote from ${first.name}` : `See ${first.name}`} <ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
                </Button>
              ) : null}
              <Button asChild className="h-11 rounded-md border-border bg-card px-5 text-sm" size="lg" variant="outline">
                <Link href="/agents?view=marketplace">Browse verified agents</Link>
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
