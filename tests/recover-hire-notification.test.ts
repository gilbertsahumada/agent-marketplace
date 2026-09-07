import { describe, expect, it, vi } from "vitest";
import { recoverHireNotification, type NotificationRecoveryPort } from "../src/business/use-cases/recover-hire-notification";
import type { HireNotification } from "../shared/hire-notification";
import type { Erc8183JobFacts } from "../src/business/entities/erc8183-browser-spike";

function fixture(state: HireNotification["state"] = "processing") {
  const row = { chainId: 97, jobId: "1066", agentId: "2197", quoteRequestId: 1, buyer: "buyer", state, attempts: 1, leaseToken: "lease" } as HireNotification;
  const job = { status: "FUNDED", deadline: "200" } as Erc8183JobFacts;
  const notify = vi.fn(async (beforeSend: () => Promise<void>) => { await beforeSend(); return { acknowledged: true as const, alreadySubmitted: false, job }; });
  const port: NotificationRecoveryPort = { claim: vi.fn(async () => row), prepare: vi.fn(async () => ({ job, notify })), sending: vi.fn(async () => {}), finish: vi.fn(async () => {}), now: () => 100000 };
  return { row, job, notify, port };
}
describe("durable hire notification recovery", () => {
  it("fences the send and records acknowledgement", async () => {
    const { port, notify } = fixture();
    expect((await recoverHireNotification(port))?.state).toBe("notified");
    expect(notify).toHaveBeenCalledOnce();
    expect(port.sending).toHaveBeenCalledOnce();
  });
  it("retries an unavailable quote before dispatch", async () => {
    const { port, notify } = fixture();
    vi.mocked(port.prepare).mockRejectedValue(new Error("quote unavailable"));
    expect((await recoverHireNotification(port))?.state).toBe("pending");
    expect(notify).not.toHaveBeenCalled();
  });
  it("does not resend a timed-out dispatch after restart", async () => {
    const { port, notify, row } = fixture();
    notify.mockImplementation(async fence => { await fence(); throw new Error("timeout"); });
    expect((await recoverHireNotification(port))?.state).toBe("uncertain");
    row.state = "uncertain";
    await recoverHireNotification(port);
    expect(notify).toHaveBeenCalledOnce();
  });
  it("reconciles delivery after a lost seller response", async () => {
    const { port, job, notify } = fixture("uncertain");
    job.status = "SUBMITTED";
    expect((await recoverHireNotification(port))?.state).toBe("delivered");
    expect(notify).not.toHaveBeenCalled();
  });
  it("stops at expiry and escalates bounded failures", async () => {
    const { port, job, row, notify } = fixture();
    job.deadline = "100";
    expect((await recoverHireNotification(port))?.state).toBe("stopped");
    expect(notify).not.toHaveBeenCalled();
    vi.mocked(port.prepare).mockRejectedValue(new Error("offline"));
    row.attempts = 6;
    expect((await recoverHireNotification(port))?.state).toBe("attention");
  });
  it("does not send when another runner owns the job", async () => {
    const { port, notify } = fixture();
    vi.mocked(port.claim).mockResolvedValue(null);
    expect(await recoverHireNotification(port)).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
  it("fails before dispatch when persistence cannot fence the send", async () => {
    const { port } = fixture();
    vi.mocked(port.sending).mockRejectedValue(new Error("D1 offline"));
    expect((await recoverHireNotification(port))?.state).toBe("uncertain");
  });
});
