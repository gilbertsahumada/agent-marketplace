import type { HireChainId, HireJob, HireJobsScope } from "@/src/business/entities/hire-job";
import type { MainnetJobProof } from "@/src/business/entities/mainnet-job-proof";

export type JobHistoryTotals = { total: number; completed: number; funded: number; submitted: number };

/** Indexed state leads. Wallet activity is shown, but is not an agent credential. */
export function agentJobHistory(input: {
  chainId: HireChainId;
  scope: HireJobsScope;
  jobs: readonly HireJob[] | null;
  proofs: readonly MainnetJobProof[];
  totals?: JobHistoryTotals;
}) {
  const indexed = [...new Map((input.jobs ?? []).filter(job => job.chainId === input.chainId).map(job => [`${job.chainId}:${job.jobId}`, job])).values()];
  const proofMap = new Map((input.chainId === 56 ? input.proofs : []).map(job => [job.jobId, job]));
  const current = new Map(indexed.map(job => [job.jobId, job]));
  // When the ledger is available it owns the paginated list. Injecting a proof
  // absent from this page could duplicate the same job on a later cursor page.
  const proofs = input.jobs === null ? [...proofMap.values()] : [];
  const agentCompleted = input.scope === "agent" && input.totals
    ? input.totals.completed
    : [...proofMap.values()].filter(proof => (current.get(proof.jobId)?.status ?? proof.finalState) === "COMPLETED").length;
  const agentTotal = input.scope === "agent" && input.totals ? input.totals.total : proofMap.size;
  return { indexed, proofs, agentCompleted, agentTotal, resultVerified: proofMap.size, totals: input.totals ?? null };
}
