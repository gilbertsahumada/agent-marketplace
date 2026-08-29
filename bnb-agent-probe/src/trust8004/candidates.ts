import { isSyntacticallyPublicHttpsUrl } from "./safe-url.ts";
import type { CatalogAgent, LiveTargetCandidate } from "./types.ts";

export interface LiveTargetPolicy {
  curatedAgentIds: ReadonlySet<string>;
  maxEndpointsPerAgent?: number;
}

const A2A_AGENT_CARD_SUFFIX = "/.well-known/agent-card.json";

export function a2aBaseEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (!url.pathname.endsWith(A2A_AGENT_CARD_SUFFIX)) return endpoint;
  const basePath = url.pathname.slice(0, -A2A_AGENT_CARD_SUFFIX.length).replace(/\/+$/, "");
  return `${url.origin}${basePath}`;
}

export function selectLiveTargets(
  agent: CatalogAgent,
  policy: LiveTargetPolicy,
): LiveTargetCandidate[] {
  if (agent.chainId !== 56 || !agent.metadataAvailable) return [];
  if (!agent.declarations.erc8183 && !policy.curatedAgentIds.has(agent.agentId)) return [];
  const maximum = policy.maxEndpointsPerAgent ?? 2;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 2) {
    throw new Error("maxEndpointsPerAgent must be an integer between 0 and 2");
  }
  const seen = new Set<string>();
  const targets: LiveTargetCandidate[] = [];
  for (const declaration of agent.declaredEndpoints) {
    if (!isSyntacticallyPublicHttpsUrl(declaration.endpoint)) continue;
    const endpoint = declaration.transport === "a2a"
      ? a2aBaseEndpoint(declaration.endpoint)
      : declaration.endpoint;
    const key = `${declaration.transport}\u0000${endpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      chainId: 56,
      agentId: agent.agentId,
      transport: declaration.transport,
      endpoint,
    });
    if (targets.length === maximum) break;
  }
  return targets;
}
