"use client";
import { useEffect, useState } from "react";
import { Check, ChevronDown, ExternalLink, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { DeliveryReport, JobClosure } from "@/src/mainnet/job-delivery";

const closureLabels: Record<JobClosure, string> = {
  completed: "Completed on-chain", rejected: "Rejected on-chain", expired: "Expired on-chain",
  not_submitted: "Waiting for seller", review_window: "Review window open", disputed: "Dispute in progress",
  settlement_available: "Ready for settlement", awaiting_policy: "Awaiting policy decision",
  unsupported_policy: "Policy not supported here", unavailable: "Closure check unavailable",
};
const integrityLabels = { verified: "Integrity verified", mismatch: "Hash mismatch", unsupported: "Unverified format", unavailable: "Delivery unavailable", not_submitted: "No delivery yet" };

function HighlightedDelivery({ content, requests }: { content: string; requests: string[] }) {
  const values = [...new Set(requests.filter(value => typeof value === "string" && value.length > 0))].sort((a, b) => b.length - a.length);
  if (!values.length) return <>{content}</>;
  const pattern = new RegExp(`(${values.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return <>{content.split(pattern).map((part, index) => values.includes(part)
    ? <mark key={index} className="rounded-sm bg-signal px-0.5 text-black">{part}</mark>
    : part)}</>;
}

export function JobDeliveryPanel({ jobId }: { jobId: string }) {
  const [report, setReport] = useState<DeliveryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setLoading(true); setError(false);
    void (async () => {
      try {
        const response = await fetch(`/api/marketplace/jobs/mainnet/${jobId}/delivery`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json() as DeliveryReport;
        if (data.jobId !== jobId || !data.delivery || !(data.delivery.status in integrityLabels) || !(data.closure in closureLabels)) throw new Error("Invalid response");
        if (!controller.signal.aborted) setReport(data);
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [jobId, revision]);
  return <Card className="mt-6">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium"><FileText aria-hidden="true" className="size-4" />Delivery &amp; closure</h2>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision(value => value + 1)}>
          {loading ? <LoaderCircle aria-hidden="true" data-icon="inline-start" className="animate-spin" /> : <RefreshCw aria-hidden="true" data-icon="inline-start" />}{loading ? "Checking delivery…" : "Refresh status"}
        </Button>
      </div>
      <CardDescription>Integrity confirms the content matches its on-chain hash, not that it meets your requirements.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4" aria-busy={loading}>
      {error ? <p role="alert">Could not check the delivery. Your job and payment have not changed. Retry shortly.</p> : null}
      {report ? <>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{report.delivery.status === "verified" ? <Check aria-hidden="true" /> : null}{integrityLabels[report.delivery.status]}</Badge>
          <Badge variant="outline">{closureLabels[report.closure]}</Badge>
        </div>
        {report.delivery.content !== null ? <>
          {report.delivery.status !== "verified" ? <p className="text-sm text-muted-foreground">Unverified seller content. Do not treat this as proof of completion.</p> : null}
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-4 text-sm"><HighlightedDelivery content={report.delivery.content} requests={report.requestTexts ?? []} /></pre>
          <p className="text-sm text-muted-foreground">Compare this response with your requested deliverable and acceptance criteria.</p>
        </> : <p className="text-sm text-muted-foreground">{report.delivery.status === "not_submitted" ? "The seller has not submitted a delivery." : "A supported delivery could not be retrieved. An on-chain hash alone does not make the result accessible."}</p>}
        {report.delivery.url ? <Button asChild variant="outline" size="sm" className="self-start"><a href={report.delivery.url} target="_blank" rel="noopener noreferrer">Seller source<ExternalLink aria-hidden="true" data-icon="inline-end" /></a></Button> : null}
        {report.reviewEndsAt ? <p className="text-sm">Review window ends <time dateTime={report.reviewEndsAt}>{new Date(report.reviewEndsAt).toUTCString()}</time>.</p> : null}
        {report.closure === "review_window" ? <p className="text-sm text-muted-foreground">If the result does not meet your request, the original buyer can dispute it through the bound policy before the deadline. Disputes are not yet submitted from this app.</p> : null}
        {report.closure === "settlement_available" ? <p className="text-sm text-muted-foreground">The policy permits settlement. A separate on-chain transaction is required; no settlement or new payment has been sent by this page.</p> : null}
        {report.closure === "disputed" ? <p className="text-sm text-muted-foreground">The policy is handling a dispute. A completed outcome has not been confirmed.</p> : null}
        <details className="group/delivery">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">Verification details<ChevronDown aria-hidden="true" className="size-4 group-open/delivery:rotate-180" /></summary>
          <p className="mt-2 break-all text-xs text-muted-foreground">Checked {new Date(report.checkedAt).toUTCString()} · Policy {report.policy ?? "unavailable"}. Read-only checks; no wallet signature.</p>
        </details>
      </> : null}
    </CardContent>
  </Card>;
}
