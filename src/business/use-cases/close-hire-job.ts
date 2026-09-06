export type ClosureAction = "dispute" | "settle";
export type ClosureBinding = { chainId: number; commerce: string; jobId: string; wallet: string; action: ClosureAction };
export type ClosureFacts = { status: string; buyer: string; supported: boolean; disputed: boolean; verdict: number; now: bigint; reviewEndsAt: bigint };
export type ClosureAttempt = ClosureBinding & { state: "signing" | "submitted" | "confirmed" | "reverted" | "uncertain"; hash?: string };
export interface ClosurePort {
  read(): Promise<ClosureFacts>;
  assertWallet(): Promise<void>;
  simulate(): Promise<void>;
  send(): Promise<string>;
  verify(hash: string): Promise<"confirmed" | "reverted" | "pending">;
  load(): ClosureAttempt | null;
  save(attempt: ClosureAttempt): void;
  /** Must exclude concurrent tabs as well as concurrent clicks. */
  exclusive<T>(run: () => Promise<T>): Promise<T>;
}

export function assertClosureAllowed(binding: ClosureBinding, facts: ClosureFacts): void {
  if (!facts.supported) throw new Error("Unsupported closure policy or contracts");
  if (facts.status !== "SUBMITTED") throw new Error("Job is not awaiting closure");
  if (binding.action === "dispute") {
    if (binding.wallet.toLowerCase() !== facts.buyer.toLowerCase()) throw new Error("Only the original buyer can dispute");
    if (facts.disputed) throw new Error("Job already disputed");
    if (facts.now >= facts.reviewEndsAt) throw new Error("Dispute window has ended");
  } else if (facts.verdict !== 1 && facts.verdict !== 2) throw new Error("Policy has no settlement verdict");
}

function sameAttempt(a: ClosureBinding, b: ClosureBinding): boolean {
  return a.chainId === b.chainId && a.jobId === b.jobId && a.action === b.action &&
    a.commerce.toLowerCase() === b.commerce.toLowerCase() && a.wallet.toLowerCase() === b.wallet.toLowerCase();
}

/** Sending is explicit; resume ONLY checks a previous receipt, never signs again. */
export async function closeHireJob(binding: ClosureBinding, port: ClosurePort, mode: "send" | "resume"): Promise<ClosureAttempt> {
  return port.exclusive(async () => {
    const saved = port.load();
    if (saved && !sameAttempt(saved, binding)) throw new Error("Saved closure belongs to another job or wallet");
    if (mode === "resume") {
      if (!saved?.hash) throw new Error("No transaction hash available; inspect wallet history before retrying");
      const result = await port.verify(saved.hash);
      const updated: ClosureAttempt = { ...saved, state: result === "pending" ? "uncertain" : result };
      port.save(updated);
      return updated;
    }
    if (saved) throw new Error("A closure attempt already exists; check it before sending another transaction");
    await port.assertWallet();
    assertClosureAllowed(binding, await port.read());
    await port.simulate();
    // Revalidate after potentially slow simulation; no stale wallet/state reuse.
    await port.assertWallet();
    assertClosureAllowed(binding, await port.read());
    let attempt: ClosureAttempt = { ...binding, state: "signing" };
    port.save(attempt); // Storage failure must stop BEFORE opening the wallet.
    try {
      const hash = await port.send();
      attempt = { ...attempt, hash, state: "submitted" };
      port.save(attempt);
      const result = await port.verify(hash);
      attempt = { ...attempt, state: result === "pending" ? "uncertain" : result };
      port.save(attempt);
      return attempt;
    } catch {
      // Even wallet/RPC errors can hide a broadcast; retain the attempt and never auto-resend.
      attempt = { ...attempt, state: "uncertain" };
      port.save(attempt);
      return attempt;
    }
  });
}
