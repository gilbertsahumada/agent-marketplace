import type { Metadata } from "next";
import { HireLedgerPage } from "@/components/marketplace/hire-ledger-page";
import { getHireLedger } from "@/src/business/composition";

export const metadata: Metadata = {
  title: "ERC-8183 jobs",
  description: "Indexed on-chain ERC-8183 jobs on BSC: protocol totals, jobs processed through this marketplace, and the jobs created by your wallet.",
};

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const chainId = params.chainId === "97" ? 97 : 56;
  const before = typeof params.before === "string" && /^(?:0|[1-9]\d{0,15})$/.test(params.before) ? params.before : undefined;
  const [summary, page] = await Promise.all([
    getHireLedger.summary({ chainId }),
    getHireLedger.listRecentJobs({ chainId, ...(before === undefined ? {} : { before }) }),
  ]);
  return <HireLedgerPage chainId={chainId} page={page} summary={summary} {...(before === undefined ? {} : { before })} />;
}
