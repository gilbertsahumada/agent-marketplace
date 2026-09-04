"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, LoaderCircle, ShieldCheck, WifiOff } from "lucide-react";
import {
  validateEndpointInBrowser,
  type BrowserValidationResult,
  type BrowserValidationTarget,
} from "@/src/verification/browser-endpoint-validation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { markCatalogForRefresh } from "./catalog-return-refresh";

type PersistenceStatus = "recorded" | "failed" | "not_configured" | "pending";
/**
 * A catalog target can be checked by the marketplace Worker even when the
 * browser policy deliberately excludes it (for example an unsafe or external
 * declaration). Keep that distinction explicit so the UI never offers a
 * browser action for a target that the browser/API contract would reject.
 */
export type ValidationTarget = BrowserValidationTarget & {
  endpointKey?: string;
  browserValidatable?: boolean;
};
type InfrastructureState = "pending" | "deferred" | "completed" | "failed";
type BrowserPhase = "checking" | "saving";
const POLL_DELAYS_MS = [1_000, 2_000, 4_000, 5_000, 5_000, 5_000] as const;

interface InfrastructureObservation {
  protocol: string;
  outcome: string;
  observedAt: number;
  expiresAt: number | null;
  httpStatus: number | null;
  durationMs: number;
  source: string;
}

interface InfrastructureStatus {
  state: InfrastructureState;
  message: string;
  requestId?: string;
  attemptCount?: number;
  result?: InfrastructureObservation | null;
}

export interface ValidationObservationSummary {
  endpointKey: string;
  protocol: string;
  source: string;
  outcome: string;
  observedAt: number;
  expiresAt: number | null;
  httpStatus: number | null;
  durationMs: number;
}

interface ResultState {
  result: BrowserValidationResult;
  persistence: PersistenceStatus;
}

function targetKey(target: BrowserValidationTarget): string {
  return `${target.protocol}\u0000${target.endpoint}`;
}

function targetLabel(target: BrowserValidationTarget): string {
  try {
    const url = new URL(target.endpoint);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "Invalid declared URL";
  }
}

function protocolCheckDescription(protocol: BrowserValidationTarget["protocol"]): string {
  if (protocol === "mcp") return "the MCP initialize → initialized → tools/list handshake";
  if (protocol === "a2a") return "the A2A Agent Card GET";
  return "the ERC-8183 HTTP health GET";
}

function protocolLabel(protocol: string): string {
  if (protocol === "mcp") return "MCP";
  if (protocol === "a2a") return "A2A";
  if (protocol === "erc8183_http") return "ERC-8183 HTTP";
  return protocol.toUpperCase();
}

function outcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    protocol_valid: "Endpoint response verified",
    quote_verified: "Quote verified",
    quote_rejected: "Quote rejected",
    quote_invalid: "Quote invalid",
    cors_blocked: "Browser blocked by CORS",
    unreachable: "Endpoint unreachable",
    unsafe_url: "Unsafe endpoint URL",
    http_error: "HTTP error",
    timeout: "Request timed out",
    network_error: "Network error",
    invalid_response: "Invalid endpoint response",
    error: "Check failed",
  };
  return labels[outcome] ?? outcome.replaceAll("_", " ");
}

function observedAtLabel(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toISOString().replace("T", " ").replace(".000Z", "Z");
}

function resultClass(outcome: BrowserValidationResult["outcome"]): string {
  if (outcome === "protocol_valid") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (outcome === "cors_blocked") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  return "border-red-400/30 bg-red-400/10 text-red-200";
}

function infrastructureCompletionMessage(
  target: ValidationTarget,
  status: { attemptCount?: number; result?: InfrastructureObservation | null },
): string {
  const result = status.result;
  if (!result) return "Marketplace check completed and shared evidence was updated. Refreshing this workspace to recalculate the hiring state.";
  const outcome = outcomeLabel(result.outcome).toLocaleLowerCase();
  const transport = protocolLabel(result.protocol || target.protocol);
  const http = result.httpStatus === null ? "" : ` · HTTP ${result.httpStatus}`;
  const duration = result.durationMs > 0 ? ` · ${result.durationMs} ms` : "";
  const attempts = typeof status.attemptCount === "number" ? ` · ${status.attemptCount} attempt${status.attemptCount === 1 ? "" : "s"}` : "";
  return `Marketplace check completed and shared evidence was updated: ${transport} ${outcome}${http}${duration}${attempts}. Refreshing this workspace to recalculate the hiring state.`;
}

