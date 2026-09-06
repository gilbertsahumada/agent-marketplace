"use client";

import { Fragment, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, Copy, ExternalLink, FileClock, LoaderCircle, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { subscribeMarketplaceEvidence } from "./catalog-return-refresh";
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
  pagination?: { page: number; total: number; hasMore: boolean };
  counts?: { requests: number; buyerRequests?: number; buyerVerified?: number; buyerSucceeded?: number; capabilityProbes?: number; importedObservations?: number; succeeded: number; rejected: number; failed: number; expired?: number };
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
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setResult("copied"); }
    catch { setResult("failed"); }
  };
  return (
    <span className="inline-flex items-center gap-1"><Button variant="ghost" size="icon-xs"
      aria-label={result === "copied" ? `${label} copied` : `Copy ${label}`}
      onClick={copy}
      title={`Copy ${label}`}
      type="button"
    >
      {result === "copied" ? <CheckCircle2 aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button><span role="status" className="text-xs">{result === "copied" ? "Copied" : result === "failed" ? "Could not copy" : ""}</span></span>
  );
}

function statusStyle(status: string, errorCode?: string | null): { label: string; className: string; icon: typeof CheckCircle2 } {
  if (errorCode === "QUOTE_ATTEMPT_INTERRUPTED") return { label: "Interrupted", className: "border-amber-400/30 text-amber-200", icon: CircleAlert };
  if (status === "succeeded") return { label: "Verified", className: "border-emerald-400/30 text-emerald-300", icon: CheckCircle2 };
  if (status === "rejected" || status === "failed") return { label: status === "rejected" ? "Rejected" : "Failed", className: "border-red-400/30 text-red-300", icon: CircleAlert };
  if (status === "expired") return { label: "Expired", className: "border-amber-400/30 text-amber-200", icon: Clock3 };
  if (status === "pending" || status === "running") return { label: "Processing", className: "border-cyan-400/30 text-cyan-200", icon: LoaderCircle };
  return { label: "Unknown", className: "text-muted-foreground", icon: CircleAlert };
}

