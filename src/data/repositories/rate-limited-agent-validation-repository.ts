import type { AgentValidationEvidence } from "../../business/entities/agent-validation.js";
import { MarketplaceRateLimitError } from "../../business/errors/marketplace-errors.js";
import type { AgentValidationRepository } from "../../business/use-cases/validate-marketplace-agent.js";

export interface AgentValidationAdmissionOptions {
  maxRequests?: number;
  windowMs?: number;
  maxConcurrent?: number;
  now?: () => number;
}

export class RateLimitedAgentValidationRepository implements AgentValidationRepository {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxConcurrent: number;
  private readonly now: () => number;
  private readonly starts: Array<{ agentId: string; at: number }> = [];
  private readonly pending = new Map<string, Promise<AgentValidationEvidence | null>>();
  private active = 0;

  constructor(
    private readonly delegate: AgentValidationRepository,
    options: AgentValidationAdmissionOptions = {},
  ) {
    this.maxRequests = options.maxRequests ?? 10;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.now = options.now ?? Date.now;
  }

  validate(agentId: string): Promise<AgentValidationEvidence | null> {
    const inFlight = this.pending.get(agentId);
    if (inFlight) return inFlight;
    const now = this.now();
    while (this.starts[0] !== undefined && this.starts[0].at <= now - this.windowMs) this.starts.shift();
    const alreadyAdmitted = this.starts.some((entry) => entry.agentId === agentId);
    if (!alreadyAdmitted && (this.active >= this.maxConcurrent || this.starts.length >= this.maxRequests)) {
      const oldest = this.starts[0]?.at ?? now;
      return Promise.reject(new MarketplaceRateLimitError(
        Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1_000)),
      ));
    }
    if (!alreadyAdmitted) this.starts.push({ agentId, at: now });
    this.active += 1;
    const promise = this.delegate.validate(agentId).finally(() => {
      this.active -= 1;
      this.pending.delete(agentId);
    });
    this.pending.set(agentId, promise);
    return promise;
  }
}
