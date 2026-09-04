"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, Copy, ExternalLink, FileClock, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { relativeAge } from "./relative-time";

type QuoteAttempt = {
  id: string;
  executor: string;
  status: string;
  durationMs: number | null;
  httpStatus: number | null;
  outcome: string | null;
  errorCode: string | null;
};

type QuoteRequest = {
  id: number;
  kind?: "capability_probe" | "buyer_quote";
  requestHash?: string;
  endpoint?: string | null;
  provider?: string | null;
  status: string;
  transport: string;
  createdAt: number;
  completedAt: number | null;
  quoteExpiresAt: number | null;
  errorCode: string | null;
  attempts: QuoteAttempt[];
};

type QuoteHistoryResponse = {
  counts?: { requests: number; buyerRequests?: number; buyerSucceeded?: number; capabilityProbes?: number; succeeded: number; rejected: number; failed: number; expired?: number };
  requests?: QuoteRequest[];
};

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function providerUrl(value: string): string | null {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? `https://bscscan.com/address/${value}` : null;
}

function CopyReference({ value, label }: { value: string; label: string }) {
  const copy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) void navigator.clipboard.writeText(value);
  };
  return (
    <button
      aria-label={`Copy ${label}`}
      className="inline-flex size-6 cursor-pointer items-center justify-center rounded text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={copy}
      title={`Copy ${label}`}
      type="button"
    >
      <Copy aria-hidden="true" className="size-3" />
    </button>
  );
}

function statusStyle(status: string): { label: string; className: string; icon: typeof CheckCircle2 } {
  if (status === "succeeded") return { label: "Verified", className: "border-emerald-400/30 text-emerald-300", icon: CheckCircle2 };
  if (status === "rejected" || status === "failed") return { label: status === "rejected" ? "Rejected" : "Failed", className: "border-red-400/30 text-red-300", icon: CircleAlert };
  if (status === "expired") return { label: "Expired", className: "border-amber-400/30 text-amber-200", icon: Clock3 };
  return { label: "Processing", className: "border-cyan-400/30 text-cyan-200", icon: LoaderCircle };
}

export function QuoteHistory({ agentId }: { agentId: string }) {
  const [data, setData] = useState<QuoteHistoryResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    // Test environments and older embedded shells may not expose fetch. Keep
    // the profile renderable in that case; the server-rendered state remains
    // authoritative and the history simply stays unavailable.
    const request = typeof fetch === "function"
      ? fetch(`/api/marketplace/agents/${agentId}/quotes`, { cache: "no-store" })
      : null;
    if (!request || typeof (request as Promise<Response>).then !== "function") {
      return () => { active = false; };
    }
    void request
      .then(async (response) => {
        const value = await response.json() as QuoteHistoryResponse;
        if (!response.ok) throw new Error("QUOTE_HISTORY_FAILED");
        if (active) setData(value);
      })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [agentId]);

  const requests = data?.requests ?? [];
  return (
    <section aria-labelledby="quote-history-title" className="rounded-xl border border-white/10 bg-white/[0.015]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
        <h2 className="flex items-center gap-2 text-base font-medium text-white" id="quote-history-title">
          <FileClock aria-hidden="true" className="size-4 text-zinc-500" />Quote history
        </h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{data?.counts?.buyerRequests ?? data?.counts?.requests ?? "—"} quotes requested</Badge>
          {data?.counts?.capabilityProbes !== undefined ? <Badge variant="outline">{data.counts.capabilityProbes} capacity checks</Badge> : null}
          <Badge className="border-emerald-400/30 text-emerald-300" variant="outline">{data?.counts?.buyerSucceeded ?? data?.counts?.succeeded ?? "—"} verified</Badge>
        </div>
      </div>
      {error ? <p className="px-4 py-5 text-sm text-zinc-500 sm:px-5">Quote history is temporarily unavailable.</p> : null}
      {!error && data === null ? <p className="flex items-center gap-2 px-4 py-5 text-sm text-zinc-500 sm:px-5"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />Loading quote history…</p> : null}
      {!error && data !== null && requests.length === 0 ? <p className="px-4 py-5 text-sm text-zinc-500 sm:px-5">No quote requests yet. A compatible seller can be asked for one above.</p> : null}
      {requests.length > 0 ? (
        <ol className="divide-y divide-white/10">
          {requests.map((request) => {
            const style = statusStyle(request.status);
            const Icon = style.icon;
            // The Worker returns attempts newest-first. Keeping the first one
            // here makes the visible executor/result match the current state.
            const latestAttempt = request.attempts[0];
            const created = new Date(request.createdAt).toISOString();
            return (
              <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5" key={request.id}>
                <Icon aria-hidden="true" className={`size-4 shrink-0 ${style.label === "Processing" ? "animate-spin" : ""} ${style.className.split(" ").at(-1) ?? "text-zinc-400"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={style.className} variant="outline">{style.label}</Badge>
                    <span className="text-xs text-zinc-500">{request.kind === "capability_probe" ? "Capacity check" : "Buyer quote"}</span>
                    <span className="text-xs uppercase tracking-wide text-zinc-600">{request.transport}</span>
                    <time className="inline-flex items-center gap-1 text-xs text-zinc-500" dateTime={created} title={created}>
                      <Clock3 aria-hidden="true" className="size-3" />{relativeAge(created)}
                    </time>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-600">
                    {request.requestHash ? (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <code className="truncate" title={request.requestHash}>Request {shortHash(request.requestHash)}</code>
                        <CopyReference label="request hash" value={request.requestHash} />
                      </span>
                    ) : null}
                    {request.endpoint && safeExternalUrl(request.endpoint) ? (
                      <a
                        className="inline-flex max-w-full min-w-0 items-center gap-1 truncate transition-colors hover:text-zinc-300"
                        href={safeExternalUrl(request.endpoint)!}
                        rel="noreferrer"
                        target="_blank"
                        title={request.endpoint}
                      >
                        <span className="truncate">{request.endpoint}</span><ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                      </a>
                    ) : null}
                    {request.provider ? (
                      <span className="inline-flex items-center gap-1">
                        <a
                          className="font-mono transition-colors hover:text-zinc-300"
                          href={providerUrl(request.provider) ?? undefined}
                          rel={providerUrl(request.provider) ? "noreferrer" : undefined}
                          target={providerUrl(request.provider) ? "_blank" : undefined}
                          title={request.provider}
                        >
                          Provider {shortHash(request.provider)}
                        </a>
                        <CopyReference label="provider address" value={request.provider} />
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="text-right text-xs text-zinc-600">
                  {latestAttempt ? (
                    <>
                      <span className="block uppercase tracking-wide">{latestAttempt.outcome === "fallback" ? "Worker fallback" : latestAttempt.executor}</span>
                      <span className="block">{latestAttempt.durationMs ?? "—"} ms{latestAttempt.httpStatus !== null ? ` · HTTP ${latestAttempt.httpStatus}` : ""}{latestAttempt.errorCode ? ` · ${latestAttempt.errorCode}` : ""}</span>
                    </>
                  ) : "—"}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
