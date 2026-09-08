"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight, CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { Erc8183TestnetJobTracking } from "@/src/business/entities/erc8183-testnet-job-tracking";
import type { Erc8183BrowserJournal } from "@/src/business/entities/erc8183-browser-spike";
import { ERC8183_TESTNET, loadBrowserJournal } from "@/src/business/browser/erc8183-browser-wallet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceRail } from "./evidence-rail";
import { Breadcrumb } from "./page-primitives";
import { TestnetClosurePanel } from "./testnet-closure-panel";
import { JobNotificationStatus } from "./job-notification-status";
import type { JobAgentResolution } from "@/src/business/entities/job-agent-resolution";

const TRANSACTION_LABELS = {
  createJob: "Create job",
  registerJob: "Register policy",
  setBudget: "Set budget",
  approve: "Approve exact amount",
  fund: "Fund escrow",
  submit: "Submit result",
} as const;

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}


export function TestnetJobTracker({ tracking, agentResolution }: { tracking: Erc8183TestnetJobTracking; agentResolution?: JobAgentResolution | undefined }) {
  const router = useRouter();
  const [journal, setJournal] = useState<Erc8183BrowserJournal | null>(null);
  const { job, snapshot } = tracking;
  const jobId = job?.jobId ?? snapshot?.jobId ?? "unknown";
  const buyer = job?.buyer ?? snapshot?.buyer ?? "Unavailable";
  const seller = job?.provider ?? snapshot?.seller ?? "Unavailable";

  useEffect(() => {
    const stored = loadBrowserJournal();
    if (
      stored?.jobId === jobId &&
      sameAddress(stored.buyer, buyer) &&
      sameAddress(stored.seller, seller)
    ) setJournal(stored);
  }, [buyer, jobId, seller]);

  const submitted = job
    ? job.status === "SUBMITTED" || job.status === "COMPLETED"
    : snapshot?.lifecycle.expectedState === "SUBMITTED";
  const resultVerified = job?.result?.hashVerified === true || snapshot?.deliverable.hashVerified === true;
  const steps = [
    { kind: "declared" as const, label: "Declared", status: "verified" as const, provenance: "declared" as const, detail: "The controlled fixture and fixed Testnet terms are declared.", ...(snapshot ? { source: snapshot.source } : {}) },
    { kind: "reachable" as const, label: "Reachable", status: resultVerified ? "verified" as const : "unknown" as const, provenance: "observed" as const, detail: resultVerified ? "The hosted result was fetched from the allowlisted origin." : "No current hosted result is available." },
    { kind: "quote" as const, label: "Quote verified", status: snapshot?.quote?.signatureVerified ? "verified" as const : "unknown" as const, provenance: "observed" as const, detail: snapshot?.quote?.signatureVerified ? "The signed quote was verified before the browser transactions." : "No versioned quote proof is attached to this job." },
    { kind: "job" as const, label: "Job proven", status: submitted ? "verified" as const : "current" as const, provenance: "onchain" as const, detail: submitted ? "The ERC-8183 job reached SUBMITTED on BSC Testnet." : `Current direct-chain state: ${job?.status ?? "temporarily unavailable"}.` },
  ];

  const snapshotTransactions = snapshot ? Object.entries(snapshot.transactions) : [];
  const journalTransactions = journal
    ? Object.entries(journal.transactions).filter(([phase]) => !snapshot?.transactions[phase as keyof typeof snapshot.transactions])
    : [];

  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <Breadcrumb current={`Job #${jobId}`} trail={[{ href: "/", label: "Home" }, { href: "/jobs?chainId=97", label: "Jobs" }]} />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <h1 className="mt-5 text-3xl font-light tracking-tight sm:text-5xl">ERC-8183 Job #{jobId}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{job?.status ?? snapshot?.lifecycle.expectedState ?? "Unavailable"}</Badge>
        </div>
      </div>

      <Alert className="mt-7 border-amber-300/20 bg-amber-300/[0.05]">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>Testing infrastructure — not a marketplace agent</AlertTitle>
        <AlertDescription>Seller Agent 1866 is a controlled Testnet fixture. This job does not make a Mainnet marketplace candidate hireable.</AlertDescription>
      </Alert>
      {job ? <TestnetClosurePanel jobId={jobId} /> : null}
      <JobNotificationStatus chainId={97} jobId={jobId} />

      {tracking.liveStatus === "unavailable" && (
        <Alert className="mt-4 border-zinc-700 bg-zinc-950">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Live chain check unavailable</AlertTitle>
          <AlertDescription>The sanitized historical proof remains visible. Refresh when the Testnet demo is enabled and RPC access is available.</AlertDescription>
        </Alert>
      )}

      <details className="mt-6">
      <summary className="cursor-pointer text-sm text-muted-foreground">Verification details</summary>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Evidence line</CardTitle>
          <CardDescription>Declared, observed and onchain facts are never collapsed into one status.</CardDescription>
        </CardHeader>
        <CardContent><EvidenceRail ariaLabel={`Evidence for Testnet Job ${jobId}`} steps={steps} /></CardContent>
      </Card>
      </details>

      <div className="mt-6 flex flex-col gap-6">
        {job ? <JobStateCard job={directJobState(job)} source="direct" agentResolution={agentResolution} /> : snapshot ? <JobStateCard source="snapshot" agentResolution={agentResolution} job={{
          chainId: 97, buyer: snapshot.buyer, provider: snapshot.seller, evaluator: null,
          budgetRaw: snapshot.payment.budgetRaw, expiresAt: snapshot.lifecycle.deadline.iso,
          submittedAt: null, deliverable: snapshot.deliverable.hash, events: [],
        }} /> : null}
        <dl>              {tracking.buyerIdentity.kind === "demo_agent" && (
                <div className="border-b border-white/10 py-3 last:border-0 sm:grid sm:grid-cols-[9rem_1fr] sm:gap-4">
                  <dt className="text-xs text-muted-foreground">Buyer identity</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2 sm:mt-0">
                    <Badge className="border-primary/30 bg-primary/10 text-primary" variant="outline">Hired by an agent</Badge>
                    {tracking.buyerIdentity.verified && tracking.buyerIdentity.agentId && tracking.buyerIdentity.registry ? (
                      <a className="inline-flex items-center gap-1 text-xs text-zinc-200 underline-offset-4 hover:underline" href={`${ERC8183_TESTNET.explorerUrl}/token/${tracking.buyerIdentity.registry}?a=${tracking.buyerIdentity.agentId}`} rel="noreferrer" target="_blank">
                        ERC-8004 #{tracking.buyerIdentity.agentId} · registry wallet verified<ArrowUpRight aria-hidden="true" className="size-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-400">
                        {tracking.buyerIdentity.agentId
                          ? `ERC-8004 #${tracking.buyerIdentity.agentId} declared · registry wallet not verified`
                          : "Demo agent-buyer wallet · no ERC-8004 identity declared"}
                      </span>
                    )}
                  </dd>
                </div>
              )}</dl>

        <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">Transaction history</summary>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Receipt spine</CardTitle>
            <CardDescription>{snapshotTransactions.length ? "Versioned public transaction evidence." : journal ? "Transactions retained only by this browser." : "No transaction hashes are available in this browser."}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {snapshotTransactions.map(([phase, transaction]) => (
              <a className="rounded-lg border border-white/10 p-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={transaction.explorerUrl} key={phase} rel="noreferrer" target="_blank">
                <span className="flex items-center justify-between gap-3 text-sm text-zinc-200"><span className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="size-4 text-emerald-400" />{TRANSACTION_LABELS[phase as keyof typeof TRANSACTION_LABELS]}</span><ArrowUpRight aria-hidden="true" className="size-4" /></span>
                <span className="font-hash mt-2 block text-[11px] text-zinc-400">{transaction.hash}</span>
                <span className="mt-2 block text-[11px] text-zinc-500">Block {transaction.blockNumber} · {transaction.timestamp} · onchain</span>
              </a>
            ))}
            {journalTransactions.map(([phase, hash]) => hash && (
              <a className="rounded-lg border border-white/10 p-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`${ERC8183_TESTNET.explorerUrl}/tx/${hash}`} key={phase} rel="noreferrer" target="_blank">
                <span className="flex items-center justify-between gap-3 text-sm text-zinc-200"><span>{TRANSACTION_LABELS[phase as keyof typeof TRANSACTION_LABELS]}</span><ArrowUpRight aria-hidden="true" className="size-4" /></span>
                <span className="font-hash mt-2 block text-[11px] text-zinc-400">{hash}</span>
              </a>
            ))}
          </CardContent>
        </Card>
        </details>
      </div>

      {tracking.verifiedPhases.length > 0 && (
        <Card className="marketplace-surface mt-6">
          <CardHeader>
            <CardTitle>Chain-verified hire phases</CardTitle>
            <CardDescription>Phases the observation Worker verified against BSC Testnet receipts and Commerce events for this job. A verified phase proves the phase, not the deliverable.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul aria-label={`Chain-verified hire phases for Testnet Job ${jobId}`} className="flex flex-col gap-3">
              {tracking.verifiedPhases.map((event) => (
                <li key={`${event.txHash}:${event.phase}`}>
                  <a className="block rounded-lg border border-white/10 p-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`${ERC8183_TESTNET.explorerUrl}/tx/${event.txHash}`} rel="noreferrer" target="_blank">
                    <span className="flex items-center justify-between gap-3 text-sm text-zinc-200"><span className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="size-4 text-emerald-400" />{event.phase}</span><ArrowUpRight aria-hidden="true" className="size-4" /></span>
                    <span className="font-hash mt-2 block text-[11px] text-zinc-400">{event.txHash}</span>
                    <span className="mt-2 block text-[11px] text-zinc-500">Block {event.blockNumber} · {event.occurredAt} · onchain</span>
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {resultVerified && (
        <Card className="mt-6 border-emerald-400/20 bg-emerald-400/[0.04]">
          <CardHeader><CardTitle>Hash-verified result</CardTitle><CardDescription>The displayed content matches the deliverable committed onchain.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="whitespace-pre-wrap text-sm text-zinc-200">{job?.result?.content ?? snapshot?.deliverable.content}</p>
            {(job?.deliverableUrl ?? snapshot?.deliverable.url) && (
              <a className="inline-flex items-center gap-2 text-sm text-emerald-300 underline-offset-4 hover:underline" href={job?.deliverableUrl ?? snapshot?.deliverable.url} rel="noreferrer" target="_blank">Open sanitized receipt<ArrowUpRight aria-hidden="true" className="size-4" /></a>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mt-7 flex flex-wrap gap-3">
        <Button onClick={() => router.refresh()} variant="outline"><RefreshCw aria-hidden="true" data-icon="inline-start" />Refresh chain state</Button>
      </div>
    </main>
  );
}
import { JobStateCard } from "./job-state-card";
import { directJobState } from "./direct-job-state";
