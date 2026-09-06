import "server-only";
import { DeliverableManifest, JobDescription } from "@bnbagent/sdk/erc8183";
import { isAddressEqual } from "viem";
import { ERC8183_MAINNET as pins } from "./contracts.ts";

export type Delivery = { status: "verified" | "mismatch" | "unsupported" | "unavailable" | "not_submitted"; content: string | null; url: string | null };
export type JobClosure = "completed" | "rejected" | "expired" | "not_submitted" | "review_window" | "disputed" | "settlement_available" | "awaiting_policy" | "unsupported_policy" | "unavailable";
export type DeliveryReport = {
  jobId: string; status: string; checkedAt: string; delivery: Delivery;
  closure: JobClosure; reviewEndsAt: string | null; policy: string | null;
  requestTexts?: string[];
};

/** Only request fields from the job's on-chain description, never inferred from seller prose. */
export function requestTextsFromDescription(description: string): string[] {
  try {
    const request = JobDescription.fromStr(description);
    if (!request) return [];
    return [...new Set([request.task, request.terms.deliverables, request.terms.qualityStandards, request.terms.successCriteria]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 8_000))];
  } catch { return []; }
}
const same = (a: unknown, b: string) => typeof a === "string" && /^0x[\da-f]{40}$/i.test(a) && isAddressEqual(a as `0x${string}`, b as `0x${string}`);

export function verifyDelivery(raw: unknown, binding: { jobId: string; hash: string; policy: string }): Delivery {
  const result: Delivery = { status: "unsupported", content: null, url: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  const data = raw as Record<string, unknown>;
  const response = data.response as { content?: unknown } | undefined;
  if (typeof response?.content !== "string" || response.content.length > 32_000) return result;
  result.content = response.content;
  try {
    const manifest = DeliverableManifest.fromDict(data);
    result.status = String(manifest.jobId) === binding.jobId && manifest.chainId === 56 &&
      same(manifest.contracts?.commerce, pins.commerce) && same(manifest.contracts?.router, pins.router) &&
      same(manifest.contracts?.policy, binding.policy) && /^0x[\da-f]{64}$/i.test(binding.hash) && manifest.verify(binding.hash as `0x${string}`)
      ? "verified" : "mismatch";
  } catch { /* Unsupported manifests remain explicitly unverified. */ }
  return result;
}

export function closureState(status: string, disputed: boolean, verdict: number, eligibleAt: number, now: number): JobClosure {
  if (status === "COMPLETED") return "completed";
  if (status === "REJECTED") return "rejected";
  if (status === "EXPIRED") return "expired";
  if (status !== "SUBMITTED") return "not_submitted";
  if (disputed) return "disputed";
  if (now < eligibleAt) return "review_window";
  return verdict === 1 || verdict === 2 ? "settlement_available" : "awaiting_policy";
}
