import {
  isStepCount,
  jsonSchema,
  readUIMessageStream,
  streamText,
  tool,
  toUIMessageStream,
  type JSONValue,
  type LanguageModel,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
  type UIMessageChunk,
} from "ai";
import {
  BANNED_COPY,
  CONCIERGE_LIMITS,
  filterBannedCopy,
  parseConciergeBrief,
  summarizeConciergeMessage,
  type AgentToolInput,
  type ConciergeAdmission,
  type ConciergeAgentCard,
  type ConciergeMessage,
  type ConciergeProposal,
  type ConciergeReply,
  type ConciergeUIMessage,
  type PassportOutput,
  type ProposeInput,
  type ProposeOutput,
  type ProposeRejection,
  type QuoteInputOutput,
  type SearchAgentsInput,
  type SearchAgentsOutput,
} from "../entities/concierge.ts";
import {
  MARKETPLACE_CATEGORIES,
  type MarketplaceAgent,
  type MarketplaceAgentPage,
  type MarketplaceCategory,
} from "../entities/marketplace-agent.ts";
import type { AgentEvidencePassport } from "../entities/evidence-passport.ts";
import { MarketplaceDataUnavailableError } from "../errors/marketplace-errors.ts";
import {
  MARKETPLACE_AVAILABILITIES,
  type ListMarketplaceAgentsInput,
  type MarketplaceAvailability,
} from "./list-marketplace-agents.ts";
import { buildContractRequest, normalizeNegotiationContract, validateParameters, type NegotiationContract } from "../../shared/negotiation-input.ts";

export interface ConciergeModelHandle {
  languageModel: LanguageModel;
  name: string;
  providerOptions?: Record<string, Record<string, JSONValue>>;
}

export interface AskConciergeDependencies {
  /** Resolved per request; throws MarketplaceDataUnavailableError when not configured. */
  model: () => ConciergeModelHandle;
  admission: ConciergeAdmission;
  agents: { execute(input: ListMarketplaceAgentsInput): Promise<MarketplaceAgentPage> };
  passports: { execute(input: { agentId: string }): Promise<AgentEvidencePassport> };
  negotiationInput: (agentId: string, options: { caller?: string }) => Promise<{ status: number; body: unknown } | null>;
  /** Wall-clock budget for the whole turn; defaults to CONCIERGE_LIMITS.deadlineMs. */
  deadlineMs?: number;
}

export interface AskConciergeInput {
  messages: ConciergeMessage[];
  caller: string;
  abortSignal?: AbortSignal;
}

interface ContractEntry {
  contract: NegotiationContract;
  endpointKey: string;
  contractHash: string;
}

export const STREAM_ERROR_COPY = {
  capacity: "The concierge is temporarily at capacity. Try again in a moment.",
  timeout: "This took too long. Try again with a shorter request.",
  generic: "The concierge could not answer. Try again.",
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolErrorFrom(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.name : "UNKNOWN_ERROR" };
}

// The quote panel encodes parameters with buildContractRequest, which also
// bounds the task description; a proposal must pass the same gate.
function encodable(contract: NegotiationContract, parameters: Record<string, unknown>): boolean {
  if (!validateParameters(contract.inputSchema, parameters)) return false;
  try {
    buildContractRequest(contract, parameters);
    return true;
  } catch {
    return false;
  }
}

function toAgentCard(agent: MarketplaceAgent): ConciergeAgentCard {
  return {
    agentId: agent.agentId,
    name: agent.name,
    categories: agent.categories.map((assignment) => assignment.category),
    hireability: agent.hireability.status,
    canHire: agent.hireability.canHire,
    summary: agent.description ? agent.description.slice(0, 160) : null,
    href: `/hire/${agent.agentId}`,
  };
}

