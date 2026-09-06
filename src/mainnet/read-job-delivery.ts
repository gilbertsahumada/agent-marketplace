import "server-only";
import { CommerceClient, RouterClient, JobStatus, PolicyClient } from "@bnbagent/sdk/erc8183";
import { createPublicClient, http, decodeFunctionData, decodeEventLog, hexToString, isAddressEqual } from "viem";
import type { HireJobDetail } from "../business/entities/hire-job";
import { createSafeEndpointTransport } from "../verification/safe-http";
import { readBoundedJson } from "../verification/bounded-json";
import { ERC8183_MAINNET as pins, mainnetCommerceEvidenceAbi } from "./contracts";
import { mainnetImplementationPinsMatch } from "./implementation-pins";
import { closureState, verifyDelivery, requestTextsFromDescription, type DeliveryReport } from "./job-delivery";

/** Read-only: no wallet, no settle/dispute calls, no speculative URL discovery. */
export async function readJobDelivery(ledger: HireJobDetail): Promise<DeliveryReport> {
  const report: DeliveryReport = { jobId: ledger.jobId, status: ledger.status, checkedAt: new Date().toISOString(),
    delivery: { status: "unavailable", content: null, url: null }, closure: "unavailable", reviewEndsAt: null, policy: null };
  if (ledger.chainId !== 56) return report;
  try {
    const p = createPublicClient({ transport: http(process.env.BSC_RPC_URL?.trim() || pins.rpcUrl, { timeout: 3_000, retryCount: 0 }) });
    if (await p.getChainId() !== 56 || !await mainnetImplementationPinsMatch(p)) return report;
    const id = BigInt(ledger.jobId);
    const [job, policy, block] = await Promise.all([new CommerceClient(p, pins.commerce).getJob(id), new RouterClient(p, pins.router).jobPolicy(id), p.getBlock()]);
    if (!isAddressEqual(job.client, ledger.buyer) || !isAddressEqual(job.provider, ledger.provider)) return report;
    report.status = JobStatus[job.status];
    report.requestTexts = requestTextsFromDescription(job.description);
    report.policy = policy;
    if (["COMPLETED", "REJECTED", "EXPIRED"].includes(report.status)) report.closure = closureState(report.status, false, 0, 0, 0);
    // A different evaluator/policy must not inherit our optimistic-policy rules.
    if (isAddressEqual(job.evaluator, pins.router) && isAddressEqual(policy, pins.policy)) {
      try {
        const boundPolicy = new PolicyClient(p, policy);
        const [window, disputed, verdict] = await Promise.all([boundPolicy.disputeWindow(), boundPolicy.disputed(id), boundPolicy.check(id)]);
        const eligible = Number(job.submittedAt + window);
        report.reviewEndsAt = job.submittedAt > 0n ? new Date(eligible * 1000).toISOString() : null;
        report.closure = closureState(report.status, disputed, verdict[0], eligible, Number(block.timestamp));
      } catch { /* Policy unavailability must not hide an accessible delivery. */ }
    } else if (report.closure === "unavailable") report.closure = "unsupported_policy";
    if (job.submittedAt === 0n) { report.delivery.status = "not_submitted"; return report; }
    const submission = [...ledger.events].reverse().find(event => event.eventName === "JobSubmitted" && event.deliverable?.toLowerCase() === job.deliverable.toLowerCase());
    if (!submission) return report;
    const [tx, receipt] = await Promise.all([p.getTransaction({ hash: submission.txHash }), p.getTransactionReceipt({ hash: submission.txHash })]);
    if (receipt.status !== "success" || !tx.to || !isAddressEqual(tx.to, pins.commerce)) return report;
    const confirmed = receipt.logs.some(log => {
      if (!isAddressEqual(log.address, pins.commerce)) return false;
      try {
        const decoded = decodeEventLog({ abi: mainnetCommerceEvidenceAbi, data: log.data, topics: log.topics });
        return decoded.eventName === "JobSubmitted" && decoded.args.jobId === id && decoded.args.deliverable === job.deliverable && isAddressEqual(decoded.args.provider, job.provider);
      } catch { return false; }
    });
    if (!confirmed) return report;
    const call = decodeFunctionData({ abi: mainnetCommerceEvidenceAbi, data: tx.input });
    if (call.functionName !== "submit" || call.args[0] !== id || call.args[1] !== job.deliverable) return report;
    const params = JSON.parse(hexToString(call.args[2])) as { deliverable_url?: unknown };
    if (typeof params.deliverable_url !== "string" || params.deliverable_url.length > 2048) return report;
    const transport = await createSafeEndpointTransport(params.deliverable_url, { timeoutMs: 8_000, maxResponseBytes: 64 * 1024 });
    try {
      const response = await transport.fetch(transport.url, { cache: "no-store" });
      if (!response.ok) return report;
      const raw = await readBoundedJson(response, { maxBytes: 64 * 1024, tooLargeMessage: "Delivery too large", invalidJsonMessage: "Invalid delivery" });
      report.delivery = { ...verifyDelivery(raw, { jobId: ledger.jobId, hash: job.deliverable, policy }), url: transport.url.href };
    } finally { await transport.close(); }
  } catch { /* Keep chain/policy and delivery failures separate, without leaking upstream errors. */ }
  return report;
}
