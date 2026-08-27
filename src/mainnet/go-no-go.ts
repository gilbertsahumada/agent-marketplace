import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { bsc } from "viem/chains";
import { fetchAgentCard } from "../a2a.ts";
import { hasErc8183SellerSkills } from "../erc8183/skills.ts";
import { createSafeEndpointTransport } from "../verification/safe-http.ts";
import { ERC1967_IMPLEMENTATION_SLOT, ERC8183_MAINNET } from "./contracts.ts";

const commerceAbi = parseAbi(["function paymentToken() view returns (address)"]);
const routerAbi = parseAbi(["function policyWhitelist(address) view returns (bool)"]);
const policyAbi = parseAbi([
  "function commerce() view returns (address)",
  "function router() view returns (address)",
  "function disputeWindow() view returns (uint64)",
  "function voteQuorum() view returns (uint16)",
  "function activeVoterCount() view returns (uint16)",
  "function admin() view returns (address)",
]);
const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export interface MainnetGoNoGoReport {
  schemaVersion: 1;
  generatedAt: string;
  status: "go" | "no_go";
  chainId: 56;
  blockNumber: string;
  spendCeilingRaw: string;
  checks: Record<string, {
    passed: boolean;
    expected: string;
    observed: string;
    provenance: "configured:official-apex" | "onchain:bsc-rpc" | "operator:public-config" | "observed:https-dns-pinned";
  }>;
  reasons: string[];
  warnings: string[];
}

function implementationAddress(value: `0x${string}` | undefined): Address | null {
  if (!value || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) return null;
  return getAddress(`0x${value.slice(-40)}`);
}

function check(
  passed: boolean,
  expected: unknown,
  observed: unknown,
  provenance: MainnetGoNoGoReport["checks"][string]["provenance"],
) {
  return { passed, expected: String(expected), observed: String(observed), provenance };
}

export function createMainnetReadClient(): PublicClient {
  return createPublicClient({
    chain: bsc,
    transport: http(ERC8183_MAINNET.rpcUrl, { timeout: 20_000 }),
  });
}

async function probeProductionSeller(origin: string): Promise<boolean> {
  const endpoint = `${origin}/grid`;
  let transport: Awaited<ReturnType<typeof createSafeEndpointTransport>> | null = null;
  try {
    transport = await createSafeEndpointTransport(endpoint, {
      timeoutMs: 20_000,
      maxResponseBytes: 64 * 1024,
    });
    const card = await fetchAgentCard(endpoint, null, transport.fetch);
    return card.name === "marketplace-operated-grid-planner"
      && card.url === `${origin}/api/sellers/grid/a2a`
      && hasErc8183SellerSkills(card.skills);
  } catch {
    return false;
  } finally {
    await transport?.close();
  }
}

