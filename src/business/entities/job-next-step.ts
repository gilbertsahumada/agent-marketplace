import type { HireJob } from "./hire-job.ts";

/** Expiry alone never means the escrow has already been returned. */
export function refundDeadlinePassed(status: string, deadline: bigint, now: bigint): boolean {
  return status === "FUNDED" && now > deadline;
}

export function jobNextStep(job: Pick<HireJob, "status" | "expiresAt" | "chainId">, now: number | null): { label: string; actionable: boolean } {
  switch (job.status) {
    case "EXPIRED": return { label: "Deposit withdrawn", actionable: false };
    case "COMPLETED": return { label: "Completed", actionable: false };
    case "REJECTED": return { label: "Rejected", actionable: false };
    case "SUBMITTED": return { label: "Review delivery", actionable: true };
    case "OPEN": return { label: "Awaiting funding", actionable: false };
    case "FUNDED": {
      const deadline = Date.parse(job.expiresAt);
      if (now === null || !Number.isFinite(deadline)) return { label: "Check status", actionable: true };
      if (refundDeadlinePassed(job.status, BigInt(Math.floor(deadline / 1000)), BigInt(Math.floor(now / 1000)))) {
        return { label: job.chainId === 97 ? "Withdrawal available" : "Check withdrawal", actionable: true };
      }
      return { label: "Awaiting delivery", actionable: false };
    }
  }
}
