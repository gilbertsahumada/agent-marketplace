import { ERC8004Agent } from "@bnbagent/sdk/erc8004";
import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { TESTNET_CHAIN_ID } from "./config.ts";

export const TESTNET_REGISTRY = getAddress(
  "0x8004A818BFB912233c491871b3d84c89A494BD9e",
);

const identityReadAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export interface ResolvedIdentity {
  agentId: number;
  owner: Address;
  agentWallet: Address;
  agentUri: string;
  a2aEndpoint: string;
  metadata: Record<string, unknown>;
}

export function createChainReader(rpcUrl?: string): PublicClient {
  return createPublicClient({ transport: http(rpcUrl) });
}

export function extractA2aEndpoint(
  metadata: Record<string, unknown>,
): string {
  const services = metadata.services;
  if (!Array.isArray(services)) {
    throw new Error("ERC-8004 metadata has no services array");
  }
  const endpoints = services
    .filter(
      (service): service is { name: string; endpoint: string } =>
        typeof service === "object" &&
        service !== null &&
        "name" in service &&
        "endpoint" in service &&
        String(service.name).toUpperCase() === "A2A" &&
        typeof service.endpoint === "string",
    )
    .map((service) => service.endpoint);
  if (endpoints.length !== 1) {
    throw new Error(`Expected exactly one A2A endpoint, found ${endpoints.length}`);
  }
  const url = new URL(endpoints[0]!);
  if (url.protocol !== "https:") {
    throw new Error("The registered A2A endpoint must use HTTPS");
  }
  return url.toString();
}

export async function resolveIdentity(
  client: PublicClient,
  agentId: number,
  options: { chainId?: number; registry?: Address; blockNumber?: bigint } = {},
): Promise<ResolvedIdentity> {
  const chainId = await client.getChainId();
  const expectedChainId = options.chainId ?? TESTNET_CHAIN_ID;
  const registry = options.registry ?? TESTNET_REGISTRY;
  if (chainId !== expectedChainId) {
    throw new Error(`RPC chain mismatch: expected ${expectedChainId}, received ${chainId}`);
  }
  const id = BigInt(agentId);
  const historicalBlock = options.blockNumber === undefined
    ? {}
    : { blockNumber: options.blockNumber };
  const [owner, agentWallet, agentUri] = await Promise.all([
    client.readContract({
      address: registry,
      abi: identityReadAbi,
      functionName: "ownerOf",
      args: [id],
      ...historicalBlock,
    }),
    client.readContract({
      address: registry,
      abi: identityReadAbi,
      functionName: "getAgentWallet",
      args: [id],
      ...historicalBlock,
    }),
    client.readContract({
      address: registry,
      abi: identityReadAbi,
      functionName: "tokenURI",
      args: [id],
      ...historicalBlock,
    }),
  ]);
  const metadata = await ERC8004Agent.parseAgentUri(agentUri);
  if (!metadata) throw new Error("Unable to parse the registered agent URI");
  return {
    agentId,
    owner,
    agentWallet,
    agentUri,
    a2aEndpoint: extractA2aEndpoint(metadata),
    metadata,
  };
}
