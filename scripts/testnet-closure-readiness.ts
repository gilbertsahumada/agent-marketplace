import { createPublicClient, http, parseAbi } from "viem";
import { bscTestnet } from "viem/chains";
import { ERC8183_TESTNET as deployment } from "../src/data/erc8183/contracts.ts";
import { ERC1967_IMPLEMENTATION_SLOT } from "../src/mainnet/contracts.ts";

// Read-only deployment audit. Never loads private keys or sends transactions.
const client = createPublicClient({ chain: bscTestnet, transport: http(deployment.rpcUrl, { timeout: 10_000, retryCount: 0 }) });
const abi = parseAbi([
  "function paymentToken() view returns (address)",
  "function policyWhitelist(address) view returns (bool)",
  "function disputeWindow() view returns (uint256)",
  "function tokenURI(uint256) view returns (string)",
  "function getAgentWallet(uint256) view returns (address)",
]);
async function run() {
  const chainId = await client.getChainId();
  if (chainId !== 97) throw new Error("Expected Testnet chain 97; refusing to continue");
  const blockNumber = await client.getBlockNumber();
  const contracts = await Promise.all((["commerce", "router", "policy", "token"] as const).map(async name => {
    const address = deployment[name];
    const code = await client.getCode({ address, blockNumber });
    return { name, address, hasCode: !!code && code !== "0x" };
  }));
  const implementations = await Promise.all((["commerce", "router"] as const).map(async name => ({
    name, storage: await client.getStorageAt({ address: deployment[name], slot: ERC1967_IMPLEMENTATION_SLOT, blockNumber }),
  })));
  const policyAllowed = await client.readContract({ address: deployment.router, abi, functionName: "policyWhitelist", args: [deployment.policy], blockNumber });
  const disputeWindow = await client.readContract({ address: deployment.policy, abi, functionName: "disputeWindow", blockNumber });
  const paymentToken = await client.readContract({ address: deployment.commerce, abi, functionName: "paymentToken", blockNumber });
  const agentWallet = await client.readContract({ address: deployment.registry, abi, functionName: "getAgentWallet", args: [BigInt(deployment.agentId)], blockNumber });
  const agentUri = await client.readContract({ address: deployment.registry, abi, functionName: "tokenURI", args: [BigInt(deployment.agentId)], blockNumber });
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), chainId, blockNumber: String(blockNumber), contracts, implementations, policyAllowed, paymentToken, tokenMatches: paymentToken.toLowerCase() === deployment.token.toLowerCase(), disputeWindowSeconds: String(disputeWindow), configuredAgentId: deployment.agentId, agentWallet, sellerMatches: agentWallet.toLowerCase() === deployment.seller.toLowerCase(), agentUri, writesEnabled: false }, null, 2));
}
run().catch(error => {
  console.error(JSON.stringify({ ready: false, reason: error instanceof Error ? error.message.split("\n")[0] : "Read failed", writesEnabled: false }));
  process.exitCode = 1;
});