export function QuoteHistory({ agentId }: { agentId: string }) {
  const [data, setData] = useState<QuoteHistoryResponse | null>(null);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [expandedRequest, setExpandedRequest] = useState<number | null>(null);
  useEffect(() => { setData(null); setExpandedRequest(null); }, [agentId, page]);
  const processing = data?.requests?.some(request => request.status === "pending" || request.status === "running") ?? false;
  useEffect(() => {
    if (!processing || error) return;
    const timer = setTimeout(() => setReload(value => value + 1), 5_000);
    return () => clearTimeout(timer);
  }, [processing, error, data]);
  useEffect(() => subscribeMarketplaceEvidence(agentId, () => { setPage(1); setReload(value => value + 1); }), [agentId]);

  useEffect(() => {
    let active = true;
    setError(false);
    // Test environments and older embedded shells may not expose fetch. Keep
    // the profile renderable in that case; the server-rendered state remains
    // authoritative and the history simply stays unavailable.
    const request = typeof fetch === "function"
      ? fetch(`/api/marketplace/agents/${agentId}/quotes?page=${page}`, { cache: "no-store" })
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
  }, [agentId, page, reload]);

  const requests = data?.requests ?? [];
  return (
    <section aria-labelledby="quote-history-title" className="rounded-xl border border-white/10 bg-white/[0.015]">
      <details className="group/history" open>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-4 hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <h2 className="flex items-center gap-2 text-base font-medium text-white" id="quote-history-title">
          <FileClock aria-hidden="true" className="size-4 text-zinc-500" />Quote history
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{data?.counts?.buyerRequests ?? data?.counts?.requests ?? "—"} quotes requested</Badge>
          {data?.counts?.capabilityProbes !== undefined ? <Badge variant="outline">{data.counts.capabilityProbes} capacity checks</Badge> : null}
          <Badge className="border-emerald-400/30 text-emerald-300" variant="outline">{data?.counts?.buyerVerified ?? data?.counts?.buyerSucceeded ?? data?.counts?.succeeded ?? "—"} verified historically</Badge>
          {data?.counts?.importedObservations ? <Badge variant="outline">{data.counts.importedObservations} imported observations</Badge> : null}
          <ChevronDown aria-hidden="true" className="ml-1 size-4 shrink-0 text-muted-foreground transition-transform group-open/history:rotate-180 motion-reduce:transition-none" />
        </div>
      </summary>
      <div className="border-t border-white/10">
      {error ? <div className="flex items-center justify-between gap-3 px-4 py-5 text-sm text-muted-foreground sm:px-5"><p>Quote history unavailable.</p><Button variant="outline" size="sm" type="button" onClick={() => setReload(value => value + 1)}><RotateCw aria-hidden="true" data-icon="inline-start" />Retry</Button></div> : null}
      {!error && data === null ? <p className="flex items-center gap-2 px-4 py-5 text-sm text-zinc-500 sm:px-5"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />Loading quote history…</p> : null}
      {!error && data !== null && requests.length === 0 ? <p className="px-4 py-5 text-sm text-zinc-500 sm:px-5">No quote requests yet. A compatible seller can be asked for one above.</p> : null}
      {requests.length > 0 ? (
        <Table containerLabel="Quote history table"><TableHeader><TableRow>{["Request", "Status", "Transport", "Date", "Details"].map(column => <TableHead className="px-5" scope="col" key={column}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>
          {requests.slice(0, 5).map((request) => {
            const style = statusStyle(request.status, request.errorCode);
            const Icon = style.icon;
            // The Worker returns attempts newest-first. Keeping the first one
            // here makes the visible executor/result match the current state.
            const latestAttempt = request.attempts[0];
            const created = new Date(request.createdAt).toISOString();
            const expanded = expandedRequest === request.id;
            return (
              <Fragment key={request.id}>
              <TableRow>
                <TableCell className="px-5 py-4"><span className="font-medium">#{request.id}</span><span className="block text-xs text-muted-foreground">{request.kind === "capability_probe" ? "Capacity check" : "Buyer quote"}</span></TableCell>
                <TableCell className="px-5"><Badge className={style.className} variant="outline"><Icon aria-hidden="true" className={style.label === "Processing" ? "animate-spin motion-reduce:animate-none" : ""} />{style.label}</Badge></TableCell>
                <TableCell className="px-5 uppercase text-xs text-muted-foreground">{request.transport.replace("erc8183_http", "HTTP")}</TableCell>
                <TableCell className="px-5">
                    <time className="inline-flex items-center gap-1 text-xs text-zinc-500" dateTime={created} title={created}>
                      <Clock3 aria-hidden="true" className="size-3" />{relativeAge(created)}
                    </time>
                </TableCell>
                <TableCell className="px-5"><Button variant="outline" size="sm" type="button"
                  aria-label={`${expanded ? "Hide" : "View"} details for quote ${request.id}`}
                  aria-expanded={expanded} aria-controls={`quote-details-${request.id}`}
                  onClick={() => setExpandedRequest(expanded ? null : request.id)}>
                  {expanded ? "Hide details" : "View details"}<ChevronDown aria-hidden="true" data-icon="inline-end" style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
                </Button></TableCell>
              </TableRow>
              {expanded ? <TableRow><TableCell colSpan={5} className="px-5 py-4 whitespace-normal">
                <div id={`quote-details-${request.id}`} role="region" aria-label={`Quote ${request.id} details`} className="flex flex-col gap-4">
                  <p className="text-sm">{request.errorCode === "QUOTE_SIGNATURE"
                    ? "The quote signature could not be verified. Hiring remains blocked."
                    : request.errorCode === "SELLER_TIMEOUT" ? "The seller did not respond in time. No quote was verified."
                      : request.status === "succeeded" ? "Quote verified. Funding requires a fresh quote for your request."
                        : request.errorCode === "QUOTE_ATTEMPT_INTERRUPTED" ? "This attempt was interrupted before verification finished."
                          : `Quote ${style.label.toLowerCase()}.`}</p>
                  <div className="grid min-w-0 gap-4 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
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
                        <span className="truncate">Seller endpoint · {new URL(request.endpoint).hostname}</span><ExternalLink aria-hidden="true" className="size-3 shrink-0" />
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
                          Provider {shortHash(request.provider)}{providerUrl(request.provider) ? <ExternalLink aria-hidden="true" className="ml-1 inline size-3" /> : null}
                        </a>
                        <CopyReference label="provider address" value={request.provider} />
                      </span>
                    ) : null}
                <span className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {latestAttempt ? (
                    <>
                      <span>{latestAttempt.executor === "browser" ? "Browser attempt" : "Marketplace attempt"}</span>
                      <span>{latestAttempt.durationMs ?? "—"} ms{latestAttempt.httpStatus !== null ? ` · HTTP ${latestAttempt.httpStatus}` : ""}</span>
                      {latestAttempt.errorCode ? <code className="break-all">{latestAttempt.errorCode}</code> : null}
                    </>
                  ) : "—"}
                </span>
                  </div>
                </div>
              </TableCell></TableRow> : null}
              </Fragment>
            );
          })}
        </TableBody></Table>
      ) : null}
      {data && ((data.pagination?.total ?? 0) > 5 || page > 1) ? <nav aria-label="Quotes pagination" className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
        <Button variant="outline" size="sm" type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft aria-hidden="true" data-icon="inline-start" />Previous</Button>
        <span className="text-muted-foreground">Page {page} of {Math.max(1, Math.ceil((data.pagination?.total ?? 0) / 5))}</span>
        <Button variant="outline" size="sm" type="button" disabled={!data.pagination?.hasMore} onClick={() => setPage(value => value + 1)}>Next<ChevronRight aria-hidden="true" data-icon="inline-end" /></Button>
      </nav> : null}
      </div>
      </details>
    </section>
  );
}
