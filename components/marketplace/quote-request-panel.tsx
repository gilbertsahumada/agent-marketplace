"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, RadioTower, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SellerParameters, initialSellerParameters } from "./seller-parameters";
import { buildContractRequest, normalizeNegotiationContract, type NegotiationContract } from "@/src/shared/negotiation-input";
import { cn } from "@/lib/utils";
import { markCatalogForRefresh } from "./catalog-return-refresh";
import { Erc8183MarketplaceHire, type MainnetQuoteResponse } from "@/components/spikes/erc8183-browser-spike";

type Phase = "idle" | "registering" | "connecting" | "negotiating" | "verifying" | "fallback" | "succeeded" | "failed";


const phaseCopy: Record<Phase, string> = {
  idle: "Ready to request",
  registering: "Registering request",
  connecting: "Connecting to seller",
  negotiating: "Negotiating terms",
  verifying: "Verifying signed quote",
  fallback: "Browser blocked · using Worker",
  succeeded: "Quote verified",
  failed: "Quote request failed",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasQuoteToolSchema(tool: Record<string, unknown>): boolean {
  const schema = asRecord(tool.inputSchema);
  const properties = asRecord(schema?.properties);
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((field): field is string => typeof field === "string")
    : [];
  return schema !== null
    && (schema.type === undefined || schema.type === "object")
    && properties !== null
    && ["task_description", "terms"].every((field) => field in properties)
    && ["task_description", "terms"].every((field) => required.includes(field));
}

function mcpEnvelope(result: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!result) return null;
  const structured = asRecord(result.structuredContent);
  if (structured) return structured;
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content.map(asRecord)) {
    const json = asRecord(item?.json);
    if (item?.type === "json" && json) return json;
    if (item?.type === "text" && typeof item.text === "string") {
      try {
        const parsed = asRecord(JSON.parse(item.text) as unknown);
        if (parsed) return parsed;
      } catch { /* continue to the stable invalid-response path */ }
    }
  }
  return null;
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return JSON.parse(text) as unknown; } catch {
    // MCP servers may return a JSON-RPC message as an SSE `data` event. Keep
    // the browser path protocol-compatible with the Worker adapter instead of
    // treating a valid response as a network failure.
    const event = text.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .at(-1)
      ?.slice(5)
      .trim();
    if (!event || event === "[DONE]") return null;
    try { return JSON.parse(event) as unknown; } catch { return null; }
  }
}

/** Keep a seller from holding the browser indefinitely. Network/CORS failures
 * are deliberately surfaced to the same Worker fallback as a timeout. */
function browserFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const signal = typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(10_000)
    : init.signal;
  return fetch(input, { ...init, ...(signal ? { signal } : {}) });
}

