import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  isAddressEqual,
  type Address,
  type EIP1193Provider,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { bsc, bscTestnet, type Chain } from "viem/chains";
import type {
  Erc8183BrowserJournal,
  Erc8183HirePlan,
  Erc8183JobFacts,
  Erc8183JournalStep,
  Erc8183TransactionKind,
} from "../../business/entities/erc8183-browser-spike.js";
import { InvalidErc8183SpikeInputError } from "../../business/errors/erc8183-spike-errors.js";
import {
  agenticCommerceBrowserAbi,
  ERC8183_TESTNET,
  evaluatorRouterBrowserAbi,
  paymentTokenBrowserAbi,
} from "./contracts.js";
import { assertSuccessfulReceipt, extractConfirmedJobId } from "./receipt-parser.js";

const JOURNAL_KEY = "bnb-agent-marketplace:erc8183-browser-spike:v1";
const JOURNAL_STEPS = new Set([
  "connected",
  "created",
  "registered",
  "budgeted",
  "approved",
  "funded",
  "notified",
  "submitted",
]);

export interface BrowserHireProgress {
  step: Erc8183JournalStep;
  journal: Erc8183BrowserJournal;
}

export interface BrowserHireExecution {
  jobId: string;
  journal: Erc8183BrowserJournal;
}

export interface Erc8183BrowserDeployment {
  chainId: 56 | 97;
  networkName: string;
  nativeCurrencyName: string;
  nativeCurrencySymbol: string;
  rpcUrl: string;
  explorerUrl: string;
  agentId: number;
  commerce: Address;
  router: Address;
  policy: Address;
  token: Address;
  seller: Address;
  maximumBudgetRaw: bigint;
}

const TESTNET_BROWSER_DEPLOYMENT: Erc8183BrowserDeployment = {
  ...ERC8183_TESTNET,
  nativeCurrencyName: "tBNB",
  nativeCurrencySymbol: "tBNB",
};

function journalKey(deployment: Erc8183BrowserDeployment): string {
  return deployment.chainId === ERC8183_TESTNET.chainId
    ? JOURNAL_KEY
    : `bnb-agent-marketplace:erc8183-browser:${deployment.chainId}:${deployment.agentId}:v1`;
}

function viemChain(deployment: Erc8183BrowserDeployment): Chain {
  return deployment.chainId === 56 ? bsc : bscTestnet;
}

function sameAddress(left: string, right: string): boolean {
  return isAddressEqual(getAddress(left), getAddress(right));
}

export function assertBrowserSpikeChain(
  chainId: number,
  deployment: Erc8183BrowserDeployment = TESTNET_BROWSER_DEPLOYMENT,
): void {
  if (chainId !== deployment.chainId) {
    throw new InvalidErc8183SpikeInputError(`Browser writes are locked to ${deployment.networkName} chain ${deployment.chainId}`);
  }
}

export function exactApprovalRequired(allowanceRaw: string, budgetRaw: string): boolean {
  return BigInt(allowanceRaw) < BigInt(budgetRaw);
}

