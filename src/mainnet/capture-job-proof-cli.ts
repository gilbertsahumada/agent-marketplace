import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  hexToString,
  http,
  isAddressEqual,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { bsc } from "viem/chains";
import { parseJobDescription, verifyQuoteSignature } from "@bnbagent/sdk/erc8183";
import type { MainnetJobProof, MainnetJobTransactionProof } from "../business/entities/mainnet-job-proof.ts";
import type { Erc8183JobFacts } from "../business/entities/erc8183-browser-spike.ts";
import {
  GRID_CANONICAL_INPUT,
  GRID_NEGOTIATION_TERMS,
  buildGridPlan,
  gridTaskDescription,
  parseGridTaskDescription,
} from "../business/policies/grid-plan-policy.ts";
import { resolveIdentity, type ResolvedIdentity } from "../identity.ts";
import {
  ERC8183_MAINNET,
  mainnetCommerceEvidenceAbi,
  mainnetRouterEvidenceAbi,
  mainnetTokenEvidenceAbi,
} from "./contracts.ts";
import { MainnetErc8183Repository } from "./mainnet-erc8183-repository.ts";
import { mainnetImplementationPinsMatch } from "./implementation-pins.ts";

const PHASE_TARGETS = {
  createJob: ERC8183_MAINNET.commerce,
  registerJob: ERC8183_MAINNET.router,
  setBudget: ERC8183_MAINNET.commerce,
  approve: ERC8183_MAINNET.token,
  fund: ERC8183_MAINNET.commerce,
  submit: ERC8183_MAINNET.commerce,
  settle: ERC8183_MAINNET.router,
} as const;

type EvidencePhase = keyof typeof PHASE_TARGETS;
type LifecyclePhaseBlocks = Partial<Record<EvidencePhase, bigint>>;

const IMPLEMENTATION_PIN_PHASES = [
  "createJob",
  "registerJob",
  "setBudget",
  "fund",
  "submit",
  "settle",
] as const satisfies readonly EvidencePhase[];

interface EvidenceTransactionInput {
  from: Address;
  to: Address | null;
  input: Hex;
}

interface EvidenceReceiptInput {
  status: "success" | "reverted";
  logs: ReadonlyArray<{ address: Address; data: Hex; topics: readonly Hex[] }>;
}

interface ExpectedEvidenceJob {
  jobId: bigint;
  buyer: Address;
  seller: Address;
  description: string;
  deadline: bigint;
  budget: bigint;
  deliverable: Hex;
}

interface MainnetProofBindingInput {
  job: Erc8183JobFacts;
  description: Record<string, unknown>;
  identity: Pick<ResolvedIdentity, "agentId" | "agentWallet" | "a2aEndpoint">;
  expectedAgentId: number;
  expectedSeller: Address;
  expectedOrigin: string;
  signatureValid: boolean;
}

function sameAddress(left: string, right: string): boolean {
  return isAddressEqual(getAddress(left), getAddress(right));
}

/** Reject a proof unless its job, signed quote and ERC-8004 identity all bind to the fixed deployment. */
export function assertMainnetProofBinding(input: MainnetProofBindingInput): void {
  const { job, description, identity } = input;
  const terms = sourceObject(description.terms);
  if (
    job.chainId !== 56 ||
    !sameAddress(job.provider, input.expectedSeller) ||
    !sameAddress(job.evaluator, ERC8183_MAINNET.router) ||
    !sameAddress(job.policy, ERC8183_MAINNET.policy) ||
    job.budgetRaw !== ERC8183_MAINNET.maximumDemoBudgetRaw.toString() ||
    job.quotedPriceRaw !== ERC8183_MAINNET.maximumDemoBudgetRaw.toString() ||
    !job.quotedToken ||
    !sameAddress(job.quotedToken, ERC8183_MAINNET.token) ||
    description.chain_id !== 56 ||
    typeof description.verifying_contract !== "string" ||
    !sameAddress(description.verifying_contract, ERC8183_MAINNET.commerce) ||
    description.task !== gridTaskDescription(GRID_CANONICAL_INPUT) ||
    terms.deliverables !== GRID_NEGOTIATION_TERMS.deliverables ||
    terms.quality_standards !== GRID_NEGOTIATION_TERMS.qualityStandards
  ) throw new Error("Mainnet proof job or quote is outside the fixed deployment allowlist");
  if (!input.signatureValid) throw new Error("Mainnet proof quote signature is invalid");
  if (
    identity.agentId !== input.expectedAgentId ||
    !sameAddress(identity.agentWallet, input.expectedSeller) ||
    new URL(identity.a2aEndpoint).origin !== input.expectedOrigin
  ) throw new Error("Mainnet proof Agent ID does not resolve to the fixed seller deployment");
}

