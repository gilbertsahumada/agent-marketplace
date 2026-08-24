import type { PublicVerificationSnapshot } from "../data/verification/public-verification-snapshot.js";
import type { BscVerificationReport } from "./types.js";

const DEFAULT_FRESHNESS_HOURS = 72;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface ReleaseMarketplaceEvidence {
  operator: "third_party" | "marketplace";
  qualification: "qualified" | "not_qualified" | "unavailable";
}

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

export function marketplaceEvidenceFromReleaseInput(
  value: unknown,
): ReadonlyMap<string, ReleaseMarketplaceEvidence> {
  const root = record(value, "release input");
  if (!("verification" in root)) return new Map();
  if (root.schemaVersion !== 3 || !Array.isArray(root.candidates)) {
    throw new Error("release input does not contain a readiness schema 3 candidate list");
  }
  const sellerQualification = record(root.sellerQualification, "sellerQualification");
  if (!Array.isArray(sellerQualification.qualifiedAgentIds)
    || sellerQualification.qualifiedAgentIds.some((agentId) => typeof agentId !== "string" || !/^\d+$/.test(agentId))) {
    throw new Error("sellerQualification.qualifiedAgentIds must be numeric strings");
  }
  const qualifiedAgentIds = new Set(sellerQualification.qualifiedAgentIds as string[]);
  const result = new Map<string, ReleaseMarketplaceEvidence>();
  root.candidates.forEach((value, index) => {
    const candidate = record(value, `candidates[${index}]`);
    const agentId = candidate.agentId;
    const selection = candidate.selection;
    const qualification = record(candidate.qualification, `candidates[${index}].qualification`);
    if (typeof agentId !== "string" || !/^\d+$/.test(agentId)) {
      throw new Error(`candidates[${index}].agentId must be numeric`);
    }
    if (!["curated", "marketplace_operated", "operator_explicit"].includes(String(selection))) {
      throw new Error(`candidates[${index}].selection is unsupported`);
    }
    if (!["qualified", "not_qualified", "unavailable"].includes(String(qualification.status))) {
      throw new Error(`candidates[${index}].qualification.status is unsupported`);
    }
    if (qualification.provenance !== "derived:marketplace-seller-qualification") {
      throw new Error(`candidates[${index}].qualification.provenance is unsupported`);
    }
    if ((qualification.status === "qualified") !== qualifiedAgentIds.has(agentId)) {
      throw new Error(`candidates[${index}].qualification does not match sellerQualification`);
    }
    result.set(agentId, {
      operator: selection === "marketplace_operated" ? "marketplace" : "third_party",
      qualification: qualification.status as ReleaseMarketplaceEvidence["qualification"],
    });
  });
  return result;
}

export function sanitizeVerificationReport(
  report: BscVerificationReport,
  options: {
    now?: number;
    maxAgeHours?: number;
    marketplaceEvidence?: ReadonlyMap<string, ReleaseMarketplaceEvidence>;
  } = {},
): PublicVerificationSnapshot {
  const now = options.now ?? Date.now();
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_FRESHNESS_HOURS;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("maxAgeHours must be positive");
  }
  const generatedAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAt)) throw new Error("verification generatedAt is invalid");
  if (generatedAt > now + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error("verification generatedAt is too far in the future");
  }
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
      const marketplaceEvidence = options.marketplaceEvidence?.get(agent.agentId);
      const endpoints = agent.mcpEndpoints;
      const observed = endpoints.filter((endpoint) => endpoint.status !== "not_probed");
      const probeOutcomes = [...new Set(endpoints.map((endpoint) => endpoint.status))];
      const reachability = endpoints.some((endpoint) => endpoint.status === "protocol_valid")
        ? "verified" as const
        : observed.length > 0
          ? "failed" as const
          : "not_probed" as const;
      const observedAt = observed
        .map((endpoint) => endpoint.observedAt)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null;
      return {
        agentId: agent.agentId,
        name: agent.name,
        categories: agent.categories,
        operator: marketplaceEvidence?.operator ?? "third_party",
        qualification: {
          status: marketplaceEvidence?.qualification ?? "unavailable",
          observedAt: report.generatedAt,
          provenance: "derived:marketplace-seller-qualification" as const,
        },
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
          probeOutcomes,
          reachability,
          declaredOnly: [...new Set(observed.flatMap((endpoint) => endpoint.comparison.declaredOnly))].sort(),
          observedOnly: [...new Set(observed.flatMap((endpoint) => endpoint.comparison.observedOnly))].sort(),
          observedAt,
          provenance: observed.length > 0 ? "observed" as const : "not_probed" as const,
        },
      };
    }),
  };
}