function sharedObservationLine(
  target: ValidationTarget,
  observation: ValidationObservationSummary | undefined,
): ReactNode {
  if (!observation) return <p className="mt-2 text-xs text-zinc-500">Declared by the agent · no shared marketplace check yet</p>;
  const expired = observation.expiresAt !== null && observation.expiresAt <= Date.now();
  const failed = !["protocol_valid", "quote_verified"].includes(observation.outcome);
  const tone = failed ? "text-red-300" : expired ? "text-amber-300" : "text-emerald-300";
  const outcome = outcomeLabel(observation.outcome);
  const source = observation.source === "buyer_refresh"
    ? "buyer refresh"
    : observation.source === "migration"
      ? "release snapshot"
      : "scheduled Worker";
  return (
    <p className={`mt-2 text-xs ${tone}`} data-observation-source={observation.source}>
      Shared: {outcome} · {source} · {observedAtLabel(observation.observedAt)}
      {observation.httpStatus === null ? "" : ` · HTTP ${observation.httpStatus}`}
      {observation.durationMs > 0 ? ` · ${observation.durationMs} ms` : ""}
      {expired ? " · stale" : ""}
      {target.protocol !== observation.protocol ? ` · declared ${target.protocol.toUpperCase()}` : ""}
    </p>
  );
}

