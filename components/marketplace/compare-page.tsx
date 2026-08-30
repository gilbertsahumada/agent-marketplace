import Link from "next/link";
import { Fingerprint } from "lucide-react";
import type { MarketplaceAgentComparison } from "@/src/business/entities/marketplace-agent";
import { observationTargetsByAgentId, type ObservationFeedResult } from "@/src/business/entities/worker-observations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceRail } from "./evidence-rail";
import { PageIntro } from "./page-primitives";
import { agentCardWithObservations, hireabilityLabelFor, verificationViewModel } from "./view-models";
import { VerificationDrift } from "./verification-drift";

const passportLabels = {
  registered: "Registered",
  evaluated: "Evaluated",
  hireable: "Hireable",
  job_proven: "Job proven",
  attention: "Attention",
} as const;

export function ComparePage({ candidates, comparison, observations = { status: "unavailable", feed: null }, selected, provenAgentId }: { candidates: { agentId: string; name: string }[]; comparison: MarketplaceAgentComparison | undefined; observations?: ObservationFeedResult; selected: string[]; provenAgentId?: string }) {
  const targets = observationTargetsByAgentId(observations.feed);
  const now = Date.now();
  const options = new Map(candidates.map(({ agentId, name }) => [agentId, name]));
  for (const agent of comparison?.agents ?? []) options.set(agent.agentId, agent.name);
  for (const agentId of selected) if (!options.has(agentId)) options.set(agentId, `Agent ${agentId}`);
  return (
    <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <PageIntro eyebrow="Evidence side by side" title="Compare agents without a universal winner">
        Select two or three curated candidates. The marketplace aligns evidence and activation status but does not invent a single best agent.
      </PageIntro>
      <form className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <fieldset>
          <legend className="text-sm font-semibold text-white">Agents to compare</legend>
          {options.size ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[...options].map(([agentId, name]) => (
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 p-3 text-sm text-zinc-300" key={agentId}>
                  <input defaultChecked={selected.includes(agentId)} name="agentId" type="checkbox" value={agentId} />
                  <span className="min-w-0 truncate">{name}</span>
                  <span className="font-stat ml-auto shrink-0 text-xs text-zinc-600">#{agentId}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">No curated candidate is available to compare right now.</p>
          )}
        </fieldset>
        <Button className="mt-4" type="submit">Compare selected</Button>
      </form>

      {!comparison ? (
        <Card className="marketplace-surface mt-8"><CardContent className="py-8 text-sm text-zinc-400">Choose two or three unique agents to begin.</CardContent></Card>
      ) : (
        <>
          <p className="mt-8 text-sm text-zinc-400">{comparison.note}</p>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {comparison.agents.map((agent) => {
              const passport = agentCardWithObservations(
                agent,
                targets.get(agent.agentId) ?? [],
                observations.status === "available",
                now,
                provenAgentId,
              );
              return (
              <Card className="marketplace-surface marketplace-agent-evidence-card" data-passport-state={passport.passportState} key={agent.agentId}>
                <CardHeader>
                  <Badge className="w-fit" variant="outline">Agent #{agent.agentId}</Badge>
                  <CardTitle className="mt-2"><Link href={`/agents/${agent.agentId}`}>{agent.name}</Link></CardTitle>
                  <Link
                    aria-label={`Passport · ${passportLabels[passport.passportState]} for ${agent.name}`}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-zinc-400 underline decoration-zinc-700 underline-offset-4 hover:text-white"
                    href={passport.passportHref}
                    prefetch={false}
                  >
                    <Fingerprint aria-hidden="true" className="size-3" />
                    Passport · {passportLabels[passport.passportState]}
                  </Link>
                </CardHeader>
                <CardContent className="space-y-5">
                  <EvidenceRail compact steps={passport.evidence} />
                  {verificationViewModel(agent) && <VerificationDrift compact verification={verificationViewModel(agent)!} />}
                  <dl className="space-y-3 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-zinc-500">Categories</dt><dd className="text-right">{agent.categories.map(({ category }) => category.replaceAll("_", " ")).join(", ") || "Not evaluated"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-zinc-500">Endpoint</dt><dd>{passport.evidence.find((step) => step.kind === "reachable")?.status ?? "unavailable"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-zinc-500">Trust</dt><dd>{agent.trustScore.total ?? "—"} <span className="text-zinc-500">· derived</span></dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-zinc-500">Feedback</dt><dd>{agent.reputation.totalFeedbacks}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-zinc-500">Hireability</dt><dd>{hireabilityLabelFor(passport)}</dd></div>
                    <div><dt className="text-zinc-500">Declared capabilities</dt><dd className="mt-1">{agent.capabilities.join(", ") || "None declared"}</dd></div>
                  </dl>
                </CardContent>
              </Card>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
