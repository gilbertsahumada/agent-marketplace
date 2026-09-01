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

export async function catalogMetadataVersion(agent: CatalogAgent): Promise<string> {
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
  }));
}