async function browserQuote(target: string, transport: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (transport === "a2a") {
    const base = new URL(target);
    const cardUrl = new URL(base);
    const cardSuffix = "/.well-known/agent-card.json";
    if (!cardUrl.pathname.endsWith(cardSuffix)) {
      cardUrl.pathname = `${cardUrl.pathname.replace(/\/+$/, "")}${cardSuffix}`;
    }
    const cardResponse = await browserFetch(cardUrl, { headers: { accept: "application/json" }, redirect: "manual" });
    if (!cardResponse.ok) throw new Error("A2A_CARD_FAILED");
    const card = asRecord(await parse(cardResponse));
    const messageUrl = typeof card?.url === "string" ? new URL(card.url) : null;
    if (!messageUrl
      || messageUrl.origin !== base.origin
      || messageUrl.username !== ""
      || messageUrl.password !== ""
      || messageUrl.search !== ""
      || messageUrl.hash !== "") throw new Error("A2A_CARD_INVALID");
    const skills = Array.isArray(card?.skills) ? card.skills : [];
    const skill = skills.map(asRecord).find((entry) => entry?.id === "negotiate-erc8183-job" || entry?.id === "negotiate")?.id;
    if (!skill) throw new Error("A2A_QUOTE_UNSUPPORTED");
    const id = crypto.randomUUID();
    const response = await browserFetch(messageUrl, {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "message/send", params: {
        message: { kind: "message", role: "user", messageId: crypto.randomUUID(), parts: [{ kind: "data", data: { skill, ...request } }] },
      } }),
      redirect: "manual",
    });
    const value = asRecord(await parse(response));
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    if (value?.jsonrpc !== "2.0" || value.id !== id || value.error !== undefined) throw new Error("A2A_QUOTE_INVALID");
    const result = asRecord(value?.result);
    const parts = Array.isArray(result?.parts) ? result.parts : [];
    const part = parts.map(asRecord).find((entry) => entry?.kind === "data" && asRecord(entry.data));
    const envelope = asRecord(part?.data);
    if (!response.ok || !envelope) throw new Error("A2A_QUOTE_INVALID");
    return envelope;
  }
  if (transport === "mcp") {
    const initializeId = crypto.randomUUID();
    const init = await browserFetch(target, {
      method: "POST",
      headers: { ...headers, accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: initializeId, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "trust8004-marketplace", version: "1.0" } } }),
      redirect: "manual",
    });
    const initValue = asRecord(await parse(init));
    if (!init.ok || !initValue || initValue.jsonrpc !== "2.0" || initValue.id !== initializeId || initValue.error !== undefined) throw new Error("MCP_INITIALIZE_FAILED");
    const session = init.headers.get("mcp-session-id");
    const toolsId = crypto.randomUUID();
    const toolResponse = await browserFetch(target, {
      method: "POST",
      headers: { ...headers, accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: toolsId, method: "tools/list", params: {} }),
      redirect: "manual",
    });
    const listed = asRecord(await parse(toolResponse));
    if (!toolResponse.ok || !listed || listed.jsonrpc !== "2.0" || listed.id !== toolsId || listed.error !== undefined) throw new Error("MCP_TOOLS_FAILED");
    const tools = asRecord(listed?.result)?.tools;
    const tool = Array.isArray(tools) ? tools.map(asRecord).find((entry) => entry?.name === "negotiate_erc8183_job" || entry?.name === "request_quote") : null;
    if (!tool || !initValue || !hasQuoteToolSchema(tool)) throw new Error("MCP_QUOTE_UNSUPPORTED");
    const callId = crypto.randomUUID();
    const called = await browserFetch(target, {
      method: "POST",
      headers: { ...headers, accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: callId, method: "tools/call", params: { name: tool.name, arguments: { task_description: request.task_description, terms: request.terms } } }),
      redirect: "manual",
    });
    const value = asRecord(await parse(called));
    if (!value || value.jsonrpc !== "2.0" || value.id !== callId || value.error !== undefined) throw new Error("MCP_QUOTE_INVALID");
    const result = asRecord(value?.result);
    const envelope = mcpEnvelope(result);
    if (!called.ok || !envelope) throw new Error("MCP_QUOTE_INVALID");
    return envelope;
  }
  // The declared ERC-8183 HTTP URL may point at /health, /status, or
  // /negotiate. Resolve the shared base and run the same read-only handshake
  // as the Worker adapter before requesting a quote.
  const declared = new URL(target);
  const path = declared.pathname.replace(/\/+$/, "");
  const suffix = path.match(/\/(health|status|negotiate)$/)?.[1];
  const base = suffix ? path.slice(0, -(suffix.length + 1)) : path;
  const route = (name: string) => {
    const url = new URL(declared);
    url.pathname = `${base}/${name}`.replace(/\/{2,}/g, "/");
    return url;
  };
  const health = await browserFetch(route("health"), { headers: { accept: "application/json" }, redirect: "manual" });
  const healthValue = asRecord(await parse(health));
  if (!health.ok || !healthValue || healthValue.status !== "ok" || healthValue.service !== "ERC-8183 Agent") {
    throw new Error("ERC8183_HEALTH_INVALID");
  }
  const status = await browserFetch(route("status"), { headers: { accept: "application/json" }, redirect: "manual" });
  const statusValue = asRecord(await parse(status));
  if (!status.ok || !statusValue || statusValue.status !== "ok") throw new Error("ERC8183_STATUS_INVALID");
  const response = await browserFetch(route("negotiate"), { method: "POST", headers, body: JSON.stringify(request), redirect: "manual" });
  const value = asRecord(await parse(response));
  if (!response.ok || !value) throw new Error(`HTTP_${response.status}`);
  return value;
}

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (/^[A-Z][A-Z0-9_]{2,63}$/.test(message)) return message;
    if (message === "AbortError" || /timeout|timed out|failed to fetch|network request failed|load failed/i.test(message)) return message.match(/timeout|timed out/i) ? "BROWSER_TIMEOUT" : "BROWSER_NETWORK_ERROR";
    return message.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "BROWSER_REQUEST_FAILED";
  }
  return "BROWSER_REQUEST_FAILED";
}

function shouldUseWorkerFallback(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const code = errorCode(error);
  return code === "BROWSER_NETWORK_ERROR" || code === "BROWSER_TIMEOUT" || code === "TIMEOUT";
}

export function QuoteRequestPanel({ agentId, agentName, onSuccess }: { agentId: string; agentName?: string; onSuccess?: () => void }) {
  return <SellerQuoteSession key={agentId} agentId={agentId} {...(agentName ? { agentName } : {})} {...(onSuccess ? { onSuccess } : {})} />;
}