// System prompt rules are literal contract, not loose guidance: tests pin the
// wording (propose/search_agents/never, and the single prohibition sentence).
export const CONCIERGE_SYSTEM_PROMPT = `You are the hiring concierge of the BNB Agent Marketplace.

Your job: turn a plain-language need into a short brief, a short list of
candidate agents, and a set of seller parameters ready for a quote.

Rules:
- Agents are found only through the search_agents tool. Never name or
  recommend an agent that did not come back from a search_agents call in
  this conversation.
- Search once with the matching category when the need fits one (grid
  trading, rebalancing, yield optimisation, health factor monitoring) and a
  single short keyword such as "grid"; the catalog matches words literally,
  so long phrases return nothing.
- Before proposing parameters for an agent, call get_quote_input for that
  agent and use its schema. Never invent a parameter shape.
- You may call get_passport to read an agent's indexed state and on-chain
  activity before recommending it.
- Call the propose tool when at least one agent matched: it carries the
  brief and, when the seller's schema is available and every required value
  is known, the agentId and the parameters. Then write your reply. When
  nothing in the catalog fits, skip propose and say in one sentence what the
  marketplace does cover.
- The brief has three short fields in the user's own words: objective,
  deliverable, and acceptance criteria. Keep each field under 500 characters.
- Ask at most one clarifying question, and only when a required parameter
  cannot be inferred from what the user already said.
- Do not narrate tool calls: call the tools without any text first, and
  write your reply only after the last tool result.
- Do not ask the user to confirm what they already said. Keep the reply
  under 90 words; the brief and the parameters carry the detail. Do not
  repeat the parameters or the brief in the reply: the interface shows them.
- The reply after propose says, in two or three sentences, what the
  chosen agent does and what happens next: with parameters, that the
  request is ready for a signed quote; without them, exactly which values
  are still missing and how to give them.
- Answer in the language of the user's latest message, even when earlier
  turns used another language. Keep tool arguments in English.
- Describe on-chain facts as indexed data or activity, never as proof of
  quality or of a result. Never use the words proven, track record or guarantee.
- Never invent prices, fees or delivery times. The signed quote sets the
  price and the escrow holds the funds; you only draft the request.
- Example for a grid request: pair is an uppercase BASE/QUOTE pair (for
  example BNB/USDT), lowerPrice and upperPrice are decimal strings with the
  lower value first, capital is a simulated amount, and gridCount is an
  integer between 2 and 100.`;

export const LANGUAGE_REMINDER = "\n\n(Reply in the language of this message.)";

const SEARCH_AGENTS_SCHEMA = {
  type: "object",
  properties: {
    q: { type: "string", description: "Free text search, at most 120 characters." },
    category: { type: "string", enum: [...MARKETPLACE_CATEGORIES] },
    availability: { type: "string", enum: [...MARKETPLACE_AVAILABILITIES] },
  },
  required: [],
  additionalProperties: false,
} as const;

const AGENT_ID_SCHEMA = {
  type: "object",
  properties: { agentId: { type: "string" } },
  required: ["agentId"],
  additionalProperties: false,
} as const;

const PROPOSE_SCHEMA = {
  type: "object",
  properties: {
    brief: {
      type: "object",
      properties: {
        objective: { type: "string" },
        deliverable: { type: "string" },
        acceptanceCriteria: { type: "string" },
      },
      required: ["objective", "deliverable", "acceptanceCriteria"],
      additionalProperties: false,
    },
    agentId: { type: "string" },
    parameters: { type: "object" },
  },
  required: [],
  additionalProperties: false,
} as const;

/** Tool names and descriptions the model sees; pinned by tests. */
export const CONCIERGE_TOOL_DESCRIPTIONS = {
  search_agents: "Search the marketplace catalog for candidate agents by free text, category or availability.",
  get_passport: "Read the evidence passport (indexed state and on-chain activity) for an agent already returned by search_agents.",
  get_quote_input: "Read the seller's negotiation input schema for an agent already returned by search_agents.",
  propose: "Record the brief and, if ready, the agent and its seller parameters. Call it once, before writing your reply.",
} as const;

// Text streams word by word, so a banned claim that arrives split across two
// deltas ("track " + "record") must still be caught: the tail of every text
// block stays buffered until a later delta or text-end closes it.
const COPY_FILTER_HOLDBACK = 24;

function lastBreakBefore(text: string, position: number): number {
  return Math.max(text.lastIndexOf(" ", position), text.lastIndexOf("\n", position));
}