/** Verify every distinct Commerce/Router lifecycle block against the pinned implementations. */
export async function assertMainnetLifecycleImplementationPins(
  client: Parameters<typeof mainnetImplementationPinsMatch>[0],
  phaseBlocks: LifecyclePhaseBlocks,
  pinsMatch: typeof mainnetImplementationPinsMatch = mainnetImplementationPinsMatch,
): Promise<void> {
  const blocks = new Set<bigint>();
  for (const phase of IMPLEMENTATION_PIN_PHASES) {
    const blockNumber = phaseBlocks[phase];
    if (blockNumber !== undefined) blocks.add(blockNumber);
  }
  const results = await Promise.all([...blocks].map((blockNumber) => pinsMatch(client, blockNumber)));
  if (results.some((matches) => !matches)) {
    throw new Error("Mainnet proof lifecycle used an unallowlisted Commerce or Router implementation");
  }
}

function eventArgs(
  receipt: EvidenceReceiptInput,
  address: Address,
  abi: Abi,
  eventName: string,
  matches: (args: Record<string, unknown>) => boolean,
): boolean {
  return receipt.logs.some((log) => {
    if (!sameAddress(log.address, address)) return false;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
      return decoded.eventName === eventName && matches(decoded.args as unknown as Record<string, unknown>);
    } catch {
      return false;
    }
  });
}

function requireEvent(found: boolean, phase: EvidencePhase): void {
  if (!found) throw new Error(`${phase} receipt does not contain the expected confirmed lifecycle event`);
}

