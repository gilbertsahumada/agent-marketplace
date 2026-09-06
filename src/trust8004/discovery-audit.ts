import { normalizeCatalogAgent, type CatalogAgentInput } from "./catalog-normalization.ts";

/** Identity counts and endpoint work are deliberately different grains. */
export function discoveryInventory(items: CatalogAgentInput[], chainId: 56 | 97) {
  const agents = items.map(item => {
    if (Number(item.chainId) !== chainId) throw new Error("AUDIT_CHAIN_MISMATCH");
    return normalizeCatalogAgent(item);
  });
  if (new Set(agents.map(agent => agent.agentKey)).size !== agents.length) throw new Error("AUDIT_DUPLICATE_IDENTITY");
  const targets = new Map<string, { endpoint: string; transport: string; agents: string[] }>();
  for (const agent of agents) for (const declaration of agent.declarations) {
    if (declaration.safety !== "safe" || !declaration.url || !["erc8183_http", "a2a", "mcp"].includes(declaration.protocol)) continue;
    const key = `${declaration.protocol}:${declaration.endpointKey}`;
    const target = targets.get(key) ?? { endpoint: declaration.url, transport: declaration.protocol, agents: [] };
    if (!target.agents.includes(agent.agentId)) target.agents.push(agent.agentId);
    targets.set(key, target);
  }
  return { chainId, registered: agents.length, withDeclarations: agents.filter(agent => agent.declarations.length).length,
    safeOperationalAgents: new Set([...targets.values()].flatMap(target => target.agents)).size,
    targets: [...targets.values()].sort((a, b) => Number(b.transport === "erc8183_http") - Number(a.transport === "erc8183_http")),
  };
}
