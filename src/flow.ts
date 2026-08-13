import {
  ERC8183Client,
  JobStatus,
  buildJobDescription,
  verifyQuoteSignature,
} from "@bnbagent/sdk/erc8183";
import { formatUnits, getAddress } from "viem";
import {
  fetchAgentCard,
  negotiate,
  notifyFunded,
  type QuoteEnvelope,
} from "./a2a.js";
import type { Gate1Config, ReceiptConfig } from "./config.js";
import {
  createEvmBuyerWallet,
  type BuyerWalletFactory,
} from "./buyer-wallet.js";
import { resolveIdentity } from "./identity.js";
import {
  receiptPath,
  writeReceipt,
  type Gate1Receipt,
} from "./receipt.js";

export interface PreflightResult {
  identity: Awaited<ReturnType<typeof resolveIdentity>>;
  card: Awaited<ReturnType<typeof fetchAgentCard>>;
  quote: QuoteEnvelope;
  messageUrl: string;
  provider: `0x${string}`;
  price: bigint;
  token: `0x${string}`;
  tokenSymbol: string;
  tokenDecimals: number;
  disputeWindow: bigint;
  buyerBalance: bigint | null;
  buyerAllowance: bigint | null;
  buyerNativeBalance: bigint | null;
  intent: Record<string, unknown>;
}

function quoteTerms(quote: QuoteEnvelope): {
  provider: `0x${string}`;
  price: bigint;
  currency: `0x${string}`;
} {
  if (!quote.response || typeof quote.response !== "object") {
    throw new Error("Quote is missing response terms");
  }
  const price = quote.response.terms?.price;
  const currency = quote.response.terms?.currency;
  if (typeof price !== "string" || !/^\d+$/.test(price) || BigInt(price) <= 0n) {
    throw new Error("Quote price must be a positive raw-unit integer");
  }
  if (typeof currency !== "string") {
    throw new Error("Quote currency is missing");
  }
  return {
    provider: getAddress(quote.provider_address),
    price: BigInt(price),
    currency: getAddress(currency),
  };
}

export async function preflight(config: Gate1Config): Promise<PreflightResult> {
  const erc8183 = await ERC8183Client.create({ network: "bsc-testnet" });
  const identity = await resolveIdentity(erc8183.publicClient, config.agentId);
  const card = await fetchAgentCard(identity.a2aEndpoint, config.bearerToken);
  const skillIds = new Set(card.skills.map((skill) => skill.id));
  if (!skillIds.has("negotiate-erc8183-job")) {
    throw new Error("Agent Card does not advertise negotiate-erc8183-job");
  }
  if (!skillIds.has("notify_funded")) {
    throw new Error("Agent Card does not advertise notify_funded");
  }

  const quote = await negotiate(card.url, config.bearerToken);
  const { provider, price, currency } = quoteTerms(quote);
  if (provider !== getAddress(identity.agentWallet)) {
    throw new Error("Quote provider does not match the ERC-8004 agent wallet");
  }
  const token = await erc8183.paymentToken();
  if (currency !== getAddress(token)) {
    throw new Error("Quote currency does not match the Commerce payment token");
  }
  const verdict = await verifyQuoteSignature({
    envelope: quote,
    provider,
    publicClient: erc8183.publicClient,
    expectedVerifyingContract: erc8183.commerce.address,
  });
  if (!verdict.valid) {
    throw new Error(`Quote signature rejected: ${verdict.reason}`);
  }

  const [tokenSymbol, tokenDecimals, disputeWindow] = await Promise.all([
    erc8183.tokenSymbol(),
    erc8183.tokenDecimals(),
    erc8183.policy.disputeWindow(),
  ]);
  let buyerBalance: bigint | null = null;
  let buyerAllowance: bigint | null = null;
  let buyerNativeBalance: bigint | null = null;
  if (config.buyerAddress) {
    [buyerBalance, buyerAllowance, buyerNativeBalance] = await Promise.all([
      erc8183.tokenBalance(config.buyerAddress),
      erc8183.tokenAllowance(config.buyerAddress, erc8183.commerce.address),
      erc8183.publicClient.getBalance({ address: config.buyerAddress }),
    ]);
  }
  const deadline =
    BigInt(Math.floor(Date.now() / 1000)) + disputeWindow + 3_600n;
  return {
    identity,
    card,
    quote,
    messageUrl: card.url,
    provider,
    price,
    token,
    tokenSymbol,
    tokenDecimals,
    disputeWindow,
    buyerBalance,
    buyerAllowance,
    buyerNativeBalance,
    intent: {
      network: "bsc-testnet",
      chainId: 97,
      commerce: erc8183.commerce.address,
      router: erc8183.router.address,
      policy: erc8183.policy.address,
      provider,
      token,
      tokenSymbol,
      budgetRaw: price.toString(),
      budgetDisplay: formatUnits(price, tokenDecimals),
      currentAllowance: buyerAllowance?.toString() ?? null,
      maximumAllowance: price.toString(),
      deadline: deadline.toString(),
    },
  };
}

