import { getAddress, isAddress, isAddressEqual } from "viem";
import { buildBscCandidateInventory } from "../trust8004/inventory.ts";
import type { Trust8004Provider } from "../trust8004/provider.ts";
import type { BscCandidateInventory, MarketplaceAgent, MarketplaceCategory } from "../trust8004/types.ts";
import type { BscIdentityReader } from "./onchain.ts";
import { verifyMcpEndpoint, type McpVerifierOptions } from "./mcp.ts";
import { createProbeBudget, type ProbeBudget } from "./probe-budget.ts";
import type {
  AgentVerification,
  BscVerificationReport,
  IdentityVerification,
  McpEndpointVerification,
  VerificationError,
  WalletAttribution,
} from "./types.ts";

export interface BuildVerificationReportOptions {
  provider: Trust8004Provider;
  identityReader: BscIdentityReader;
  inventory?: BscCandidateInventory;
  verifyMcp?: typeof verifyMcpEndpoint;
  mcpOptions?: McpVerifierOptions;
  probeBudget?: ProbeBudget;
  maxMcpEndpointsPerAgent?: number;
  now?: () => number;
}

function curatedCategories(
  inventory: BscCandidateInventory,
  agentId: string,
): MarketplaceCategory[] {
  return (Object.keys(inventory.categories) as MarketplaceCategory[])
    .filter((category) => inventory.categories[category].agentIds.includes(agentId));
}

function sanitizedError(error: unknown, code: string): VerificationError {
  const candidate = error && typeof error === "object" && "shortMessage" in error
    ? String((error as { shortMessage: unknown }).shortMessage)
    : error instanceof Error
      ? error.message
      : String(error);
  const message = candidate
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
    .replace(/(bearer|token|password|secret)=?\s*[^\s]+/gi, "$1=[redacted]")
    .slice(0, 300);
  return { code, message: message || "Verification failed." };
}

function ownerMatches(declared: string, onchain: string): boolean {
  return isAddress(declared) && getAddress(declared) === getAddress(onchain);
}

async function verifyIdentity(
  agent: MarketplaceAgent,
  identityReader: BscIdentityReader,
  blockNumber: bigint,
  observedAt: string,
): Promise<IdentityVerification> {
  try {
    const onchain = await identityReader.readIdentity(agent.agentId, blockNumber);
    const checks = {
      ownerMatches: ownerMatches(agent.owner, onchain.owner),
      metadataUriMatches: agent.metadataUri === onchain.metadataUri,
    };
    return {
      status: checks.ownerMatches && checks.metadataUriMatches ? "match" : "mismatch",
      declared: {
        owner: agent.owner,
        metadataUri: agent.metadataUri,
        provenance: "declared:trust8004-public-api",
      },
      onchain: {
        owner: onchain.owner,
        agentWallet: onchain.agentWallet,
        metadataUri: onchain.metadataUri,
        registryAddress: identityReader.registryAddress,
        blockNumber: blockNumber.toString(),
        provenance: "onchain:bsc-rpc",
      },
      checks,
      observedAt,
      error: null,
    };
  } catch (error) {
    return {
      status: "read_error",
      declared: {
        owner: agent.owner,
        metadataUri: agent.metadataUri,
        provenance: "declared:trust8004-public-api",
      },
      onchain: {
        owner: null,
        agentWallet: null,
        metadataUri: null,
        registryAddress: identityReader.registryAddress,
        blockNumber: blockNumber.toString(),
        provenance: "onchain:bsc-rpc",
      },
      checks: { ownerMatches: null, metadataUriMatches: null },
      observedAt,
      error: sanitizedError(error, "ONCHAIN_IDENTITY_READ_FAILED"),
    };
  }
}

function mcpTargets(agent: MarketplaceAgent): Array<{ endpoint: string; tools: string[] }> {
  const targets = new Map<string, Set<string>>();
  const declarations = [
    ...agent.services.map(({ name, endpoint, tools }) => ({ name, endpoint, tools })),
    ...agent.endpoints.map(({ name, endpoint }) => ({ name, endpoint, tools: [] as string[] })),
  ];
  for (const declaration of declarations) {
    if (
      !declaration.endpoint
      || !declaration.name
      || declaration.name.toLowerCase().replace(/[^a-z0-9]/g, "") !== "mcp"
    ) continue;
    const tools = targets.get(declaration.endpoint) ?? new Set<string>();
    for (const tool of declaration.tools) tools.add(tool);
    targets.set(declaration.endpoint, tools);
  }
  return [...targets].map(([endpoint, tools]) => ({ endpoint, tools: [...tools] }));
}

function hasToolDrift(endpoint: McpEndpointVerification): boolean {
  return endpoint.comparison.declaredOnly.length > 0 || endpoint.comparison.observedOnly.length > 0;
}

function walletAttribution(
  agent: AgentVerification,
  walletGroups: ReadonlyMap<string, string[]>,
): WalletAttribution {
  const owner = agent.identity.onchain.owner;
  const wallet = agent.identity.onchain.agentWallet;
  if (!owner || !wallet || !isAddressEqual(owner, wallet)) {
    return {
      status: "not_checked",
      candidateCount: 0,
      candidateAgentIds: [],
      provenance: "derived:marketplace-readiness",
    };
  }
  const candidateAgentIds = walletGroups.get(wallet.toLowerCase()) ?? [agent.agentId];
  return {
    status: candidateAgentIds.length > 1 ? "ambiguous" : "unique",
    candidateCount: candidateAgentIds.length,
    candidateAgentIds: [...candidateAgentIds],
    provenance: "derived:marketplace-readiness",
  };
}

