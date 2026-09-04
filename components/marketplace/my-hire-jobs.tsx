"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { HireChainId, HireJob, HireJobPage } from "@/src/business/entities/hire-job";
import { HireJobRows } from "./hire-job-rows";
import { WalletConnectButton } from "./wallet-connect-button";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; jobs: HireJob[]; nextBefore: string | null; loadingMore: boolean }
  | { status: "unavailable" };

// The cursor is remembered together with the wallet and network it belongs
// to, so switching either one drops it without a reset effect.
interface Cursor {
  chainId: HireChainId;
  buyer: string;
  before: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const JOB_ID = /^(?:0|[1-9]\d{0,15})$/;
const DECIMAL = /^\d{1,78}$/;
const STATUSES = new Set(["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"]);

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isJob(value: unknown, chainId: HireChainId): value is HireJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Partial<HireJob>;
  return job.chainId === chainId
    && typeof job.jobId === "string" && JOB_ID.test(job.jobId)
    && typeof job.buyer === "string" && ADDRESS.test(job.buyer)
    && typeof job.provider === "string" && ADDRESS.test(job.provider)
    && typeof job.budgetRaw === "string" && DECIMAL.test(job.budgetRaw)
    && typeof job.status === "string" && STATUSES.has(job.status)
    && isTimestamp(job.expiresAt)
    && (job.submittedAt === null || isTimestamp(job.submittedAt))
    && typeof job.marketplace === "boolean"
    && isTimestamp(job.updatedAt);
}

// The route is same-origin and typed, but a 200 with the wrong shape must
// degrade to "unavailable" rather than crash the page in render.
function parsePage(body: unknown, chainId: HireChainId): HireJobPage | null {
  if (typeof body !== "object" || body === null) return null;
  const page = body as Partial<HireJobPage>;
  if (page.chainId !== chainId || !Array.isArray(page.jobs) || !page.jobs.every((job) => isJob(job, chainId))) return null;
  if (page.nextBefore !== null && (typeof page.nextBefore !== "string" || !JOB_ID.test(page.nextBefore))) return null;
  return { chainId, jobs: page.jobs, nextBefore: page.nextBefore ?? null };
}

// The wallet address only exists in the browser (injected connector, no
// session), so this is the one ledger view that fetches client-side. It uses
// the same public route the MCP tools will use.
export function MyHireJobs({ chainId }: { chainId: HireChainId }) {
  const { address } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const before = cursor !== null && cursor.chainId === chainId && cursor.buyer === address ? cursor.before : undefined;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !address) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState((previous) => before !== undefined && previous.status === "ready"
      ? { ...previous, loadingMore: true }
      : { status: "loading" });
    const query = `chainId=${chainId}&buyer=${address}${before === undefined ? "" : `&before=${before}`}`;
    fetch(`/api/marketplace/jobs?${query}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const page = parsePage(await response.json(), chainId);
        if (controller.signal.aborted) return;
        if (page === null) {
          setState({ status: "unavailable" });
          return;
        }
        setState((previous) => ({
          status: "ready",
          jobs: before !== undefined && previous.status === "ready" ? [...previous.jobs, ...page.jobs] : page.jobs,
          nextBefore: page.nextBefore,
          loadingMore: false,
        }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setState({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [address, before, chainId, mounted]);

  const ready = state.status === "ready" ? state : null;
  const countLabel = ready === null
    ? null
    : ready.nextBefore !== null
      ? `showing the newest ${ready.jobs.length}`
      : `${ready.jobs.length} shown`;

  return (
    <section aria-labelledby="my-hire-jobs" className="mt-8 rounded-xl border border-white/10 bg-white/[0.015]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
        <h2 className="text-base font-medium text-white" id="my-hire-jobs">My jobs</h2>
        {countLabel !== null ? <span className="text-sm text-zinc-500">{countLabel}</span> : null}
      </div>
      {!mounted || !address ? (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-6">
          <p className="text-sm text-zinc-500">Connect a wallet to see the jobs it created on this network.</p>
          <WalletConnectButton />
        </div>
      ) : state.status === "unavailable" ? (
        <p className="px-5 py-6 text-sm text-zinc-500" role="status">Ledger temporarily unavailable.</p>
      ) : ready !== null ? (
        <>
          <HireJobRows chainId={chainId} emptyText="No indexed jobs created by this wallet on this network." jobs={ready.jobs} />
          {ready.nextBefore !== null ? (
            <div className="border-t border-white/10 px-4 py-4 sm:px-5">
              <Button
                disabled={ready.loadingMore}
                onClick={() => setCursor({ chainId, buyer: address, before: ready.nextBefore as string })}
                type="button"
                variant="outline"
              >
                Older jobs<ArrowRight aria-hidden="true" />
              </Button>
              {ready.loadingMore ? <span className="sr-only" role="status">Loading older jobs</span> : null}
            </div>
          ) : null}
        </>
      ) : (
        <div aria-busy="true" className="space-y-3 px-5 py-5">
          <span className="sr-only" role="status">Loading your jobs</span>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-5/6" />
        </div>
      )}
    </section>
  );
}
