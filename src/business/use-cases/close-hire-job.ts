export type ClosureAction = "dispute" | "settle";
export type ClosureBinding = { chainId: number; commerce: string; jobId: string; wallet: string; action: ClosureAction };
export type ClosureFacts = { status: string; buyer: string; supported: boolean; disputed: boolean; verdict: number; now: bigint; reviewEndsAt: bigint };
export type ClosureAttempt = ClosureBinding & { state: "signing" | "submitted" | "confirmed" | "reverted" | "uncertain" | "rejected" | "cancelled" | "replaced" | "already_closed"; hash?: string; replacementHash?: string; replacementHashes?: string[]; previousAttempts?: Omit<ClosureAttempt, "previousAttempts">[] };

/** Only an explicit EIP-1193 rejection during send is safe to retry. */
function signatureRejected(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && error && typeof error === "object" && !seen.has(error); depth++) {
    seen.add(error);
    if ("code" in error && error.code === 4001) return true;
    error = "cause" in error ? error.cause : null;
  }
  return false;
}
export interface ClosurePort {
  read(): Promise<ClosureFacts>;
  assertWallet(): Promise<void>;
  simulate(): Promise<void>;
  send(): Promise<string>;
  verify(hash: string, replacement?: (hash: string) => void): Promise<"confirmed" | "reverted" | "pending" | "cancelled" | "replaced">;
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
    let saved = port.load();
    if (saved && !sameAttempt(saved, binding)) throw new Error("Saved closure belongs to another job or wallet");
    async function check(attempt: ClosureAttempt): Promise<ClosureAttempt> {
      let updated = { ...attempt };
      try {
        const result = await port.verify(attempt.hash!, hash => {
          updated = { ...updated, replacementHash: hash, replacementHashes: [...new Set([...(updated.replacementHashes ?? []), hash])] };
          port.save(updated);
        });
        updated.state = result === "pending" ? "uncertain" : result;
      } catch { updated.state = "uncertain"; }
      port.save(updated);
      return updated;
    }
    if (mode === "resume") {
      if (!saved?.hash) throw new Error("No transaction hash available; inspect wallet history before retrying");
      return check(saved);
    }
    if (saved?.hash && ["reverted", "cancelled", "replaced"].includes(saved.state)) {
      saved = await check(saved);
      if (!["reverted", "cancelled", "replaced"].includes(saved.state)) return saved;
    } else if (saved && (saved.state !== "rejected" || saved.hash)) throw new Error("A closure attempt already exists; check it before sending another transaction");
    await port.assertWallet();
    const facts = await port.read();
    if (facts.supported && ["COMPLETED", "REJECTED", "EXPIRED"].includes(facts.status)) return { ...(saved ?? binding), state: "already_closed" };
    assertClosureAllowed(binding, facts);
    await port.simulate();
    // Revalidate after potentially slow simulation; no stale wallet/state reuse.
    await port.assertWallet();
    const fresh = await port.read();
    if (fresh.supported && ["COMPLETED", "REJECTED", "EXPIRED"].includes(fresh.status)) return { ...(saved ?? binding), state: "already_closed" };
    assertClosureAllowed(binding, fresh);
    let attempt: ClosureAttempt = { ...binding, state: "signing" };
    if (saved) {
      const { previousAttempts = [], ...previous } = saved;
      attempt.previousAttempts = [...previousAttempts, previous];
    }
    port.save(attempt); // Storage failure must stop BEFORE opening the wallet.
    let sending = true;
    try {
      const hash = await port.send();
      sending = false;
      attempt = { ...attempt, hash, state: "submitted" };
      port.save(attempt);
      return await check(attempt);
    } catch (error) {
      // Even wallet/RPC errors can hide a broadcast; retain the attempt and never auto-resend.
      attempt = { ...attempt, state: sending && signatureRejected(error) ? "rejected" : "uncertain" };
      port.save(attempt);
      return attempt;
    }
  });
}