function notProbedMcp(
  endpoint: string,
  declaredTools: string[],
  code: "MCP_ENDPOINT_LIMIT_REACHED" | "MCP_PROBE_BUDGET_EXHAUSTED",
): McpEndpointVerification {
  return {
    status: "not_probed",
    endpoint,
    protocol: "mcp",
    declaredTools: [...new Set(declaredTools)].sort(),
    observedTools: [],
    comparison: { matched: [], declaredOnly: [], observedOnly: [] },
    negotiatedProtocolVersion: null,
    serverInfo: null,
    latencyMs: null,
    observedAt: null,
    provenance: "declared:trust8004-public-api+derived:probe-budget",
    error: {
      code,
      message: code === "MCP_ENDPOINT_LIMIT_REACHED"
        ? "The endpoint was not probed because the per-agent MCP limit was reached."
        : "The endpoint was not probed because the shared execution budget was exhausted.",
    },
  };
}

export async function buildBscVerificationReport(
  options: BuildVerificationReportOptions,
): Promise<BscVerificationReport> {
  const now = options.now ?? Date.now;
  const verifyMcp = options.verifyMcp ?? verifyMcpEndpoint;
  const inventory = options.inventory ?? await buildBscCandidateInventory(options.provider, now);
  const probeBudget = options.probeBudget ?? createProbeBudget({
    maxMcpEndpoints: 24,
    maxSellerEndpoints: 0,
    maxTotalEndpoints: 24,
    maxTotalDurationMs: 180_000,
    ...(options.mcpOptions?.monotonicNow ? { monotonicNow: options.mcpOptions.monotonicNow } : {}),
  });
  const maxMcpEndpointsPerAgent = options.maxMcpEndpointsPerAgent ?? 1;
  await options.identityReader.assertChain();
  const blockNumber = await options.identityReader.getBlockNumber();
  const generatedAt = new Date(now()).toISOString();
  const agents: AgentVerification[] = [];

  for (const agent of inventory.agents) {
    const identity = await verifyIdentity(agent, options.identityReader, blockNumber, generatedAt);
    const mcpEndpoints: McpEndpointVerification[] = [];
    const targets = mcpTargets(agent);
    for (const [index, target] of targets.entries()) {
      if (index >= maxMcpEndpointsPerAgent) {
        mcpEndpoints.push(notProbedMcp(target.endpoint, target.tools, "MCP_ENDPOINT_LIMIT_REACHED"));
        continue;
      }
      const claim = probeBudget.claim("mcp");
      if (!claim.allowed) {
        mcpEndpoints.push(notProbedMcp(target.endpoint, target.tools, "MCP_PROBE_BUDGET_EXHAUSTED"));
        continue;
      }
      mcpEndpoints.push(await verifyMcp(target.endpoint, target.tools, {
        ...options.mcpOptions,
        timeoutMs: Math.max(1, Math.min(options.mcpOptions?.timeoutMs ?? 10_000, claim.remainingMs)),
      }));
    }
    agents.push({
      agentId: agent.agentId,
      name: agent.name,
      categories: curatedCategories(inventory, agent.agentId),
      identity,
      mcpEndpoints,
      hireability: "not_assessed",
    });
  }

  const walletGroups = new Map<string, string[]>();
  for (const agent of agents) {
    const owner = agent.identity.onchain.owner;
    const wallet = agent.identity.onchain.agentWallet;
    if (owner && wallet && isAddressEqual(owner, wallet)) {
      const ids = walletGroups.get(wallet.toLowerCase()) ?? [];
      ids.push(agent.agentId);
      walletGroups.set(wallet.toLowerCase(), ids);
    }
  }
  const attributedAgents = agents.map((agent) => ({
    ...agent,
    identity: {
      ...agent.identity,
      walletAttribution: walletAttribution(agent, walletGroups),
    },
  }));
  const endpoints = attributedAgents.flatMap((agent) => agent.mcpEndpoints);
  const identityMatches = attributedAgents.filter((agent) => agent.identity.status === "match").length;
  const endpointsValid = endpoints.filter((endpoint) => endpoint.status === "protocol_valid").length;
  const endpointsNotProbed = endpoints.filter((endpoint) => endpoint.status === "not_probed").length;
  const agentsWithoutMcpEndpoint = attributedAgents.filter((agent) => agent.mcpEndpoints.length === 0).length;
  const toolDriftEndpoints = endpoints.filter(hasToolDrift).length;
  const identityAttention = attributedAgents.length - identityMatches;
  const endpointAttention = endpoints.length - endpointsValid;
  const walletAmbiguousAgents = attributedAgents.filter(
    (agent) => agent.identity.walletAttribution?.status === "ambiguous",
  ).length;
  const attentionRequired = identityAttention > 0
    || endpointAttention > 0
    || agentsWithoutMcpEndpoint > 0
    || toolDriftEndpoints > 0
    || walletAmbiguousAgents > 0;

  return {
    schemaVersion: 2,
    generatedAt,
    chainId: 56,
    catalog: {
      source: "trust8004",
      coverage: "partial",
      snapshotGeneratedAt: inventory.generatedAt,
    },
    onchain: {
      network: "bsc-mainnet",
      registryAddress: options.identityReader.registryAddress,
      blockNumber: blockNumber.toString(),
    },
    categories: inventory.categories,
    summary: {
      status: attentionRequired ? "attention_required" : "complete",
      agentsTotal: agents.length,
      identityMatches,
      identityAttention,
      endpointsTotal: endpoints.length,
      endpointsValid,
      endpointsNotProbed,
      endpointAttention,
      agentsWithoutMcpEndpoint,
      toolDriftEndpoints,
      walletAmbiguousAgents,
    },
    agents: attributedAgents,
  };
}
