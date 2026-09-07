import { describe, expect, it } from "vitest";
import { jobNextStep, refundDeadlinePassed } from "../src/business/entities/job-next-step";

const deadline = "2026-09-07T12:00:00Z";
const job = { status: "FUNDED" as const, expiresAt: deadline, chainId: 97 as const };
const now = Date.parse(deadline);

describe("job next step", () => {
  it("requires the funded deadline to have strictly passed", () => {
    expect(jobNextStep(job, now).label).toBe("Awaiting delivery");
    expect(jobNextStep(job, now + 1000).label).toBe("Withdrawal available");
    expect(refundDeadlinePassed("SUBMITTED", 1n, 2n)).toBe(false);
  });
  it("does not describe an elapsed deadline as money returned", () => {
    expect(jobNextStep(job, now + 1000)).toEqual({ label: "Withdrawal available", actionable: true });
    expect(jobNextStep({ ...job, status: "EXPIRED" }, now)).toEqual({ label: "Deposit withdrawn", actionable: false });
  });
  it("keeps submitted and unfunded jobs out of withdrawal even after expiry", () => {
    expect(jobNextStep({ ...job, status: "SUBMITTED" }, now + 1000).label).toBe("Review delivery");
    expect(jobNextStep({ ...job, status: "OPEN" }, now + 1000).label).toBe("Awaiting funding");
  });
  it("does not promise enabled Mainnet withdrawals or infer missing dates", () => {
    expect(jobNextStep({ ...job, chainId: 56 }, now + 1000).label).toBe("Check withdrawal");
    expect(jobNextStep({ ...job, expiresAt: "invalid" }, now).label).toBe("Check status");
    expect(jobNextStep(job, null).label).toBe("Check status");
  });
});
