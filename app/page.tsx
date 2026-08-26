import { MarketplaceLanding } from "@/components/marketplace/landing-page";
import type { CategoryCardViewModel, EvidenceStepViewModel } from "@/components/marketplace/presentation-types";
import { snapshotAgentCardViewModel } from "@/components/marketplace/view-models";
import { getMainnetJobProof, getMarketplaceLandingCatalog, getPublicJobProof } from "@/src/business/composition";

export const dynamic = "force-dynamic";

const categoryCopy = {
  rebalancing: ["Rebalancing", "Maintain a target allocation or liquidity position as market conditions change."],
  grid_trading: ["Grid trading", "Place disciplined orders across a price range with clearly bounded execution rules."],
  yield_optimisation: ["Yield optimisation", "Evaluate and manage yield opportunities without turning projections into guarantees."],
  health_factor_monitoring: ["Health factor monitoring", "Track lending risk and surface conditions that may require user action."],
} as const;

export default async function HomePage() {
  const [catalogResult, proof] = await Promise.all([
    getMarketplaceLandingCatalog.execute(),
    getPublicJobProof.execute({ jobId: "551" }),
  ]);
  const catalog = catalogResult;
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
  const publicProof: EvidenceStepViewModel[] = mainnetProof ? [
    { kind: "declared", label: "Declared", status: "verified", provenance: "declared", detail: "The marketplace Grid seller published deterministic no-custody terms.", timestamp: mainnetProof.capturedAt },
    { kind: "reachable", label: "Reachable", status: "verified", provenance: "observed", detail: "The seller negotiated and submitted the Grid result.", timestamp: mainnetProof.transactions.submit?.timestamp ?? mainnetProof.capturedAt, ...txLink(mainnetProof.transactions.submit) },
    { kind: "quote", label: "Quote verified", status: "verified", provenance: "observed", detail: "The job carries the seller-signed canonical quote.", timestamp: mainnetProof.transactions.createJob?.timestamp ?? mainnetProof.capturedAt, ...txLink(mainnetProof.transactions.createJob) },
    { kind: "job", label: "Job proven", status: "verified", provenance: "onchain", detail: `Job #${mainnetProof.jobId} reached ${mainnetProof.finalState} on BSC Mainnet.`, timestamp: (mainnetProof.transactions.settle ?? mainnetProof.transactions.submit)?.timestamp ?? mainnetProof.capturedAt, ...txLink(mainnetProof.transactions.settle ?? mainnetProof.transactions.submit) },
  ] : [
    { kind: "declared", label: "Declared", status: "verified", provenance: "declared", detail: "Seller identity and terms were recorded.", timestamp: proof.snapshot.recordedAt },
    { kind: "reachable", label: "Reachable", status: "verified", provenance: "observed", detail: "The seller negotiated and confirmed funding.", timestamp: proof.snapshot.transactions.fund.timestamp, ...txLink(proof.snapshot.transactions.fund) },
    { kind: "quote", label: "Quote verified", status: "verified", provenance: "observed", detail: "The buyer accepted the signed quote.", timestamp: proof.snapshot.transactions.createJob.timestamp, ...txLink(proof.snapshot.transactions.createJob) },
    { kind: "job", label: "Job proven", status: "verified", provenance: "onchain", detail: `Job #${proof.snapshot.jobId} reached SUBMITTED on BSC Testnet, browser-signed.`, timestamp: proof.snapshot.transactions.submit.timestamp, ...txLink(proof.snapshot.transactions.submit) },
  ];
  const featuredAgents = catalogResult.snapshot.agents.map((agent) =>
    snapshotAgentCardViewModel(agent, catalogResult.snapshot, Date.now(), mainnetProof?.agentId));
  return (
    <MarketplaceLanding
      catalogSnapshot={{
        generatedAt: catalogResult.snapshot.generatedAt,
        staleAfter: catalogResult.snapshot.staleAfter,
      }}
      categories={categories}
      demoEnabled={Reflect.get(process.env, "ERC8183_BROWSER_SPIKE_ENABLED") === "true"}
      featuredAgents={featuredAgents}
      publicProof={publicProof}
      {...(mainnetProof ? { proofSummary: {
        href: "/proof/mainnet",
        network: `BSC Mainnet · Job #${mainnetProof.jobId}`,
        title: "One browser-signed Mainnet hiring lifecycle",
        description: "An injected wallet funded a real Grid planning job; its result, transactions, gas and duration are publicly reproducible.",
      } } : {})}
      qualifiedSeller={catalogResult.qualifiedSeller}
    />
  );
}
