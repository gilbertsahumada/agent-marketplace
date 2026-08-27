import Link from "next/link";
import { CircleAlert, CircleCheck, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProvenanceBadge } from "./provenance-badge";
import type { VerificationDriftViewModel } from "./presentation-types";

function toolSummary(verification: VerificationDriftViewModel): string {
  if (verification.toolsStatus === "not_probed") return "Tool endpoint was not probed";
  if (verification.toolReachability === "failed") {
    return `Probe did not establish reachability (${verification.toolProbeOutcomes.join(", ")})`;
  }
  if (verification.declaredOnlyTools.length > 0) {
    return `${verification.declaredOnlyTools.length} declared tool${verification.declaredOnlyTools.length === 1 ? " was" : "s were"} not observed`;
  }
  if (verification.observedOnlyTools.length > 0) {
    return `${verification.observedOnlyTools.length} observed tool${verification.observedOnlyTools.length === 1 ? " was" : "s were"} not declared`;
  }
  return "Declared and observed tool lists matched";
}

export function VerificationDrift({
  verification,
  compact = false,
}: {
  verification: VerificationDriftViewModel;
  compact?: boolean;
}) {
  const attention = verification.identityStatus !== "match"
    || verification.walletAttribution?.status === "ambiguous"
    || verification.toolReachability === "failed"
    || verification.declaredOnlyTools.length > 0
    || verification.observedOnlyTools.length > 0;
  const notProbed = verification.toolReachability === "not_probed";
  const Icon = verification.freshness === "stale" || notProbed ? Clock3 : attention ? CircleAlert : CircleCheck;
  const iconClass = verification.freshness === "stale" || attention
    ? "text-amber-300"
    : notProbed
      ? "text-zinc-400"
      : "text-emerald-300";
  const title = verification.walletAttribution?.status === "ambiguous"
    ? `Wallet attribution ambiguous · ${toolSummary(verification)}`
    : verification.identityStatus === "mismatch"
    ? `Identity mismatch · ${toolSummary(verification)}`
    : verification.identityStatus === "read_error"
      ? `Identity unavailable · ${toolSummary(verification)}`
      : toolSummary(verification);

  if (compact) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-xs text-zinc-300">
        <Icon aria-hidden="true" className={`mt-0.5 size-4 ${iconClass}`} />
        <div>
          <p>{title}</p>
          <p className="font-stat mt-1 text-[10px] text-zinc-500">
            {verification.freshness === "stale" ? "Stale snapshot" : notProbed ? "Not probed" : "Observed"} · {verification.toolsObservedAt ?? verification.identityObservedAt}
          </p>
        </div>
      </div>
    );
  }

  return (
    <details className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex flex-wrap items-center gap-2">
          <Icon aria-hidden="true" className={`size-4 ${iconClass}`} />
          <span className="text-sm font-medium text-zinc-100">{title}</span>
          <Badge variant="outline">{verification.freshness}</Badge>
        </span>
      </summary>
      <div className="mt-4 space-y-4 border-t border-white/10 pt-4 text-sm text-zinc-400">
        <div>
          <div className="flex flex-wrap items-center gap-2"><strong className="text-zinc-200">Identity</strong><ProvenanceBadge provenance="declared" /><ProvenanceBadge provenance={verification.identityOnchainProvenance} /></div>
          <p className="mt-1">{verification.identityStatus === "match" ? "Declared owner and metadata matched the pinned BSC read." : verification.identityStatus === "mismatch" ? `Mismatched field: ${verification.identityMismatchFields.join(", ").replaceAll("_", " ")}.` : "The direct identity read did not complete."}</p>
          {verification.walletAttribution?.status === "ambiguous" && (
            <p className="mt-2 text-amber-200">Wallet attribution is ambiguous across {verification.walletAttribution.candidateCount} evaluated agents ({verification.walletAttribution.candidateAgentIds.join(", ")}); payments cannot be assigned to one Agent ID from this evidence.</p>
          )}
          <p className="font-stat mt-1 text-[10px] text-zinc-500">Block {verification.blockNumber} · {verification.identityObservedAt}</p>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2"><strong className="text-zinc-200">Tools</strong><ProvenanceBadge provenance={verification.toolsStatus === "not_probed" ? "not_probed" : "observed"} /></div>
          {verification.toolsStatus === "not_probed" ? <p className="mt-1">No observation was attempted; this is not a failed endpoint.</p> : (
            <>
              <p className="mt-1">{toolSummary(verification)}.</p>
              {verification.declaredOnlyTools.length > 0 && <p className="mt-2 break-words"><span className="text-zinc-300">Declared, not observed:</span> {verification.declaredOnlyTools.join(", ")}</p>}
              {verification.observedOnlyTools.length > 0 && <p className="mt-2 break-words"><span className="text-zinc-300">Observed, not declared:</span> {verification.observedOnlyTools.join(", ")}</p>}
            </>
          )}
          <p className="font-stat mt-1 text-[10px] text-zinc-500">{verification.toolsObservedAt ?? "No observation timestamp"}</p>
        </div>
        <p className="text-xs"><Link className="underline underline-offset-4" href="/evidence/verification">Read the published verification rule</Link></p>
      </div>
    </details>
  );
}
