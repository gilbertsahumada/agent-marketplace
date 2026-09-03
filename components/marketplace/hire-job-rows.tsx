import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { shortAddress } from "@/lib/bsc-chains";
import { ERC8183_MAINNET, ERC8183_TESTNET } from "@/src/business/browser/erc8183-browser-wallet";
import type { HireChainId, HireJob, HireJobStatus } from "@/src/business/entities/hire-job";

const STATUS_LABELS: Record<HireJobStatus, string> = {
  OPEN: "Open",
  FUNDED: "Funded",
  SUBMITTED: "Submitted",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};
const UTC_DATE = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" });

export function explorerUrl(chainId: HireChainId): string {
  return chainId === 56 ? ERC8183_MAINNET.explorerUrl : ERC8183_TESTNET.explorerUrl;
}

export function networkSlug(chainId: HireChainId): "mainnet" | "testnet" {
  return chainId === 56 ? "mainnet" : "testnet";
}

export function jobStatusLabel(status: HireJobStatus): string {
  return STATUS_LABELS[status];
}

function statusClassName(status: HireJobStatus): string {
  if (status === "COMPLETED") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (status === "FUNDED" || status === "SUBMITTED") return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  return "";
}

// One row per indexed job. Every row links to the job page for its network,
// so no cell is a dead end; "marketplace" marks a job with a chain-verified
// hire event, nothing more.
export function HireJobRows({ chainId, jobs, emptyText }: {
  chainId: HireChainId;
  jobs: readonly HireJob[];
  emptyText: string;
}) {
  if (jobs.length === 0) {
    return <p className="px-5 py-6 text-sm text-zinc-500">{emptyText}</p>;
  }
  return (
    <ul className="divide-y divide-white/10">
      {jobs.map((job) => (
        <li key={`${job.chainId}:${job.jobId}`}>
          <Link
            className="grid cursor-pointer items-center gap-x-4 gap-y-2 px-4 py-4 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[7rem_auto_minmax(0,1fr)_auto_auto] sm:px-5"
            href={`/jobs/${networkSlug(chainId)}/${job.jobId}`}
          >
            <span className="font-medium text-white">Job #{job.jobId}</span>
            <Badge className={statusClassName(job.status)} variant="outline">{jobStatusLabel(job.status)}</Badge>
            <span className="font-hash min-w-0 truncate text-xs text-zinc-400" title={`${job.buyer} → ${job.provider}`}>
              {shortAddress(job.buyer)} → {shortAddress(job.provider)}
            </span>
            <span>{job.marketplace ? <Badge className="border-primary/40 bg-primary/10 text-primary" variant="outline">marketplace</Badge> : null}</span>
            <span className="flex items-center justify-between gap-3 text-sm text-zinc-500 sm:justify-end">
              {UTC_DATE.format(new Date(job.updatedAt))}<ArrowRight aria-hidden="true" className="size-4" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
