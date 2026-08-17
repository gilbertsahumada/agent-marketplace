import { ArrowUpRight, CheckCircle2, ShieldCheck } from "lucide-react";
import type { PublicJobProof } from "@/src/business/entities/public-job-proof";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceRail } from "./evidence-rail";
import { PageIntro } from "./page-primitives";

export function PublicProofPage({ proof }: { proof: PublicJobProof }) {
  const { snapshot, live } = proof;
  const verified = live.status === "verified";
  const steps = [
    { kind: "declared" as const, label: "Declared", status: "verified" as const, provenance: "declared" as const, detail: "The fixture published a deterministic service and job terms.", source: snapshot.source, timestamp: snapshot.recordedAt },
    { kind: "reachable" as const, label: "Reachable", status: "verified" as const, provenance: "observed" as const, detail: "The temporary seller endpoint accepted negotiation and funding notification.", timestamp: snapshot.transactions.fund.timestamp },
    { kind: "quote" as const, label: "Quote verified", status: "verified" as const, provenance: "observed" as const, detail: "The buyer accepted the seller quote before creating the job.", timestamp: snapshot.transactions.createJob.timestamp },
    { kind: "job" as const, label: "Job proven", status: verified ? "verified" as const : "current" as const, provenance: "onchain" as const, detail: verified ? "Direct BSC Testnet reads confirm SUBMITTED." : "The versioned snapshot remains available; live RPC verification is temporarily unavailable.", source: live.source, timestamp: live.observedAt },
  ];
  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <PageIntro eyebrow="Public Gate 1 proof" title={`ERC-8183 Job #${snapshot.jobId}`}>
          A sanitized record of a real controlled hiring lifecycle on BSC Testnet. The seller is test infrastructure, not a marketplace candidate or official reference agent.
        </PageIntro>
        <Badge className={verified ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 bg-amber-400/10 text-amber-200"} variant="outline">
          <ShieldCheck aria-hidden="true" />{verified ? "Live onchain verified" : "Snapshot verified · live unavailable"}
        </Badge>
      </div>
      <Card className="marketplace-surface mt-8"><CardHeader><CardTitle>Evidence line</CardTitle></CardHeader><CardContent><EvidenceRail steps={steps} /></CardContent></Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="marketplace-surface">
          <CardHeader><CardTitle>Job terms</CardTitle></CardHeader>
          <CardContent><dl className="space-y-3 text-sm">
            {[
              ["Chain", `${snapshot.network} · ${snapshot.chainId}`], ["Seller agent", snapshot.sellerAgentId], ["Buyer", snapshot.buyer], ["Seller", snapshot.seller],
              ["Payment token", `${snapshot.payment.symbol} · ${snapshot.payment.token}`], ["Budget (raw)", snapshot.payment.budgetRaw], ["Deadline", snapshot.lifecycle.deadline.iso], ["Submitted", snapshot.lifecycle.submittedAt.iso],
            ].map(([label, value]) => <div className="grid gap-1 border-b border-white/10 pb-3 sm:grid-cols-[9rem_1fr]" key={label}><dt className="text-zinc-500">{label}</dt><dd className="font-stat break-all text-xs text-zinc-200">{value}</dd></div>)}
          </dl></CardContent>
        </Card>
        <Card className="marketplace-surface">
          <CardHeader><CardTitle>Lifecycle transactions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(snapshot.transactions).map(([phase, transaction]) => (
              <a className="flex items-center justify-between gap-3 rounded-lg border border-white/10 p-3 text-sm hover:bg-white/[0.03]" href={transaction.explorerUrl} key={phase} rel="noreferrer" target="_blank">
                <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-400" />{phase}</span>
                <span className="font-stat truncate text-xs text-zinc-500">{transaction.hash.slice(0, 12)}…</span><ArrowUpRight className="size-4" />
              </a>
            ))}
          </CardContent>
        </Card>
      </div>
      <Alert className="mt-6 border-zinc-800 bg-zinc-950">
        <AlertTitle>Sanitized deliverable receipt</AlertTitle>
        <AlertDescription>{snapshot.deliverable.receipt} · {snapshot.deliverable.hash}<br />{snapshot.deliverable.note}</AlertDescription>
      </Alert>
    </main>
  );
}
