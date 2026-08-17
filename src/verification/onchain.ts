import { resolveNetwork } from "@bnbagent/sdk";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Address,
  type PublicClient,
} from "viem";
import type { OnchainIdentity } from "./types.js";

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

export interface BscIdentityReader {
  readonly registryAddress: Address;
  assertChain(): Promise<void>;
  getBlockNumber(): Promise<bigint>;
  readIdentity(agentId: string, blockNumber: bigint): Promise<OnchainIdentity>;
}

export class ViemBscIdentityReader implements BscIdentityReader {
  readonly registryAddress: Address;

  constructor(private readonly client: PublicClient, registryAddress: string) {
    this.registryAddress = getAddress(registryAddress);
  }

  async assertChain(): Promise<void> {
    const chainId = await this.client.getChainId();
    if (chainId !== 56) throw new Error(`RPC chain mismatch: expected 56, received ${chainId}`);
  }

  getBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async readIdentity(agentId: string, blockNumber: bigint): Promise<OnchainIdentity> {
    if (!/^\d+$/.test(agentId)) throw new Error(`agentId must be numeric: ${agentId}`);
    const tokenId = BigInt(agentId);
    const [owner, agentWallet, metadataUri] = await Promise.all([
      this.client.readContract({
        address: this.registryAddress,
        abi: identityReadAbi,
        functionName: "ownerOf",
        args: [tokenId],
        blockNumber,
      }),
      this.client.readContract({
        address: this.registryAddress,
        abi: identityReadAbi,
        functionName: "getAgentWallet",
        args: [tokenId],
        blockNumber,
      }),
      this.client.readContract({
        address: this.registryAddress,
        abi: identityReadAbi,
        functionName: "tokenURI",
        args: [tokenId],
        blockNumber,
      }),
    ]);
    return { owner, agentWallet, metadataUri };
  }
}

export function createBscIdentityReader(): BscIdentityReader {
  const network = resolveNetwork("bsc-mainnet");
  const bsc = defineChain({
    id: 56,
    name: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
    blockExplorers: { default: { name: "BscScan", url: "https://bscscan.com" } },
  });
  const client = createPublicClient({
    chain: bsc,
    transport: http(network.rpcUrl),
  });
  return new ViemBscIdentityReader(client, network.registryContract);
}