export function AgentValidationActions({ agentId, targets, initialObservations = [] }: {
  agentId: string;
  targets: ValidationTarget[];
  initialObservations?: ValidationObservationSummary[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [browserPhase, setBrowserPhase] = useState<Record<string, BrowserPhase>>({});
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [infrastructure, setInfrastructure] = useState<Record<string, InfrastructureStatus>>({});
  const [browserErrors, setBrowserErrors] = useState<Record<string, string>>({});

  const latestObservations = new Map<string, ValidationObservationSummary>();
  for (const observation of initialObservations) {
    const key = `${observation.protocol}\u0000${observation.endpointKey}`;
    const current = latestObservations.get(key);
    if (!current || observation.observedAt > current.observedAt) latestObservations.set(key, observation);
  }

  function existingObservation(target: ValidationTarget): ValidationObservationSummary | undefined {
    return latestObservations.get(`${target.protocol}\u0000${target.endpointKey ?? ""}`);
  }

  async function validate(target: BrowserValidationTarget) {
    const key = targetKey(target);
    setPending(key);
    setBrowserPhase((current) => ({ ...current, [key]: "checking" }));
    setBrowserErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      const result = await validateEndpointInBrowser(target);
      setResults((current) => ({ ...current, [key]: { result, persistence: "pending" } }));
      setBrowserPhase((current) => ({ ...current, [key]: "saving" }));
      let persistence: PersistenceStatus = "failed";
      try {
        const response = await fetch(`/api/marketplace/agents/${agentId}/observations/browser`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(result),
        });
        const payload = await response.json() as { persistence?: PersistenceStatus };
        persistence = response.ok ? payload.persistence ?? "failed" : "failed";
      } catch {
        persistence = "failed";
      }
      setResults((current) => ({ ...current, [key]: { result, persistence } }));
      // The POST writes a browser_reported observation that is shared with
      // other viewers, but it is intentionally not used to promote platform
      // reachability or hireability. Refresh only after the Worker accepted
      // the write so the server-rendered observation state can catch up.
      if (persistence === "recorded") {
        markCatalogForRefresh();
        router.refresh();
      }
    } catch {
      setBrowserErrors((current) => ({
        ...current,
        [key]: "The browser check could not start. No browser result was recorded; shared marketplace evidence was not changed.",
      }));
    } finally {
      setPending(null);
      setBrowserPhase((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function validateThroughMarketplace(target: ValidationTarget) {
    if (!target.endpointKey) return;
    const key = targetKey(target);
    setInfrastructure((current) => ({
      ...current,
      [key]: { state: "pending", message: `Step 1/3 · queued for ${protocolCheckDescription(target.protocol)} through the marketplace.` },
    }));
    try {
      const response = await fetch("/api/marketplace/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, endpointKey: target.endpointKey, validationKind: "protocol" }),
      });
      const payload = await response.json() as {
        status?: string;
        reused?: boolean;
        requestId?: string | null;
        pollAfterMs?: number;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || "Marketplace validation could not be queued.");
      if (payload.status === "completed") {
        setInfrastructure((current) => ({
          ...current,
          [key]: {
            state: "completed",
            message: payload.reused
              ? `A fresh shared ${protocolLabel(target.protocol)} observation already exists. Refreshing this workspace to recalculate the hiring state.`
              : `Shared evidence was updated for ${target.protocol.toUpperCase()}. Refreshing this workspace to recalculate the hiring state.`,
          },
        }));
        markCatalogForRefresh();
        router.refresh();
        return;
      }
      const requestId = payload.requestId;
      if (!requestId) throw new Error("Marketplace validation returned no request identifier.");

      setInfrastructure((current) => ({
        ...current,
        [key]: {
          state: "pending",
          requestId,
          message: `Step 2/3 · the Worker is running ${protocolCheckDescription(target.protocol)} against ${targetLabel(target)}. No wallet signature is requested.`,
        },
      }));

      for (let attempt = 0; attempt < POLL_DELAYS_MS.length; attempt += 1) {
        setInfrastructure((current) => ({
          ...current,
          [key]: {
            ...(current[key] ?? { state: "pending" as const }),
            state: "pending",
            requestId,
            message: `Step 3/3 · reading the ${protocolLabel(target.protocol)} result (poll ${attempt + 1}/${POLL_DELAYS_MS.length}). The endpoint is checked outside this browser.`,
          },
        }));
        const delayMs = attempt === 0 && typeof payload.pollAfterMs === "number"
          ? Math.max(0, Math.min(5_000, payload.pollAfterMs))
          : POLL_DELAYS_MS[attempt] ?? 5_000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        let statusResponse: Response;
        let statusPayload: {
          status?: string;
          hasResult?: boolean;
          attemptCount?: number;
          result?: InfrastructureObservation | null;
          errorCode?: string | null;
          error?: { message?: string };
        };
        try {
          statusResponse = await fetch(`/api/marketplace/validate/${encodeURIComponent(requestId)}`, {
            cache: "no-store",
          });
          statusPayload = await statusResponse.json();
        } catch {
          setInfrastructure((current) => ({
            ...current,
            [key]: {
              state: "deferred",
              requestId,
              message: "The status check was interrupted. The marketplace validation may still be running; continue checking shortly.",
            },
          }));
          return;
        }
        if (!statusResponse.ok) {
          setInfrastructure((current) => ({
            ...current,
            [key]: {
              state: "deferred",
              requestId,
              message: statusPayload.error?.message
                ? `${statusPayload.error.message} The marketplace validation may still be running.`
                : "The status check was interrupted. The marketplace validation may still be running; continue checking shortly.",
            },
          }));
          return;
        }
        if (statusPayload.status === "completed") {
          if (statusPayload.hasResult !== true || !statusPayload.result) {
            throw new Error("Marketplace validation completed but did not produce shared evidence.");
          }
          setInfrastructure((current) => ({
            ...current,
            [key]: {
              state: "completed",
              requestId,
              ...(typeof statusPayload.attemptCount === "number" ? { attemptCount: statusPayload.attemptCount } : {}),
              result: statusPayload.result ?? null,
              message: infrastructureCompletionMessage(target, statusPayload),
            },
          }));
          markCatalogForRefresh();
          router.refresh();
          return;
        }
        if (statusPayload.status === "failed" || statusPayload.status === "cancelled") {
          throw new Error(statusPayload.errorCode
            ? `Marketplace validation stopped (${statusPayload.errorCode}).`
            : "Marketplace validation stopped before producing evidence.");
        }
        setInfrastructure((current) => ({
          ...current,
          [key]: {
            state: "pending",
            requestId,
            ...(typeof statusPayload.attemptCount === "number" ? { attemptCount: statusPayload.attemptCount } : {}),
            message: `Step 3/3 · the Worker is still running ${protocolCheckDescription(target.protocol)} (poll ${attempt + 1}/${POLL_DELAYS_MS.length}).`,
          },
        }));
      }
      setInfrastructure((current) => ({
        ...current,
        [key]: {
          state: "deferred",
          requestId,
          message: "Marketplace validation is still running. Continue checking shortly to read the shared result.",
        },
      }));
    } catch (error) {
      setInfrastructure((current) => ({
        ...current,
        [key]: {
          state: "failed",
          message: error instanceof Error && error.message
            ? error.message
            : "Marketplace validation could not be completed.",
        },
      }));
    }
  }

  return (
    <Card className="marketplace-surface mt-5 scroll-mt-6" id="validation">
      <CardHeader>
        <CardTitle>Connection check</CardTitle>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          Browser checks are local. Marketplace checks update the shared status.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {targets.length === 0 ? (
          <p className="text-sm text-zinc-500">This registration has no endpoint the browser can validate.</p>
        ) : (
          <ul className="grid gap-3">
            {targets.map((target) => {
              const key = targetKey(target);
              const state = results[key];
              const infrastructureState = infrastructure[key];
              return (
                <li aria-busy={pending === key || infrastructureState?.state === "pending"} className="rounded-xl border border-white/10 bg-white/[0.02] p-4" key={key}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{target.protocol.replace("_", " ").toUpperCase()}</Badge>
                        <span className="truncate text-sm text-zinc-300">{targetLabel(target)}</span>
                      </div>
                      {sharedObservationLine(target, existingObservation(target))}
                    </div>
                    {pending === key ? (
                      <p aria-live="polite" className="text-xs text-cyan-200">
                        {browserPhase[key] === "saving"
                          ? "Step 2/2 · Saving this browser result separately. Shared marketplace evidence is unchanged."
                          : `Step 1/2 · Running ${protocolCheckDescription(target.protocol)} from this browser. This result is reported separately from marketplace evidence.`}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {target.browserValidatable !== false ? (
                        <Button
                          className="cursor-pointer"
                          disabled={pending !== null}
                          onClick={() => void validate(target)}
                          type="button"
                          variant="outline"
                        >
                          {pending === key ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <ShieldCheck aria-hidden="true" />}
                          Validate from browser
                        </Button>
                      ) : null}
                      {target.endpointKey && (
                        <Button
                          className="cursor-pointer"
                          disabled={infrastructureState?.state === "pending"}
                          onClick={() => void validateThroughMarketplace(target)}
                          type="button"
                        >
                          {infrastructureState?.state === "pending"
                            ? <LoaderCircle aria-hidden="true" className="animate-spin" />
                            : <ShieldCheck aria-hidden="true" />}
                          Validate through marketplace
                        </Button>
                      )}
                    </div>
                  </div>
                  {state && (
                    <div aria-live="polite" className={`mt-3 rounded-lg border p-3 text-sm ${resultClass(state.result.outcome)}`}>
                      <div className="flex items-center gap-2 font-medium">
                        {state.result.outcome === "protocol_valid"
                          ? <CheckCircle2 aria-hidden="true" className="size-4" />
                          : state.result.outcome === "cors_blocked"
                            ? <WifiOff aria-hidden="true" className="size-4" />
                            : <CircleAlert aria-hidden="true" className="size-4" />}
                        {outcomeLabel(state.result.outcome)}
                      </div>
                      <p className="mt-1 leading-relaxed">{state.result.message}</p>
                      <p className="mt-2 text-xs opacity-80">
                        Checked {new Date(state.result.observedAt).toLocaleString()} · {state.result.durationMs} ms
                        {state.result.capabilityCount > 0 ? ` · ${state.result.capabilityCount} capabilities` : ""}
                        {state.persistence === "recorded"
                          ? " · saved as browser-reported evidence"
                          : state.persistence === "not_configured"
                            ? " · shared save not configured · local result only"
                            : " · shared save failed · local result only"}
                      </p>
                    </div>
                  )}
                  {browserErrors[key] ? (
                    <Alert aria-live="polite" className="mt-3" variant="destructive">
                      <CircleAlert aria-hidden="true" />
                      <AlertTitle>Browser check stopped</AlertTitle>
                      <AlertDescription>{browserErrors[key]}</AlertDescription>
                    </Alert>
                  ) : null}
                  {infrastructureState && (
                    <Alert aria-live="polite" className="mt-3" variant={infrastructureState.state === "failed" ? "destructive" : "default"}>
                      {infrastructureState.state === "failed"
                        ? <CircleAlert aria-hidden="true" />
                        : <ShieldCheck aria-hidden="true" />}
                      <AlertTitle>{infrastructureState.state === "completed"
                        ? "Marketplace check completed"
                        : infrastructureState.state === "pending" ? "Marketplace check queued"
                          : infrastructureState.state === "deferred" ? "Marketplace check still running"
                            : "Validation stopped"}</AlertTitle>
                      <AlertDescription>{infrastructureState.message}</AlertDescription>
                    </Alert>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
