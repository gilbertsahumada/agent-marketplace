// P4 — the agent buyer demo (Testnet only). An autonomous buyer that discovers and
// quotes through the public MCP endpoint, verifies the prepared plan with the same
// validation module the browser UI uses, signs the five ERC-8183 transactions with a
// plain local key, notifies the seller and tracks the job from chain. A demo, not a
// product: it runs once and leaves onchain evidence.
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddressEqual,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Erc8183HirePlan } from "../business/entities/erc8183-browser-spike.ts";
import { validateHirePlan } from "../data/erc8183/browser-wallet-adapter.ts";
import {
  agenticCommerceBrowserAbi,
  ERC8183_TESTNET,
  evaluatorRouterBrowserAbi,
  paymentTokenBrowserAbi,
} from "../data/erc8183/contracts.ts";
import { assertSuccessfulReceipt, extractConfirmedJobId } from "../data/erc8183/receipt-parser.ts";
import { defaultMarketplaceOrigin, normalizedOrigin } from "../marketplace-cli.ts";

interface DemoQuote {
  envelope: Record<string, unknown>;
  chainId: number;
  priceRaw: string;
  quoteExpiresAt: number;
  tokenSymbol: string;
}

export function assertQuoteWithinDemoCeiling(quote: DemoQuote, now = Date.now()): void {
  if (quote.chainId !== ERC8183_TESTNET.chainId) {
    throw new Error(`The quote is for chain ${quote.chainId}; this demo buyer signs only on BSC Testnet (97)`);
  }
  if (!/^\d+$/.test(quote.priceRaw) || BigInt(quote.priceRaw) <= 0n) {
    throw new Error("The quoted price is not a positive integer");
  }
  if (BigInt(quote.priceRaw) > ERC8183_TESTNET.maximumBudgetRaw) {
    throw new Error(
      `The quoted price ${quote.priceRaw} exceeds the demo spend ceiling ${ERC8183_TESTNET.maximumBudgetRaw} raw units`,
    );
  }
  if (quote.quoteExpiresAt * 1_000 <= now) {
    throw new Error("The quote expired before the buyer could act");
  }
}

function toolText(result: unknown, tool: string): string {
  const record = typeof result === "object" && result !== null ? result as { content?: unknown; isError?: unknown } : {};
  const content = Array.isArray(record.content) ? record.content[0] : undefined;
  const text = typeof content === "object" && content !== null && "text" in content ? String(content.text) : "";
  if (record.isError === true) throw new Error(`${tool} failed: ${text.slice(0, 300)}`);
  return text;
}

async function postJson(origin: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40_000),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new Error(`${path} -> ${response.status} ${error?.code ?? ""}: ${error?.message ?? "request failed"}`);
  }
  return payload;
}

