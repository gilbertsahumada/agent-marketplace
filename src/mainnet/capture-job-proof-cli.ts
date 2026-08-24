import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, getAddress, http, isAddressEqual, type Hash } from "viem";
import { bsc } from "viem/chains";
import type { MainnetJobProof, MainnetJobTransactionProof } from "../business/entities/mainnet-job-proof.js";
import { buildGridPlan, parseGridTaskDescription } from "../business/policies/grid-plan-policy.js";
import { parseJobDescription } from "@bnbagent/sdk/erc8183";
import { ERC8183_MAINNET } from "./contracts.js";
import { MainnetErc8183Repository } from "./mainnet-erc8183-repository.js";

const PHASE_TARGETS = {
  createJob: ERC8183_MAINNET.commerce,
  registerJob: ERC8183_MAINNET.router,
  setBudget: ERC8183_MAINNET.commerce,
  approve: ERC8183_MAINNET.token,
  fund: ERC8183_MAINNET.commerce,
  submit: ERC8183_MAINNET.commerce,
  settle: ERC8183_MAINNET.router,
} as const;

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
  const expectedPlan = buildGridPlan(parseGridTaskDescription(parsedDescription.task));
  if (JSON.stringify(JSON.parse(job.result.content)) !== JSON.stringify(expectedPlan)) throw new Error("Grid result is not the deterministic quoted computation");
  const client = createPublicClient({ chain: bsc, transport: http(ERC8183_MAINNET.rpcUrl) });
  const transactions: Record<string, MainnetJobTransactionProof> = {};
  let firstTimestamp: bigint | null = null;
  let lastTimestamp: bigint | null = null;
  let totalGasCost = 0n;
  const phases = job.status === "COMPLETED"
    ? Object.entries(PHASE_TARGETS)
    : Object.entries(PHASE_TARGETS).filter(([phase]) => phase !== "settle");
  for (const [phase, target] of phases.filter(([phase]) => phase !== "approve" || transactionsInput.approve !== undefined)) {
    const txHash = hash(transactionsInput[phase], phase);
    const [receipt, transaction] = await Promise.all([
      client.getTransactionReceipt({ hash: txHash }),
      client.getTransaction({ hash: txHash }),
    ]);
    if (receipt.status !== "success" || !transaction.to || !isAddressEqual(transaction.to, target)) throw new Error(`${phase} receipt is not allowlisted`);
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
    totalGasCost += gasCost;
    firstTimestamp = firstTimestamp === null || block.timestamp < firstTimestamp ? block.timestamp : firstTimestamp;
    lastTimestamp = lastTimestamp === null || block.timestamp > lastTimestamp ? block.timestamp : lastTimestamp;
    transactions[phase] = proofTransaction(txHash, receipt.blockNumber, block.timestamp, receipt.gasUsed, receipt.effectiveGasPrice);
  }
  if (firstTimestamp === null || lastTimestamp === null) throw new Error("Proof timestamps are unavailable");
  const proof: MainnetJobProof = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    chainId: 56,
    agentId: String(repository.allowlist.agentId),
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

main().catch(() => {
  process.stderr.write("Mainnet proof capture failed; no sensitive details were emitted.\n");
  process.exitCode = 1;
});
