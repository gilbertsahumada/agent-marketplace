import snapshotJson from "./bsc-candidates-public.json" with { type: "json" };
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from "../../business/entities/marketplace-agent.js";
import type { PublicAgentVerification, PublicVerificationFreshness, PublicVerificationSnapshot } from "../../business/entities/public-verification-snapshot.js";
export type { PublicAgentVerification, PublicVerificationFreshness, PublicVerificationSnapshot } from "../../business/entities/public-verification-snapshot.js";

const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const PROBE_OUTCOMES = [
  "protocol_valid", "no_tools", "unauthorized", "timeout", "unsafe_url",
  "http_error", "protocol_error", "not_probed",
] as const;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a string`);
  return value;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${name} must be a string array`);
  }
  return [...new Set(value)];
}

function timestamp(value: unknown, name: string): string {
  const result = string(value, name);
  const parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) {
    throw new Error(`${name} must be a canonical ISO timestamp`);
  }
  return result;
}

function numericString(value: unknown, name: string): string {
  const result = string(value, name);
  if (!/^\d+$/.test(result)) throw new Error(`${name} must be a numeric string`);
  return result;
}

function address(value: unknown, name: string): string {
  const result = string(value, name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(result)) throw new Error(`${name} must be an EVM address`);
  return result;
}

export function parsePublicVerificationSnapshot(value: unknown): PublicVerificationSnapshot {
  const root = object(value, "verification snapshot");
  if (root.schemaVersion !== 2 || root.chainId !== 56) {
    throw new Error("verification snapshot schema or chain is unsupported");
  }
  const generatedAt = timestamp(root.generatedAt, "generatedAt");
  const staleAfter = timestamp(root.staleAfter, "staleAfter");
  const agents = Array.isArray(root.agents) ? root.agents.map((entry, index) => {
    const agent = object(entry, `agents[${index}]`);
    const identity = object(agent.identity, `agents[${index}].identity`);
    const tools = object(agent.tools, `agents[${index}].tools`);
    const qualification = object(agent.qualification, `agents[${index}].qualification`);
    const identityStatus = string(identity.status, "identity.status");
    if (!["match", "mismatch", "read_error"].includes(identityStatus)) {
      throw new Error("identity.status is unsupported");
    }
    const identityProvenance = stringArray(identity.provenance, "identity.provenance");
    const expectedIdentitySource = identityStatus === "read_error" ? "unavailable" : "onchain";
    if (
      identityProvenance.length !== 2
      || identityProvenance[0] !== "declared"
      || identityProvenance[1] !== expectedIdentitySource
    ) {
      throw new Error("identity.provenance does not match identity.status");
    }
    const mismatchFields = stringArray(identity.mismatchFields, "identity.mismatchFields");
    if (mismatchFields.some((field) => field !== "owner" && field !== "metadata_uri")) {
      throw new Error("identity.mismatchFields contains an unsupported field");
    }
    if ((identityStatus === "mismatch") !== (mismatchFields.length > 0)) {
      throw new Error("identity.mismatchFields does not match identity.status");
    }
    const toolStatus = string(tools.status, "tools.status");
    if (toolStatus !== "observed" && toolStatus !== "not_probed") {
      throw new Error("tools.status is unsupported");
    }
    const provenance = string(tools.provenance, "tools.provenance");
    if (provenance !== "observed" && provenance !== "not_probed") {
      throw new Error("tools.provenance is unsupported");
    }
    const probeOutcomes = stringArray(tools.probeOutcomes, "tools.probeOutcomes");
    if (probeOutcomes.some((outcome) => !PROBE_OUTCOMES.includes(outcome as typeof PROBE_OUTCOMES[number]))) {
      throw new Error("tools.probeOutcomes contains an unsupported outcome");
    }
    const reachability = string(tools.reachability, "tools.reachability");
    if (!["verified", "failed", "not_probed"].includes(reachability)) {
      throw new Error("tools.reachability is unsupported");
    }
    const attemptedProbe = probeOutcomes.some((outcome) => outcome !== "not_probed");
    if (attemptedProbe && probeOutcomes.includes("not_probed")) {
      throw new Error("tools.probeOutcomes cannot mix attempted and not_probed outcomes");
    }
    const expectedToolStatus = attemptedProbe ? "observed" : "not_probed";
    const expectedReachability = probeOutcomes.includes("protocol_valid")
      ? "verified"
      : attemptedProbe
        ? "failed"
        : "not_probed";
    if (toolStatus !== expectedToolStatus || reachability !== expectedReachability) {
      throw new Error("tools status and reachability do not match probeOutcomes");
    }
    if ((provenance === "observed") !== attemptedProbe) {
      throw new Error("tools.provenance does not match probeOutcomes");
    }
    const operator = string(agent.operator, "operator");
    if (operator !== "third_party" && operator !== "marketplace") {
      throw new Error("operator is unsupported");
    }
    const selection = string(agent.selection, "selection");
    if (!["curated", "marketplace_operated", "operator_explicit"].includes(selection)) {
      throw new Error("selection is unsupported");
    }
    if ((selection === "marketplace_operated") !== (operator === "marketplace")) {
      throw new Error("selection does not match operator");
    }
    const qualificationStatus = string(qualification.status, "qualification.status");
    if (!["qualified", "not_qualified", "unavailable"].includes(qualificationStatus)) {
      throw new Error("qualification.status is unsupported");
    }
    if (qualification.provenance !== "derived:marketplace-seller-qualification") {
      throw new Error("qualification.provenance is unsupported");
    }
    const qualificationObservedAt = timestamp(qualification.observedAt, "qualification.observedAt");
    if (qualificationObservedAt !== generatedAt) {
      throw new Error("qualification.observedAt must match snapshot generatedAt");
    }
    const toolsObservedAt = tools.observedAt === null ? null : timestamp(tools.observedAt, "tools.observedAt");
    if ((toolsObservedAt !== null) !== attemptedProbe) {
      throw new Error("tools.observedAt does not match probeOutcomes");
    }
    return {
      agentId: numericString(agent.agentId, "agentId"),
      name: string(agent.name, "name"),
      selection: selection as PublicAgentVerification["selection"],
      operator: operator as PublicAgentVerification["operator"],
      qualification: {
        status: qualificationStatus as PublicAgentVerification["qualification"]["status"],
        observedAt: qualificationObservedAt,
        provenance: "derived:marketplace-seller-qualification" as const,
      },
      categories: stringArray(agent.categories, "categories").map((category) => {
        if (!MARKETPLACE_CATEGORIES.includes(category as MarketplaceCategory)) {
          throw new Error("categories contains an unsupported marketplace category");
        }
        return category as MarketplaceCategory;
      }),
      identity: {
        status: identityStatus as PublicAgentVerification["identity"]["status"],
        mismatchFields: mismatchFields as PublicAgentVerification["identity"]["mismatchFields"],
        observedAt: timestamp(identity.observedAt, "identity.observedAt"),
        provenance: ["declared", expectedIdentitySource] as const,
      },
      tools: {
        status: toolStatus as PublicAgentVerification["tools"]["status"],
        probeOutcomes: probeOutcomes as PublicAgentVerification["tools"]["probeOutcomes"],
        reachability: reachability as PublicAgentVerification["tools"]["reachability"],
        declaredOnly: stringArray(tools.declaredOnly, "tools.declaredOnly"),
        observedOnly: stringArray(tools.observedOnly, "tools.observedOnly"),
        observedAt: toolsObservedAt,
        provenance: provenance as PublicAgentVerification["tools"]["provenance"],
      },
    };
  }) : null;
  if (!agents) throw new Error("verification snapshot agents must be an array");
  if (Date.parse(staleAfter) <= Date.parse(generatedAt)) {
    throw new Error("verification snapshot staleAfter must follow generatedAt");
  }
  if (root.source !== "marketplace-verification-release-snapshot") {
    throw new Error("verification snapshot source is unsupported");
  }
  return {
    schemaVersion: 2,
    generatedAt,
    staleAfter,
    chainId: 56,
    blockNumber: numericString(root.blockNumber, "blockNumber"),
    registryAddress: address(root.registryAddress, "registryAddress"),
    source: root.source,
    agents,
  };
}

