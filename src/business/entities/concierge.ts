import { InvalidMarketplaceInputError } from "../errors/marketplace-errors.ts";
import type { HireabilityStatus, MarketplaceCategory } from "./marketplace-agent.ts";

export const CONCIERGE_SCHEMA_VERSION = 1;

export const CONCIERGE_LIMITS = {
  messages: 12,
  userChars: 1_200,
  assistantChars: 4_000,
  briefChars: 500,
  modelRounds: 4,
  toolCalls: 6,
  searchLimit: 6,
  // Overall wall-clock budget for the whole conversation (model rounds +
  // in-process tool calls), independent of any single call's own timeout.
  // Kept comfortably under the route's maxDuration (60s, see
  // app/api/marketplace/concierge/route.ts) so a slow upstream makes the
  // use case return its own fallback reply instead of the platform killing
  // the function mid-flight (which would skip the admission release).
  deadlineMs: 35_000,
} as const;

export type ConciergeRole = "user" | "assistant";

export interface ConciergeMessage {
  role: ConciergeRole;
  content: string;
}

export interface ConciergeBrief {
  objective: string;
  deliverable: string;
  acceptanceCriteria: string;
}

export interface ConciergeAgentCard {
  agentId: string;
  name: string;
  categories: MarketplaceCategory[];
  hireability: HireabilityStatus;
  canHire: boolean;
  summary: string | null;
  href: string; // `/hire/${agentId}`
}

export interface ConciergeProposal {
  agentId: string;
  parameters: Record<string, unknown>;
  contractHash: string;
  fields: Array<{ key: string; title: string; value: string }>; // for display
}

export interface ConciergeStep {
  tool: "search_agents" | "get_passport" | "get_quote_input";
  summary: string;
}

export interface ConciergeReply {
  schemaVersion: 1;
  message: string;
  question: string | null;
  brief: ConciergeBrief | null;
  agents: ConciergeAgentCard[];
  proposal: ConciergeProposal | null;
  steps: ConciergeStep[];
  model: string;
}

// Port over the model backing the concierge (implemented in the data layer).
export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ModelChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; toolCalls: ModelToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ModelTurn =
  | { kind: "text"; text: string }
  | { kind: "tool_calls"; text: string | null; calls: ModelToolCall[] };

export interface ConciergeModel {
  readonly name: string;
  complete(input: { messages: ModelChatMessage[]; tools: ModelToolDefinition[]; forceTool?: string }): Promise<ModelTurn>;
}

export interface ConciergeAdmission {
  /** Throws MarketplaceRateLimitError when the caller is over budget. */
  acquire(caller: string): () => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConciergeMessages(value: unknown): ConciergeMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > CONCIERGE_LIMITS.messages) {
    throw new InvalidMarketplaceInputError("Concierge messages are invalid");
  }

  const messages = value.map((entry, index) => {
    if (!isPlainObject(entry) || Object.keys(entry).sort().join(",") !== "content,role") {
      throw new InvalidMarketplaceInputError("Concierge messages are invalid");
    }
    const { role, content } = entry;
    const expectedRole: ConciergeRole = index % 2 === 0 ? "user" : "assistant";
    if (role !== expectedRole) throw new InvalidMarketplaceInputError("Concierge messages are invalid");
    if (typeof content !== "string" || content.trim().length < 1) {
      throw new InvalidMarketplaceInputError("Concierge messages are invalid");
    }
    const limit = role === "user" ? CONCIERGE_LIMITS.userChars : CONCIERGE_LIMITS.assistantChars;
    if (content.length > limit) throw new InvalidMarketplaceInputError("Concierge messages are invalid");
    return { role: expectedRole, content };
  });

  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    throw new InvalidMarketplaceInputError("Concierge messages are invalid");
  }

  return messages;
}

/** Same rules as app/api/marketplace/agents/[agentId]/quotes/route.ts's brief() (schemaVersion 1 shape). */
export function parseConciergeBrief(value: unknown): ConciergeBrief | null {
  if (!isPlainObject(value) || Object.keys(value).sort().join(",") !== "acceptanceCriteria,deliverable,objective") {
    return null;
  }
  const { objective, deliverable, acceptanceCriteria } = value;
  for (const entry of [objective, deliverable, acceptanceCriteria]) {
    if (typeof entry !== "string" || entry.trim().length < 1 || entry.length > CONCIERGE_LIMITS.briefChars) {
      return null;
    }
  }
  return {
    objective: objective as string,
    deliverable: deliverable as string,
    acceptanceCriteria: acceptanceCriteria as string,
  };
}

export const BANNED_COPY = /\b(proven|track record|guarantee[ds]?|applied)\b/i;
