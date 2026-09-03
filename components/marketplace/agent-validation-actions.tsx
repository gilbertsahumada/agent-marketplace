"use client";

import { useState } from "react";
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

type PersistenceStatus = "recorded" | "failed" | "not_configured" | "pending";
type ValidationTarget = BrowserValidationTarget & { endpointKey?: string };
type InfrastructureState = "pending" | "deferred" | "completed" | "failed";
const POLL_DELAYS_MS = [1_000, 2_000, 4_000, 5_000, 5_000, 5_000] as const;

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

function resultClass(outcome: BrowserValidationResult["outcome"]): string {
  if (outcome === "protocol_valid") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (outcome === "cors_blocked") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  return "border-red-400/30 bg-red-400/10 text-red-200";
}

export function AgentValidationActions({ agentId, targets }: {
  agentId: string;
  targets: ValidationTarget[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [infrastructure, setInfrastructure] = useState<Record<string, {
    state: InfrastructureState;
    message: string;
  }>>({});

  async function validate(target: BrowserValidationTarget) {
    const key = targetKey(target);
    setPending(key);
    const result = await validateEndpointInBrowser(target);
    setResults((current) => ({ ...current, [key]: { result, persistence: "pending" } }));
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
    setPending(null);
  }

  async function validateThroughMarketplace(target: ValidationTarget) {
    if (!target.endpointKey) return;
    const key = targetKey(target);
    setInfrastructure((current) => ({
      ...current,
      [key]: { state: "pending", message: "The marketplace queued this endpoint for validation." },
    }));
    try {
      const response = await fetch("/api/marketplace/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, endpointKey: target.endpointKey, validationKind: "protocol" }),
      });
      const payload = await response.json() as {
        status?: string;
        requestId?: string | null;
        pollAfterMs?: number;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message || "Marketplace validation could not be queued.");
      if (payload.status === "completed") {
        setInfrastructure((current) => ({
          ...current,
          [key]: { state: "completed", message: "Marketplace check completed and shared evidence was updated." },
        }));
        router.refresh();
        return;
      }
      if (!payload.requestId) throw new Error("Marketplace validation returned no request identifier.");

      for (let attempt = 0; attempt < POLL_DELAYS_MS.length; attempt += 1) {
        const delayMs = attempt === 0 && typeof payload.pollAfterMs === "number"
          ? Math.max(0, Math.min(5_000, payload.pollAfterMs))
          : POLL_DELAYS_MS[attempt] ?? 5_000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        let statusResponse: Response;
        let statusPayload: {
          status?: string;
          hasResult?: boolean;
          errorCode?: string | null;
          error?: { message?: string };
        };
        try {
          statusResponse = await fetch(`/api/marketplace/validate/${encodeURIComponent(payload.requestId)}`, {
            cache: "no-store",
          });
          statusPayload = await statusResponse.json();
        } catch {
          setInfrastructure((current) => ({
            ...current,
            [key]: {
              state: "deferred",
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
              message: statusPayload.error?.message
                ? `${statusPayload.error.message} The marketplace validation may still be running.`
                : "The status check was interrupted. The marketplace validation may still be running; continue checking shortly.",
            },
          }));
          return;
        }
        if (statusPayload.status === "completed") {
          if (statusPayload.hasResult !== true) {
            throw new Error("Marketplace validation completed but did not produce shared evidence.");
          }
          setInfrastructure((current) => ({
            ...current,
            [key]: { state: "completed", message: "Marketplace check completed and shared evidence was updated." },
          }));
          router.refresh();
          return;
        }
        if (statusPayload.status === "failed" || statusPayload.status === "cancelled") {
          throw new Error(statusPayload.errorCode
            ? `Marketplace validation stopped (${statusPayload.errorCode}).`
            : "Marketplace validation stopped before producing evidence.");
        }
      }
      setInfrastructure((current) => ({
        ...current,
        [key]: {
          state: "deferred",
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
        <CardTitle>Validate declared endpoints</CardTitle>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          Run a read-only protocol check now. Browser results are reported separately from marketplace-operated checks and never make an agent hireable by themselves.
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
                <li className="rounded-xl border border-white/10 bg-white/[0.02] p-4" key={key}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{target.protocol.replace("_", " ").toUpperCase()}</Badge>
                        <span className="truncate text-sm text-zinc-300">{targetLabel(target)}</span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">Declared by the agent · not yet trusted</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
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
                        {state.result.outcome.replaceAll("_", " ")}
                      </div>
                      <p className="mt-1 leading-relaxed">{state.result.message}</p>
                      <p className="mt-2 text-xs opacity-80">
                        Checked {new Date(state.result.observedAt).toLocaleString()} · {state.result.durationMs} ms
                        {state.result.capabilityCount > 0 ? ` · ${state.result.capabilityCount} capabilities` : ""}
                        {state.persistence === "recorded" ? " · saved as browser-reported evidence" : " · local result only"}
                      </p>
                    </div>
                  )}
                  {infrastructureState && (
                    <Alert className="mt-3" variant={infrastructureState.state === "failed" ? "destructive" : "default"}>
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
