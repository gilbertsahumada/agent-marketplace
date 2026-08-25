import { ArrowUpRight, CheckCircle2, ShieldCheck } from "lucide-react";
import type { MainnetJobProof } from "@/src/business/entities/mainnet-job-proof";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageIntro } from "./page-primitives";

export function MainnetJobProofPage({ proof }: { proof: MainnetJobProof }) {
  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <PageIntro eyebrow="Primary public hiring proof" title={`BSC Mainnet Job #${proof.jobId}`}>
          A browser-signed ERC-8183 Grid planning job against a marketplace-operated seller. The seller performs no trading or custody and is not an official BNB reference agent.
        </PageIntro>
        <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300" variant="outline"><ShieldCheck />Onchain {proof.finalState}</Badge>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="marketplace-surface"><CardHeader><CardTitle>Measured result</CardTitle></CardHeader><CardContent><dl className="space-y-3 text-sm">
          {[
            ["Chain", "BSC Mainnet · 56"], ["Agent ID", proof.agentId], ["Buyer", proof.buyer], ["Seller", proof.seller],
            ["Payment token", proof.token], ["Budget raw", proof.budgetRaw], ["Duration", `${proof.durationSeconds} seconds`],
            ["Total gas cost", `${proof.totalGasCostWei} wei`], ["Deliverable", proof.deliverableHash],
          ].map(([label, value]) => <div className="grid gap-1 border-b border-white/10 pb-3 sm:grid-cols-[9rem_1fr]" key={label}><dt className="text-zinc-500">{label}</dt><dd className="font-hash text-xs text-zinc-200">{value}</dd></div>)}
        </dl><div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-sm text-emerald-200"><CheckCircle2 className="mr-2 inline size-4" />Deliverable hash and deterministic Grid result re-derived successfully.</div></CardContent></Card>
        <Card className="marketplace-surface"><CardHeader><CardTitle>Lifecycle transactions</CardTitle></CardHeader><CardContent className="space-y-3">
          {Object.entries(proof.transactions).map(([phase, transaction]) => <a className="block rounded-lg border border-white/10 p-3 text-sm hover:bg-white/[0.03]" href={transaction.explorerUrl} key={phase} rel="noreferrer" target="_blank"><span className="flex items-center justify-between"><span>{phase}</span><ArrowUpRight className="size-4" /></span><span className="font-hash mt-2 block text-[11px] text-zinc-300">{transaction.hash}</span><span className="mt-2 block text-[11px] text-zinc-500">Block {transaction.blockNumber} · {transaction.timestamp} · gas {transaction.gasCostWei} wei · {transaction.provenance}</span></a>)}
        </CardContent></Card>
      </div>
      <p className="mt-6 text-xs text-zinc-500">Captured {proof.capturedAt}. Public addresses, hashes and costs only; no keys, wallet secrets, environment variables or local paths are stored.</p>
    </main>
  );
}
