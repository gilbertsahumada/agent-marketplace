import snapshotJson from "./bsc-candidates-public.json" with { type: "json" };
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from "../../business/entities/marketplace-agent.js";
import type { PublicAgentVerification, PublicVerificationFreshness, PublicVerificationSnapshot } from "../../business/entities/public-verification-snapshot.js";
export type { PublicAgentVerification, PublicVerificationFreshness, PublicVerificationSnapshot } from "../../business/entities/public-verification-snapshot.js";

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
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${name} must be an ISO timestamp`);
  return result;
}

export function parsePublicVerificationSnapshot(value: unknown): PublicVerificationSnapshot {
  const root = object(value, "verification snapshot");
  if (root.schemaVersion !== 1 || root.chainId !== 56) {
    throw new Error("verification snapshot schema or chain is unsupported");
  }
  const agents = Array.isArray(root.agents) ? root.agents.map((entry, index) => {
    const agent = object(entry, `agents[${index}]`);
    const identity = object(agent.identity, `agents[${index}].identity`);
    const tools = object(agent.tools, `agents[${index}].tools`);
    const identityStatus = string(identity.status, "identity.status");
    if (!["match", "mismatch", "read_error"].includes(identityStatus)) {
      throw new Error("identity.status is unsupported");
    }
    const mismatchFields = stringArray(identity.mismatchFields, "identity.mismatchFields");
    if (mismatchFields.some((field) => field !== "owner" && field !== "metadata_uri")) {
      throw new Error("identity.mismatchFields contains an unsupported field");
    }
    const toolStatus = string(tools.status, "tools.status");
    if (toolStatus !== "observed" && toolStatus !== "not_probed") {
      throw new Error("tools.status is unsupported");
    }
    const provenance = string(tools.provenance, "tools.provenance");
    if (provenance !== "observed" && provenance !== "not_probed") {
      throw new Error("tools.provenance is unsupported");
    }
    return {
      agentId: string(agent.agentId, "agentId"),
      name: string(agent.name, "name"),
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
        provenance: ["declared", "onchain"] as const,
      },
      tools: {
        status: toolStatus as PublicAgentVerification["tools"]["status"],
        declaredOnly: stringArray(tools.declaredOnly, "tools.declaredOnly"),
        observedOnly: stringArray(tools.observedOnly, "tools.observedOnly"),
        observedAt: tools.observedAt === null ? null : timestamp(tools.observedAt, "tools.observedAt"),
        provenance: provenance as PublicAgentVerification["tools"]["provenance"],
      },
    };
  }) : null;
  if (!agents) throw new Error("verification snapshot agents must be an array");
  const generatedAt = timestamp(root.generatedAt, "generatedAt");
  const staleAfter = timestamp(root.staleAfter, "staleAfter");
  if (Date.parse(staleAfter) <= Date.parse(generatedAt)) {
    throw new Error("verification snapshot staleAfter must follow generatedAt");
  }
  if (root.source !== "marketplace-verification-release-snapshot") {
    throw new Error("verification snapshot source is unsupported");
  }
  return {
    schemaVersion: 1,
    generatedAt,
    staleAfter,
    chainId: 56,
    blockNumber: string(root.blockNumber, "blockNumber"),
    registryAddress: string(root.registryAddress, "registryAddress"),
    source: root.source,
    agents,
  };
}

export const PUBLIC_VERIFICATION_SNAPSHOT = parsePublicVerificationSnapshot(snapshotJson);

export function assertPublicVerificationSnapshotFresh(
  snapshot: PublicVerificationSnapshot,
  now = Date.now(),
): void {
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
    freshness: now <= Date.parse(PUBLIC_VERIFICATION_SNAPSHOT.staleAfter) ? "current" : "stale",
  };
}
