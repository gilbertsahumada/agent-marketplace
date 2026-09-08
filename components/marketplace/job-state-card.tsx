import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { HireJobDetail } from "@/src/business/entities/hire-job";
import type { JobAgentResolution } from "@/src/business/entities/job-agent-resolution";
import { explorerUrl } from "./hire-job-rows";
import { AddressLink } from "./address-link";
import { JobAgentCell } from "./job-agent-cell";
import { formatTokenAmount } from "@/src/business/entities/token-amount";
import { ERC8183_MAINNET } from "@/src/mainnet/contracts";
import { ERC8183_TESTNET } from "@/src/business/browser/erc8183-browser-wallet";
const EXPLORER_LINK = "inline-flex items-center gap-1.5 text-signal underline decoration-signal/30 underline-offset-4 hover:decoration-signal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal";

const UTC_DATE_TIME = new Intl.DateTimeFormat("en", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});

function when(value: string | null): string {
  return !value || !Number.isFinite(Date.parse(value)) ? "—" : `${UTC_DATE_TIME.format(new Date(value))} UTC`;
}

export type JobStateFacts = Pick<HireJobDetail, "chainId" | "buyer" | "provider" | "budgetRaw" | "expiresAt" | "submittedAt" | "deliverable" | "events"> & { evaluator: string | null; policy?: string };

export function JobStateCard({ job, agentResolution, source = "indexed" }: { job: JobStateFacts; agentResolution?: JobAgentResolution | undefined; source?: "indexed" | "direct" | "snapshot" }) {
  const explorer = explorerUrl(job.chainId);
  const submission = job.deliverable ? job.events.findLast((event) => event.eventName === "JobSubmitted" && event.deliverable?.toLowerCase() === job.deliverable?.toLowerCase()) : undefined;
  const facts: Array<[string, string]> = [
    ["Buyer", job.buyer],
    ["Provider", job.provider],
    ...(job.evaluator ? [["Evaluator", job.evaluator] as [string, string]] : []),
    ...(job.policy ? [["Policy", job.policy] as [string, string]] : []),
    ["Expires", when(job.expiresAt)],
    ["Submitted", when(job.submittedAt)],
    ["Deliverable hash", job.deliverable ?? "—"],
  ];
  return (
      <Card className="mt-8">
        <CardHeader><h2 className="font-heading text-base font-medium">{source === "indexed" ? "Indexed job state" : source === "snapshot" ? "Historical job state" : "Verified job state"}</h2><CardDescription>{source === "indexed" ? "Read from the Commerce contract by the observation Worker." : source === "snapshot" ? "Saved public evidence. Current chain state is unavailable." : "Read directly from the Commerce contract."}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid gap-1 border-b border-border pb-3 sm:grid-cols-[10rem_1fr]">
            <span className="text-muted-foreground">Chain</span>
            <div className="flex items-center gap-3">
              <img alt="" width={24} height={24} className="size-6 shrink-0" src="/logo/SVG/BNB Chain_Symbol_Yellow.svg" />
              <div>
                <p>{job.chainId === 56 ? "BNB Smart Chain Mainnet" : "BNB Smart Chain Testnet"}</p>
                <p className="text-xs text-muted-foreground">Chain ID: {job.chainId}</p>
              </div>
            </div>
          </div>
          <div className="grid gap-1 border-b border-border pb-3 sm:grid-cols-[10rem_1fr]">
            <span className="text-muted-foreground">Agent</span><JobAgentCell resolution={agentResolution} />
          </div>
          <div className="grid gap-1 border-b border-border pb-3 sm:grid-cols-[10rem_1fr]">
            <span className="text-muted-foreground">Budget</span>
            <p className="flex items-center gap-1.5">
              <span>{formatTokenAmount(job.budgetRaw, 18)}</span>
              <a className={EXPLORER_LINK} href={`${explorer}/address/${job.chainId === 56 ? ERC8183_MAINNET.token : ERC8183_TESTNET.token}`} target="_blank" rel="noopener noreferrer" aria-label="U token on explorer, opens in a new tab">U<ExternalLink aria-hidden="true" className="size-3" /></a>
            </p>
          </div>
          {facts.map(([label, value]) => (
            <div className="grid gap-1 border-b border-white/[0.06] pb-3 sm:grid-cols-[10rem_1fr]" key={label}>
              <span className="text-zinc-500">{label}</span>
              <span className="font-hash break-all text-xs text-zinc-200">{["Buyer", "Provider", "Evaluator", "Policy"].includes(label) ? <AddressLink address={value} chainId={job.chainId} full /> : value}</span>
            </div>
          ))}
          {job.deliverable ? <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>The provider recorded this deliverable hash when submitting the result on-chain. It identifies the delivered content, not a transaction. Matching the hash verifies integrity, not the quality of the work.</p>
            {submission ? <a className={EXPLORER_LINK} href={`${explorer}/tx/${submission.txHash}`} target="_blank" rel="noopener noreferrer">View submission transaction<ExternalLink aria-hidden="true" className="size-3.5" /></a> : <p>Submission transaction not yet indexed.</p>}
          </div> : null}
        </CardContent>
      </Card>
  );
}
