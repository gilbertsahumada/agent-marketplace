import type { PublicVerificationSnapshot } from "../data/verification/public-verification-snapshot.js";
import type { BscVerificationReport } from "./types.js";

const DEFAULT_FRESHNESS_HOURS = 72;

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function verificationReportFromReleaseInput(value: unknown): BscVerificationReport {
  const root = record(value, "release input");
  const candidate = "verification" in root ? root.verification : value;
  const report = record(candidate, "verification report");
  if (report.schemaVersion !== 2 || report.chainId !== 56 || !Array.isArray(report.agents)) {
    throw new Error("release input does not contain a BSC verification schema 2 report");
  }
  return candidate as BscVerificationReport;
}

export function sanitizeVerificationReport(
  report: BscVerificationReport,
  options: { now?: number; maxAgeHours?: number } = {},
): PublicVerificationSnapshot {
  const now = options.now ?? Date.now();
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_FRESHNESS_HOURS;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("maxAgeHours must be positive");
  }
  const generatedAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAt)) throw new Error("verification generatedAt is invalid");
  const freshnessMs = maxAgeHours * 60 * 60 * 1_000;
  if (now - generatedAt > freshnessMs) {
    throw new Error(`verification report is older than ${maxAgeHours} hours`);
  }
  return {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    staleAfter: new Date(generatedAt + freshnessMs).toISOString(),
    chainId: 56,
    blockNumber: report.onchain.blockNumber,
    registryAddress: report.onchain.registryAddress,
    source: "marketplace-verification-release-snapshot",
    agents: report.agents.map((agent) => {
      const endpoints = agent.mcpEndpoints;
      const observed = endpoints.filter((endpoint) => endpoint.status !== "not_probed");
      const observedAt = observed
        .map((endpoint) => endpoint.observedAt)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null;
      return {
        agentId: agent.agentId,
        name: agent.name,
        categories: agent.categories,
        identity: {
          status: agent.identity.status,
          mismatchFields: [
            ...(agent.identity.checks.ownerMatches === false ? ["owner" as const] : []),
            ...(agent.identity.checks.metadataUriMatches === false ? ["metadata_uri" as const] : []),
          ],
          observedAt: agent.identity.observedAt,
          provenance: ["declared", "onchain"] as const,
        },
        tools: {
          status: observed.length > 0 ? "observed" as const : "not_probed" as const,
          declaredOnly: [...new Set(observed.flatMap((endpoint) => endpoint.comparison.declaredOnly))].sort(),
          observedOnly: [...new Set(observed.flatMap((endpoint) => endpoint.comparison.observedOnly))].sort(),
          observedAt,
          provenance: observed.length > 0 ? "observed" as const : "not_probed" as const,
        },
      };
    }),
  };
}
