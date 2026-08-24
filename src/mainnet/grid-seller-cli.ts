import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentEndpoint, ERC8004Agent } from "@bnbagent/sdk/erc8004";
import { resolveNetwork } from "@bnbagent/sdk";
import { EVMWalletProvider } from "@bnbagent/sdk/wallets";
import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { fetchAgentCard } from "../a2a.js";
import { createSafeEndpointTransport } from "../verification/safe-http.js";
import { ERC8183_MAINNET } from "./contracts.js";
import { loadMainnetGridSellerConfig } from "./grid-seller-config.js";
import type { MainnetGoNoGoReport } from "./go-no-go.js";

async function assertRecentGo(): Promise<MainnetGoNoGoReport> {
  const path = resolve(".marketplace/mainnet/go-no-go.json");
  const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<MainnetGoNoGoReport>;
  if (parsed.schemaVersion !== 1 || parsed.status !== "go" || !parsed.generatedAt) {
    throw new Error("A successful mainnet:go-no-go report is required");
  }
  if (Date.now() - Date.parse(parsed.generatedAt) > 15 * 60_000) {
    throw new Error("The mainnet:go-no-go report is older than 15 minutes");
  }
  return parsed as MainnetGoNoGoReport;
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  if (process.argv[2] !== "register" || process.argv.some((arg, index) => index > 2 && arg !== "--execute")) {
    throw new Error("Expected command: register [--execute]");
  }
  const decision = await assertRecentGo();
  const config = loadMainnetGridSellerConfig(process.env, { requireAgentId: false });
  if (config.agentId !== null) throw new Error("The Mainnet Grid seller already has a configured Agent ID");
  const transport = await createSafeEndpointTransport(config.origin, { timeoutMs: 20_000, maxResponseBytes: 64 * 1024 });
  const card = await (async () => {
    try { return await fetchAgentCard(config.endpoint, null, transport.fetch); }
    finally { await transport.close(); }
  })();
  if (card.url !== `${config.origin}/api/sellers/grid/a2a`) {
    throw new Error("The public Grid Agent Card does not match the fixed message route");
  }
  const wallet = new EVMWalletProvider({ password: "in-memory-only", privateKey: config.privateKey, persist: false });
  const identity = await ERC8004Agent.create({ walletProvider: wallet, network: resolveNetwork("bsc-mainnet") });
  const agentUri = identity.generateAgentUri({
    name: "marketplace-operated-grid-planner",
    description: "Marketplace-operated deterministic Grid planning seller. No trading, custody or financial execution. Not an official BNB reference agent.",
    endpoints: [AgentEndpoint.a2a(config.endpoint, { version: "0.3.0" })],
  });
  const publicClient = createPublicClient({ chain: bsc, transport: http(ERC8183_MAINNET.rpcUrl) });
  await publicClient.simulateContract({
    account: config.address,
    address: ERC8183_MAINNET.registry,
    abi: parseAbi(["function register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)"]),
    functionName: "register",
    args: [agentUri, []],
  });
  const summary = {
    execute,
    chainId: 56,
    seller: config.address,
    endpoint: config.endpoint,
    registry: ERC8183_MAINNET.registry,
    goNoGoBlock: decision.blockNumber,
    registrationSimulation: "passed",
  };
  if (!execute) {
    process.stdout.write(`${JSON.stringify({ ...summary, status: "DRY_RUN_NO_TRANSACTION" })}\n`);
    return;
  }
  const result = await identity.registerAgent(agentUri);
  if (result.agentId === null) throw new Error("Registration completed without a recoverable Agent ID");
  process.stdout.write(`${JSON.stringify({ ...summary, status: "REGISTERED", agentId: result.agentId, transactionHash: result.transactionHash })}\n`);
}

main().catch(() => {
  process.stderr.write("Mainnet Grid seller registration failed; no secret details were emitted.\n");
  process.exitCode = 1;
});
