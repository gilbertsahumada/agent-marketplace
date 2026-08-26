"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CircleAlert, ShieldCheck } from "lucide-react";
import type { AgentValidationReport } from "@/src/business/entities/agent-validation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidencePassportCard } from "./evidence-passport-card";

function ValidationSkeleton() {
  return (
    <div aria-busy="true" aria-label="Validation in progress" className="grid gap-4">
      <Skeleton className="h-52 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function ValidateAgentPanel() {
  const [agentId, setAgentId] = useState("");
  const [result, setResult] = useState<AgentValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d+$/.test(agentId)) {
      setError("Enter a numeric BSC Agent ID.");
      return;
    }
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/marketplace/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const payload = await response.json() as AgentValidationReport | { error?: { message?: string } };
      if (!response.ok || !("passport" in payload)) {
        throw new Error("error" in payload ? payload.error?.message : undefined);
      }
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : "The validation could not be completed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-8">
      <Card className="marketplace-surface">
        <CardHeader>
          <CardTitle>Validate a BSC agent</CardTitle>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
            Enter one ERC-8004 Agent ID. The marketplace resolves its profile through trust8004, checks identity directly on BSC and probes only the endpoints that agent declared.
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={submit}>
            <label className="grid flex-1 gap-2 text-sm font-medium text-zinc-200" htmlFor="validation-agent-id">
              BSC Agent ID
              <Input
                autoComplete="off"
                id="validation-agent-id"
                inputMode="numeric"
                maxLength={32}
                onChange={(event) => setAgentId(event.target.value.trim())}
                pattern="[0-9]+"
                placeholder="303779"
                value={agentId}
              />
            </label>
            <Button disabled={pending || agentId.length === 0} size="lg" type="submit">
              <ShieldCheck aria-hidden="true" />Validate agent
            </Button>
          </form>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">
            Read-only. No wallet, transaction, arbitrary endpoint or marketplace category is requested.
          </p>
        </CardContent>
      </Card>

      <div aria-live="polite">
        {pending && <ValidationSkeleton />}
        {error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Validation stopped</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {result && (
          <div className="grid gap-5">
            <EvidencePassportCard passport={result.passport} />
            <Alert>
              <ShieldCheck aria-hidden="true" />
              <AlertTitle>Manual review required</AlertTitle>
              <AlertDescription>{result.promotion.note} {result.qualification.note}</AlertDescription>
            </Alert>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="marketplace-surface">
                <CardHeader><CardTitle>Endpoint observations</CardTitle></CardHeader>
                <CardContent>
                  {result.evidence.endpointChecks.length > 0 ? (
                    <ul className="grid gap-3">
                      {result.evidence.endpointChecks.map((check, index) => (
                        <li className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3" key={`${check.protocol}-${index}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium uppercase text-zinc-200">{check.protocol.replace("_", " ")}</span>
                            <Badge variant="outline">{check.status.replace("_", " ")}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-zinc-400">
                            Declared tools: {check.declaredTools.length} · Observed tools: {check.observedTools.length}
                          </p>
                          {check.error && <p className="mt-2 text-xs text-zinc-500">{check.error.message}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-zinc-500">No probeable endpoint was declared.</p>}
                </CardContent>
              </Card>

              <Card className="marketplace-surface">
                <CardHeader><CardTitle>Commercial evidence</CardTitle></CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Quote</span><span>{result.evidence.quote.status}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Price · raw units</span><span className="font-stat">{result.evidence.quote.priceRaw ?? "—"}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Identity</span><span>{result.evidence.identity.status}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Classification</span><span>Not assigned</span></div>
                  <p className="border-t border-white/[0.08] pt-3 text-xs leading-relaxed text-zinc-500">{result.classification.note}</p>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline"><Link href={`/agents/${result.agent.agentId}`}>Open indexed profile</Link></Button>
              <Button asChild variant="ghost"><Link href={`/agents/${result.agent.agentId}/passport`}>Open published Passport</Link></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
