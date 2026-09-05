"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { BriefcaseBusiness, ChevronDown } from "lucide-react";
import type { AgentEvidencePassport } from "@/src/business/entities/evidence-passport";
import type { MainnetJobProof } from "@/src/business/entities/mainnet-job-proof";
import type { HireActivity, HireChainId, HireJob } from "@/src/business/entities/hire-job";
import { Badge } from "@/components/ui/badge";
import { HireJobTableRow } from "./hire-job-rows";
import { JobNetworkTabs } from "./job-network-tabs";
import { HistoryPages } from "./history-pages";
import { agentJobHistory, type JobHistoryTotals } from "./agent-job-history";

function JobHistoryContent({ jobs, hireJobs, scope, olderHref, newestHref, chainId, agentId, totals, activity, onNetworkChange, pending }: {
  activity?: HireActivity | null;
  onNetworkChange?: (network: string) => void;
  pending?: boolean;
  chainId: HireChainId;
  agentId: string;
  totals?: JobHistoryTotals;
  olderHref?: string;
  newestHref?: string;
  hireActivity: AgentEvidencePassport["checks"]["hireActivity"];
  jobs: readonly MainnetJobProof[];
  hireJobs: readonly HireJob[] | null;
  more: boolean;
  scope: "wallet" | "agent";
}) {
  const model = agentJobHistory({ chainId, scope, jobs: hireJobs, proofs: jobs, ...(totals ? { totals } : {}) });
  const ordered = newestHref ? [] : model.proofs.sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  const indexed = model.indexed;
  return (
    <details open className="group mt-5 rounded-xl border border-white/10 bg-white/[0.015]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <h2 className="flex items-center gap-2 text-base font-medium text-white" id="erc8183-history">
          <BriefcaseBusiness aria-hidden="true" className="size-4 text-zinc-500" />{scope === "wallet" ? "Provider wallet jobs" : "ERC-8183 job history"}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {model.totals ? <>
            <Badge variant="outline">{model.totals.total} {model.totals.total === 1 ? "job" : "jobs"}</Badge>
            <Badge variant="outline">{model.totals.funded} funded</Badge>
            <Badge variant="outline">{model.totals.completed} completed</Badge>
          </> : <Badge variant="outline">Totals unavailable</Badge>}
          <Badge variant="outline">{model.resultVerified} result verified</Badge>
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </div>
      </summary>
      <div className="border-t border-white/10">
        {activity?.chainId === chainId ? <p className="px-5 pt-3 text-xs text-muted-foreground">Last {activity.days} days: {activity.totals.created.toLocaleString("en")} created · {activity.totals.settled.toLocaleString("en")} settled</p> : null}
        <JobNetworkTabs agentId={agentId} chainId={chainId} walletScope={scope === "wallet"} onNetworkChange={onNetworkChange} pending={pending}>
        <HistoryPages emptyContent={hireJobs === null ? "Indexed ledger unavailable right now." : "No indexed jobs on this network."} columns={["Job", "Status", "Buyer", "Provider", "Updated", "Details"]} key={olderHref ?? newestHref ?? "newest"} label="Jobs" {...(olderHref ? { olderHref } : {})} {...(newestHref ? { newestHref } : {})}>
            {ordered.map((job) => (
              <HireJobTableRow key={job.jobId} job={{ chainId: 56, jobId: job.jobId, buyer: job.buyer, provider: job.seller, status: job.finalState, updatedAt: job.capturedAt, marketplace: false }} />
            ))}
            {indexed.map(job => <HireJobTableRow key={`${job.chainId}:${job.jobId}`} job={job} />)}
        </HistoryPages>
        </JobNetworkTabs>
      </div>
    </details>
  );
}

type JobHistoryProps = Omit<ComponentProps<typeof JobHistoryContent>, "onNetworkChange" | "pending"> & { provider?: string | null };

export function JobHistory(props: JobHistoryProps) {
  // A local tab response belongs only to the server snapshot it started from.
  // New cursor pages and refreshes remain authoritative without remounting the
  // surrounding quote session or requiring a second render to clear old rows.
  const [localSelection, setLocalSelection] = useState<{ source: JobHistoryProps; value: JobHistoryProps } | null>(null);
  const [pendingSource, setPendingSource] = useState<JobHistoryProps | null>(null);
  const request = useRef<AbortController | null>(null);
  const selection = localSelection?.source === props ? localSelection.value : props;
  const pending = pendingSource === props;
  useEffect(() => () => request.current?.abort(), [props]);
  async function changeNetwork(network: string) {
    const chainId = network === "testnet" ? 97 : 56;
    if (pending || chainId === selection.chainId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPendingSource(props);
    let jobs: HireJob[] | null = null;
    let totals: JobHistoryTotals | undefined;
    let nextBefore: string | null = null;
    let activity: HireActivity | null = null;
    try {
      if (chainId === 97 && !props.provider) throw new Error("No cross-chain wallet");
      const query = new URLSearchParams({ chainId: String(chainId), ...(props.provider ? { provider: props.provider } : { agentId: props.agentId }) });
      const activityRead = fetch(`/api/marketplace/jobs/activity?${query}`, { cache: "no-store", signal: controller.signal })
        .then(async response => response.ok ? await response.json() as HireActivity : null).catch(() => null);
      const response = await fetch(`/api/marketplace/jobs?${query}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Ledger unavailable");
      const page = await response.json();
      if (!Array.isArray(page.jobs)) throw new Error("Invalid ledger");
      jobs = page.jobs;
      totals = page.totals;
      nextBefore = page.nextBefore ?? null;
      const window = await activityRead;
      if (window?.chainId === chainId && window.totals) activity = window;
    } catch { /* Unavailable is not zero jobs. */ }
    if (controller.signal.aborted) return;
    const { olderHref: _older, newestHref: _newest, totals: _totals, ...base } = props;
    setLocalSelection({ source: props, value: { ...base, chainId, activity, hireJobs: jobs, scope: props.provider ? "wallet" : "agent", more: nextBefore !== null,
      ...(totals ? { totals } : {}),
      ...(nextBefore ? { olderHref: `/hire/${props.agentId}?jobsNetwork=${network}&jobsBefore=${nextBefore}#erc8183-history` } : {}),
    } });
    const url = new URL(window.location.href);
    url.searchParams.set("jobsNetwork", network);
    url.searchParams.delete("jobsBefore");
    url.hash = "erc8183-history";
    window.history.replaceState(null, "", url);
    setPendingSource(null);
  }
  return <JobHistoryContent {...selection} pending={pending} onNetworkChange={network => void changeNetwork(network)} />;
}
