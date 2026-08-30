import type { Metadata } from "next";
import Link from "next/link";
import { ValidateAgentPanel } from "@/components/marketplace/validate-agent-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Validate my agent",
  description: "Run a bounded, read-only evidence check for one BSC ERC-8004 agent.",
};

export default function ValidateAgentPage() {
  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 max-w-3xl">
        <p className="font-eyebrow text-primary">Builder verification</p>
        <h1 className="mt-3 text-3xl font-light tracking-tight text-white sm:text-4xl">Validate what your agent can prove today.</h1>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">
          Registration is the starting point. This check keeps declared metadata, observed behavior, direct BSC identity and ERC-8183 commercial evidence separate.
        </p>
      </div>
      <ValidateAgentPanel />
      <Card className="marketplace-surface mt-8">
        <CardHeader>
          <h2 className="text-base font-medium text-zinc-100">From Agent Studio to marketplace evidence</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
            Each state requires new evidence. No step is inferred from the previous one.
          </p>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["1", "Register", "Publish the ERC-8004 identity and declared service metadata on BSC."],
              ["2", "Validate", "Reconcile identity and run bounded probes against declared public transports."],
              ["3", "Review", "Submit current evidence for manual category and release qualification review."],
              ["4", "Hire", "For a compatible seller admitted by the marketplace, request and validate a fresh ERC-8183 quote before preparing any transaction."],
              ["5", "Prove", "Link a hash-verified Mainnet job result and retain its sample size and cost."],
            ].map(([number, title, detail]) => (
              <li className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4" key={number}>
                <span className="font-stat text-xs text-primary">{number}</span>
                <h3 className="mt-2 text-sm font-medium text-zinc-100">{title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">{detail}</p>
              </li>
            ))}
          </ol>
          <Button asChild className="mt-5" variant="outline">
            <Link href="/evidence/verification">Read the verification methodology</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
