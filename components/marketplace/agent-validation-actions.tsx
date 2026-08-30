"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, ShieldCheck, WifiOff } from "lucide-react";
import type { AgentValidationReport } from "@/src/business/entities/agent-validation";
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
  targets: BrowserValidationTarget[];
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [fallbackPending, setFallbackPending] = useState(false);
  const [fallback, setFallback] = useState<AgentValidationReport | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

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

  async function validateThroughMarketplace() {
    setFallbackPending(true);
    setFallback(null);
    setFallbackError(null);
    try {
      const response = await fetch("/api/marketplace/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const payload = await response.json() as AgentValidationReport | { error?: { message?: string } };
      if (!response.ok || !("evidence" in payload)) {
        throw new Error("error" in payload ? payload.error?.message : undefined);
      }
      setFallback(payload);
    } catch (error) {
      setFallbackError(error instanceof Error && error.message
        ? error.message
        : "Marketplace validation could not be completed.");
    } finally {
      setFallbackPending(false);
    }
  }

  return (
    <Card className="marketplace-surface mt-5">
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
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-relaxed text-zinc-500">
            If CORS blocks your browser, the marketplace can repeat the check from its protected server. This performs no wallet transaction; a quote, when supported, is requested only to verify current ERC-8183 terms.
          </p>
          <Button
            className="shrink-0 cursor-pointer"
            disabled={fallbackPending}
            onClick={() => void validateThroughMarketplace()}
            type="button"
          >
            {fallbackPending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <ShieldCheck aria-hidden="true" />}
            Validate through marketplace
          </Button>
        </div>

        {fallbackError && (
          <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertTitle>Validation stopped</AlertTitle><AlertDescription>{fallbackError}</AlertDescription></Alert>
        )}
        {fallback && (
          <Alert>
            <ShieldCheck aria-hidden="true" />
            <AlertTitle>Marketplace check completed</AlertTitle>
            <AlertDescription>
              {fallback.evidence.endpointChecks.filter((check) => check.status === "verified").length} endpoint checks passed. ERC-8183 quote: {fallback.evidence.quote.status.replaceAll("_", " ")}. {fallback.qualification.note}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
