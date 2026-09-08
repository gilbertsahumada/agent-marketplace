import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { explorerUrl } from "./hire-job-rows";

export function JobPhaseLedger({ chainId, events }: { chainId: 56 | 97; events: readonly { phase: string; occurredAt: string; txHash: string }[] }) {
  return <Card className="mt-6">
    <CardHeader><h2 className="font-heading text-base font-medium">Phase ledger</h2><CardDescription>Chain-verified event history. An event confirms a phase, not the quality of the result.</CardDescription></CardHeader>
    <CardContent>{events.length ? <ul aria-label="Indexed phase events" className="divide-y divide-border text-sm">
      {events.map((event, index) => <li key={`${event.txHash}:${event.phase}:${index}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
        <span className="font-medium capitalize">{event.phase}</span>
        <span className="text-muted-foreground">{new Date(event.occurredAt).toLocaleString("en", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} UTC</span>
        <a className="inline-flex items-center gap-1.5 text-signal underline underline-offset-4" href={`${explorerUrl(chainId)}/tx/${event.txHash}`} target="_blank" rel="noopener noreferrer" aria-label={`${event.phase.charAt(0).toUpperCase() + event.phase.slice(1)} transaction on explorer, opens in a new tab`}>Transaction on explorer<ExternalLink className="size-3.5" aria-hidden="true" /></a>
      </li>)}
    </ul> : <p className="text-sm text-muted-foreground">No phase events indexed for this job yet. Jobs backfilled by state have no event history until a new phase lands on chain.</p>}</CardContent>
  </Card>;
}
