import {
  createPublicClient,
  custom,
  getAddress,
  isAddress,
  isAddressEqual,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { bsc } from "viem/chains";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_BLOCK_AGE_SECONDS = 120;
const MAX_RPC_RESPONSE_BYTES = 64 * 1_024;
const READ_ONLY_RPC_METHODS = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_call",
  "eth_getCode",
]);

export const BSC_REGISTRY = getAddress("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
export const BSC_COMMERCE = getAddress("0xEa4DAa3100A767e86FDed867729ae7446476EBA6");
export const BSC_ROUTER = getAddress("0x51895229E12F9876011789B04f8698af06cCD6DA");
export const BSC_POLICY = getAddress("0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5");
export const BSC_PAYMENT_TOKEN = getAddress("0xcE24439F2D9C6a2289F741120FE202248B666666");

const registryAbi = parseAbi([
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);
const commerceAbi = parseAbi(["function paymentToken() view returns (address)"]);
const routerAbi = parseAbi(["function policyWhitelist(address policy) view returns (bool)"]);
const tokenAbi = parseAbi(["function decimals() view returns (uint8)"]);

export class BscProbeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BscProbeError";
  }
}

export interface CountedBscClientInput {
  readonly rpcUrl: string;
  readonly fetch: typeof fetch;
  readonly deadlineMs: number;
  readonly now: () => number;
}

export function createCountedBscClient(input: CountedBscClientInput): PublicClient {
  const rpcUrl = parseRpcUrl(input.rpcUrl);
  let id = 0;
  return createPublicClient({
    chain: bsc,
    transport: custom({
      request: async ({ method, params }) => {
        if (!READ_ONLY_RPC_METHODS.has(method)) throw new BscProbeError("BSC_RPC_METHOD");
        const remainingMs = Math.floor(input.deadlineMs - input.now());
        if (remainingMs <= 0) throw new BscProbeError("BSC_RPC_TIMEOUT");
        let response: Response;
        try {
          response = await input.fetch(rpcUrl, {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            redirect: "manual",
            signal: AbortSignal.timeout(remainingMs),
            body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
          });
        } catch {
          throw new BscProbeError("BSC_RPC_UNREACHABLE");
        }
        if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
          throw new BscProbeError("BSC_RPC_REDIRECT");
        }
        if (!response.ok) throw new BscProbeError("BSC_RPC_HTTP");
        const reply = await readRpcReply(response);
        if (reply.error !== undefined || !("result" in reply)) {
          throw new BscProbeError("BSC_RPC_RESPONSE");
        }
        return reply.result;
      },
    }, { retryCount: 0 }),
  });
}

interface ProbeChainReader {
  getChainId(): Promise<number>;
  getBlock(): Promise<{ number: bigint | null; timestamp: bigint }>;
  multicall(input: {
    contracts: readonly unknown[];
    blockNumber: bigint;
    allowFailure: false;
  }): Promise<readonly unknown[]>;
}

export interface ProbeChainContext {
  readonly provider: Address;
  readonly walletSource: "agentWallet" | "ownerOf";
  readonly blockNumber: bigint;
  readonly blockTimestamp: bigint;
  readonly commerce: Address;
  readonly router: Address;
  readonly policy: Address;
  readonly paymentToken: Address;
  readonly tokenDecimals: number;
  readonly policyAllowlisted: true;
}

export async function readProbeChainContext(
  client: ProbeChainReader,
  input: { readonly agentId: string; readonly nowSeconds: number },
): Promise<ProbeChainContext> {
  if (!/^[1-9]\d*$/.test(input.agentId)) throw new BscProbeError("BSC_AGENT_ID");
  if (await client.getChainId() !== 56) throw new BscProbeError("BSC_CHAIN_ID");
  const block = await client.getBlock();
  if (block.number === null) throw new BscProbeError("BSC_BLOCK");
  const age = BigInt(input.nowSeconds) - block.timestamp;
  if (age < 0n || age > BigInt(MAX_BLOCK_AGE_SECONDS)) throw new BscProbeError("BSC_BLOCK_FRESHNESS");
  const agentId = BigInt(input.agentId);
  const contracts = [
    { address: BSC_REGISTRY, abi: registryAbi, functionName: "getAgentWallet", args: [agentId] },
    { address: BSC_REGISTRY, abi: registryAbi, functionName: "ownerOf", args: [agentId] },
    { address: BSC_COMMERCE, abi: commerceAbi, functionName: "paymentToken" },
    { address: BSC_ROUTER, abi: routerAbi, functionName: "policyWhitelist", args: [BSC_POLICY] },
    { address: BSC_PAYMENT_TOKEN, abi: tokenAbi, functionName: "decimals" },
  ] as const;
  let values: readonly unknown[];
  try {
    values = await client.multicall({ contracts, blockNumber: block.number, allowFailure: false });
  } catch {
    throw new BscProbeError("BSC_READS");
  }
  const [agentWallet, owner, paymentToken, policyAllowlisted, tokenDecimals] = values;
  if (typeof agentWallet !== "string" || typeof owner !== "string") {
    throw new BscProbeError("BSC_IDENTITY");
  }
  const normalizedAgentWallet = getAddress(agentWallet);
  const normalizedOwner = getAddress(owner);
  const useOwner = isAddressEqual(normalizedAgentWallet, ZERO_ADDRESS);
  if (useOwner && isAddressEqual(normalizedOwner, ZERO_ADDRESS)) throw new BscProbeError("BSC_IDENTITY");
  if (
    typeof paymentToken !== "string"
    || !isAddress(paymentToken)
    || !isAddressEqual(paymentToken, BSC_PAYMENT_TOKEN)
  ) {
    throw new BscProbeError("BSC_PAYMENT_TOKEN");
  }
  if (policyAllowlisted !== true) throw new BscProbeError("BSC_POLICY");
  if (tokenDecimals !== 18) throw new BscProbeError("BSC_TOKEN_DECIMALS");
  return {
    provider: useOwner ? normalizedOwner : normalizedAgentWallet,
    walletSource: useOwner ? "ownerOf" : "agentWallet",
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    commerce: BSC_COMMERCE,
    router: BSC_ROUTER,
    policy: BSC_POLICY,
    paymentToken: BSC_PAYMENT_TOKEN,
    tokenDecimals: 18,
    policyAllowlisted: true,
  };
}

function parseRpcUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BscProbeError("BSC_RPC_URL");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.hash !== ""
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
  ) throw new BscProbeError("BSC_RPC_URL");
  return url;
}

async function readRpcReply(response: Response): Promise<Record<string, unknown>> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new BscProbeError("BSC_RPC_RESPONSE");
  }
  if (!response.body) throw new BscProbeError("BSC_RPC_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RPC_RESPONSE_BYTES) {
        await reader.cancel();
        throw new BscProbeError("BSC_RPC_RESPONSE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new BscProbeError("BSC_RPC_RESPONSE");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BscProbeError) throw error;
    throw new BscProbeError("BSC_RPC_RESPONSE");
  }
}
