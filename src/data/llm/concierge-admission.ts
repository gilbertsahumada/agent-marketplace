import { MarketplaceRateLimitError } from "../../business/errors/marketplace-errors.ts";
import type { ConciergeAdmission } from "../../business/entities/concierge.ts";

export interface InProcessConciergeAdmissionOptions {
  maxPerWindow?: number;
  windowMs?: number;
  maxConcurrent?: number;
  dailyCap?: number;
  now?: () => number;
}

export class InProcessConciergeAdmission implements ConciergeAdmission {
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly maxConcurrent: number;
  private readonly dailyCap: number;
  private readonly now: () => number;
  // Per-caller sliding window of timestamps
  private readonly callerWindows = new Map<string, number[]>();
  // Per-caller in-flight counter
  private readonly callerInflight = new Map<string, number>();
  // Global daily counter keyed by UTC date string
  private dailyUsage = new Map<string, number>();
  private lastDailyReset: string;

  constructor(options: InProcessConciergeAdmissionOptions = {}) {
    this.maxPerWindow = options.maxPerWindow ?? 6;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.dailyCap = options.dailyCap ?? this.parseDailyCapFromEnv();
    this.now = options.now ?? Date.now;
    this.lastDailyReset = this.getCurrentDateKey();
  }

  acquire(caller: string): () => void {
    const now = this.now();

    // Check and reset daily counter if date changed
    const currentDateKey = this.getCurrentDateKey(now);
    if (currentDateKey !== this.lastDailyReset) {
      this.dailyUsage.clear();
      this.lastDailyReset = currentDateKey;
    }

    // Clean up old entries in the sliding window
    const callerTimestamps = this.callerWindows.get(caller) ?? [];
    while (callerTimestamps[0] !== undefined && callerTimestamps[0] <= now - this.windowMs) {
      callerTimestamps.shift();
    }
    if (callerTimestamps.length === 0) {
      this.callerWindows.delete(caller);
    } else {
      this.callerWindows.set(caller, callerTimestamps);
    }

    // Check window limit (per caller)
    const currentCount = this.callerWindows.get(caller)?.length ?? 0;
    if (currentCount >= this.maxPerWindow) {
      const oldest = this.callerWindows.get(caller)?.[0] ?? now;
      const retryAfter = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1_000));
      throw new MarketplaceRateLimitError(retryAfter, "The concierge is temporarily at capacity");
    }

    // Check concurrency limit (per caller)
    const inflightCount = this.callerInflight.get(caller) ?? 0;
    if (inflightCount >= this.maxConcurrent) {
      throw new MarketplaceRateLimitError(5, "The concierge is temporarily at capacity");
    }

    // Check daily cap (global)
    const dailyCount = this.dailyUsage.get(currentDateKey) ?? 0;
    if (dailyCount >= this.dailyCap) {
      const nextMidnightMs = this.getNextMidnightMs(now);
      const secondsUntilMidnight = Math.min(86400, Math.ceil((nextMidnightMs - now) / 1_000));
      throw new MarketplaceRateLimitError(secondsUntilMidnight, "The concierge is temporarily at capacity");
    }

    // Admit: record in window, increment inflight and daily counts
    if (!this.callerWindows.has(caller)) {
      this.callerWindows.set(caller, []);
    }
    this.callerWindows.get(caller)!.push(now);

    this.callerInflight.set(caller, inflightCount + 1);
    this.dailyUsage.set(currentDateKey, dailyCount + 1);

    // Return release function (idempotent)
    let released = false;
    return () => {
      if (!released) {
        released = true;
        const current = this.callerInflight.get(caller) ?? 0;
        if (current > 1) {
          this.callerInflight.set(caller, current - 1);
        } else {
          this.callerInflight.delete(caller);
        }
      }
    };
  }

  private getCurrentDateKey(time = this.now()): string {
    const date = new Date(time);
    return date.toISOString().split("T")[0]!;
  }

  private getNextMidnightMs(time: number): number {
    const date = new Date(time);
    const nextMidnight = new Date(date);
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
    nextMidnight.setUTCHours(0, 0, 0, 0);
    return nextMidnight.getTime();
  }

  private parseDailyCapFromEnv(): number {
    const envValue = process.env.CONCIERGE_DAILY_CAP;
    if (!envValue) return 300;
    const parsed = parseInt(envValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 300;
    return parsed;
  }
}
