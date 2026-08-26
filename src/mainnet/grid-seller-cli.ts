import { AgentEndpoint, ERC8004Agent } from "@bnbagent/sdk/erc8004";
import { resolveNetwork } from "@bnbagent/sdk";
import { EVMWalletProvider } from "@bnbagent/sdk/wallets";
import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { fetchAgentCard } from "../a2a.ts";
import { createSafeEndpointTransport } from "../verification/safe-http.ts";
import { ERC8183_MAINNET } from "./contracts.ts";
import { loadMainnetGridSellerConfig } from "./grid-seller-config.ts";
import { evaluateMainnetGoNoGo, type MainnetGoNoGoReport } from "./go-no-go.ts";

export function assertRegistrationDecision(
  report: MainnetGoNoGoReport,
  config: { address: string; origin: string },
  now = Date.now(),
): void {
  const generatedAt = Date.parse(report.generatedAt);
  if (report.schemaVersion !== 1 || report.status !== "go" || !Number.isFinite(generatedAt)) {
    throw new Error("A successful mainnet:go-no-go report is required");
  }
  if (generatedAt > now + 60_000 || now - generatedAt > 15 * 60_000) {
    throw new Error("The mainnet:go-no-go report is outside the allowed time window");
  }
  if (
    report.chainId !== ERC8183_MAINNET.chainId ||
    report.spendCeilingRaw !== ERC8183_MAINNET.maximumDemoBudgetRaw.toString() ||
    Object.values(report.checks).some(({ passed }) => !passed) ||
    report.reasons.length > 0 ||
    report.checks.dedicatedSellerAddress?.observed.toLowerCase() !== config.address.toLowerCase() ||
    report.checks.productionSellerOrigin?.observed !== config.origin ||
    report.checks.paymentToken?.observed.toLowerCase() !== ERC8183_MAINNET.token.toLowerCase() ||
    report.checks.policyAllowlisted?.observed !== "true" ||
    report.checks.commerceImplementation?.observed.toLowerCase() !== ERC8183_MAINNET.commerceImplementation.toLowerCase() ||
    report.checks.routerImplementation?.observed.toLowerCase() !== ERC8183_MAINNET.routerImplementation.toLowerCase()
  ) {
    throw new Error("The mainnet:go-no-go result is not bound to the active seller and contract allowlist");
  }
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  if (process.argv[2] !== "register" || process.argv.some((arg, index) => index > 2 && arg !== "--execute")) {
    throw new Error("Expected command: register [--execute]");
  }
  const config = loadMainnetGridSellerConfig(process.env, { requireAgentId: false });
  // Re-read the chain and the fixed production endpoint in this invocation.
  // A previously written or edited local report is never an authority for a write.
  const decision = await evaluateMainnetGoNoGo();
  assertRegistrationDecision(decision, config);
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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(() => {
    process.stderr.write("Mainnet Grid seller registration failed; no secret details were emitted.\n");
    process.exitCode = 1;
  });
}
