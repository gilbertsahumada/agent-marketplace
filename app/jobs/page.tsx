import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HireLedgerPage } from "@/components/marketplace/hire-ledger-page";
import type { HireAddress, HireChainId } from "@/src/business/entities/hire-job";
import { getHireLedger, resolveJobAgents } from "@/src/business/composition";

export const metadata: Metadata = {
  title: "ERC-8183 jobs",
  description: "Indexed on-chain ERC-8183 jobs on BSC: protocol totals, jobs processed through this marketplace, and the jobs created by your wallet.",
};

export const dynamic = "force-dynamic";

// Same input rules as /api/marketplace/jobs: a chainId other than 56/97 is a
// missing page, not Mainnet; a cursor that is not a positive job id is ignored.
function chainIdParameter(value: string | string[] | undefined): HireChainId {
  if (value === undefined || value === "56") return 56;
  if (value === "97") return 97;
  notFound();
}

// An optional provider wallet scopes the list (the agent profile links here
// for "All indexed jobs" sold by a wallet); anything that is not an address
// is a missing page. The summary stays chain-wide either way.
function providerParameter(value: string | string[] | undefined): HireAddress | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return value as HireAddress;
  notFound();
}

function activityDaysParameter(value: string | string[] | undefined): 7 | 30 | 90 {
  if (value === undefined || value === "30") return 30;
  if (value === "7") return 7;
  if (value === "90") return 90;
  notFound();
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const chainId = chainIdParameter(params.chainId);
  const provider = providerParameter(params.provider);
  const activityDays = activityDaysParameter(params.days);
  const before = typeof params.before === "string" && /^[1-9]\d{0,15}$/.test(params.before) ? params.before : undefined;
  const cursor = before === undefined ? {} : { before };
  const cursorTrail = typeof params.trail === "string" && /^(?:[1-9]\d{0,15})(?:,[1-9]\d{0,15})*$/.test(params.trail) ? params.trail.split(",").slice(0, 1000) : [];
  const scope = provider === undefined ? {} : { provider };
  const [summary, page, activity] = await Promise.all([
    getHireLedger.summary({ chainId }),
    provider === undefined
      ? getHireLedger.listRecentJobs({ chainId, ...cursor })
      : getHireLedger.listJobsByProvider({ chainId, provider, ...cursor }),
    // Preserve the shared default cache entry for 30 days. Alternate windows
    // are explicit and never change list pagination.
    getHireLedger.activity({ chainId, ...scope, ...(activityDays === 30 ? {} : { days: activityDays }) }),
  ]);
  const agentResolutions = await resolveJobAgents.execute(page?.jobs ?? []);
  return (
    <HireLedgerPage
      activity={activity}
      activityDays={activityDays}
      cursorTrail={cursorTrail}
      key={`${chainId}:${provider ?? "all"}:${before ?? "newest"}`}
      chainId={chainId}
      page={page}
      summary={summary}
      agentResolutions={agentResolutions}
      {...cursor}
      {...(provider === undefined ? {} : { provider })}
    />
  );
}
