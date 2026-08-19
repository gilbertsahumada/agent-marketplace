"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { Erc8183TestnetJobTracking } from "@/src/business/entities/erc8183-testnet-job-tracking";
import type { Erc8183BrowserJournal } from "@/src/business/entities/erc8183-browser-spike";
import { ERC8183_TESTNET, loadBrowserJournal } from "@/src/business/browser/erc8183-browser-wallet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceRail } from "./evidence-rail";
import { PageIntro } from "./page-primitives";

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

function timestamp(seconds: string | undefined): string {
  if (!seconds || !/^\d+$/.test(seconds)) return "Unavailable";
  const milliseconds = Number(BigInt(seconds) * 1_000n);
  return Number.isSafeInteger(milliseconds) ? new Date(milliseconds).toISOString() : "Unavailable";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-3 last:border-0 sm:grid sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-stat mt-1 break-all font-mono text-xs text-zinc-200 sm:mt-0">{value}</dd>
    </div>
  );
}

export function TestnetJobTracker({ tracking }: { tracking: Erc8183TestnetJobTracking }) {
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
    <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <PageIntro eyebrow="BSC Testnet job tracker" title={`ERC-8183 Job #${jobId}`}>
          Direct contract state is authoritative. Versioned evidence and this browser&apos;s journal remain separate supporting records.
        </PageIntro>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-primary/30 bg-primary/10 text-primary" variant="outline">Chain 97</Badge>
          <Badge variant="outline">{job?.status ?? snapshot?.lifecycle.expectedState ?? "Unavailable"}</Badge>
        </div>
      </div>

      <Alert className="mt-7 border-amber-300/20 bg-amber-300/[0.05]">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>Testing infrastructure — not a marketplace agent</AlertTitle>
        <AlertDescription>Seller Agent 1866 is a controlled Testnet fixture. This job does not make a Mainnet marketplace candidate hireable.</AlertDescription>
      </Alert>

      {tracking.liveStatus === "unavailable" && (
        <Alert className="mt-4 border-zinc-700 bg-zinc-950">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Live chain check unavailable</AlertTitle>
          <AlertDescription>The sanitized historical proof remains visible. Refresh when the Testnet demo is enabled and RPC access is available.</AlertDescription>
        </Alert>
      )}

      <Card className="marketplace-surface mt-7">
        <CardHeader>
          <CardTitle>Evidence line</CardTitle>
          <CardDescription>Declared, observed and onchain facts are never collapsed into one status.</CardDescription>
        </CardHeader>
        <CardContent><EvidenceRail ariaLabel={`Evidence for Testnet Job ${jobId}`} steps={steps} /></CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <Card className="marketplace-surface">
          <CardHeader><CardTitle>Verified job facts</CardTitle></CardHeader>
          <CardContent>
            <dl>
              <Fact label="Buyer" value={buyer} />
              <Fact label="Seller" value={seller} />
              <Fact label="Seller agent" value={snapshot?.sellerAgentId ?? String(ERC8183_TESTNET.agentId)} />
              <Fact label="Payment token" value={job?.quotedToken ?? snapshot?.payment.token ?? "Unavailable"} />
              <Fact label="Budget" value={`${job?.budgetRaw ?? snapshot?.payment.budgetRaw ?? "Unavailable"} raw units`} />
              <Fact label="Deadline" value={job ? timestamp(job.deadline) : snapshot?.lifecycle.deadline.iso ?? "Unavailable"} />
              <Fact label="Deliverable" value={job?.deliverableHash ?? snapshot?.deliverable.hash ?? "Unavailable"} />
            </dl>
          </CardContent>
        </Card>

        <Card className="marketplace-surface">
          <CardHeader>
            <CardTitle>Receipt spine</CardTitle>
            <CardDescription>{snapshotTransactions.length ? "Versioned public transaction evidence." : journal ? "Transactions retained only by this browser." : "No transaction hashes are available in this browser."}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {snapshotTransactions.map(([phase, transaction]) => (
              <a className="rounded-lg border border-white/10 p-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={transaction.explorerUrl} key={phase} rel="noreferrer" target="_blank">
                <span className="flex items-center justify-between gap-3 text-sm text-zinc-200"><span className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="size-4 text-emerald-400" />{TRANSACTION_LABELS[phase as keyof typeof TRANSACTION_LABELS]}</span><ArrowUpRight aria-hidden="true" className="size-4" /></span>
                <span className="font-stat mt-2 block break-all font-mono text-[11px] text-zinc-400">{transaction.hash}</span>
                <span className="mt-2 block text-[11px] text-zinc-500">Block {transaction.blockNumber} · {transaction.timestamp} · onchain</span>
              </a>
            ))}
            {journalTransactions.map(([phase, hash]) => hash && (
              <a className="rounded-lg border border-white/10 p-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`${ERC8183_TESTNET.explorerUrl}/tx/${hash}`} key={phase} rel="noreferrer" target="_blank">
                <span className="flex items-center justify-between gap-3 text-sm text-zinc-200"><span>{TRANSACTION_LABELS[phase as keyof typeof TRANSACTION_LABELS]}</span><ArrowUpRight aria-hidden="true" className="size-4" /></span>
                <span className="font-stat mt-2 block break-all font-mono text-[11px] text-zinc-400">{hash}</span>
              </a>
            ))}
          </CardContent>
        </Card>
      </div>

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
        <Button asChild variant="outline"><Link href="/demo/erc8183"><ArrowLeft aria-hidden="true" data-icon="inline-start" />Return to demo</Link></Button>
        <Button onClick={() => router.refresh()} variant="outline"><RefreshCw aria-hidden="true" data-icon="inline-start" />Refresh chain state</Button>
      </div>
    </main>
  );
}
