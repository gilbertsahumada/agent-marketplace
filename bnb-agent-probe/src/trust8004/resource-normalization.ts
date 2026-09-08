import { CURATED_INVENTORY } from "../manifest/curated-inventory";
import { classifyCatalogResource } from "./resource-classification";
import type { CatalogAgent, CatalogEndpointProtocol } from "./types";
import type {
  CatalogEndpointEligibility,
  CatalogExternalKind,
  CatalogResourceRole,
  CatalogSafetyReason,
  CatalogValidationProtocol,
} from "./resource-classification";

export interface NormalizedCatalogResource {
  endpointKey: string;
  protocol: "a2a" | "mcp" | "web" | "erc8183_http";
  declaredProtocol: CatalogEndpointProtocol;
  role: CatalogResourceRole;
  validationProtocol: CatalogValidationProtocol | null;
  externalKind: CatalogExternalKind | null;
  eligibility: CatalogEndpointEligibility;
  safety: "safe" | "unsafe";
  safetyReason: CatalogSafetyReason | null;
  endpoint: string;
  originKey: string | null;
  rawServiceLabel: string | null;
  rawSource: "services" | "endpoints" | "shortcut" | null;
  rawSourceIndex: number | null;
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function normalizeCatalogResource(
  declaration: NonNullable<CatalogAgent["indexEndpoints"]>[number],
): Promise<NormalizedCatalogResource> {
  const classification = classifyCatalogResource(declaration.protocol, declaration.endpoint);
  let normalized = declaration.endpoint.trim();
  let originKey: string | null = null;
  if (classification.safety === "safe") {
    const url = new URL(declaration.endpoint);
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    normalized = url.toString();
    originKey = await sha256(url.origin);
  }
  return {
    protocol: classification.validationProtocol ?? "web",
    declaredProtocol: classification.declaredProtocol,
    role: classification.role,
    validationProtocol: classification.validationProtocol,
    externalKind: classification.externalKind,
    eligibility: classification.eligibility,
    safety: classification.safety,
    safetyReason: classification.safetyReason,
    endpoint: normalized,
    endpointKey: await sha256(`${classification.declaredProtocol}\n${normalized}`),
    originKey,
    rawServiceLabel: declaration.rawProtocol ?? null,
    rawSource: declaration.source ?? null,
    rawSourceIndex: declaration.sourceIndex ?? null,
  };
}

/**
 * Curated inventory facts that the ingest writes onto the agent row. They are
 * part of the metadata version so a manifest change (a new marketplace-operated
 * seller, a category assignment) re-ingests the agent instead of leaving the
 * row stale until upstream metadata happens to change. Agents outside the
 * manifest keep the historical version string.
 */
export function curatedInventoryFingerprint(agent: Pick<CatalogAgent, "agentId" | "chainId">): {
  operator: "third_party" | "marketplace";
  categories: string[];
} | null {
  if (agent.chainId !== 56) return null;
  const entry = CURATED_INVENTORY.entries.find((candidate) => candidate.agentId === agent.agentId);
  return entry ? { operator: entry.operator, categories: entry.categories.map(({ category }) => category) } : null;
}

export async function catalogMetadataVersion(agent: CatalogAgent): Promise<string> {
  const curated = curatedInventoryFingerprint(agent);
  return sha256(JSON.stringify({
    owner: agent.owner,
    metadataUri: agent.metadataUri,
    blockNumber: agent.blockNumber,
    registeredAt: agent.registeredAt,
    metadataUpdatedAt: agent.metadataUpdatedAt,
    name: agent.name,
    description: agent.description ?? null,
    imageUrl: agent.imageUrl ?? null,
    endpoints: agent.indexEndpoints ?? [],
    ...(curated ? { curated } : {}),
  }));
}
