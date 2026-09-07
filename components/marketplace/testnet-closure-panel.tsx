"use client";
import { useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/src/business/entities/token-amount";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { JobClosureActions } from "./job-closure-actions";
import type { JobClosure } from "@/src/mainnet/job-delivery";

type Report = { jobId: string; chainId: 97; closure: JobClosure; settlementOutcome: "completed" | "rejected" | null; refundAvailable?: boolean; buyer?: string; budgetRaw?: string };
export function TestnetClosurePanel({ jobId }: { jobId: string }) {
  return <Panel key={jobId} jobId={jobId} />;
}
function Panel({ jobId }: { jobId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { void refresh(); return () => { request.current?.abort(); request.current = null; }; }, []);
  async function refresh() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    setBusy(true); setReport(null); setError(false);
    try {
      const response = await fetch(`/api/marketplace/jobs/testnet/${jobId}/closure`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      if (data.chainId !== 97 || data.jobId !== jobId || !["completed", "rejected", "expired", "not_submitted", "review_window", "disputed", "settlement_available", "awaiting_policy"].includes(data.closure)) throw new Error("Invalid response");
      if (data.refundAvailable === true && (data.status !== "FUNDED" || !/^0x[\da-f]{40}$/i.test(data.buyer ?? "") || !/^\d{1,78}$/.test(data.budgetRaw ?? ""))) throw new Error("Invalid refund response");
      if (!controller.signal.aborted) setReport(data);
    } catch { if (request.current === controller) setError(true); }
    finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  const labels: Record<JobClosure, string> = { unsupported_policy: "Unsupported policy", unavailable: "Status unavailable", not_submitted: "Awaiting delivery", review_window: "Review delivery", disputed: "Under dispute", settlement_available: "Ready to close", awaiting_policy: "Awaiting resolution", completed: "Completed", rejected: "Rejected", expired: "Deposit withdrawn" };
  return <Card className="mt-8" aria-label="Job status">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-base font-medium">Job status</h2>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>{busy ? "Updating…" : "Refresh status"}</Button>
      </div>
      <CardDescription>Delivery and deposit</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
    {busy && <div role="status" aria-label="Loading job status" className="flex flex-col gap-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-full" /></div>}
    {error ? <p role="alert">Current job status could not be verified. Refresh to retry; no transaction was sent.</p> : null}
    {report ? <>
      <div role="status" className="flex flex-col items-start gap-3">
        <Badge variant="outline">{report.refundAvailable ? "Deadline passed · deposit available" : labels[report.closure]}</Badge>
        {report.refundAvailable ? <>
          <p className="text-sm text-muted-foreground">No delivery was submitted before the deadline. Your deposit is still in escrow. Withdraw it to return the funds to your wallet.</p>
          <p className="text-sm">Available to withdraw <span className="ml-2 font-medium">{formatTokenAmount(report.budgetRaw!, 18)} U</span></p>
        </> : report.closure === "not_submitted" ? <p className="text-sm text-muted-foreground">The provider has not submitted a delivery yet.</p> : null}
      </div>
      {report.refundAvailable === true || process.env.NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED === "true"
        ? <JobClosureActions network="testnet" report={report} refresh={() => void refresh()} />
        : null}
    </> : null}
    </CardContent>
  </Card>;
}