function baseReceipt(result: PreflightResult): Gate1Receipt {
  return {
    schemaVersion: 1,
    sdkVersion: "0.5.0",
    updatedAt: new Date().toISOString(),
    phase: "preflight",
    chainId: 97,
    agentId: result.identity.agentId,
    endpoint: result.identity.a2aEndpoint,
    provider: result.provider,
    quote: {
      negotiationHash: result.quote.negotiation_hash,
      price: result.price.toString(),
      token: result.token,
    },
    intent: result.intent,
    transactions: {},
  };
}

export async function runPreflight(config: Gate1Config): Promise<PreflightResult> {
  const result = await preflight(config);
  await writeReceipt(
    receiptPath(config.receiptDir, `preflight-${config.agentId}`),
    baseReceipt(result),
  );
  return result;
}

function txHash(result: { transactionHash: string }): string {
  return result.transactionHash;
}

export async function execute(
  config: Gate1Config,
  walletFactory: BuyerWalletFactory = createEvmBuyerWallet,
): Promise<Gate1Receipt> {
  if (!config.buyerAddress) {
    throw new Error("BUYER_ADDRESS is required for --execute wallet pinning");
  }
  const result = await preflight(config);
  if (result.buyerBalance === null || result.buyerBalance < result.price) {
    throw new Error("Buyer has insufficient testnet settlement-token balance");
  }
  const wallet = walletFactory({
    address: config.buyerAddress,
    password: config.buyerWalletPassword,
    ...(config.buyerWalletsDir
      ? { walletsDir: config.buyerWalletsDir }
      : {}),
  });
  if (getAddress(wallet.address) !== config.buyerAddress) {
    throw new Error("Buyer wallet address does not match BUYER_ADDRESS");
  }
  const client = await ERC8183Client.create({
    walletProvider: wallet,
    network: "bsc-testnet",
  });
  const deadline = BigInt(result.intent.deadline as string);
  const description = buildJobDescription(result.quote);
  let receipt = { ...baseReceipt(result), buyer: config.buyerAddress };
  const transactions: Record<string, string> = {};

  try {
    const created = await client.createJob({
      provider: result.provider,
      expiredAt: deadline,
      description,
    });
    if (created.jobId === null) throw new Error("createJob returned no job ID");
    const jobId = created.jobId;
    transactions.createJob = txHash(created);
    receipt = {
      ...receipt,
      phase: "created",
      jobId: jobId.toString(),
      transactions,
    };
    const path = receiptPath(config.receiptDir, jobId.toString());
    await writeReceipt(path, receipt);

    const registered = await client.registerJob(jobId);
    transactions.registerJob = txHash(registered);
    receipt = { ...receipt, phase: "registered", transactions };
    await writeReceipt(path, receipt);

    const budgeted = await client.setBudget(jobId, result.price);
    transactions.setBudget = txHash(budgeted);
    receipt = { ...receipt, phase: "budgeted", transactions };
    await writeReceipt(path, receipt);

    const funded = await client.fund(jobId, result.price, { approveFloor: 0n });
    transactions.fund = txHash(funded);
    receipt = { ...receipt, phase: "funded", status: "FUNDED", transactions };
    await writeReceipt(path, receipt);

    const notification = await notifyFunded(
      result.messageUrl,
      jobId,
      config.bearerToken,
    );
    receipt = {
      ...receipt,
      phase: "notified",
      notification: { acknowledged: Boolean(notification) },
    };
    await writeReceipt(path, receipt);

    const started = Date.now();
    while (Date.now() - started < config.submittedTimeoutMs) {
      const job = await client.getJob(jobId);
      const status = JobStatus[job.status];
      receipt = { ...receipt, phase: "polling", status };
      await writeReceipt(path, receipt);
      if (
        job.status === JobStatus.SUBMITTED ||
        job.status === JobStatus.COMPLETED
      ) {
        const deliverableUrl = await client.getDeliverableUrl(jobId);
        receipt = {
          ...receipt,
          phase: "submitted",
          status,
          deliverableUrl,
        };
        await writeReceipt(path, receipt);
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }
    throw new Error("Timed out waiting for onchain SUBMITTED state");
  } catch (error) {
    receipt = {
      ...receipt,
      phase: "error",
      error: error instanceof Error ? error.message : String(error),
      transactions,
    };
    const id = receipt.jobId ?? `failed-${config.agentId}`;
    await writeReceipt(receiptPath(config.receiptDir, id), receipt);
    throw error;
  }
}

export async function resume(
  config: ReceiptConfig,
  jobId: bigint,
): Promise<Gate1Receipt> {
  const client = await ERC8183Client.create({ network: "bsc-testnet" });
  const job = await client.getJob(jobId);
  const status = JobStatus[job.status];
  const deliverableUrl =
    job.status === JobStatus.SUBMITTED || job.status === JobStatus.COMPLETED
      ? await client.getDeliverableUrl(jobId)
      : null;
  const receipt: Gate1Receipt = {
    schemaVersion: 1,
    sdkVersion: "0.5.0",
    updatedAt: new Date().toISOString(),
    phase: "resumed",
    chainId: 97,
    provider: job.provider,
    buyer: job.client,
    jobId: jobId.toString(),
    status,
    deliverableUrl,
  };
  await writeReceipt(receiptPath(config.receiptDir, jobId.toString()), receipt);
  return receipt;
}
