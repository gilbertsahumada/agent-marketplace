"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { JobClosureActions } from "./job-closure-actions";
import type { JobClosure } from "@/src/mainnet/job-delivery";

type Report = { jobId: string; chainId: 97; closure: JobClosure; settlementOutcome: "completed" | "rejected" | null };
export function TestnetClosurePanel({ jobId }: { jobId: string }) {
  return <Panel key={jobId} jobId={jobId} />;
}
function Panel({ jobId }: { jobId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
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
      if (!controller.signal.aborted) setReport(data);
    } catch { if (request.current === controller) setError(true); }
    finally { clearTimeout(timer); request.current = null; setBusy(false); }
  }
  return <section className="mt-6 flex flex-col gap-3" aria-label="Testnet closure">
    <h2 className="text-lg font-medium">Testnet closure</h2>
    <p className="text-sm text-muted-foreground">Reads chain 97 only. Checking status does not open your wallet or send a transaction.</p>
    <Button variant="outline" disabled={busy} onClick={() => void refresh()}>{busy ? "Checking Testnet…" : "Check closure status"}</Button>
    {error ? <p role="alert">Testnet state is unavailable or unsupported. No transaction was sent.</p> : null}
    {report ? <>
      <p role="status">{report.closure.replaceAll("_", " ")}</p>
      {process.env.NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED === "true"
        ? <JobClosureActions network="testnet" report={report} refresh={() => void refresh()} />
        : <p className="text-sm text-muted-foreground">Wallet closure actions are disabled for this deployment.</p>}
    </> : null}
  </section>;
}
