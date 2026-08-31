import { MarketplaceLanding } from "@/components/marketplace/landing-page";
import type { CategoryCardViewModel, EvidenceStepViewModel, FunnelSectionViewModel } from "@/components/marketplace/presentation-types";
import { agentCardWithObservations } from "@/components/marketplace/view-models";
import { getFunnelEvidence, getMainnetJobProof, getPublicJobProof, getWorkerObservations, listMarketplaceAgents } from "@/src/business/composition";
import type { FunnelEvidence } from "@/src/business/entities/funnel-evidence";
import { observationTargetsByAgentId } from "@/src/business/entities/worker-observations";

export const dynamic = "force-dynamic";

const categoryCopy = {
  rebalancing: ["Rebalancing", "Maintain a target allocation or liquidity position as market conditions change."],
  grid_trading: ["Grid trading", "Place disciplined orders across a price range with clearly bounded execution rules."],
  yield_optimisation: ["Yield optimisation", "Evaluate and manage yield opportunities without turning projections into guarantees."],
  health_factor_monitoring: ["Health factor monitoring", "Track lending risk and surface conditions that may require user action."],
} as const;

function funnelSectionViewModel(evidence: FunnelEvidence | null): FunnelSectionViewModel | null {
  if (!evidence) return null;
  const integer = new Intl.NumberFormat("en-US");
  const share = (value: number) => `${((value / evidence.registeredTotal) * 100).toFixed(1)}%`;
  return {
    stages: [
      {
        label: "Registered on BSC",
        detail: "ERC-8004 registrations counted by a full catalogue sweep, cross-checked against the API total.",
        count: integer.format(evidence.registeredTotal),
        share: null,
        provenance: "observed",
      },
      {
        label: "Metadata resolves",
        detail: "Registrations whose metadata URI answered with parseable content.",
        count: integer.format(evidence.metadataOk),
        share: share(evidence.metadataOk),
        provenance: "observed",
      },
      {
        label: "Declares a hireable transport",
        detail: "Self-declared A2A or ERC-8183 endpoint in metadata. Declaration is not capability.",
        count: integer.format(evidence.transportDeclarants),
        share: share(evidence.transportDeclarants),
        provenance: "declared",
      },
      {
        label: "Public HTTPS endpoint",
        detail: "Declared endpoints outside loopback and private ranges. Syntactic check only; not yet contacted.",
        count: integer.format(evidence.publicHttpsEndpoints),
        share: null,
        provenance: "derived",
      },
      {
        label: "Declares ERC-8183 hiring",
        detail: "The only transport this marketplace can escrow through.",
        count: integer.format(evidence.erc8183Declarants),
        share: null,
        provenance: "declared",
      },
      {
        label: "Answers with a verified quote",
        detail: "Measured live by the observation layer now in build; never persisted as a boolean.",
        count: null,
        share: null,
        provenance: null,
      },
      {
        label: "Job settled onchain",
        detail: "Published once the canonical list of marketplace jobs is reconciled against BSC.",
        count: null,
        share: null,
        provenance: null,
      },
    ],
    citation: {
      artifact: evidence.sourcePath,
      sha256: evidence.sourceSha256,
      blockNumber: evidence.blockNumber,
      generatedAt: evidence.generatedAt,
    },
  };
}

