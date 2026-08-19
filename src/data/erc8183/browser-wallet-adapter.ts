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
import { bscTestnet } from "viem/chains";
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

function sameAddress(left: string, right: string): boolean {
  return isAddressEqual(getAddress(left), getAddress(right));
}

export function assertBrowserSpikeChain(chainId: number): void {
  if (chainId !== ERC8183_TESTNET.chainId) {
    throw new InvalidErc8183SpikeInputError("Browser writes are locked to BSC Testnet chain 97");
  }
}

export function exactApprovalRequired(allowanceRaw: string, budgetRaw: string): boolean {
  return BigInt(allowanceRaw) < BigInt(budgetRaw);
}

export function validateHirePlan(plan: Erc8183HirePlan): void {
  assertBrowserSpikeChain(plan.quote.chainId);
  if (
    !sameAddress(plan.quote.commerce, ERC8183_TESTNET.commerce) ||
    !sameAddress(plan.quote.router, ERC8183_TESTNET.router) ||
    !sameAddress(plan.quote.policy, ERC8183_TESTNET.policy) ||
    !sameAddress(plan.quote.token, ERC8183_TESTNET.token) ||
    !sameAddress(plan.seller, ERC8183_TESTNET.seller) ||
    plan.quote.agentId !== ERC8183_TESTNET.agentId ||
    BigInt(plan.quote.priceRaw) <= 0n ||
    BigInt(plan.quote.priceRaw) > ERC8183_TESTNET.maximumBudgetRaw
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
  if (!/^\d+$/.test(plan.deadline) || BigInt(plan.deadline) <= now || BigInt(plan.deadline) > now + 7_200n) {
    throw new InvalidErc8183SpikeInputError("Prepared deadline is outside the Testnet spike window");
  }
  if (plan.executeBefore <= Number(now) || plan.executeBefore !== plan.quote.quoteExpiresAt) {
    throw new InvalidErc8183SpikeInputError("Prepared quote execution window is invalid");
  }
}

function isHash(value: unknown): value is Hash {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function parseBrowserJournal(value: unknown): Erc8183BrowserJournal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<Erc8183BrowserJournal>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.chainId !== ERC8183_TESTNET.chainId ||
    typeof candidate.buyer !== "string" ||
    typeof candidate.seller !== "string" ||
    !sameAddress(candidate.seller, ERC8183_TESTNET.seller) ||
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
    for (const kind of ["createJob", "registerJob", "setBudget", "approve", "fund"] as const) {
      const hash = candidate.transactions[kind];
      if (hash !== undefined) {
        if (!isHash(hash)) return null;
        transactions[kind] = hash;
      }
    }
    return {
      schemaVersion: 1,
      chainId: ERC8183_TESTNET.chainId,
      buyer,
      seller,
      jobId: candidate.jobId ?? null,
      transactions,
      lastConfirmedStep: candidate.lastConfirmedStep as Erc8183JournalStep,
    };
  } catch {
    return null;
  }
}

export function loadBrowserJournal(storage: Pick<Storage, "getItem"> = localStorage): Erc8183BrowserJournal | null {
  const raw = storage.getItem(JOURNAL_KEY);
  if (!raw) return null;
  try {
    return parseBrowserJournal(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveBrowserJournal(
  journal: Erc8183BrowserJournal,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(JOURNAL_KEY, JSON.stringify(journal));
}

export function clearBrowserJournal(storage: Pick<Storage, "removeItem"> = localStorage): void {
  storage.removeItem(JOURNAL_KEY);
}

function rpcErrorCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") {
    return error.code;
  }
  return null;
}

export async function connectInjectedWallet(provider: EIP1193Provider): Promise<Address> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const firstAccount = accounts[0];
  if (!firstAccount) {
    throw new InvalidErc8183SpikeInputError("The injected wallet returned no account");
  }
  const account = getAddress(firstAccount);
  let chainHex = await provider.request({ method: "eth_chainId" });
  if (Number(chainHex) !== ERC8183_TESTNET.chainId) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x61" }],
      });
    } catch (error) {
      if (rpcErrorCode(error) !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x61",
          chainName: ERC8183_TESTNET.networkName,
          nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
          rpcUrls: [ERC8183_TESTNET.rpcUrl],
          blockExplorerUrls: [ERC8183_TESTNET.explorerUrl],
        }],
      });
    }
    chainHex = await provider.request({ method: "eth_chainId" });
  }
  assertBrowserSpikeChain(Number(chainHex));
  return account;
}

function withProgress(
  journal: Erc8183BrowserJournal,
  step: Erc8183JournalStep,
  transaction: { kind: Erc8183TransactionKind; hash: Hash } | null,
  jobId: string | null,
  onProgress: (progress: BrowserHireProgress) => void,
): Erc8183BrowserJournal {
  const next: Erc8183BrowserJournal = {
    ...journal,
    jobId: jobId ?? journal.jobId,
    transactions: transaction
      ? { ...journal.transactions, [transaction.kind]: transaction.hash }
      : journal.transactions,
    lastConfirmedStep: step,
  };
  saveBrowserJournal(next);
  onProgress({ step, journal: next });
  return next;
}