export async function runAgentBuyer(options: { dryRun: boolean; buyerOverride?: string }): Promise<void> {
  const origin = normalizedOrigin(process.env.MARKETPLACE_ORIGIN ?? defaultMarketplaceOrigin());
  const log = (line: string) => console.log(line);
  const deployment = ERC8183_TESTNET;

  let buyer: Address;
  let account: ReturnType<typeof privateKeyToAccount> | null = null;
  if (options.dryRun) {
    buyer = getAddress(options.buyerOverride ?? "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52");
  } else {
    const key = process.env.AGENT_BUYER_PRIVATE_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error("Set AGENT_BUYER_PRIVATE_KEY (0x + 64 hex) in the environment — it is never sent anywhere");
    }
    account = privateKeyToAccount(key as `0x${string}`);
    buyer = account.address;
  }
  log(`agent-buyer: ${options.dryRun ? "DRY RUN (no signatures)" : "live run"} as ${buyer}`);
  log(`marketplace: ${origin}`);

  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`));
  const client = new Client({ name: "agent-buyer-demo", version: "1.0.0" });
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  try {
    // Discover → Understand through the same MCP surface any third-party agent uses.
    const search = JSON.parse(toolText(await client.callTool({
      name: "search_agents",
      arguments: { availability: "all", limit: 5 },
    }), "search_agents")) as { items: Array<{ agentId: string; name: string }> };
    log(`discovered ${search.items.length} agent(s): ${search.items.map((item) => `${item.agentId} (${item.name})`).join(", ")}`);
    const first = search.items[0];
    if (first) {
      const passport = JSON.parse(toolText(await client.callTool({
        name: "get_passport",
        arguments: { agentId: String(first.agentId) },
      }), "get_passport")) as { state: string };
      log(`passport ${first.agentId}: state=${passport.state} (evidence, not reputation)`);
    }

    // Quote through MCP — free, signs nothing. The envelope must stay byte-identical.
    const quote = JSON.parse(toolText(await client.callTool({
      name: "request_quote",
      arguments: { network: "testnet" },
    }), "request_quote")) as DemoQuote;
    assertQuoteWithinDemoCeiling(quote);
    log(`quote: ${quote.priceRaw} raw ${quote.tokenSymbol}, expires ${new Date(quote.quoteExpiresAt * 1_000).toISOString()}`);

    // Prepare over HTTP, then verify the plan against the locally pinned allowlist —
    // the exact validation module the browser UI runs before any signature.
    const plan = await postJson(origin, "/api/marketplace/demo/erc8183/prepare", {
      buyer,
      quote: quote.envelope,
    }) as Erc8183HirePlan;
    validateHirePlan(plan);
    log(`plan validated: ${plan.transactions.length} intents, deadline ${plan.deadline}, approval ${plan.approvalRequired ? "required (exact)" : "not required"}`);
    log(`guardrails: spend ceiling ${plan.guardrails.spendCeilingRaw} raw, key received by server: ${plan.guardrails.buyerPrivateKeyReceivedByServer}`);

    if (options.dryRun) {
      log("dry run complete — quote validated, plan verified against the pinned allowlist, nothing signed.");
      return;
    }
    if (!account) throw new Error("No signing account");

    const publicClient = createPublicClient({ chain: bscTestnet, transport: http(deployment.rpcUrl) });
    const walletClient = createWalletClient({ account, chain: bscTestnet, transport: http(deployment.rpcUrl) });
    const confirm = async (hash: Hash, expectedContract: Address, label: string) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assertSuccessfulReceipt(receipt);
      const transaction = await publicClient.getTransaction({ hash });
      if (!transaction.to || !isAddressEqual(getAddress(transaction.to), expectedContract)) {
        throw new Error(`${label}: confirmed transaction targeted an unexpected contract`);
      }
      log(`${label}: ${hash} (block ${receipt.blockNumber})`);
      return receipt;
    };
    const write = async (request: Parameters<typeof walletClient.writeContract>[0], expectedContract: Address, label: string) => {
      const hash = await walletClient.writeContract(request);
      return { hash, receipt: await confirm(hash, expectedContract, label) };
    };

    const budget = BigInt(plan.quote.priceRaw);
    const created = await publicClient.simulateContract({
      account,
      address: deployment.commerce,
      abi: agenticCommerceBrowserAbi,
      functionName: "createJob",
      args: [plan.seller, deployment.router, BigInt(plan.deadline), plan.quote.description, deployment.router],
    }).then((simulation) => write(simulation.request, deployment.commerce, "createJob"));
    const jobId = extractConfirmedJobId(created.receipt, deployment.commerce);
    log(`jobId: ${jobId}`);

    await publicClient.simulateContract({
      account,
      address: deployment.router,
      abi: evaluatorRouterBrowserAbi,
      functionName: "registerJob",
      args: [jobId, deployment.policy],
    }).then((simulation) => write(simulation.request, deployment.router, "registerJob"));

    await publicClient.simulateContract({
      account,
      address: deployment.commerce,
      abi: agenticCommerceBrowserAbi,
      functionName: "setBudget",
      args: [jobId, budget, "0x"],
    }).then((simulation) => write(simulation.request, deployment.commerce, "setBudget"));

    if (plan.approvalRequired) {
      await publicClient.simulateContract({
        account,
        address: deployment.token,
        abi: paymentTokenBrowserAbi,
        functionName: "approve",
        args: [deployment.commerce, budget],
      }).then((simulation) => write(simulation.request, deployment.token, "approve"));
    }

    await publicClient.simulateContract({
      account,
      address: deployment.commerce,
      abi: agenticCommerceBrowserAbi,
      functionName: "fund",
      args: [jobId, budget, "0x"],
    }).then((simulation) => write(simulation.request, deployment.commerce, "fund"));

    const notify = await postJson(origin, "/api/marketplace/demo/erc8183/notify", {
      buyer,
      jobId: jobId.toString(),
    }) as { acknowledged: boolean; sellerTransactionHash?: string };
    log(`seller notified: acknowledged=${notify.acknowledged}${notify.sellerTransactionHash ? `, submit tx ${notify.sellerTransactionHash}` : ""}`);

    const status = JSON.parse(toolText(await client.callTool({
      name: "get_job_status",
      arguments: { network: "testnet", jobId: jobId.toString() },
    }), "get_job_status")) as { job?: { status: string; deliverableHash: string } | null };
    log(`job ${jobId} status from chain: ${status.job?.status ?? "unavailable"}`);
    log(`explorer: ${deployment.explorerUrl}/address/${deployment.commerce}`);
    log(`track: ${origin}/jobs/testnet/${jobId}`);
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const buyerFlag = process.argv.indexOf("--buyer");
  const buyerOverride = buyerFlag !== -1 ? process.argv[buyerFlag + 1] : undefined;
  await runAgentBuyer({ dryRun, ...(buyerOverride ? { buyerOverride } : {}) });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