export default async function HomePage() {
  const [catalog, observations, proof] = await Promise.all([
    listMarketplaceAgents.execute({ view: "marketplace", page: 1, limit: 12 }),
    getWorkerObservations(),
    getPublicJobProof.execute({ jobId: "551" }),
  ]);
  const mainnetProof = getMainnetJobProof.execute();
  const categories: CategoryCardViewModel[] = catalog.categories.map(({ category, count, status }) => ({
    category,
    title: categoryCopy[category][0],
    description: categoryCopy[category][1],
    href: `/agents?view=marketplace&category=${category}`,
    availability: status === "unverified" ? "empty" : "listed",
    availabilityLabel: status === "unverified" ? "Unverified · empty" : `${count} candidate${count === 1 ? "" : "s"}`,
  }));
  const txLink = (tx: { hash: string; explorerUrl: string } | undefined) =>
    tx ? { link: { href: tx.explorerUrl, label: `${tx.hash.slice(0, 6)}…${tx.hash.slice(-4)}` } } : {};
  const publicProof: EvidenceStepViewModel[] = [
    { kind: "declared", label: "Declared", status: "verified", provenance: "declared", detail: "Seller identity and terms were recorded.", timestamp: proof.snapshot.recordedAt },
    { kind: "reachable", label: "Reachable", status: "verified", provenance: "observed", detail: "The seller negotiated and confirmed funding.", timestamp: proof.snapshot.transactions.fund.timestamp, ...txLink(proof.snapshot.transactions.fund) },
    { kind: "quote", label: "Quote verified", status: "verified", provenance: "observed", detail: "The buyer accepted the signed quote.", timestamp: proof.snapshot.transactions.createJob.timestamp, ...txLink(proof.snapshot.transactions.createJob) },
    { kind: "job", label: "Job proven", status: "verified", provenance: "onchain", detail: `Job #${proof.snapshot.jobId} reached SUBMITTED on BSC Testnet, browser-signed.`, timestamp: proof.snapshot.transactions.submit.timestamp, ...txLink(proof.snapshot.transactions.submit) },
  ];
  const mainnetProofEvidence: EvidenceStepViewModel[] | null = mainnetProof ? [
    { kind: "declared", label: "Declared", status: "verified", provenance: "declared", detail: "The marketplace Grid seller published deterministic no-custody terms.", timestamp: mainnetProof.capturedAt },
    { kind: "reachable", label: "Reachable", status: "verified", provenance: "observed", detail: "The seller negotiated and submitted the Grid result.", timestamp: mainnetProof.transactions.submit?.timestamp ?? mainnetProof.capturedAt, ...txLink(mainnetProof.transactions.submit) },
    { kind: "quote", label: "Quote verified", status: "verified", provenance: "observed", detail: "The job carries the seller-signed canonical quote.", timestamp: mainnetProof.transactions.createJob?.timestamp ?? mainnetProof.capturedAt, ...txLink(mainnetProof.transactions.createJob) },
    { kind: "job", label: "Job proven", status: "verified", provenance: "onchain", detail: `Job #${mainnetProof.jobId} reached ${mainnetProof.finalState} on BSC Mainnet.`, timestamp: (mainnetProof.transactions.settle ?? mainnetProof.transactions.submit)?.timestamp ?? mainnetProof.capturedAt, ...txLink(mainnetProof.transactions.settle ?? mainnetProof.transactions.submit) },
  ] : null;
  const now = Date.now();
  const targets = observationTargetsByAgentId(observations.feed);
  const featuredAgents = catalog.items.map((agent) => agentCardWithObservations(
    agent,
    targets.get(agent.agentId) ?? [],
    observations.status === "available",
    now,
    mainnetProof?.agentId,
  ));
  const qualified = featuredAgents.find((agent) => agent.hireability === "hireable") ?? null;
  return (
    <MarketplaceLanding
      categories={categories}
      demoEnabled={Reflect.get(process.env, "ERC8183_BROWSER_SPIKE_ENABLED") === "true"}
      featuredAgents={featuredAgents}
      funnel={funnelSectionViewModel(getFunnelEvidence.execute())}
      publicProof={publicProof}
      {...(mainnetProof ? { proofSummary: {
        href: "/proof/mainnet",
        network: `BSC Mainnet · Job #${mainnetProof.jobId}`,
        title: "One browser-signed Mainnet hiring lifecycle",
        description: "An injected wallet funded a real Grid planning job; its result, transactions, gas and duration are publicly reproducible.",
        evidence: mainnetProofEvidence!,
      } } : {})}
      qualifiedSeller={qualified ? { agentId: qualified.agentId, name: qualified.name } : null}
    />
  );
}
