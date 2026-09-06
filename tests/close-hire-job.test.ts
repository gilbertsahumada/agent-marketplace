import { describe, expect, it, vi } from "vitest";
import { assertClosureAllowed, closeHireJob, type ClosureAttempt, type ClosureFacts, type ClosurePort } from "../src/business/use-cases/close-hire-job";
const binding = { chainId: 56, commerce: "0xcommerce", jobId: "56719", wallet: "0xbuyer", action: "settle" as const };
const facts: ClosureFacts = { status: "SUBMITTED", buyer: "0xbuyer", supported: true, disputed: false, verdict: 1, now: 20n, reviewEndsAt: 30n };
function setup() {
  let saved: ClosureAttempt | null = null;
  const port: ClosurePort = { read: vi.fn(async () => facts), assertWallet: vi.fn(async () => {}), simulate: vi.fn(async () => {}), send: vi.fn(async () => "0xtx"), verify: vi.fn(async () => "confirmed" as const), load: () => saved, save: vi.fn(attempt => { saved = attempt; }), exclusive: run => run() };
  return port;
}
describe("safe closure", () => {
  it("retains replacement metadata when persisting confirmation fails once", async () => {
    const port = setup();
    const persist = port.save;
    let failed = false;
    port.save = vi.fn(attempt => {
      if (attempt.state === "confirmed" && !failed) {
        failed = true;
        throw new Error("storage temporarily unavailable");
      }
      persist(structuredClone(attempt));
    });
    vi.mocked(port.verify).mockImplementationOnce(async (_hash, replacement) => {
      replacement?.("0xreplacement");
      return "confirmed";
    });
    const result = await closeHireJob(binding, port, "send");
    expect(result).toMatchObject({ state: "uncertain", hash: "0xtx", replacementHash: "0xreplacement", replacementHashes: ["0xreplacement"] });
    expect(port.load()).toEqual(result);
    expect(port.send).toHaveBeenCalledOnce();
    await expect(closeHireJob(binding, port, "send")).rejects.toThrow(/already exists/);
  });
  it("does not overwrite persisted replacement evidence when storage stays unavailable", async () => {
    const port = setup();
    const persist = port.save;
    let unavailable = false;
    port.save = vi.fn(attempt => {
      if (unavailable) throw new Error("storage unavailable");
      persist(structuredClone(attempt));
    });
    vi.mocked(port.verify).mockImplementationOnce(async (_hash, replacement) => {
      replacement?.("0xreplacement");
      unavailable = true;
      return "confirmed";
    });
    await expect(closeHireJob(binding, port, "send")).rejects.toThrow("storage unavailable");
    expect(port.load()).toMatchObject({ state: "submitted", hash: "0xtx", replacementHash: "0xreplacement", replacementHashes: ["0xreplacement"] });
    expect(port.send).toHaveBeenCalledOnce();
    await expect(closeHireJob(binding, port, "send")).rejects.toThrow(/already exists/);
  });
  it.each(["cancelled", "replaced"] as const)("allows an explicit retry after revalidating %s", async state => {
    const port = setup();
    vi.mocked(port.verify).mockResolvedValueOnce(state).mockResolvedValueOnce(state);
    await closeHireJob(binding, port, "send");
    expect((await closeHireJob(binding, port, "send")).previousAttempts?.[0]?.state).toBe(state);
    expect(port.send).toHaveBeenCalledTimes(2);
  });
  it("does not send if the job closes during simulation", async () => {
    const port = setup();
    vi.mocked(port.read).mockResolvedValueOnce(facts).mockResolvedValueOnce({ ...facts, status: "COMPLETED" });
    expect((await closeHireJob(binding, port, "send")).state).toBe("already_closed");
    expect(port.send).not.toHaveBeenCalled();
  });
  it("rechecks a reverted receipt before a fresh explicit send and preserves history", async () => {
    const port = setup();
    vi.mocked(port.verify).mockResolvedValueOnce("reverted").mockResolvedValueOnce("reverted");
    await closeHireJob(binding, port, "send");
    const result = await closeHireJob(binding, port, "send");
    expect(result.state).toBe("confirmed");
    expect(result.previousAttempts?.[0]?.state).toBe("reverted");
    expect(port.verify).toHaveBeenCalledTimes(3);
  });
  it("does not resend if a previously reverted receipt is now uncertain", async () => {
    const port = setup();
    vi.mocked(port.verify).mockResolvedValueOnce("reverted").mockResolvedValueOnce("pending");
    await closeHireJob(binding, port, "send");
    expect((await closeHireJob(binding, port, "send")).state).toBe("uncertain");
    expect(port.send).toHaveBeenCalledOnce();
  });
  it("retains a rejected signature and permits only a fresh explicit attempt", async () => {
    const port = setup();
    vi.mocked(port.send).mockRejectedValueOnce(Object.assign(new Error("User rejected"), { code: 4001 }));
    expect((await closeHireJob(binding, port, "send")).state).toBe("rejected");
    expect(port.send).toHaveBeenCalledOnce();
    await expect(closeHireJob(binding, port, "resume")).rejects.toThrow(/No transaction hash/);
    const next = await closeHireJob(binding, port, "send");
    expect(next.state).toBe("confirmed");
    expect(next.previousAttempts).toEqual([expect.objectContaining({ state: "rejected" })]);
    expect(port.read).toHaveBeenCalledTimes(4);
  });
  it("never treats a verification error after broadcast as a rejected signature", async () => {
    const port = setup();
    vi.mocked(port.verify).mockRejectedValueOnce(Object.assign(new Error("Rejected RPC"), { code: 4001 }));
    expect((await closeHireJob(binding, port, "send")).state).toBe("uncertain");
    await expect(closeHireJob(binding, port, "send")).rejects.toThrow(/already exists/);
  });
  it("simulates, checks state twice and persists before signing", async () => {
    const port = setup();
    expect((await closeHireJob(binding, port, "send")).state).toBe("confirmed");
    expect(port.read).toHaveBeenCalledTimes(2);
    expect(port.simulate).toHaveBeenCalledOnce();
    expect(vi.mocked(port.save).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(port.send).mock.invocationCallOrder[0]!);
    await expect(closeHireJob(binding, port, "send")).rejects.toThrow(/already exists/);
    await closeHireJob(binding, port, "resume");
    expect(port.send).toHaveBeenCalledOnce();
  });
  it("retains uncertain broadcasts and only verifies on resume", async () => {
    const port = setup();
    vi.mocked(port.verify).mockRejectedValueOnce(new Error("timeout"));
    expect((await closeHireJob(binding, port, "send")).state).toBe("uncertain");
    expect((await closeHireJob(binding, port, "resume")).state).toBe("confirmed");
    expect(port.send).toHaveBeenCalledOnce();
  });
  it("blocks a wallet change and storage failure before sending", async () => {
    const port = setup();
    vi.mocked(port.assertWallet).mockResolvedValueOnce().mockRejectedValueOnce(new Error("changed"));
    await expect(closeHireJob(binding, port, "send")).rejects.toThrow("changed");
    expect(port.send).not.toHaveBeenCalled();
    const broken = setup(); broken.save = () => { throw new Error("storage"); };
    await expect(closeHireJob(binding, broken, "send")).rejects.toThrow("storage");
    expect(broken.send).not.toHaveBeenCalled();
  });
  it("rejects wrong buyers, ended windows, terminal jobs and unsupported policies", () => {
    expect(() => assertClosureAllowed({ ...binding, action: "dispute", wallet: "other" }, facts)).toThrow(/original buyer/);
    expect(() => assertClosureAllowed({ ...binding, action: "dispute" }, { ...facts, now: 30n })).toThrow(/ended/);
    expect(() => assertClosureAllowed(binding, { ...facts, status: "COMPLETED" })).toThrow(/awaiting closure/);
    expect(() => assertClosureAllowed(binding, { ...facts, supported: false })).toThrow(/Unsupported/);
    expect(() => assertClosureAllowed(binding, { ...facts, verdict: 0 })).toThrow(/no settlement/);
    expect(() => assertClosureAllowed(binding, { ...facts, disputed: true, verdict: 2 })).not.toThrow();
  });
});
