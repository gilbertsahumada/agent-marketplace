import { ERC8183Client, JobStatus } from "@bnbagent/sdk/erc8183";
import { resolveNetwork } from "@bnbagent/sdk";
import { EVMWalletProvider } from "@bnbagent/sdk/wallets";
import { isAddressEqual } from "viem";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ERC8183_MAINNET } from "./contracts.ts";
import { loadMainnetGridSellerConfig } from "./grid-seller-config.ts";

async function main(): Promise<void> {
  const jobIdRaw = process.argv[2];
  const execute = process.argv.includes("--execute");
  const evidenceIndex = process.argv.indexOf("--evidence");
  const evidencePath = evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : undefined;
  const allowedArguments = new Set(["--execute", "--evidence", evidencePath]);
  if (!jobIdRaw || !/^\d+$/.test(jobIdRaw) || (evidenceIndex >= 0 && !evidencePath) || process.argv.some((arg, index) => index > 2 && !allowedArguments.has(arg))) {
    throw new Error("Expected command: <jobId> [--execute] [--evidence sanitized-browser-evidence.json]");
  }
  const jobId = BigInt(jobIdRaw);
  const config = loadMainnetGridSellerConfig();
  const wallet = new EVMWalletProvider({ password: "in-memory-only", privateKey: config.privateKey, persist: false });
  const client = await ERC8183Client.create({ walletProvider: wallet, network: resolveNetwork("bsc-mainnet") });
  const [job, policy, disputeWindow, latestBlock] = await Promise.all([
    client.getJob(jobId),
    client.router.jobPolicy(jobId),
    client.policy.disputeWindow(),
    client.publicClient.getBlock(),
  ]);
  if (!isAddressEqual(job.provider, config.address) || !isAddressEqual(job.evaluator, ERC8183_MAINNET.router) || !isAddressEqual(policy, ERC8183_MAINNET.policy)) {
    throw new Error("Job is outside the Mainnet Grid seller allowlist");
  }
  if (job.status === JobStatus.COMPLETED) {
    process.stdout.write(`${JSON.stringify({ status: "ALREADY_COMPLETED", chainId: 56, jobId: jobIdRaw })}\n`);
    return;
  }
  if (job.status !== JobStatus.SUBMITTED || job.deliverable === `0x${"0".repeat(64)}`) {
    throw new Error("Only a submitted Grid job with a deliverable can be settled");
  }
  const eligibleAt = job.submittedAt + disputeWindow;
  if (latestBlock.timestamp < eligibleAt) {
    throw new Error(`Settlement window is not open until Unix ${eligibleAt}`);
  }
  if (!execute) {
    process.stdout.write(`${JSON.stringify({ status: "DRY_RUN_NO_TRANSACTION", chainId: 56, jobId: jobIdRaw, eligibleAt: eligibleAt.toString() })}\n`);
    return;
  }
  const result = await client.settle(jobId);
  const completed = await client.getJob(jobId);
  if (completed.status !== JobStatus.COMPLETED) throw new Error("Settlement transaction did not complete the job");
  if (evidencePath) {
    const path = resolve(evidencePath);
    const evidence = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (evidence.chainId !== 56 || evidence.jobId !== jobIdRaw || !evidence.transactions || typeof evidence.transactions !== "object" || Array.isArray(evidence.transactions)) {
      throw new Error("Sanitized evidence file does not match the settled job");
    }
    evidence.transactions = { ...(evidence.transactions as Record<string, unknown>), settle: result.transactionHash };
    await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify({ status: "COMPLETED", chainId: 56, jobId: jobIdRaw, transactionHash: result.transactionHash })}\n`);
}

main().catch(() => {
  process.stderr.write("Mainnet Grid job settlement failed; no secret details were emitted.\n");
  process.exitCode = 1;
});