function isAlreadyRegistered(job: Erc8183JobFacts | null): boolean {
  return job !== null && sameAddress(job.policy, ERC8183_TESTNET.policy);
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
): void {
  const policyIsUnset = /^0x0{40}$/i.test(job.policy);
  if (
    job.chainId !== ERC8183_TESTNET.chainId ||
    job.jobId !== expectedJobId ||
    !sameAddress(job.buyer, plan.buyer) ||
    !sameAddress(job.provider, plan.seller) ||
    !sameAddress(job.evaluator, ERC8183_TESTNET.router) ||
    (!policyIsUnset && !sameAddress(job.policy, ERC8183_TESTNET.policy)) ||
    (job.budgetRaw !== "0" && job.budgetRaw !== plan.quote.priceRaw) ||
    job.quotedToken === null ||
    !sameAddress(job.quotedToken, ERC8183_TESTNET.token) ||
    job.quotedPriceRaw !== plan.quote.priceRaw ||
    BigInt(job.deadline) <= BigInt(Math.floor(Date.now() / 1_000)) ||
    job.status === "REJECTED" ||
    job.status === "EXPIRED"
  ) {
    throw new InvalidErc8183SpikeInputError(
      "Recovered chain state does not match the prepared Testnet hire",
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
  } = {},
): Promise<BrowserHireExecution> {
  validateHirePlan(plan);
  if (Math.floor(Date.now() / 1_000) >= plan.executeBefore) {
    throw new InvalidErc8183SpikeInputError("The prepared quote expired before signing");
  }
  const account = await connectInjectedWallet(provider);
  if (!sameAddress(account, plan.buyer)) {
    throw new InvalidErc8183SpikeInputError("Connected wallet differs from the prepared buyer");
  }
  const onProgress = options.onProgress ?? (() => undefined);
  let journal = options.journal ?? {
    schemaVersion: 1,
    chainId: ERC8183_TESTNET.chainId,
    buyer: account,
    seller: plan.seller,
    jobId: null,
    transactions: {},
    lastConfirmedStep: "connected",
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
    validateRecoveredJobForResume(options.recoveredJob, plan, journal.jobId);
  }
  journal = withProgress(journal, "connected", null, journal.jobId, onProgress);

  const publicClient = createPublicClient({ chain: bscTestnet, transport: http(ERC8183_TESTNET.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: bscTestnet, transport: custom(provider) });
  const confirm = async (hash: Hash, expectedContract: Address): Promise<TransactionReceipt> => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assertSuccessfulReceipt(receipt);
    const transaction = await publicClient.getTransaction({ hash });
    if (!transaction.to || !sameAddress(transaction.to, expectedContract)) {
      throw new InvalidErc8183SpikeInputError("Confirmed transaction targeted an unexpected contract");
    }
    return receipt;
  };
  let jobId = journal.jobId ? BigInt(journal.jobId) : null;
  if (jobId === null && journal.transactions.createJob) {
    jobId = extractConfirmedJobId(await confirm(journal.transactions.createJob, ERC8183_TESTNET.commerce));
    journal = withProgress(journal, "created", null, jobId.toString(), onProgress);
  }
  if (jobId === null) {
    const simulation = await publicClient.simulateContract({
      account,
      address: ERC8183_TESTNET.commerce,
      abi: agenticCommerceBrowserAbi,
      functionName: "createJob",
      args: [plan.seller, ERC8183_TESTNET.router, BigInt(plan.deadline), plan.quote.description, ERC8183_TESTNET.router],
    });
    const hash = await walletClient.writeContract(simulation.request);
    jobId = extractConfirmedJobId(await confirm(hash, ERC8183_TESTNET.commerce));
    journal = withProgress(journal, "created", { kind: "createJob", hash }, jobId.toString(), onProgress);
  }
  const budget = BigInt(plan.quote.priceRaw);
  const recovered = options.recoveredJob ?? null;
  if (!isAlreadyRegistered(recovered)) {
    const simulation = await publicClient.simulateContract({
      account,
      address: ERC8183_TESTNET.router,
      abi: evaluatorRouterBrowserAbi,
      functionName: "registerJob",
      args: [jobId, ERC8183_TESTNET.policy],
    });
    const hash = await walletClient.writeContract(simulation.request);
    await confirm(hash, ERC8183_TESTNET.router);
    journal = withProgress(journal, "registered", { kind: "registerJob", hash }, jobId.toString(), onProgress);
  }
  if (!isAlreadyBudgeted(recovered, budget)) {
    const simulation = await publicClient.simulateContract({
      account,
      address: ERC8183_TESTNET.commerce,
      abi: agenticCommerceBrowserAbi,
      functionName: "setBudget",
      args: [jobId, budget, "0x"],
    });
    const hash = await walletClient.writeContract(simulation.request);
    await confirm(hash, ERC8183_TESTNET.commerce);
    journal = withProgress(journal, "budgeted", { kind: "setBudget", hash }, jobId.toString(), onProgress);
  }
  if (!isAlreadyFunded(recovered)) {
    if (plan.approvalRequired) {
      const simulation = await publicClient.simulateContract({
        account,
        address: ERC8183_TESTNET.token,
        abi: paymentTokenBrowserAbi,
        functionName: "approve",
        args: [ERC8183_TESTNET.commerce, budget],
      });
      const hash = await walletClient.writeContract(simulation.request);
      await confirm(hash, ERC8183_TESTNET.token);
      journal = withProgress(journal, "approved", { kind: "approve", hash }, jobId.toString(), onProgress);
    }
    const simulation = await publicClient.simulateContract({
      account,
      address: ERC8183_TESTNET.commerce,
      abi: agenticCommerceBrowserAbi,
      functionName: "fund",
      args: [jobId, budget, "0x"],
    });
    const hash = await walletClient.writeContract(simulation.request);
    await confirm(hash, ERC8183_TESTNET.commerce);
    journal = withProgress(journal, "funded", { kind: "fund", hash }, jobId.toString(), onProgress);
  }
  return { jobId: jobId.toString(), journal };
}