export function copyFilterTransform<TOOLS extends ToolSet>(): TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> {
  const pending = new Map<string, string>();
  return new TransformStream({
    transform(part, controller) {
      if (part.type === "text-delta") {
        // Rewrite on the whole buffer, never on the emitted slice alone:
        // the cut could otherwise land between the two words of a phrase.
        // The holdback below keeps at least a word plus 24 characters
        // pending, so a phrase still arriving is never split.
        const buffered = filterBannedCopy((pending.get(part.id) ?? "") + part.text);
        let cut = -1;
        if (buffered.length > COPY_FILTER_HOLDBACK) {
          const lastBreak = lastBreakBefore(buffered, buffered.length - COPY_FILTER_HOLDBACK);
          // One more whole word stays buffered so a two-word phrase that
          // straddles the break is filtered as a unit.
          cut = lastBreak > 0 ? lastBreakBefore(buffered, lastBreak - 1) : -1;
        }
        if (cut > 0) {
          controller.enqueue({ ...part, text: buffered.slice(0, cut + 1) });
          pending.set(part.id, buffered.slice(cut + 1));
        } else {
          pending.set(part.id, buffered);
        }
        return;
      }
      if (part.type === "text-end") {
        const buffered = pending.get(part.id);
        pending.delete(part.id);
        if (buffered) controller.enqueue({ type: "text-delta", id: part.id, text: filterBannedCopy(buffered) });
      }
      controller.enqueue(part);
    },
  });
}

function describeStreamError(error: unknown): string {
  const candidate = error as { statusCode?: unknown; name?: unknown; lastError?: unknown } | null;
  if (candidate && typeof candidate === "object") {
    // A retried call surfaces as the SDK's RetryError; the upstream status
    // lives on the last attempt.
    if (candidate.lastError && typeof candidate.lastError === "object") return describeStreamError(candidate.lastError);
    if (candidate.statusCode === 429) return STREAM_ERROR_COPY.capacity;
    if (candidate.name === "AbortError" || candidate.name === "TimeoutError") return STREAM_ERROR_COPY.timeout;
  }
  return STREAM_ERROR_COPY.generic;
}

// The deadline (and a client disconnect) end streamText with an `abort`
// chunk, which the chat has no words for. The deadline gets the timeout
// copy as an error chunk instead; a disconnected client reads neither.
function abortsAsErrors(): TransformStream<UIMessageChunk, UIMessageChunk> {
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk.type === "abort" ? { type: "error", errorText: STREAM_ERROR_COPY.timeout } : chunk);
    },
  });
}

export class AskConcierge {
  constructor(private readonly deps: AskConciergeDependencies) {}

  /**
   * Streams one concierge turn as AI SDK UI message chunks: text deltas plus
   * every tool call and its output, which the chat renders as it arrives.
   * Admission is taken before the model is called and released when the
   * stream ends, aborts or fails.
   */
  stream(input: AskConciergeInput): ReadableStream<UIMessageChunk> {
    const model = this.deps.model();
    const release = this.deps.admission.acquire(input.caller);
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      release();
    };

