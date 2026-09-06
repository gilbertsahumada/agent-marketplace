import type { UIDataTypes, UIMessage } from "ai";
import { InvalidMarketplaceInputError } from "../errors/marketplace-errors.ts";
import type { InputSchema, NegotiationContract } from "../../shared/negotiation-input.ts";
import type { MarketplaceAvailability } from "../use-cases/list-marketplace-agents.ts";
import type { AgentEvidencePassport } from "./evidence-passport.ts";
import type { HireabilityStatus, MarketplaceCategory } from "./marketplace-agent.ts";

export const CONCIERGE_SCHEMA_VERSION = 1;

export const CONCIERGE_LIMITS = {
  messages: 12,
  userChars: 1_200,
  assistantChars: 4_000,
  briefChars: 500,
  // Model calls per request: search, quote input, propose and the closing
  // message use four; the fifth absorbs one passport read or a retry. The
  // last step is forced to plain text so every request ends in a message.
  modelSteps: 5,
  toolCalls: 6,
  searchLimit: 6,
  // Overall wall-clock budget for the whole conversation (model steps +
  // in-process tool calls), independent of any single call's own timeout.
  // Kept comfortably under the route's maxDuration (60s, see
  // app/api/marketplace/concierge/route.ts) so a slow upstream ends the
  // stream with the use case's own error text instead of the platform
  // killing the function mid-flight (which would skip the admission release).
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

/** Non-streaming projection of one concierge turn (eval script, tests). */
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

export interface ConciergeAdmission {
  /** Throws MarketplaceRateLimitError when the caller is over budget. */
  acquire(caller: string): () => void;
}

// ---------------------------------------------------------------------------
// Tool contract shared by the use case (server) and the chat (client). The
// AI SDK streams every tool call and its output to the browser as typed
// message parts, so the shapes below are the wire format the UI renders.
// ---------------------------------------------------------------------------

export interface ConciergeToolError {
  error: string;
}

export interface SearchAgentsInput {
  q?: string;
  category?: MarketplaceCategory;
  availability?: MarketplaceAvailability;
}

export interface SearchAgentsResult {
  /** Model-authored search text, bounded and copy-filtered, for display. */
  label: string;
  agents: ConciergeAgentCard[];
}

export type SearchAgentsOutput = SearchAgentsResult | ConciergeToolError;

export interface AgentToolInput {
  agentId: string;
}

export interface PassportResult {
  agentId: string;
  state: AgentEvidencePassport["state"];
  checks: Record<keyof AgentEvidencePassport["checks"], { status: string }>;
  provenJobs: number;
  attentionReasons: string[];
  nextRequirements: string[];
}

export type PassportOutput = PassportResult | ConciergeToolError;

export interface QuoteInputResult {
  agentId: string;
  inputSchema: InputSchema;
  taskDescriptionPrefix?: NegotiationContract["taskDescriptionPrefix"];
  terms?: NegotiationContract["terms"];
}

export type QuoteInputOutput = QuoteInputResult | ConciergeToolError;

export interface ProposeInput {
  brief?: ConciergeBrief;
  agentId?: string;
  parameters?: Record<string, unknown>;
}

export type ProposeRejection = "unknown_agent" | "missing_quote_input" | "invalid_parameters" | "invalid_brief";

export interface ProposeOutput {
  brief: ConciergeBrief | null;
  proposal: ConciergeProposal | null;
  /** Every agent seen in this request, proposed one first. */
  agents: ConciergeAgentCard[];
  rejected: ProposeRejection[];
}

// A type alias (not an interface): an index signature would widen every
// tool part to `tool-${string}` with unknown output on the client.
export type ConciergeUITools = {
  search_agents: { input: SearchAgentsInput; output: SearchAgentsOutput };
  get_passport: { input: AgentToolInput; output: PassportOutput };
  get_quote_input: { input: AgentToolInput; output: QuoteInputOutput };
  propose: { input: ProposeInput; output: ProposeOutput };
};

export type ConciergeUIMessage = UIMessage<unknown, UIDataTypes, ConciergeUITools>;

export function isConciergeToolError(value: unknown): value is ConciergeToolError {
  return isPlainObject(value) && typeof value.error === "string";
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

// Model text is streamed word by word, so banned marketing claims are
// rewritten in place instead of replacing the whole message after the fact.
const COPY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bproven\b/gi, "indexed"],
  [/\btrack record\b/gi, "activity history"],
  [/\bguaranteed\b/gi, "promised"],
  [/\bguarantees\b/gi, "promises"],
  [/\bguarantee\b/gi, "promise"],
  [/\bapplied\b/gi, "used"],
];

export function filterBannedCopy(text: string): string {
  if (!BANNED_COPY.test(text)) return text;
  return COPY_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}

/**
 * The text a turn shows and keeps: what the model wrote after its last tool
 * call. Narration before or between tool calls ("I'll search the catalog…")
 * duplicates the step rows and often comes in English, so it is dropped.
 */
export function finalTextParts<PART extends { type: string }>(parts: readonly PART[]): Array<Extract<PART, { type: "text" }>> {
  let lastToolIndex = -1;
  parts.forEach((part, index) => {
    if (part.type.startsWith("tool-")) lastToolIndex = index;
  });
  return parts
    .slice(lastToolIndex + 1)
    .filter((part): part is Extract<PART, { type: "text" }> => part.type === "text");
}

const STEP_TOOLS = new Set<ConciergeStep["tool"]>(["search_agents", "get_passport", "get_quote_input"]);

/**
 * Collapses one finished assistant message into the flat ConciergeReply the
 * eval script and the non-streaming use case entry point return. Mirrors what
 * the chat renders: streamed text, the steps that completed, and the propose
 * output (or, without one, the agents from the last search).
 */
export function summarizeConciergeMessage(message: Pick<ConciergeUIMessage, "parts">, model: string): ConciergeReply {
  const steps: ConciergeStep[] = [];
  let propose: ProposeOutput | null = null;
  let lastSearch: SearchAgentsResult | null = null;

  for (const part of message.parts) {
    if (part.type === "tool-search_agents" && part.state === "output-available" && !isConciergeToolError(part.output)) {
      lastSearch = part.output;
      steps.push({ tool: "search_agents", summary: `${part.output.agents.length} agents for “${part.output.label}”` });
      continue;
    }
    if (part.type === "tool-get_passport" && part.state === "output-available" && !isConciergeToolError(part.output)) {
      steps.push({ tool: "get_passport", summary: `passport for ${part.output.agentId}` });
      continue;
    }
    if (part.type === "tool-get_quote_input" && part.state === "output-available" && !isConciergeToolError(part.output)) {
      steps.push({ tool: "get_quote_input", summary: `quote input for ${part.output.agentId}` });
      continue;
    }
    if (part.type === "tool-propose" && part.state === "output-available") {
      propose = part.output;
    }
  }

  const text = finalTextParts(message.parts).map((part) => (part as { text: string }).text).join("");
  const message_ = filterBannedCopy(text.trim()).slice(0, CONCIERGE_LIMITS.assistantChars);
  return {
    schemaVersion: 1,
    message: message_,
    question: null,
    brief: propose?.brief ?? null,
    agents: propose?.agents ?? lastSearch?.agents ?? [],
    proposal: propose?.proposal ?? null,
    steps: steps.filter((step) => STEP_TOOLS.has(step.tool)),
    model,
  };
}