function SellerQuoteSession({ agentId, agentName, onSuccess }: { agentId: string; agentName?: string; onSuccess?: () => void }) {
  const [discovery, setDiscovery] = useState<{ contract: NegotiationContract; endpointKey: string; contractHash: string } | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setDiscovery(null); setDiscoveryError(null);
    void fetch(`/api/marketplace/agents/${agentId}/quotes/input`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const value = asRecord(await response.json());
        if (!response.ok || !value) throw new Error(String(value?.error ?? "NEGOTIATION_DISCOVERY_FAILED"));
        const contract = normalizeNegotiationContract(value.contract);
        if (typeof value.endpointKey !== "string" || typeof value.contractHash !== "string") throw new Error("NEGOTIATION_DISCOVERY_FAILED");
        if (controller.signal.aborted) return;
        setParameters(initialSellerParameters(contract.inputSchema));
        setDiscovery({ contract, endpointKey: value.endpointKey, contractHash: value.contractHash });
      }).catch(error => { if (!controller.signal.aborted) setDiscoveryError(error instanceof Error ? error.message : "NEGOTIATION_DISCOVERY_FAILED"); });
    return () => controller.abort();
  }, [agentId, reload]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [quote, setQuote] = useState<MainnetQuoteResponse | null>(null);
  const [quoteRequestId, setQuoteRequestId] = useState<number | null>(null);

  function verifiedQuote(value: unknown): MainnetQuoteResponse | null {
    const candidate = asRecord(value);
    if (!candidate || !candidate.envelope || typeof candidate.envelope !== "object" || Array.isArray(candidate.envelope)) return null;
    return candidate as unknown as MainnetQuoteResponse;
  }

  async function requestQuote() {
    if (!discovery) return;
    try { buildContractRequest(discovery.contract, parameters); }
    catch { setShowErrors(true); setMessage("Complete the seller's required parameters."); return; }
    setShowErrors(false);
    setQuote(null); setQuoteRequestId(null); setMessage(null); setPhase("registering");
    try {
      const start = await fetch(`/api/marketplace/agents/${agentId}/quotes`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 2, parameters, endpointKey: discovery.endpointKey, contractHash: discovery.contractHash }),
      });
      const registered = asRecord(await parse(start));
      if (!start.ok || !registered) throw new Error(typeof registered?.error === "string" ? registered.error : "QUOTE_REGISTRATION_FAILED");
      const attemptId = typeof registered.attemptId === "string" ? registered.attemptId : null;
      const target = typeof registered.target === "string" ? registered.target : null;
      const transport = typeof registered.transport === "string" ? registered.transport : null;
      const requestBody = asRecord(registered.request);
      if (!attemptId || !target || !transport || !requestBody) throw new Error("QUOTE_REQUEST_INVALID");
      setPhase("connecting");
      let envelope: Record<string, unknown> | null = null;
      try {
        setPhase("negotiating");
        envelope = await browserQuote(target, transport, requestBody);
      } catch (error) {
        if (!shouldUseWorkerFallback(error)) {
          const code = errorCode(error);
          // Persist a seller rejection/invalid protocol result against the
          // already-registered attempt. This avoids repeating a known failure
          // through the Worker and keeps the public history honest.
          await fetch(`/api/marketplace/agents/${agentId}/quotes/${attemptId}/result`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ schemaVersion: 1, errorCode: code }),
          }).catch(() => undefined);
          throw new Error(code);
        }
        setPhase("fallback");
        const fallback = await fetch(`/api/marketplace/agents/${agentId}/quotes/${attemptId}/fallback`, {
          method: "POST", headers: {
            "content-type": "application/json",
            "x-marketplace-browser-error": errorCode(error),
          },
          body: JSON.stringify(requestBody),
        });
        const fallbackValue = asRecord(await parse(fallback));
        if (!fallback.ok || !fallbackValue) throw new Error(typeof fallbackValue?.code === "string" ? fallbackValue.code : "SELLER_UNREACHABLE");
        const verified = verifiedQuote(fallbackValue.quote);
        const requestId = typeof fallbackValue.requestId === "number" ? fallbackValue.requestId : null;
        if (!verified || requestId === null) throw new Error("QUOTE_RESPONSE_INVALID");
        setPhase("succeeded"); setQuote(verified); setQuoteRequestId(requestId); setMessage("Verified by the marketplace Worker"); markCatalogForRefresh(); onSuccess?.(); return;
      }
      if (!envelope) throw new Error("QUOTE_EMPTY_RESPONSE");
      setPhase("verifying");
      const result = await fetch(`/api/marketplace/agents/${agentId}/quotes/${attemptId}/result`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope: { ...envelope, request: envelope.request ?? requestBody } }),
      });
      const resultValue = asRecord(await parse(result));
      if (!result.ok || !resultValue) throw new Error(typeof resultValue?.code === "string" ? resultValue.code : "QUOTE_REJECTED");
      const verified = verifiedQuote(resultValue.quote);
      const requestId = typeof resultValue.requestId === "number" ? resultValue.requestId : null;
      if (!verified || requestId === null) throw new Error("QUOTE_RESPONSE_INVALID");
      setPhase("succeeded"); setQuote(verified); setQuoteRequestId(requestId); setMessage("Verified and shared with the marketplace"); markCatalogForRefresh(); onSuccess?.();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setPhase("failed");
      setMessage(code === "quote_service_unavailable"
        ? "Quote service is temporarily unavailable. Try again later."
        : /EXPIRED/i.test(code) ? "Quote expired. Request again."
          : /RATE_LIMIT|rate_limit/i.test(code) ? "Too many attempts. Please try again later."
            : /SCHEMA_CHANGED/i.test(code) ? "Requirements changed. Reload the seller parameters."
            : /SERVER_ERROR|HTTP_5/i.test(code) ? "The seller responded but could not create a quote."
            : /HTTP_4|PARAMETERS_INVALID/i.test(code) ? "The seller rejected these parameters. Review your request."
            : /UNREACHABLE|TIMEOUT/i.test(code) ? "Could not reach the seller. Retry the connection check."
              : "Could not verify a quote. Please try again.");
    }
  }

  const busy = !["idle", "succeeded", "failed"].includes(phase);
  return (
    <section aria-labelledby="quote-request-title" className="rounded-xl border border-primary/20 bg-primary/[0.03] p-5" id="quote-request">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-white" id="quote-request-title">Request quote</h2>
        </div>
        <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", phase === "succeeded" ? "border-emerald-400/30 text-emerald-300" : phase === "failed" ? "border-red-400/30 text-red-300" : "border-white/10 text-zinc-400")}>
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : phase === "succeeded" ? <CheckCircle2 className="size-3.5" /> : phase === "failed" ? <CircleAlert className="size-3.5" /> : <Clock3 className="size-3.5" />}
          {phaseCopy[phase]}
        </span>
      </div>
      <div className="mt-4">
        {discovery ? <SellerParameters schema={discovery.contract.inputSchema} value={parameters} onChange={value => { setParameters(value); setQuote(null); setQuoteRequestId(null); setPhase("idle"); setMessage(null); }} disabled={busy} showErrors={showErrors} />
          : discoveryError ? <p role="status" className="text-sm text-muted-foreground">{/UNSUPPORTED|UNAVAILABLE|REQUIRED/i.test(discoveryError) ? "Compatible negotiation parameters are not published by this seller." : "Could not load the seller's requirements."}</p>
          : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />Loading seller parameters</p>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button className="cursor-pointer" disabled={busy || !discovery} onClick={requestQuote} type="button"><ShieldCheck className="size-4" />{phase === "succeeded" ? "Request again" : "Request quote"}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { setQuote(null); setQuoteRequestId(null); setPhase("idle"); setMessage(null); setShowErrors(false); setReload(value => value + 1); }} type="button">Reload parameters</Button>
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500"><RadioTower className="size-3.5" />No signature</span>
      </div>
      {message ? <p aria-live="polite" className={cn("mt-3 text-sm", phase === "failed" ? "text-red-300" : "text-emerald-300")}>{message}</p> : null}
      {quote ? <dl className="mt-4 grid gap-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-4 text-sm sm:grid-cols-3"><div><dt className="text-zinc-500">Status</dt><dd className="mt-1 text-emerald-300">Quote verified</dd></div><div><dt className="text-zinc-500">Price</dt><dd className="mt-1 break-all text-zinc-200">{quote.priceDisplay ?? quote.priceRaw ?? "Signed terms"} {quote.tokenSymbol ?? ""}</dd></div><div><dt className="text-zinc-500">Request hash</dt><dd className="mt-1 break-all font-mono text-xs text-zinc-300">{typeof quote.envelope.request_hash === "string" ? quote.envelope.request_hash : "Recorded"}</dd></div></dl> : null}
      {quote && quoteRequestId !== null ? (
        <div className="mt-5 border-t border-white/10 pt-5">
          <Erc8183MarketplaceHire
            {...(agentName ? { agentName } : {})}
            onQuoteExpired={() => { setQuote(null); setQuoteRequestId(null); setPhase("idle"); setMessage("Quote expired. Request another quote to continue."); }}
            quote={quote}
            quoteRequestId={quoteRequestId}
          />
        </div>
      ) : null}
    </section>
  );
}
