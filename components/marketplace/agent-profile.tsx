import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleAlert, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { MarketplaceAgent } from "@/src/business/entities/marketplace-agent";
import type { AgentEvidencePassport } from "@/src/business/entities/evidence-passport";
import type { WorkerObservationTarget } from "@/src/business/entities/worker-observations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EvidenceRail } from "./evidence-rail";
import { Breadcrumb } from "./page-primitives";
import { ProvenanceBadge } from "./provenance-badge";
import { agentCardWithObservations, hireabilityLabelFor, verificationViewModel } from "./view-models";
import { VerificationDrift } from "./verification-drift";
import { EvidencePassportCard } from "./evidence-passport-card";
import { AgentAvatar } from "./agent-avatar";
import { trust8004AgentHref } from "./agent-card";
import { AgentValidationActions } from "./agent-validation-actions";
import { declaredBrowserValidationTargets } from "@/src/business/policies/catalog-validation-policy";
import type { CatalogCandidate } from "@/src/business/entities/catalog-candidate";
import { catalogCandidateCard } from "./catalog-candidate-view-model";

function MonoValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <p className="font-eyebrow text-zinc-500">{label}</p>
      <p className="font-hash mt-1 text-xs text-zinc-300">{value ?? "Unavailable"}</p>
    </div>
  );
}