export function validateHirePlan(
  plan: Erc8183HirePlan,
  deployment: Erc8183BrowserDeployment = TESTNET_BROWSER_DEPLOYMENT,
): void {
  assertBrowserSpikeChain(plan.quote.chainId, deployment);
  if (
    !sameAddress(plan.quote.commerce, deployment.commerce) ||
    !sameAddress(plan.quote.router, deployment.router) ||
    !sameAddress(plan.quote.policy, deployment.policy) ||
    !sameAddress(plan.quote.token, deployment.token) ||
    !sameAddress(plan.seller, deployment.seller) ||
    plan.quote.agentId !== deployment.agentId ||
    BigInt(plan.quote.priceRaw) <= 0n ||
    BigInt(plan.quote.priceRaw) > deployment.maximumBudgetRaw
  ) {
    throw new InvalidErc8183SpikeInputError("Prepared hire is outside the browser-spike allowlist");
  }
  if (plan.approvalAmountRaw !== (plan.approvalRequired ? plan.quote.priceRaw : "0")) {
    throw new InvalidErc8183SpikeInputError("Prepared approval is not exact");
  }
  if (
    plan.approvalRequired !== exactApprovalRequired(plan.allowanceRaw, plan.quote.priceRaw) ||
    plan.maximumSignatures !== (plan.approvalRequired ? 5 : 4) ||
    BigInt(plan.tokenBalanceRaw) < BigInt(plan.quote.priceRaw) ||
    BigInt(plan.nativeBalanceRaw) <= 0n
  ) {
    throw new InvalidErc8183SpikeInputError("Prepared balances or signature count are inconsistent");
  }
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const disputeWindow = BigInt(plan.disputeWindowSeconds ?? "0");
  if (!/^\d+$/.test(plan.deadline) || BigInt(plan.deadline) <= now || BigInt(plan.deadline) > now + disputeWindow + 7_200n) {
    throw new InvalidErc8183SpikeInputError(`Prepared deadline is outside the ${deployment.networkName} demo window`);
  }
  if (plan.executeBefore <= Number(now) || plan.executeBefore !== plan.quote.quoteExpiresAt) {
    throw new InvalidErc8183SpikeInputError("Prepared quote execution window is invalid");
  }
}

function isHash(value: unknown): value is Hash {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function parseBrowserJournal(
  value: unknown,
  deployment: Erc8183BrowserDeployment = TESTNET_BROWSER_DEPLOYMENT,
): Erc8183BrowserJournal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<Erc8183BrowserJournal>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.chainId !== deployment.chainId ||
    typeof candidate.buyer !== "string" ||
    typeof candidate.seller !== "string" ||
    !sameAddress(candidate.seller, deployment.seller) ||
    (candidate.jobId !== null && (typeof candidate.jobId !== "string" || !/^\d+$/.test(candidate.jobId))) ||
    typeof candidate.transactions !== "object" ||
    candidate.transactions === null ||
    typeof candidate.lastConfirmedStep !== "string" ||
    !JOURNAL_STEPS.has(candidate.lastConfirmedStep)
  ) {
    return null;
  }
  try {
    const buyer = getAddress(candidate.buyer);
    const seller = getAddress(candidate.seller);
    const transactions: Partial<Record<Erc8183TransactionKind, Hash>> = {};
    const receipts: Erc8183BrowserJournal["receipts"] = {};
    for (const kind of ["createJob", "registerJob", "setBudget", "approve", "fund", "submit", "settle"] as const) {
      const hash = candidate.transactions[kind];
      if (hash !== undefined) {
        if (!isHash(hash)) return null;
        transactions[kind] = hash;
      }
    }
    if (candidate.receipts !== undefined) {
      if (typeof candidate.receipts !== "object" || candidate.receipts === null) return null;
      for (const kind of ["createJob", "registerJob", "setBudget", "approve", "fund", "submit", "settle"] as const) {
        const receipt = candidate.receipts[kind];
        if (receipt === undefined) continue;
        if (
          !/^\d+$/.test(receipt.blockNumber) ||
          !/^\d+$/.test(receipt.gasUsed) ||
          !/^\d+$/.test(receipt.effectiveGasPrice) ||
          !Number.isFinite(Date.parse(receipt.confirmedAt)) ||
          !transactions[kind]
        ) return null;
        receipts[kind] = { ...receipt };
      }
    }
    const startedAt = candidate.startedAt;
    if (startedAt !== undefined && !Number.isFinite(Date.parse(startedAt))) return null;
    return {
      schemaVersion: 1,
      chainId: deployment.chainId,
      buyer,
      seller,
      jobId: candidate.jobId ?? null,
      transactions,
      ...(Object.keys(receipts).length ? { receipts } : {}),
      ...(startedAt ? { startedAt } : {}),
      lastConfirmedStep: candidate.lastConfirmedStep as Erc8183JournalStep,
    };
  } catch {
    return null;
  }
}

