"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Skeleton } from "@/components/ui/skeleton";
import type { HireChainId, HireJobPage } from "@/src/business/entities/hire-job";
import { HireJobRows } from "./hire-job-rows";
import { WalletConnectButton } from "./wallet-connect-button";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; page: HireJobPage }
  | { status: "unavailable" };

// The wallet address only exists in the browser (injected connector, no
// session), so this is the one ledger view that fetches client-side. It uses
// the same public route the MCP tools will use.
export function MyHireJobs({ chainId }: { chainId: HireChainId }) {
  const { address } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !address) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/marketplace/jobs?chainId=${chainId}&buyer=${address}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setState({ status: "ready", page: (await response.json()) as HireJobPage });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [address, chainId, mounted]);

  return (
    <section aria-labelledby="my-hire-jobs" className="mt-8 rounded-xl border border-white/10 bg-white/[0.015]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
        <h2 className="text-base font-medium text-white" id="my-hire-jobs">My jobs</h2>
        {state.status === "ready" ? <span className="text-sm text-zinc-500">{state.page.jobs.length} created by this wallet</span> : null}
      </div>
      {!mounted || !address ? (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-6">
          <p className="text-sm text-zinc-500">Connect a wallet to see the jobs it created on this network.</p>
          <WalletConnectButton />
        </div>
      ) : state.status === "unavailable" ? (
        <p className="px-5 py-6 text-sm text-zinc-500" role="status">Ledger temporarily unavailable.</p>
      ) : state.status === "ready" ? (
        <HireJobRows chainId={chainId} emptyText="No indexed jobs created by this wallet on this network." jobs={state.page.jobs} />
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
