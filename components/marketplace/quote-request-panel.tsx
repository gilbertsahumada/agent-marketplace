"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, RadioTower, ShieldCheck, FileInput, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SellerParameters, initialSellerParameters } from "./seller-parameters";
import { sellerParameterExample } from "./seller-parameter-examples";
import { QuoteDetails } from "./quote-details";
import { compatibilityMessage } from "@/src/shared/compatibility-message";
import { buildContractRequest, normalizeNegotiationContract, type NegotiationContract } from "@/src/shared/negotiation-input";
import { cn } from "@/lib/utils";
import { markCatalogForRefresh } from "./catalog-return-refresh";
import { Erc8183MarketplaceHire, Erc8183SavedHire, type MainnetQuoteResponse } from "@/components/spikes/erc8183-browser-spike";

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
    const protocolVersion = asRecord(initValue.result)?.protocolVersion;
    if (protocolVersion !== "2025-06-18") throw new Error("MCP_PROTOCOL_VERSION_UNSUPPORTED");
    const session = init.headers.get("mcp-session-id");
    const sessionHeaders = { ...headers, accept: "application/json, text/event-stream", "mcp-protocol-version": protocolVersion, ...(session ? { "mcp-session-id": session } : {}) };
    const initialized = await browserFetch(target, {
      method: "POST", headers: sessionHeaders, redirect: "manual",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    if (!initialized.ok) throw new Error("MCP_INITIALIZE_FAILED");
    const toolsId = crypto.randomUUID();
    const toolResponse = await browserFetch(target, {
      method: "POST",
      headers: sessionHeaders,
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
      headers: sessionHeaders,
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

export function QuoteRequestPanel({ agentId, agentName, onSuccess, checkCompatibilityFirst = false }: { agentId: string; agentName?: string; onSuccess?: () => void; checkCompatibilityFirst?: boolean }) {
  return <SellerQuoteSession key={agentId} agentId={agentId} checkCompatibilityFirst={checkCompatibilityFirst} {...(agentName ? { agentName } : {})} {...(onSuccess ? { onSuccess } : {})} />;
}

function SellerQuoteSession({ agentId, agentName, onSuccess, checkCompatibilityFirst }: { agentId: string; agentName?: string; onSuccess?: () => void; checkCompatibilityFirst: boolean }) {
  const router = useRouter();
  const [inspectionRequested, setInspectionRequested] = useState(!checkCompatibilityFirst);
  const [discovery, setDiscovery] = useState<{ contract: NegotiationContract; endpointKey: string; contractHash: string } | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => {
    if (!inspectionRequested) return;
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
        markCatalogForRefresh(agentId);
        router.refresh();
      }).catch(error => {
        if (controller.signal.aborted) return;
        setDiscoveryError(error instanceof Error ? error.message : "NEGOTIATION_DISCOVERY_FAILED");
        markCatalogForRefresh(agentId);
        router.refresh();
      });
    return () => controller.abort();
  }, [agentId, reload, inspectionRequested]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [quote, setQuote] = useState<MainnetQuoteResponse | null>(null);
  const [quoteRequestId, setQuoteRequestId] = useState<number | null>(null);
  const [recoveryActive, setRecoveryActive] = useState(false);
  const busy = !["idle", "succeeded", "failed"].includes(phase);
  const discovering = inspectionRequested && !discovery && !discoveryError;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy && !discovering) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy, discovering]);

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
        setPhase("succeeded"); setQuote(verified); setQuoteRequestId(requestId); setMessage(null); markCatalogForRefresh(agentId); router.refresh(); onSuccess?.(); return;
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
      setPhase("succeeded"); setQuote(verified); setQuoteRequestId(requestId); setMessage(null); markCatalogForRefresh(agentId); router.refresh(); onSuccess?.();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setPhase("failed");
      markCatalogForRefresh(agentId);
      router.refresh();
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

  if (!inspectionRequested) return <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="quote-request-title">
    <h2 id="quote-request-title" className="text-lg font-medium">Check hiring compatibility</h2>
    <p className="mt-2 text-sm text-muted-foreground">Check the seller's connection and required inputs. No wallet needed.</p>
    <Button className="mt-4" onClick={() => setInspectionRequested(true)} type="button"><ShieldCheck aria-hidden="true" data-icon="inline-start" />Check compatibility</Button>
  </section>;
  const example = discovery ? sellerParameterExample(discovery.contract) : null;
  return (
    <div className="flex flex-col gap-5">
    <section aria-labelledby="quote-request-title" className="rounded-xl border border-border bg-card p-5" id="quote-request">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-white" id="quote-request-title">{discovery ? "Request quote" : "Quote requirements"}</h2>
        </div>
        <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", phase === "succeeded" ? "border-emerald-400/30 text-emerald-300" : phase === "failed" ? "border-red-400/30 text-red-300" : "border-white/10 text-zinc-400")}>
          {discovering ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" /> : busy ? null : phase === "succeeded" ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : phase === "failed" ? <CircleAlert aria-hidden="true" className="size-3.5" /> : <Clock3 aria-hidden="true" className="size-3.5" />}
          {!discovery ? discoveryError ? discoveryError === "quote_service_unavailable" ? "Temporarily unavailable" : compatibilityMessage(discoveryError).title : "Checking compatibility" : phaseCopy[phase]}
          {busy || discovering ? <span aria-hidden="true">· {elapsed}s</span> : null}
        </span>
      </div>
      <div className="mt-4">
        {example ? <Button className="mb-4" variant="outline" size="sm" disabled={busy || discovering} type="button" onClick={() => {
          setParameters(example); setQuote(null); setQuoteRequestId(null); setPhase("idle"); setShowErrors(false);
          setMessage("Example loaded. Review the values before requesting a quote.");
        }}><FileInput aria-hidden="true" data-icon="inline-start" />Load example</Button> : null}
        {discovery ? <SellerParameters schema={discovery.contract.inputSchema} value={parameters} example={example} onChange={value => { setParameters(value); setQuote(null); setQuoteRequestId(null); setPhase("idle"); setMessage(null); }} disabled={busy} showErrors={showErrors} />
          : discoveryError ? <p role="status" className="text-sm text-muted-foreground">{discoveryError === "quote_service_unavailable" ? "Cannot connect to the marketplace quote service. Requirements could not be checked." : compatibilityMessage(discoveryError).detail}</p>
          : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {discovery ? <Button className="cursor-pointer" disabled={busy} aria-busy={busy} onClick={requestQuote} type="button">{busy ? <LoaderCircle aria-hidden="true" data-icon="inline-start" className="motion-safe:animate-spin" /> : <ShieldCheck aria-hidden="true" data-icon="inline-start" />}{busy ? phaseCopy[phase] : phase === "succeeded" ? "Request again" : "Request quote"}</Button> : null}
        {!discovering ? <Button variant="outline" size="sm" disabled={busy} onClick={() => { setQuote(null); setQuoteRequestId(null); setPhase("idle"); setMessage(null); setShowErrors(false); setReload(value => value + 1); }} type="button">Reload parameters</Button> : null}
        {discoveryError && <Button asChild variant="outline" size="sm"><Link href="/docs/sellers#requirements">Seller integration guide</Link></Button>}
        {discovery ? <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500"><RadioTower className="size-3.5" />No signature</span> : null}
      </div>
      {message ? <p aria-live="polite" className={cn("mt-3 text-sm", phase === "failed" ? "text-red-300" : "text-emerald-300")}>{message}</p> : null}
      {quote && typeof quote.envelope.request_hash === "string" ? <QuoteDetails key={quote.envelope.request_hash} requestHash={quote.envelope.request_hash} /> : null}
    </section>
    <section aria-labelledby="hire-checkout-title" className="rounded-xl border border-border bg-card p-5 transition-colors duration-300 motion-reduce:transition-none">
      <h2 id="hire-checkout-title" className="mb-4 flex items-center gap-2 text-lg font-medium"><ShieldCheck aria-hidden="true" className="size-5" />Hire agent</h2>
      {quote && quoteRequestId !== null ? (
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
          <Erc8183MarketplaceHire
            key={quoteRequestId}
            {...(agentName ? { agentName } : {})}
            onQuoteExpired={() => { setQuote(null); setQuoteRequestId(null); setPhase("idle"); setMessage("Quote expired. Request another quote to continue."); }}
            quote={quote}
            quoteRequestId={quoteRequestId}
          />
        </div>
      ) : <div aria-label={recoveryActive ? "Previous hire" : "Hiring locked until quote verified"}>
        <Erc8183SavedHire agentId={agentId} onActiveChange={setRecoveryActive} />
        {!recoveryActive ? <>
        <p className="mb-4 text-sm text-muted-foreground">Request a verified quote to unlock hiring.</p>
        <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {["Review", "Authorize & fund", "Track"].map((label, index) => <li key={label} className="relative flex items-center gap-3 px-4 py-4 text-muted-foreground">
            {index < 2 ? <span aria-hidden="true" className="absolute bottom-0 left-8 top-12 w-px bg-border" /> : null}
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full border border-border">{index + 2}</span>
            <span className="text-sm">{label}</span><LockKeyhole aria-label="Locked" className="ml-auto size-4" />
          </li>)}
        </ol>
        </> : null}
      </div>}
    </section>
    </div>
  );
}