    try {
      return this.converse(input, model, releaseOnce);
    } catch (error) {
      releaseOnce();
      throw error;
    }
  }

  /** Non-streaming entry point (eval script, tests): the finished turn flattened. */
  async execute(input: AskConciergeInput): Promise<ConciergeReply> {
    const model = this.deps.model();
    const stream = this.stream(input);
    let last: ConciergeUIMessage | undefined;
    let failure: unknown;
    for await (const message of readUIMessageStream<ConciergeUIMessage>({
      stream,
      onError: (error) => {
        failure ??= error;
      },
    })) {
      last = message;
    }
    if (failure !== undefined) {
      throw new MarketplaceDataUnavailableError("concierge model");
    }
    return summarizeConciergeMessage(last ?? { parts: [] }, model.name);
  }

  private converse(input: AskConciergeInput, model: ConciergeModelHandle, release: () => void): ReadableStream<UIMessageChunk> {
    const { agents, passports, negotiationInput } = this.deps;
    const caller = input.caller;

    // The language reminder rides on the latest user turn, where models
    // weigh it most; a long Spanish history otherwise keeps an English
    // follow-up answered in Spanish. It never reaches the client.
    const lastIndex = input.messages.length - 1;
    const messages: ModelMessage[] = input.messages.map((message, index) => ({
      role: message.role,
      content: index === lastIndex && message.role === "user" ? `${message.content}${LANGUAGE_REMINDER}` : message.content,
    }));

    const seenAgents = new Map<string, ConciergeAgentCard>();
    const contracts = new Map<string, ContractEntry>();
    // Quote-input fetches in flight, so a propose issued in the same model
    // step (the SDK runs a step's tool calls concurrently) waits for the
    // contract instead of seeing none.
    const contractFetches = new Map<string, Promise<unknown>>();
    let lookups = 0;

    const overBudget = (): { error: string } | null => {
      lookups += 1;
      return lookups > CONCIERGE_LIMITS.toolCalls ? { error: "TOOL_BUDGET_EXCEEDED" } : null;
    };

    const searchAgents = async (input: SearchAgentsInput): Promise<SearchAgentsOutput> => {
      const exhausted = overBudget();
      if (exhausted) return exhausted;
      const q = typeof input.q === "string" ? input.q.slice(0, 120) : undefined;
      const category = typeof input.category === "string" && (MARKETPLACE_CATEGORIES as readonly string[]).includes(input.category)
        ? input.category as MarketplaceCategory
        : undefined;
      const availability: MarketplaceAvailability = typeof input.availability === "string"
        && (MARKETPLACE_AVAILABILITIES as readonly string[]).includes(input.availability)
        ? input.availability as MarketplaceAvailability
        : "all";
      let page: MarketplaceAgentPage;
      try {
        page = await agents.execute({
          view: "marketplace",
          ...(q ? { q } : {}),
          ...(category ? { category } : {}),
          availability,
          limit: CONCIERGE_LIMITS.searchLimit,
          page: 1,
        });
      } catch (error) {
        return toolErrorFrom(error);
      }
      const cards = page.items.map(toAgentCard);
      for (const card of cards) seenAgents.set(card.agentId, card);
      // The search text is model-authored: keep it short and off the banned list.
      const label = q && !BANNED_COPY.test(q) ? q.slice(0, 60) : category ?? "the request";
      return { label, agents: cards };
    };

    const getPassport = async (input: AgentToolInput): Promise<PassportOutput> => {
      const exhausted = overBudget();
      if (exhausted) return exhausted;
      const agentId = input.agentId;
      if (typeof agentId !== "string") return { error: "INVALID_ARGUMENTS" };
      if (!seenAgents.has(agentId)) return { error: "UNKNOWN_AGENT" };
      let passport: AgentEvidencePassport;
      try {
        passport = await passports.execute({ agentId });
      } catch (error) {
        return toolErrorFrom(error);
      }
      return {
        agentId,
        state: passport.state,
        checks: {
          identity: { status: passport.checks.identity.status },
          endpoint: { status: passport.checks.endpoint.status },
          quote: { status: passport.checks.quote.status },
          job: { status: passport.checks.job.status },
          hireActivity: { status: passport.checks.hireActivity.status },
        },
        provenJobs: passport.trackRecord.provenJobs,
        attentionReasons: passport.attentionReasons,
        nextRequirements: passport.nextRequirements,
      };
    };

    const getQuoteInput = async (input: AgentToolInput): Promise<QuoteInputOutput> => {
      const exhausted = overBudget();
      if (exhausted) return exhausted;
      const agentId = input.agentId;
      if (typeof agentId !== "string") return { error: "INVALID_ARGUMENTS" };
      if (!seenAgents.has(agentId)) return { error: "UNKNOWN_AGENT" };
      let response: Awaited<ReturnType<typeof negotiationInput>>;
      const fetching = negotiationInput(agentId, { caller });
      contractFetches.set(agentId, fetching.catch(() => undefined));
      try {
        response = await fetching;
      } catch (error) {
        return toolErrorFrom(error);
      }
      if (!response || response.status < 200 || response.status >= 300 || !isPlainObject(response.body)) {
        return { error: "QUOTE_INPUT_UNAVAILABLE" };
      }
      const { contract: rawContract, endpointKey, contractHash } = response.body;
      if (typeof endpointKey !== "string" || typeof contractHash !== "string") {
        return { error: "QUOTE_INPUT_UNAVAILABLE" };
      }
      let contract: NegotiationContract;
      try {
        contract = normalizeNegotiationContract(rawContract);
      } catch {
        return { error: "QUOTE_INPUT_UNAVAILABLE" };
      }
      contracts.set(agentId, { contract, endpointKey, contractHash });
      return {
        agentId,
        inputSchema: contract.inputSchema,
        ...(contract.taskDescriptionPrefix !== undefined ? { taskDescriptionPrefix: contract.taskDescriptionPrefix } : {}),
        ...(contract.terms !== undefined ? { terms: contract.terms } : {}),
      };
    };

    const propose = async (input: ProposeInput): Promise<ProposeOutput> => {
      const rejected: ProposeRejection[] = [];
      const brief = parseConciergeBrief(input.brief);
      if (input.brief !== undefined && !brief) rejected.push("invalid_brief");

      let proposal: ConciergeProposal | null = null;
      const agentId = input.agentId;
      if (agentId !== undefined) {
        if (typeof agentId !== "string" || !seenAgents.has(agentId)) {
          rejected.push("unknown_agent");
        } else {
          await contractFetches.get(agentId);
          const entry = contracts.get(agentId);
          if (!entry) {
            rejected.push("missing_quote_input");
          } else if (!isPlainObject(input.parameters) || !encodable(entry.contract, input.parameters)) {
            rejected.push("invalid_parameters");
          } else {
            const parameters = input.parameters;
            const properties = entry.contract.inputSchema.properties ?? {};
            // Only the fields the model actually set: an omitted optional
            // property must not render as "undefined" in the proposal card.
            const fields = Object.keys(properties).filter((key) => parameters[key] !== undefined).map((key) => ({
              key,
              title: properties[key]?.title ?? key,
              value: isPlainObject(parameters[key]) ? JSON.stringify(parameters[key]) : String(parameters[key]),
            }));
            proposal = { agentId, parameters, contractHash: entry.contractHash, fields };
          }
        }
      }

      const orderedAgents = proposal
        ? [seenAgents.get(proposal.agentId)!, ...[...seenAgents.values()].filter((card) => card.agentId !== proposal!.agentId)]
        : [...seenAgents.values()];

      return { brief, proposal, agents: orderedAgents, rejected };
    };

    const tools = {
      search_agents: tool({
        description: CONCIERGE_TOOL_DESCRIPTIONS.search_agents,
        inputSchema: jsonSchema<SearchAgentsInput>(SEARCH_AGENTS_SCHEMA),
        execute: (input) => searchAgents(isPlainObject(input) ? input : {}),
      }),
      get_passport: tool({
        description: CONCIERGE_TOOL_DESCRIPTIONS.get_passport,
        inputSchema: jsonSchema<AgentToolInput>(AGENT_ID_SCHEMA),
        execute: (input) => getPassport(isPlainObject(input) ? input : { agentId: "" }),
      }),
      get_quote_input: tool({
        description: CONCIERGE_TOOL_DESCRIPTIONS.get_quote_input,
        inputSchema: jsonSchema<AgentToolInput>(AGENT_ID_SCHEMA),
        execute: (input) => getQuoteInput(isPlainObject(input) ? input : { agentId: "" }),
      }),
      propose: tool({
        description: CONCIERGE_TOOL_DESCRIPTIONS.propose,
        inputSchema: jsonSchema<ProposeInput>(PROPOSE_SCHEMA),
        execute: (input) => propose(isPlainObject(input) ? input : {}),
        // The model only needs to know what was kept; the cards go to the client.
        toModelOutput: ({ output }) => ({
          type: "json",
          value: {
            ok: output.rejected.length === 0,
            rejected: output.rejected,
            brief: output.brief !== null,
            proposal: output.proposal ? { agentId: output.proposal.agentId, fields: output.proposal.fields } : null,
          },
        }),
      }),
    } satisfies ToolSet;

    const result = streamText({
      model: model.languageModel,
      instructions: CONCIERGE_SYSTEM_PROMPT,
      messages,
      tools,
      stopWhen: isStepCount(CONCIERGE_LIMITS.modelSteps),
      // The last step is text-only so the turn always ends in a reply the
      // person can read, never in a dangling tool call; the same right after
      // propose, so the proposal is always followed by the model's words.
      prepareStep: ({ stepNumber, steps }) => {
        // A rejected propose (bad parameters, missing quote input) leaves the
        // tools open so the model can fix it while budget remains.
        const proposed = steps.at(-1)?.toolResults.some(
          (result) => result.toolName === "propose" && (result.output as ProposeOutput).rejected.length === 0,
        ) ?? false;
        return stepNumber >= CONCIERGE_LIMITS.modelSteps - 1 || proposed ? { toolChoice: "none" } : undefined;
      },
      temperature: 0.2,
      maxOutputTokens: 1_500,
      maxRetries: 1,
      timeout: { totalMs: this.deps.deadlineMs ?? CONCIERGE_LIMITS.deadlineMs },
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      ...(model.providerOptions ? { providerOptions: model.providerOptions } : {}),
      experimental_transform: () => copyFilterTransform<typeof tools>(),
      onEnd: release,
      onAbort: release,
      // Never surface the underlying error: it may embed the request (prompt).
      onError: ({ error }) => {
        release();
        const detail = error as { name?: unknown; statusCode?: unknown } | null;
        console.error("[concierge] model call failed", detail?.name ?? "unknown", detail?.statusCode ?? "");
      },
    });

    return toUIMessageStream({
      stream: result.stream,
      onError: describeStreamError,
    }).pipeThrough(abortsAsErrors());
  }
}