export async function evaluateMainnetGoNoGo(options: {
  client?: PublicClient;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  sellerEndpointProbe?: (origin: string) => Promise<boolean>;
} = {}): Promise<MainnetGoNoGoReport> {
  const client = options.client ?? createMainnetReadClient();
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const sellerEndpointProbe = options.sellerEndpointProbe ?? probeProductionSeller;
  const sellerAddressRaw = Reflect.get(env, "ERC8183_MAINNET_SELLER_ADDRESS")?.trim() ?? "";
  const sellerAddress = isAddress(sellerAddressRaw) ? getAddress(sellerAddressRaw) : null;
  const sellerOriginRaw = Reflect.get(env, "ERC8183_MAINNET_SELLER_ORIGIN")?.trim() ?? "";
  let sellerOrigin: string | null = null;
  try {
    const url = new URL(sellerOriginRaw);
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/") {
      sellerOrigin = url.origin;
    }
  } catch {
    sellerOrigin = null;
  }
  const blockNumber = await client.getBlockNumber();
  const addresses = {
    registry: ERC8183_MAINNET.registry,
    commerce: ERC8183_MAINNET.commerce,
    router: ERC8183_MAINNET.router,
    policy: ERC8183_MAINNET.policy,
    token: ERC8183_MAINNET.token,
  };
  const [chainId, codeEntries, commerceStorage, routerStorage, paymentToken, policyAllowed, policyCommerce, policyRouter, disputeWindow, voteQuorum, activeVoterCount, policyAdmin, symbol, decimals, sellerGasBalance, sellerEndpointReachable] = await Promise.all([
    client.getChainId(),
    Promise.all(Object.entries(addresses).map(async ([name, address]) => [name, await client.getCode({ address, blockNumber })] as const)),
    client.getStorageAt({ address: ERC8183_MAINNET.commerce, slot: ERC1967_IMPLEMENTATION_SLOT, blockNumber }),
    client.getStorageAt({ address: ERC8183_MAINNET.router, slot: ERC1967_IMPLEMENTATION_SLOT, blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.commerce, abi: commerceAbi, functionName: "paymentToken", blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.router, abi: routerAbi, functionName: "policyWhitelist", args: [ERC8183_MAINNET.policy], blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.policy, abi: policyAbi, functionName: "commerce", blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.policy, abi: policyAbi, functionName: "router", blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.policy, abi: policyAbi, functionName: "disputeWindow", blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.policy, abi: policyAbi, functionName: "voteQuorum", blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.policy, abi: policyAbi, functionName: "activeVoterCount", blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.policy, abi: policyAbi, functionName: "admin", blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.token, abi: tokenAbi, functionName: "symbol", blockNumber }),
    client.readContract({ address: ERC8183_MAINNET.token, abi: tokenAbi, functionName: "decimals", blockNumber }),
    sellerAddress ? client.getBalance({ address: sellerAddress, blockNumber }) : Promise.resolve(null),
    sellerOrigin === "https://bnb-agent-marketplace-ruby.vercel.app"
      ? sellerEndpointProbe(sellerOrigin)
      : Promise.resolve(false),
  ]);
  const commerceImplementation = implementationAddress(commerceStorage);
  const routerImplementation = implementationAddress(routerStorage);
  const checks: MainnetGoNoGoReport["checks"] = {
    chain: check(chainId === 56, 56, chainId, "onchain:bsc-rpc"),
    bytecode: check(codeEntries.every(([, code]) => Boolean(code && code !== "0x")), "code at all five allowlisted addresses", codeEntries.filter(([, code]) => !code || code === "0x").map(([name]) => name).join(",") || "present", "onchain:bsc-rpc"),
    commerceImplementation: check(Boolean(commerceImplementation && isAddressEqual(commerceImplementation, ERC8183_MAINNET.commerceImplementation)), ERC8183_MAINNET.commerceImplementation, commerceImplementation ?? "unavailable", "onchain:bsc-rpc"),
    routerImplementation: check(Boolean(routerImplementation && isAddressEqual(routerImplementation, ERC8183_MAINNET.routerImplementation)), ERC8183_MAINNET.routerImplementation, routerImplementation ?? "unavailable", "onchain:bsc-rpc"),
    paymentToken: check(isAddressEqual(paymentToken, ERC8183_MAINNET.token), ERC8183_MAINNET.token, paymentToken, "onchain:bsc-rpc"),
    policyAllowlisted: check(policyAllowed, true, policyAllowed, "onchain:bsc-rpc"),
    policyCommerce: check(isAddressEqual(policyCommerce, ERC8183_MAINNET.commerce), ERC8183_MAINNET.commerce, policyCommerce, "onchain:bsc-rpc"),
    policyRouter: check(isAddressEqual(policyRouter, ERC8183_MAINNET.router), ERC8183_MAINNET.router, policyRouter, "onchain:bsc-rpc"),
    disputeWindow: check(disputeWindow > 0n, "positive seconds", disputeWindow, "onchain:bsc-rpc"),
    voteQuorum: check(voteQuorum > 0, "positive quorum", voteQuorum, "onchain:bsc-rpc"),
    activeVoters: check(activeVoterCount >= voteQuorum, `at least quorum (${voteQuorum})`, activeVoterCount, "onchain:bsc-rpc"),
    policyAdmin: check(!/^0x0{40}$/i.test(policyAdmin), "non-zero operational admin", policyAdmin, "onchain:bsc-rpc"),
    tokenSymbol: check(symbol === "U", "U", symbol, "onchain:bsc-rpc"),
    tokenDecimals: check(decimals === 18, 18, decimals, "onchain:bsc-rpc"),
    spendCeiling: check(ERC8183_MAINNET.maximumDemoBudgetRaw === 10_000_000_000_000_000n, "0.01 U", ERC8183_MAINNET.maximumDemoBudgetRaw, "configured:official-apex"),
    dedicatedSellerAddress: check(Boolean(sellerAddress), "dedicated Mainnet seller public address", sellerAddress ?? "not configured", "operator:public-config"),
    sellerGasBalance: check(sellerGasBalance !== null && sellerGasBalance >= 2_000_000_000_000_000n, "at least 0.002 BNB", sellerGasBalance ?? "unavailable", "onchain:bsc-rpc"),
    productionSellerOrigin: check(sellerOrigin === "https://bnb-agent-marketplace-ruby.vercel.app", "https://bnb-agent-marketplace-ruby.vercel.app", sellerOrigin ?? "not configured", "operator:public-config"),
    productionSellerEndpoint: check(sellerEndpointReachable, "DNS-pinned production Agent Card with Grid negotiation and notify skills", sellerEndpointReachable ? "reachable and matched" : "unavailable or mismatched", "observed:https-dns-pinned"),
  };
  const reasons = Object.entries(checks).filter(([, value]) => !value.passed).map(([name]) => name);
  const warnings = activeVoterCount < voteQuorum * 3
    ? [`Active voter count ${activeVoterCount} is below the APEX operational recommendation of 3x quorum (${voteQuorum * 3}).`]
    : [];
  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    status: reasons.length === 0 ? "go" : "no_go",
    chainId: 56,
    blockNumber: blockNumber.toString(),
    spendCeilingRaw: ERC8183_MAINNET.maximumDemoBudgetRaw.toString(),
    checks,
    reasons,
    warnings,
  };
}
