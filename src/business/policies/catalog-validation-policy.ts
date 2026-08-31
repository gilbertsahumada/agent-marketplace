import type { MarketplaceAgent } from "../entities/marketplace-agent.ts";
import type { BrowserValidationTarget } from "../../verification/browser-endpoint-validation.ts";

function protocol(name: string | null): BrowserValidationTarget["protocol"] {
  if (!name) return "web";
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "a2a") return "a2a";
  if (normalized === "mcp") return "mcp";
  if (normalized === "erc8183") return "erc8183_http";
  return "web";
}

export function declaredBrowserValidationTargets(
  agent: Pick<MarketplaceAgent, "services" | "endpoints">,
): BrowserValidationTarget[] {
  const declarations = [
    ...agent.services.map(({ name, endpoint }) => ({ name, endpoint })),
    ...agent.endpoints,
  ];
  const unique = new Map<string, BrowserValidationTarget>();
  for (const declaration of declarations) {
    if (!declaration.endpoint?.trim()) continue;
    const target = { protocol: protocol(declaration.name), endpoint: declaration.endpoint.trim() };
    unique.set(`${target.protocol}\u0000${target.endpoint}`, target);
  }
  return [...unique.values()];
}