export function loadBrowserJournal(
  storage: Pick<Storage, "getItem"> = localStorage,
  deployment: Erc8183BrowserDeployment = TESTNET_BROWSER_DEPLOYMENT,
): Erc8183BrowserJournal | null {
  const raw = storage.getItem(journalKey(deployment));
  if (!raw) return null;
  try {
    return parseBrowserJournal(JSON.parse(raw), deployment);
  } catch {
    return null;
  }
}

export function saveBrowserJournal(
  journal: Erc8183BrowserJournal,
  storage: Pick<Storage, "setItem"> = localStorage,
  deployment: Erc8183BrowserDeployment = TESTNET_BROWSER_DEPLOYMENT,
): void {
  storage.setItem(journalKey(deployment), JSON.stringify(journal));
}

export function clearBrowserJournal(
  storage: Pick<Storage, "removeItem"> = localStorage,
  deployment: Erc8183BrowserDeployment = TESTNET_BROWSER_DEPLOYMENT,
): void {
  storage.removeItem(journalKey(deployment));
}

function rpcErrorCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") {
    return error.code;
  }
  return null;
}

export async function connectInjectedWallet(
  provider: EIP1193Provider,
  deployment: Erc8183BrowserDeployment = TESTNET_BROWSER_DEPLOYMENT,
): Promise<Address> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const firstAccount = accounts[0];
  if (!firstAccount) {
    throw new InvalidErc8183SpikeInputError("The injected wallet returned no account");
  }
  const account = getAddress(firstAccount);
  let chainHex = await provider.request({ method: "eth_chainId" });
  if (Number(chainHex) !== deployment.chainId) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${deployment.chainId.toString(16)}` }],
      });
    } catch (error) {
      if (rpcErrorCode(error) !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: `0x${deployment.chainId.toString(16)}`,
          chainName: deployment.networkName,
          nativeCurrency: { name: deployment.nativeCurrencyName, symbol: deployment.nativeCurrencySymbol, decimals: 18 },
          rpcUrls: [deployment.rpcUrl],
          blockExplorerUrls: [deployment.explorerUrl],
        }],
      });
    }
    chainHex = await provider.request({ method: "eth_chainId" });
  }
  assertBrowserSpikeChain(Number(chainHex), deployment);
  return account;
}

function withProgress(
  journal: Erc8183BrowserJournal,
  step: Erc8183JournalStep,
  transaction: { kind: Erc8183TransactionKind; hash: Hash; receipt?: TransactionReceipt; confirmedAt?: string } | null,
  jobId: string | null,
  onProgress: (progress: BrowserHireProgress) => void,
  deployment: Erc8183BrowserDeployment,
): Erc8183BrowserJournal {
  const next: Erc8183BrowserJournal = {
    ...journal,
    jobId: jobId ?? journal.jobId,
    transactions: transaction
      ? { ...journal.transactions, [transaction.kind]: transaction.hash }
      : journal.transactions,
    ...(transaction?.receipt && transaction.confirmedAt ? { receipts: { ...journal.receipts, [transaction.kind]: {
        blockNumber: transaction.receipt.blockNumber.toString(),
        gasUsed: transaction.receipt.gasUsed.toString(),
        effectiveGasPrice: transaction.receipt.effectiveGasPrice.toString(),
        confirmedAt: transaction.confirmedAt,
      } } } : journal.receipts ? { receipts: journal.receipts } : {}),
    lastConfirmedStep: step,
  };
  saveBrowserJournal(next, localStorage, deployment);
  onProgress({ step, journal: next });
  return next;
}

function isAlreadyRegistered(
  job: Erc8183JobFacts | null,
  deployment: Erc8183BrowserDeployment = TESTNET_BROWSER_DEPLOYMENT,
): boolean {
  return job !== null && sameAddress(job.policy, deployment.policy);
}

function isAlreadyBudgeted(job: Erc8183JobFacts | null, budget: bigint): boolean {
  return job !== null && BigInt(job.budgetRaw) === budget;
}

function isAlreadyFunded(job: Erc8183JobFacts | null): boolean {
  return job !== null && ["FUNDED", "SUBMITTED", "COMPLETED"].includes(job.status);
}

export function validateRecoveredJobForResume(
  job: Erc8183JobFacts,
  plan: Erc8183HirePlan,
  expectedJobId: string,
  deployment: Erc8183BrowserDeployment = TESTNET_BROWSER_DEPLOYMENT,
): void {
  const policyIsUnset = /^0x0{40}$/i.test(job.policy);
  if (
    job.chainId !== deployment.chainId ||
    job.jobId !== expectedJobId ||
    !sameAddress(job.buyer, plan.buyer) ||
    !sameAddress(job.provider, plan.seller) ||
    !sameAddress(job.evaluator, deployment.router) ||
    (!policyIsUnset && !sameAddress(job.policy, deployment.policy)) ||
    (job.budgetRaw !== "0" && job.budgetRaw !== plan.quote.priceRaw) ||
    job.quotedToken === null ||
    !sameAddress(job.quotedToken, deployment.token) ||
    job.quotedPriceRaw !== plan.quote.priceRaw ||
    BigInt(job.deadline) <= BigInt(Math.floor(Date.now() / 1_000)) ||
    job.status === "REJECTED" ||
    job.status === "EXPIRED"
  ) {
    throw new InvalidErc8183SpikeInputError(
      `Recovered chain state does not match the prepared ${deployment.networkName} hire`,
    );
  }
}

export function resumeRequirements(job: Erc8183JobFacts | null, budgetRaw: string) {
  const budget = BigInt(budgetRaw);
  return {
    registerJob: !isAlreadyRegistered(job),
    setBudget: !isAlreadyBudgeted(job, budget),
    fund: !isAlreadyFunded(job),
  };
}

export async function executeBrowserHire(
  provider: EIP1193Provider,
  plan: Erc8183HirePlan,
  options: {
    journal?: Erc8183BrowserJournal | null;
    recoveredJob?: Erc8183JobFacts | null;
    onProgress?: (progress: BrowserHireProgress) => void;
    deployment?: Erc8183BrowserDeployment;
  } = {},
): Promise<BrowserHireExecution> {
  const deployment = options.deployment ?? TESTNET_BROWSER_DEPLOYMENT;
  validateHirePlan(plan, deployment);
  if (Math.floor(Date.now() / 1_000) >= plan.executeBefore) {
    throw new InvalidErc8183SpikeInputError("The prepared quote expired before signing");
  }
  const account = await connectInjectedWallet(provider, deployment);
  if (!sameAddress(account, plan.buyer)) {
    throw new InvalidErc8183SpikeInputError("Connected wallet differs from the prepared buyer");
  }
  const onProgress = options.onProgress ?? (() => undefined);
  let journal = options.journal ?? {
    schemaVersion: 1,
    chainId: deployment.chainId,
    buyer: account,
    seller: plan.seller,
    jobId: null,
    transactions: {},
    lastConfirmedStep: "connected",
    startedAt: new Date().toISOString(),
  };
  if (!sameAddress(journal.buyer, account) || !sameAddress(journal.seller, plan.seller)) {
    throw new InvalidErc8183SpikeInputError("Stored journal belongs to a different buyer or seller");
  }
  if (journal.jobId !== null && !options.recoveredJob) {
    throw new InvalidErc8183SpikeInputError(
      "Current chain state is required before resuming a stored job",
    );
  }
  if (journal.jobId !== null && options.recoveredJob) {
    validateRecoveredJobForResume(options.recoveredJob, plan, journal.jobId, deployment);
  }
  journal = withProgress(journal, "connected", null, journal.jobId, onProgress, deployment);

  const chain = viemChain(deployment);
  const publicClient = createPublicClient({ chain, transport: http(deployment.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: custom(provider) });
  const confirm = async (hash: Hash, expectedContract: Address): Promise<{ receipt: TransactionReceipt; confirmedAt: string }> => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assertSuccessfulReceipt(receipt);
    const transaction = await publicClient.getTransaction({ hash });
    if (!transaction.to || !sameAddress(transaction.to, expectedContract)) {
      throw new InvalidErc8183SpikeInputError("Confirmed transaction targeted an unexpected contract");
    }
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    return { receipt, confirmedAt: new Date(Number(block.timestamp) * 1_000).toISOString() };
  };
  let jobId = journal.jobId ? BigInt(journal.jobId) : null;
  if (jobId === null && journal.transactions.createJob) {
    const confirmed = await confirm(journal.transactions.createJob, deployment.commerce);
    jobId = extractConfirmedJobId(confirmed.receipt);
    journal = withProgress(journal, "created", { kind: "createJob", hash: journal.transactions.createJob, ...confirmed }, jobId.toString(), onProgress, deployment);
  }
  if (jobId === null) {
    const simulation = await publicClient.simulateContract({
      account,
      address: deployment.commerce,
      abi: agenticCommerceBrowserAbi,
      functionName: "createJob",
      args: [plan.seller, deployment.router, BigInt(plan.deadline), plan.quote.description, deployment.router],
    });
    const hash = await walletClient.writeContract(simulation.request);
    const confirmed = await confirm(hash, deployment.commerce);
    jobId = extractConfirmedJobId(confirmed.receipt);
    journal = withProgress(journal, "created", { kind: "createJob", hash, ...confirmed }, jobId.toString(), onProgress, deployment);
  }
  const budget = BigInt(plan.quote.priceRaw);
  const recovered = options.recoveredJob ?? null;
  if (!isAlreadyRegistered(recovered, deployment)) {
    const simulation = await publicClient.simulateContract({
      account,
      address: deployment.router,
      abi: evaluatorRouterBrowserAbi,
      functionName: "registerJob",
      args: [jobId, deployment.policy],
    });
    const hash = await walletClient.writeContract(simulation.request);
    const confirmed = await confirm(hash, deployment.router);
    journal = withProgress(journal, "registered", { kind: "registerJob", hash, ...confirmed }, jobId.toString(), onProgress, deployment);
  }
  if (!isAlreadyBudgeted(recovered, budget)) {
    const simulation = await publicClient.simulateContract({
      account,
      address: deployment.commerce,
      abi: agenticCommerceBrowserAbi,
      functionName: "setBudget",
      args: [jobId, budget, "0x"],
    });
    const hash = await walletClient.writeContract(simulation.request);
    const confirmed = await confirm(hash, deployment.commerce);
    journal = withProgress(journal, "budgeted", { kind: "setBudget", hash, ...confirmed }, jobId.toString(), onProgress, deployment);
  }
  if (!isAlreadyFunded(recovered)) {
    if (plan.approvalRequired) {
      const simulation = await publicClient.simulateContract({
        account,
        address: deployment.token,
        abi: paymentTokenBrowserAbi,
        functionName: "approve",
        args: [deployment.commerce, budget],
      });
      const hash = await walletClient.writeContract(simulation.request);
      const confirmed = await confirm(hash, deployment.token);
      journal = withProgress(journal, "approved", { kind: "approve", hash, ...confirmed }, jobId.toString(), onProgress, deployment);
    }
    const simulation = await publicClient.simulateContract({
      account,
      address: deployment.commerce,
      abi: agenticCommerceBrowserAbi,
      functionName: "fund",
      args: [jobId, budget, "0x"],
    });
    const hash = await walletClient.writeContract(simulation.request);
    const confirmed = await confirm(hash, deployment.commerce);
    journal = withProgress(journal, "funded", { kind: "fund", hash, ...confirmed }, jobId.toString(), onProgress, deployment);
  }
  return { jobId: jobId.toString(), journal };
}
