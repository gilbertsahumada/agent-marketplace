export type ProbeKind = "mcp" | "seller";

export interface ProbeBudget {
  claim(kind: ProbeKind): { allowed: boolean; remainingMs: number };
  remainingMs(): number;
}

export interface ProbeBudgetOptions {
  maxMcpEndpoints: number;
  maxSellerEndpoints: number;
  maxTotalEndpoints: number;
  maxTotalDurationMs: number;
  monotonicNow?: () => number;
}

export function createProbeBudget(options: ProbeBudgetOptions): ProbeBudget {
  const monotonicNow = options.monotonicNow ?? performance.now.bind(performance);
  const startedAt = monotonicNow();
  let total = 0;
  let mcp = 0;
  let seller = 0;
  const remainingMs = () => Math.max(0, options.maxTotalDurationMs - (monotonicNow() - startedAt));

  return {
    remainingMs,
    claim(kind) {
      const remaining = remainingMs();
      const kindLimitReached = kind === "mcp"
        ? mcp >= options.maxMcpEndpoints
        : seller >= options.maxSellerEndpoints;
      if (remaining <= 0 || total >= options.maxTotalEndpoints || kindLimitReached) {
        return { allowed: false, remainingMs: remaining };
      }
      total += 1;
      if (kind === "mcp") mcp += 1;
      else seller += 1;
      return { allowed: true, remainingMs: remaining };
    },
  };
}
