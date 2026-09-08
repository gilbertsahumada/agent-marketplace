import type { Erc8183JobFacts } from "@/src/business/entities/erc8183-browser-spike";
import type { JobStateFacts } from "./job-state-card";

function date(seconds: string): string | null {
  const value = Number(seconds) * 1000;
  return Number.isFinite(value) && value > 0 && value <= 8.64e15 ? new Date(value).toISOString() : null;
}

export function directJobState(job: Erc8183JobFacts): JobStateFacts {
  return {
    chainId: job.chainId, buyer: job.buyer, provider: job.provider, evaluator: job.evaluator,
    policy: job.policy,
    budgetRaw: job.budgetRaw, expiresAt: date(job.deadline) ?? "", submittedAt: date(job.submittedAt),
    deliverable: /^0x0+$/.test(job.deliverableHash) ? null : job.deliverableHash,
    // Do not invent transaction history from the current state.
    events: [],
  };
}
