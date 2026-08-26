import { pathToFileURL } from "node:url";
import { AgentEndpoint, ERC8004Agent } from "@bnbagent/sdk/erc8004";
import { EVMWalletProvider } from "@bnbagent/sdk/wallets";
import { isAddressEqual } from "viem";
import { fetchAgentCard } from "./a2a.ts";
import { ERC8183_TESTNET } from "./data/erc8183/contracts.ts";
import { loadHostedSellerConfig } from "./data/erc8183/hosted-seller-config.ts";
import { GATE1_NETWORK } from "./network.ts";

export async function registerHostedSeller(): Promise<void> {
  const config = loadHostedSellerConfig();
  if (!isAddressEqual(config.address, ERC8183_TESTNET.seller)) {
    throw new Error("Configured key does not match the hosted seller allowlist");
  }
  const card = await fetchAgentCard(config.origin, null);
  if (new URL(card.url).origin !== config.origin) {
    throw new Error("Hosted seller Agent Card does not match its configured origin");
  }
  const wallet = new EVMWalletProvider({
    password: "in-memory-only",
    privateKey: config.privateKey,
    persist: false,
  });
  const identity = await ERC8004Agent.create({
    walletProvider: wallet,
    network: GATE1_NETWORK,
  });
  const agentUri = identity.generateAgentUri({
    name: "hosted-erc8183-seller-fixture",
    description:
      "Testing infrastructure for the browser-wallet ERC-8183 spike; not a marketplace agent.",
    endpoints: [AgentEndpoint.a2a(config.origin, { version: "0.3.0" })],
  });
  const result = await identity.registerAgent(agentUri);
  if (result.agentId === null) {
    throw new Error("Registration succeeded without a recoverable Agent ID");
  }
  console.log(
    JSON.stringify({
      fixture: true,
      chainId: ERC8183_TESTNET.chainId,
      seller: config.address,
      endpoint: config.origin,
      agentId: result.agentId,
      transactionHash: result.transactionHash,
    }),
  );
}

async function main(): Promise<void> {
  if (process.argv[2] !== "register" || process.argv.length !== 3) {
    throw new Error("Expected command: register");
  }
  await registerHostedSeller();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error("Hosted seller registration failed");
    process.exitCode = 1;
  });
}
