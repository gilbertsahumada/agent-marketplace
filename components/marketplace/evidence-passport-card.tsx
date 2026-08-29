import Link from "next/link";
import { ArrowUpRight, Fingerprint } from "lucide-react";
import type { CSSProperties } from "react";
import type { AgentEvidencePassport, EvidencePassportCheck } from "@/src/business/entities/evidence-passport";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProvenanceBadge } from "./provenance-badge";

const stateLabels: Record<AgentEvidencePassport["state"], string> = {
  registered: "Registered",
  evaluated: "Evaluated",
  hireable: "Hireable",
  job_proven: "Job proven",
  attention: "Attention",
};

const checkStatusLabels: Record<EvidencePassportCheck["status"], string> = {
  verified: "Verified",
  missing: "Not available",
  not_probed: "Not probed",
  failed: "Needs attention",
  unavailable: "Unavailable",
  stale: "Stale",
};

function visualSeed(hash: string): CSSProperties {
  return {
    "--passport-angle": `${Number.parseInt(hash.slice(2, 6), 16) % 360}deg`,
    "--passport-shift-x": `${20 + Number.parseInt(hash.slice(6, 8), 16) % 61}%`,
    "--passport-shift-y": `${20 + Number.parseInt(hash.slice(8, 10), 16) % 61}%`,
  } as CSSProperties;
}

function PassportCheck({ label, check }: { label: string; check: EvidencePassportCheck }) {
  return (
    <li className="rounded-lg border border-white/[0.08] bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-100">{label}</span>
        <ProvenanceBadge provenance={check.provenance} />
      </div>
      <p className="font-eyebrow mt-3 text-zinc-400">{checkStatusLabels[check.status]}</p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{check.detail}</p>
      {check.observedAt && <p className="font-stat mt-2 text-[10px] text-zinc-500">Observed {check.observedAt}</p>}
    </li>
  );
}

export function EvidencePassportCard({
  passport,
  apiHref,
}: {
  passport: AgentEvidencePassport;
  apiHref?: string;
}) {
  const provenJobLabel = `${passport.trackRecord.provenJobs} proven ${passport.trackRecord.provenJobs === 1 ? "job" : "jobs"}`;
  return (
    <Card
      aria-label={`Evidence Passport for ${passport.name}`}
      className="evidence-passport"
      data-state={passport.state}
      style={visualSeed(passport.evidenceSnapshotHash)}
    >
      <CardHeader className="relative z-10 gap-4 border-b border-white/[0.08] pb-5 sm:grid-cols-[1fr_auto]">
        <div>
          <p className="font-eyebrow text-zinc-400">BSC · Agent #{passport.agentId}</p>
          <h2 className="mt-2 text-xl font-medium tracking-tight text-white">Indexed Evidence Passport</h2>
          <p className="mt-2 text-sm text-zinc-400">Indexed identity and declaration snapshot — current Worker observations are shown separately.</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge className="passport-state-badge" variant="outline">{stateLabels[passport.state]}</Badge>
          <span className="text-xs text-zinc-500">{passport.operator === "marketplace" ? "Marketplace-operated" : "Third-party operator"}</span>
        </div>
      </CardHeader>

      <CardContent className="relative z-10 pt-1">
        <dl className="grid gap-3 border-b border-white/[0.08] pb-5 sm:grid-cols-3">
          <div><dt className="font-eyebrow text-zinc-500">Network</dt><dd className="mt-1 text-sm text-zinc-200">BNB Smart Chain · 56</dd></div>
          <div><dt className="font-eyebrow text-zinc-500">Track record</dt><dd className="mt-1 text-sm text-zinc-200">{provenJobLabel}</dd></div>
          <div><dt className="font-eyebrow text-zinc-500">Evidence fingerprint</dt><dd className="font-hash mt-1 text-xs text-zinc-300">{passport.evidenceSnapshotHash.slice(0, 12)}…{passport.evidenceSnapshotHash.slice(-8)}</dd></div>
        </dl>

        <ul aria-label="Passport evidence checks" className="mt-5 grid gap-3 sm:grid-cols-2">
          <PassportCheck check={passport.checks.identity} label="Identity" />
          <PassportCheck check={passport.checks.endpoint} label="Endpoint" />
          <PassportCheck check={passport.checks.quote} label="ERC-8183 quote" />
          <PassportCheck check={passport.checks.job} label="Job result" />
        </ul>

        {(passport.nextRequirements.length > 0 || apiHref) && (
          <div className="mt-5 flex flex-col gap-4 border-t border-white/[0.08] pt-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              {passport.nextRequirements.length > 0 && (
                <>
                  <p className="font-eyebrow text-zinc-500">Next requirement</p>
                  <p className="mt-2 text-sm text-zinc-300">{passport.nextRequirements[0]}</p>
                </>
              )}
            </div>
            {apiHref && (
              <Button asChild size="sm" variant="outline">
                <Link href={apiHref}>Open passport JSON<ArrowUpRight aria-hidden="true" /></Link>
              </Button>
            )}
          </div>
        )}
        <p className="mt-5 flex items-center gap-2 text-[10px] text-zinc-500">
          <Fingerprint aria-hidden="true" className="size-3" />
          Schema v{passport.schemaVersion} · Generated {passport.generatedAt}
        </p>
      </CardContent>
    </Card>
  );
}
