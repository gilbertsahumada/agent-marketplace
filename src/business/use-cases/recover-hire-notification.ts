import type { HireNotification, NotificationState } from "../../../shared/hire-notification.ts";
import type { Erc8183JobFacts, NotifyFundedResult } from "../entities/erc8183-browser-spike.ts";

export interface NotificationRecoveryPort {
  claim(): Promise<HireNotification | null>;
  prepare(row: HireNotification): Promise<{ job: Erc8183JobFacts; notify(beforeSend: () => Promise<void>): Promise<NotifyFundedResult> }>;
  sending(row: HireNotification): Promise<void>;
  finish(row: HireNotification, state: NotificationState): Promise<void>;
  now(): number;
}

/** A lost send response is reconciled, never automatically sent a second time. */
export async function recoverHireNotification(port: NotificationRecoveryPort) {
  const row = await port.claim();
  if (!row) return null;
  let dispatched = row.state === "uncertain";
  let result: NotifyFundedResult | undefined;
  let state: NotificationState;
  try {
    const prepared = await port.prepare(row);
    const job = prepared.job;
    if (["SUBMITTED", "COMPLETED"].includes(job.status)) state = "delivered";
    else if (["REJECTED", "EXPIRED"].includes(job.status) || BigInt(job.deadline) <= BigInt(Math.floor(port.now() / 1000))) state = "stopped";
    else if (dispatched) state = row.attempts >= 6 ? "attention" : "uncertain";
    else if (job.status !== "FUNDED") state = "stopped";
    else {
      result = await prepared.notify(async () => {
        // Mark locally first: even a lost response to the fence write is uncertain.
        dispatched = true;
        await port.sending(row);
      });
      state = result.alreadySubmitted ? "delivered" : result.notificationMethod === "chain_watch" ? "watching" : "notified";
    }
  } catch {
    state = row.attempts >= 6 ? "attention" : dispatched ? "uncertain" : "pending";
  }
  await port.finish(row, state);
  return { state, result };
}