export function AgentProfile({
  agent,
  observationTargets = [],
  observationsAvailable = false,
  passport,
  catalogCandidate,
  journey = "profile",
  hireFlow,
}: {
  agent: MarketplaceAgent;
  observationTargets?: WorkerObservationTarget[];
  observationsAvailable?: boolean;
  passport: AgentEvidencePassport;
  catalogCandidate?: CatalogCandidate | null;
  journey?: "profile" | "hire";
  hireFlow?: ReactNode;
}) {
  const evaluated = agent.categoryEvaluation === "evaluated";
  const verification = verificationViewModel(agent);
  const current = catalogCandidate
    ? catalogCandidateCard(catalogCandidate)
    : agentCardWithObservations(agent, observationTargets, observationsAvailable);
  const reachability = current.evidence.find((step) => step.kind === "reachable")!;
  const validationTargetMap = new Map(declaredBrowserValidationTargets(agent).map((target) => [
    `${target.protocol}\u0000${target.endpoint}`,
    target,
  ]));
  for (const target of agent.validationTargets ?? []) {
    validationTargetMap.set(`${target.protocol}\u0000${target.endpoint}`, target);
  }
  const validationTargets = [...validationTargetMap.values()];
  const canCheckAvailability = current.buyerAction === "check_availability"
    && (catalogCandidate?.state?.canRequestBrowserValidation === true
      || catalogCandidate?.state?.canRequestInfrastructureValidation === true)
    && validationTargets.length > 0;
  return (
    <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumb current={agent.name} trail={[{ href: "/agents", label: "Agents" }]} />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <AgentAvatar {...(agent.imageUrl ? { imageUrl: agent.imageUrl } : {})} className="size-14" name={agent.name} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">BSC · #{agent.agentId}</Badge>
              {agent.operator === "marketplace" && <Badge className="border-cyan-400/30 bg-cyan-400/10 text-cyan-200" variant="outline">Marketplace-operated · not official BNB reference</Badge>}
              <Badge className={current.hireability === "hireable" ? "border-primary/40 bg-primary/10 text-primary" : "border-zinc-700 bg-zinc-900 text-zinc-300"} variant="outline">
                {current.hireability !== "listed_only" || current.quoteRequestAvailable
                  ? hireabilityLabelFor(current)
                  : observationsAvailable ? evaluated ? "Not hireable" : "Not evaluated" : "Verification unavailable"}
              </Badge>
            </div>
            <h1 className="mt-3 text-3xl font-light tracking-tight text-white sm:text-4xl">{agent.name}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400 sm:text-base">{agent.description ?? "No description declared."}</p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <Button asChild variant="outline">
            <a href={trust8004AgentHref(agent.agentId)} rel="noopener noreferrer" target="_blank">
              View on trust8004<ExternalLink aria-hidden="true" />
            </a>
          </Button>
          {journey === "hire" && canCheckAvailability ? (
            <Button asChild><a href="#validation">Check availability<ArrowUpRight aria-hidden="true" /></a></Button>
          ) : journey === "hire" && hireFlow ? (
            <Button asChild><a href="#hire-flow">{current.buyerAction === "prepare_hire" ? "Continue hire" : "Request fresh quote"}<ArrowUpRight aria-hidden="true" /></a></Button>
          ) : journey === "profile" && current.quoteRequestAvailable ? (
            <>
              <Button asChild><Link href={`/hire/${agent.agentId}`}>Hire agent<ArrowUpRight aria-hidden="true" /></Link></Button>
              {!observationsAvailable && <p className="max-w-xs text-sm text-zinc-500">Automatic verification is unavailable. You can still request a new transactional quote.</p>}
              {observationsAvailable && current.hireability === "listed_only" && <p className="max-w-xs text-sm text-zinc-500">No current verified quote is held. Continuing requests a fresh ERC-8183 quote that is verified before any wallet interaction.</p>}
            </>
          ) : (
            <p className="max-w-xs text-sm text-zinc-500">
              {current.hireability === "listed_only"
                ? agent.hireability.reason
                : current.evidence.find((step) => step.kind === "quote")?.detail}
            </p>
          )}
        </div>
      </div>

      {hireFlow && <div className="mt-8 scroll-mt-6" id="hire-flow">{hireFlow}</div>}

      <div className="mt-8">
        <EvidencePassportCard
          apiHref={`/api/marketplace/agents/${agent.agentId}/passport`}
          passport={passport}
        />
      </div>

      <Card className="marketplace-surface mt-8">
        <CardHeader><CardTitle>Evidence line</CardTitle></CardHeader>
        <CardContent><EvidenceRail ariaLabel={`Evidence for ${agent.name}`} steps={current.evidence} /></CardContent>
      </Card>

      <Card className="marketplace-surface mt-5">
        <CardHeader><CardTitle>Marketplace monitoring</CardTitle></CardHeader>
        <CardContent>
          {catalogCandidate && current.monitoring?.source === "worker" && (
            <p className="mb-4 text-xs leading-relaxed text-zinc-500">
              Counts include platform-operated observations stored for this agent or its shared endpoint. Browser-reported checks are kept separate and do not qualify reachability.
            </p>
          )}
          {current.monitoring?.state === "feed_unavailable" ? (
            <p className="text-sm leading-relaxed text-amber-200">The observation feed is not connected. Reachability is unknown; this does not mean the endpoint failed.</p>
          ) : current.monitoring?.state === "no_endpoint_declared" ? (
            <p className="text-sm leading-relaxed text-amber-200">This registration does not declare a service endpoint, so the marketplace has nothing it can probe.</p>
          ) : current.monitoring?.state === "not_monitored" ? (
            <p className="text-sm leading-relaxed text-zinc-400">This agent is not included in the Worker's current monitoring scope.</p>
          ) : current.monitoring?.state === "never_probed" || !current.monitoring ? (
            <p className="text-sm leading-relaxed text-zinc-400">This agent has never been probed by the marketplace Worker.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MonoValue
                label={current.monitoring.source === "release_snapshot" ? "Attempts in this release" : "Probe attempts"}
                value={current.monitoring.attemptCount === undefined ? "Not exposed by deployed Worker" : String(current.monitoring.attemptCount)}
              />
              <MonoValue label="Last attempt · UTC" value={current.monitoring.lastAttemptAt ?? null} />
              <MonoValue label="Latest outcome" value={current.monitoring.latestOutcome?.replaceAll("_", " ") ?? null} />
              <MonoValue
                label="Last response"
                value={[
                  current.monitoring.latestHttpStatus ? `HTTP ${current.monitoring.latestHttpStatus}` : null,
                  current.monitoring.latestDurationMs !== undefined ? `${current.monitoring.latestDurationMs} ms` : null,
                  current.monitoring.latestErrorCode ?? null,
                  current.monitoring.source === "release_snapshot" ? "Release verification snapshot" : null,
                ].filter(Boolean).join(" · ") || null}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <AgentValidationActions agentId={agent.agentId} targets={validationTargets} />

      {verification && <div className="mt-5"><VerificationDrift verification={verification} /></div>}

      <Tabs className="mt-8" defaultValue="overview">
        <TabsList className="max-w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="reputation">Reputation</TabsTrigger>
          <TabsTrigger value="technical">Technical</TabsTrigger>
        </TabsList>
        <TabsContent className="mt-5" value="overview">
          <Card className="marketplace-surface">
            <CardHeader><CardTitle>What this agent does</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div>
                <h2 className="text-sm font-semibold">Marketplace categories</h2>
                {agent.categories.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {agent.categories.map(({ category, evidence }) => (
                      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3" key={category}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{category.replaceAll("_", " ")}</Badge>
                          <ProvenanceBadge provenance={evidence.kind} />
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-zinc-400">{evidence.note}</p>
                        <p className="font-stat mt-2 text-[10px] text-zinc-500">{evidence.source} · {evidence.observedAt}</p>
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-2 text-sm text-zinc-500">Not evaluated for marketplace categories.</p>}
              </div>
              <Separator />
              <div>
                <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Declared tools and capabilities</h2><ProvenanceBadge provenance="declared" /></div>
                <div className="mt-3 flex flex-wrap gap-2">{[...new Set([...agent.tools, ...agent.capabilities])].map((item) => <Badge key={item} variant="outline">{item}</Badge>)}</div>
                {!agent.tools.length && !agent.capabilities.length && <p className="mt-2 text-sm text-zinc-500">No tools declared.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent className="mt-5" value="services">
          <Card className="marketplace-surface">
            <CardHeader><CardTitle>Services and endpoints</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">{reachability.status === "verified" ? <CheckCircle2 className="size-4 text-emerald-400" /> : <CircleAlert className="size-4 text-zinc-500" />}<span>{reachability.status}</span><ProvenanceBadge provenance={reachability.provenance} /></div>
              {agent.endpoints.map((endpoint) => <MonoValue key={endpoint.endpoint} label={endpoint.name ?? "Endpoint"} value={endpoint.endpoint} />)}
              {!agent.endpoints.length && <p className="text-sm text-zinc-500">No normalized endpoint is available.</p>}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent className="mt-5" value="technical">
          <Card className="marketplace-surface">
            <CardHeader><CardTitle>Technical identity</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <MonoValue label="Indexed owner · declared" value={agent.indexedIdentity.owner} />
              <MonoValue label="Onchain owner" value={agent.onchainIdentity.owner} />
              <MonoValue label="Agent wallet · onchain" value={agent.onchainIdentity.agentWallet} />
              <MonoValue label="Metadata URI · declared" value={agent.metadataUri} />
              <MonoValue label="Registry" value={agent.onchainIdentity.registryAddress} />
              <MonoValue label="Onchain identity status" value={agent.onchainIdentity.status} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent className="mt-5" value="reputation">
          <div className="grid gap-6 md:grid-cols-2">
          <Card className="marketplace-surface">
            <CardHeader><CardTitle>Trust score</CardTitle></CardHeader>
            <CardContent>
              <p className="font-stat text-4xl font-semibold text-white">{agent.trustScore.total ?? "—"}</p>
              <div className="mt-2 flex items-center gap-2"><span className="text-sm text-zinc-400">{agent.trustScore.tier ?? "Unavailable"}</span><ProvenanceBadge provenance="derived" /></div>
              <p className="mt-4 text-xs leading-relaxed text-zinc-500">Calculated by trust8004; it is not a direct onchain fact.</p>
            </CardContent>
          </Card>
          <Card className="marketplace-surface">
            <CardHeader><CardTitle className="flex items-center gap-2">Reputation<ProvenanceBadge provenance={agent.provenance.reputation.kind} /></CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-zinc-500">Feedback</span><span>{agent.reputation.totalFeedbacks}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Average</span><span>{agent.reputation.averageScore ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Reviewers</span><span>{agent.reputation.uniqueReviewers ?? "—"}</span></div>
              <p className="border-t border-white/10 pt-3 text-xs leading-relaxed text-zinc-500">{agent.provenance.reputation.note}</p>
              <p className="font-stat text-[10px] text-zinc-500">{agent.provenance.reputation.source} · {agent.provenance.reputation.observedAt}</p>
            </CardContent>
          </Card>
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
