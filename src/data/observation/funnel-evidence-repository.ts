import artifactJson from "../../../evidence/funnel-bsc-2026-09-04T19-31-44Z.json" with { type: "json" };
import type { FunnelEvidence } from "../../business/entities/funnel-evidence.ts";
import type { FunnelEvidenceReader } from "../../business/use-cases/get-funnel-evidence.ts";
import { computeSourceSha256 } from "../../trust8004/funnel-snapshot.ts";

const ARTIFACT_PATH = "evidence/funnel-bsc-2026-09-04T19-31-44Z.json";
const COUNT_ONLY_TOLERANCE = 0.01;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function funnelEvidenceFromArtifact(artifact: unknown, sourcePath: string): FunnelEvidence | null {
  const root = asRecord(artifact);
  if (!root || root.schemaVersion !== 1 || root.chainId !== 56) return null;
  const cutoff = asRecord(root.cutoff);
  const metadata = asRecord(root.metadata);
  const protocols = asRecord(root.protocols);
  const candidates = asRecord(root.candidates);
  const scan = asRecord(root.scan);
  if (!cutoff || !metadata || !protocols || !candidates || !scan) return null;

  const sourceSha256 = nonEmptyString(root.sourceSha256);
  const generatedAt = nonEmptyString(root.generatedAt);
  const blockNumber = nonEmptyString(cutoff.blockNumber);
  const registeredTotal = count(root.registeredTotal);
  const countOnlyTotal = count(root.countOnlyTotal);
  const scanDurationMs = count(scan.durationMs);
  const metadataOk = count(metadata.ok);
  const metadataHttpUnreachable = count(metadata.httpUnreachable);
  const metadataOther = count(metadata.other);
  const buckets = ["a2aOnly", "erc8183Only", "both", "mcpOnly", "otherOrNone", "protocolUnknown"]
    .map((bucket) => count(protocols[bucket]));
  const transportDeclarants = count(candidates.declaringAgents);
  const publicHttpsEndpoints = count(candidates.publicHttpsEndpoints);
  if (
    sourceSha256 === null || generatedAt === null || blockNumber === null
    || registeredTotal === null || countOnlyTotal === null || scanDurationMs === null
    || metadataOk === null || metadataHttpUnreachable === null || metadataOther === null
    || buckets.some((bucket) => bucket === null)
    || transportDeclarants === null || publicHttpsEndpoints === null
  ) return null;

  if (computeSourceSha256(root) !== sourceSha256) return null;
  if (buckets.reduce((sum, bucket) => sum! + bucket!, 0) !== registeredTotal) return null;
  if (metadataOk + metadataHttpUnreachable + metadataOther !== registeredTotal) return null;
  if (Math.abs(registeredTotal - countOnlyTotal) > registeredTotal * COUNT_ONLY_TOLERANCE) return null;

  return {
    sourcePath,
    sourceSha256,
    generatedAt,
    blockNumber,
    registeredTotal,
    countOnlyTotal,
    scanDurationMs,
    metadataOk,
    transportDeclarants,
    publicHttpsEndpoints,
    erc8183Declarants: buckets[1]! + buckets[2]!,
  };
}

let cached: FunnelEvidence | null | undefined;

export const funnelEvidenceRepository: FunnelEvidenceReader = {
  getLatest(): FunnelEvidence | null {
    if (cached === undefined) cached = funnelEvidenceFromArtifact(artifactJson, ARTIFACT_PATH);
    return cached;
  },
};