export const PUBLIC_VERIFICATION_SNAPSHOT = parsePublicVerificationSnapshot(snapshotJson);

export function assertPublicVerificationSnapshotFresh(
  snapshot: PublicVerificationSnapshot,
  now = Date.now(),
): void {
  if (Date.parse(snapshot.generatedAt) > now + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error(`Public verification snapshot generatedAt ${snapshot.generatedAt} is too far in the future.`);
  }
  if (now > Date.parse(snapshot.staleAfter)) {
    throw new Error(`Public verification snapshot expired at ${snapshot.staleAfter}. Run npm run publish:verification before deploying.`);
  }
}

const agentsById = new Map(PUBLIC_VERIFICATION_SNAPSHOT.agents.map((agent) => [agent.agentId, agent]));

export function publicVerificationForAgent(
  agentId: string,
  now = Date.now(),
): (PublicAgentVerification & { freshness: PublicVerificationFreshness }) | null {
  const agent = agentsById.get(agentId);
  if (!agent) return null;
  return {
    ...agent,
    freshness: now <= Date.parse(PUBLIC_VERIFICATION_SNAPSHOT.staleAfter)
      && Date.parse(PUBLIC_VERIFICATION_SNAPSHOT.generatedAt) <= now + MAX_FUTURE_CLOCK_SKEW_MS
      ? "current"
      : "stale",
  };
}