/** Bind one public proof transaction to the exact Mainnet Grid job and phase. */
export function assertMainnetEvidenceTransaction(input: {
  phase: EvidencePhase;
  transaction: EvidenceTransactionInput;
  receipt: EvidenceReceiptInput;
  job: ExpectedEvidenceJob;
}): void {
  const { phase, transaction, receipt, job } = input;
  const target = PHASE_TARGETS[phase];
  if (receipt.status !== "success" || !transaction.to || !sameAddress(transaction.to, target)) {
    throw new Error(`${phase} receipt is not allowlisted`);
  }
  const expectedSender = phase === "submit" || phase === "settle" ? job.seller : job.buyer;
  if (!sameAddress(transaction.from, expectedSender)) {
    throw new Error(`${phase} transaction sender does not match the proven lifecycle`);
  }

  const abi = phase === "registerJob" || phase === "settle"
    ? mainnetRouterEvidenceAbi
    : phase === "approve"
      ? mainnetTokenEvidenceAbi
      : mainnetCommerceEvidenceAbi;
  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({ abi, data: transaction.input });
  } catch {
    throw new Error(`${phase} transaction calldata is not a supported lifecycle operation`);
  }
  if (decoded.functionName !== phase) throw new Error(`${phase} transaction called ${decoded.functionName}`);
  const args = decoded.args as readonly unknown[];

  if (phase === "createJob") {
    const [provider, evaluator, expiredAt, description, hook] = args as [Address, Address, bigint, string, Address];
    if (!sameAddress(provider, job.seller) || !sameAddress(evaluator, ERC8183_MAINNET.router) || expiredAt !== job.deadline || description !== job.description || !sameAddress(hook, ERC8183_MAINNET.router)) {
      throw new Error("createJob calldata does not match the proven job");
    }
    requireEvent(eventArgs(receipt, ERC8183_MAINNET.commerce, mainnetCommerceEvidenceAbi, "JobCreated", (event) =>
      event.jobId === job.jobId && sameAddress(String(event.client), job.buyer) && sameAddress(String(event.provider), job.seller)
      && sameAddress(String(event.evaluator), ERC8183_MAINNET.router) && event.expiredAt === job.deadline
      && sameAddress(String(event.hook), ERC8183_MAINNET.router)), phase);
    return;
  }
  if (phase === "registerJob") {
    const [jobId, policy] = args as [bigint, Address];
    if (jobId !== job.jobId || !sameAddress(policy, ERC8183_MAINNET.policy)) throw new Error("registerJob calldata does not match the proven job");
    requireEvent(eventArgs(receipt, ERC8183_MAINNET.router, mainnetRouterEvidenceAbi, "JobRegistered", (event) =>
      event.jobId === job.jobId && sameAddress(String(event.policy), ERC8183_MAINNET.policy) && sameAddress(String(event.client), job.buyer)), phase);
    return;
  }
  if (phase === "setBudget") {
    const [jobId, amount, optParams] = args as [bigint, bigint, Hex];
    if (jobId !== job.jobId || amount !== job.budget || optParams !== "0x") throw new Error("setBudget calldata does not match the proven job");
    requireEvent(eventArgs(receipt, ERC8183_MAINNET.commerce, mainnetCommerceEvidenceAbi, "BudgetSet", (event) =>
      event.jobId === job.jobId && event.amount === job.budget), phase);
    return;
  }
  if (phase === "approve") {
    const [spender, amount] = args as [Address, bigint];
    if (!sameAddress(spender, ERC8183_MAINNET.commerce) || amount !== job.budget) throw new Error("approve calldata is not the exact required allowance");
    requireEvent(eventArgs(receipt, ERC8183_MAINNET.token, mainnetTokenEvidenceAbi, "Approval", (event) =>
      sameAddress(String(event.owner), job.buyer) && sameAddress(String(event.spender), ERC8183_MAINNET.commerce) && event.value === job.budget), phase);
    return;
  }
  if (phase === "fund") {
    const [jobId, expectedBudget, optParams] = args as [bigint, bigint, Hex];
    if (jobId !== job.jobId || expectedBudget !== job.budget || optParams !== "0x") throw new Error("fund calldata does not match the proven job");
    requireEvent(eventArgs(receipt, ERC8183_MAINNET.commerce, mainnetCommerceEvidenceAbi, "JobFunded", (event) =>
      event.jobId === job.jobId && sameAddress(String(event.client), job.buyer) && sameAddress(String(event.provider), job.seller) && event.amount === job.budget), phase);
    return;
  }
  if (phase === "submit") {
    const [jobId, deliverable, optParams] = args as [bigint, Hex, Hex];
    let deliverableUrl: unknown;
    try {
      deliverableUrl = (JSON.parse(hexToString(optParams)) as Record<string, unknown>).deliverable_url;
    } catch {
      throw new Error("submit calldata does not contain valid deliverable metadata");
    }
    if (
      jobId !== job.jobId ||
      deliverable.toLowerCase() !== job.deliverable.toLowerCase() ||
      deliverableUrl !== `https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/grid/job/${job.jobId}/response`
    ) throw new Error("submit calldata does not match the proven deliverable");
    requireEvent(eventArgs(receipt, ERC8183_MAINNET.commerce, mainnetCommerceEvidenceAbi, "JobSubmitted", (event) =>
      event.jobId === job.jobId && sameAddress(String(event.provider), job.seller) && String(event.deliverable).toLowerCase() === job.deliverable.toLowerCase()), phase);
    return;
  }
  const [jobId, evidence] = args as [bigint, Hex];
  if (jobId !== job.jobId || evidence !== "0x") throw new Error("settle calldata does not match the proven job");
  requireEvent(eventArgs(receipt, ERC8183_MAINNET.router, mainnetRouterEvidenceAbi, "JobSettled", (event) =>
    event.jobId === job.jobId && sameAddress(String(event.policy), ERC8183_MAINNET.policy) && event.verdict === 1), phase);
  requireEvent(eventArgs(receipt, ERC8183_MAINNET.commerce, mainnetCommerceEvidenceAbi, "JobCompleted", (event) =>
    event.jobId === job.jobId && sameAddress(String(event.evaluator), ERC8183_MAINNET.router)), phase);
}

function sourceObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Evidence input must be a JSON object");
  return value as Record<string, unknown>;
}

function hash(value: unknown, label: string): Hash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} is not a transaction hash`);
  return value as Hash;
}

async function main(): Promise<void> {
  const jobIdRaw = process.argv[2];
  const evidencePath = process.argv[3];
  const publish = process.argv.includes("--publish");
  if (!jobIdRaw || !/^\d+$/.test(jobIdRaw) || !evidencePath || process.argv.some((arg, index) => index > 3 && arg !== "--publish")) {
    throw new Error("Expected command: <jobId> <sanitized-browser-evidence.json> [--publish]");
  }
  const jobId = BigInt(jobIdRaw);
  const input = sourceObject(JSON.parse(await readFile(resolve(evidencePath), "utf8")));
  if (input.schemaVersion !== 1 || input.chainId !== 56 || input.jobId !== jobIdRaw) throw new Error("Evidence input does not match the Mainnet job");
  const transactionsInput = sourceObject(input.transactions);
  const repository = new MainnetErc8183Repository();
  const job = await repository.getJob(jobId);
  if (job.status !== "SUBMITTED" && job.status !== "COMPLETED") throw new Error("Mainnet proof requires SUBMITTED or COMPLETED state");
  if (publish && job.status !== "COMPLETED") throw new Error("Only a terminal COMPLETED Mainnet job can become the primary public proof");
  if (!job.result?.hashVerified) throw new Error("Mainnet deliverable hash is not verified");
  const parsedDescription = parseJobDescription(job.description);
  if (!parsedDescription) throw new Error("Mainnet job description is not a signed quote");
  const description = sourceObject(JSON.parse(job.description));
  const expectedPlan = buildGridPlan(parseGridTaskDescription(parsedDescription.task));
  if (JSON.stringify(JSON.parse(job.result.content)) !== JSON.stringify(expectedPlan)) throw new Error("Grid result is not the deterministic quoted computation");
  const client = createPublicClient({ chain: bsc, transport: http(ERC8183_MAINNET.rpcUrl) });
  const transactions: Record<string, MainnetJobTransactionProof> = {};
  let firstTimestamp: bigint | null = null;
  let lastTimestamp: bigint | null = null;
  let totalGasCost = 0n;
  const phaseBlocks: LifecyclePhaseBlocks = {};
  let previousPosition: { blockNumber: bigint; transactionIndex: number } | null = null;
  const phases = job.status === "COMPLETED"
    ? Object.entries(PHASE_TARGETS)
    : Object.entries(PHASE_TARGETS).filter(([phase]) => phase !== "settle");
  for (const [phase] of phases.filter(([phase]) => phase !== "approve" || transactionsInput.approve !== undefined)) {
    const txHash = hash(transactionsInput[phase], phase);
    const [receipt, transaction] = await Promise.all([
      client.getTransactionReceipt({ hash: txHash }),
      client.getTransaction({ hash: txHash }),
    ]);
    assertMainnetEvidenceTransaction({
      phase: phase as EvidencePhase,
      transaction: { from: transaction.from, to: transaction.to, input: transaction.input },
      receipt: { status: receipt.status, logs: receipt.logs },
      job: {
        jobId,
        buyer: job.buyer,
        seller: job.provider,
        description: job.description,
        deadline: BigInt(job.deadline),
        budget: BigInt(job.budgetRaw),
        deliverable: job.deliverableHash,
      },
    });
    const position = { blockNumber: receipt.blockNumber, transactionIndex: receipt.transactionIndex };
    if (previousPosition && (position.blockNumber < previousPosition.blockNumber || (position.blockNumber === previousPosition.blockNumber && position.transactionIndex <= previousPosition.transactionIndex))) {
      throw new Error(`${phase} transaction is out of lifecycle order`);
    }
    previousPosition = position;
    phaseBlocks[phase as EvidencePhase] = receipt.blockNumber;
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
    totalGasCost += gasCost;
    firstTimestamp = firstTimestamp === null || block.timestamp < firstTimestamp ? block.timestamp : firstTimestamp;
    lastTimestamp = lastTimestamp === null || block.timestamp > lastTimestamp ? block.timestamp : lastTimestamp;
    transactions[phase] = proofTransaction(txHash, receipt.blockNumber, block.timestamp, receipt.gasUsed, receipt.effectiveGasPrice);
  }
  const fundedAtBlock = phaseBlocks.fund;
  if (firstTimestamp === null || lastTimestamp === null || phaseBlocks.createJob === undefined || fundedAtBlock === undefined) {
    throw new Error("Proof timestamps or lifecycle blocks are unavailable");
  }
  const config = repository.allowlist;
  const [identity, signature] = await Promise.all([
    resolveIdentity(client, config.agentId, {
      chainId: 56,
      registry: ERC8183_MAINNET.registry,
      blockNumber: fundedAtBlock,
    }),
    verifyQuoteSignature({
      envelope: description,
      provider: config.seller,
      publicClient: client,
      expectedVerifyingContract: ERC8183_MAINNET.commerce,
      blockNumber: fundedAtBlock,
    }),
    assertMainnetLifecycleImplementationPins(client, phaseBlocks),
  ]);
  assertMainnetProofBinding({
    job,
    description,
    identity,
    expectedAgentId: config.agentId,
    expectedSeller: config.seller,
    expectedOrigin: "https://bnb-agent-marketplace-ruby.vercel.app",
    signatureValid: signature.valid,
  });
  const proof: MainnetJobProof = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    chainId: 56,
    agentId: String(identity.agentId),
    jobId: jobIdRaw,
    buyer: getAddress(job.buyer),
    seller: getAddress(job.provider),
    token: getAddress(job.quotedToken!),
    budgetRaw: job.budgetRaw,
    finalState: job.status,
    deliverableHash: job.deliverableHash,
    resultHashVerified: true,
    deterministicResultVerified: true,
    durationSeconds: (lastTimestamp - firstTimestamp).toString(),
    totalGasCostWei: totalGasCost.toString(),
    transactions,
  };
  const destination = publish
    ? resolve("src/data/proofs/bsc-mainnet-primary.json")
    : resolve(`.marketplace/mainnet/job-${jobIdRaw}-proof.json`);
  if (publish) {
    const historyDestination = resolve("src/data/proofs/bsc-mainnet-history.json");
    const historyValue = JSON.parse(await readFile(historyDestination, "utf8")) as unknown;
    if (!historyValue || typeof historyValue !== "object" || Array.isArray(historyValue)) {
      throw new Error("Mainnet proof history is invalid");
    }
    const history = historyValue as { schemaVersion?: unknown; proofs?: unknown };
    if (history.schemaVersion !== 1 || !Array.isArray(history.proofs)) {
      throw new Error("Mainnet proof history schema is unsupported");
    }
    const existing = history.proofs.find((entry) => (
      entry && typeof entry === "object" && !Array.isArray(entry)
      && Reflect.get(entry, "chainId") === proof.chainId
      && Reflect.get(entry, "jobId") === proof.jobId
    ));
    if (existing && JSON.stringify(existing) !== JSON.stringify(proof)) {
      throw new Error(`Mainnet proof history conflicts for job ${proof.jobId}`);
    }
    if (!existing) history.proofs.push(proof);
    await writeFile(historyDestination, `${JSON.stringify(history, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  await writeFile(destination, `${JSON.stringify({ schemaVersion: 1, proof }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`Captured sanitized Mainnet Job ${jobIdRaw} proof at ${destination}\n`);
}

function proofTransaction(txHash: Hash, blockNumber: bigint, timestamp: bigint, gasUsed: bigint, effectiveGasPrice: bigint): MainnetJobTransactionProof {
  return {
    hash: txHash,
    blockNumber: blockNumber.toString(),
    timestamp: new Date(Number(timestamp) * 1_000).toISOString(),
    gasUsed: gasUsed.toString(),
    effectiveGasPrice: effectiveGasPrice.toString(),
    gasCostWei: (gasUsed * effectiveGasPrice).toString(),
    explorerUrl: `${ERC8183_MAINNET.explorerUrl}/tx/${txHash}`,
    provenance: "onchain:bsc-mainnet-rpc",
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(() => {
    process.stderr.write("Mainnet proof capture failed; no sensitive details were emitted.\n");
    process.exitCode = 1;
  });
}
