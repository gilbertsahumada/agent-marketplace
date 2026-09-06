import {
  BANNED_COPY,
  CONCIERGE_LIMITS,
  parseConciergeBrief,
  type ConciergeAdmission,
  type ConciergeAgentCard,
  type ConciergeMessage,
  type ConciergeModel,
  type ConciergeProposal,
  type ConciergeReply,
  type ConciergeStep,
  type ModelChatMessage,
  type ModelToolCall,
  type ModelToolDefinition,
  type ModelTurn,
} from "../entities/concierge.ts";
import {
  MARKETPLACE_CATEGORIES,
  type MarketplaceAgent,
  type MarketplaceAgentPage,
  type MarketplaceCategory,
} from "../entities/marketplace-agent.ts";
import type { AgentEvidencePassport } from "../entities/evidence-passport.ts";
import {
  MARKETPLACE_AVAILABILITIES,
  type ListMarketplaceAgentsInput,
  type MarketplaceAvailability,
} from "./list-marketplace-agents.ts";
import { buildContractRequest, normalizeNegotiationContract, validateParameters, type NegotiationContract } from "../../shared/negotiation-input.ts";

export interface AskConciergeDependencies {
  model: ConciergeModel;
  admission: ConciergeAdmission;
  agents: { execute(input: ListMarketplaceAgentsInput): Promise<MarketplaceAgentPage> };
  passports: { execute(input: { agentId: string }): Promise<AgentEvidencePassport> };
  negotiationInput: (agentId: string, options: { caller?: string }) => Promise<{ status: number; body: unknown } | null>;
  now?: () => number;
}

interface ContractEntry {
  contract: NegotiationContract;
  endpointKey: string;
  contractHash: string;
}

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
- Always include the brief in propose when the need is clear, even when the
  seller's schema is unavailable or no agent fits; leave agentId and
  parameters out in that case and say so in one sentence.
- Do not ask the user to confirm what they already said. Keep the message
  under 90 words; the brief and the parameters carry the detail.
- Before proposing parameters for an agent, call get_quote_input for that
  agent and use its schema. Never invent a parameter shape.
- You may call get_passport to read an agent's indexed state and on-chain
  activity before recommending it.
- Ask at most one clarifying question, and only when a required parameter
  cannot be inferred from what the user already said.
- Always finish by calling the propose tool, even if you still have a
  question or an incomplete brief.
- The brief has three short fields in the user's own words: objective,
  deliverable, and acceptance criteria. Keep each field under 500 characters.
- Describe on-chain facts as indexed data or activity, never as proof of
  quality or of a result. Never use the words proven, track record or guarantee.
- Never invent prices, fees or delivery times. The signed quote sets the
  price and the escrow holds the funds; you only draft the request.
- Answer in the user's own language; keep tool arguments in English.
- Example for a grid request: pair is an uppercase BASE/QUOTE pair (for
  example BNB/USDT), lowerPrice and upperPrice are decimal strings with the
  lower value first, capital is a simulated amount, and gridCount is an
  integer between 2 and 100.`;

export const CONCIERGE_TOOLS: ModelToolDefinition[] = [
  {
    name: "search_agents",
    description: "Search the marketplace catalog for candidate agents by free text, category or availability.",
    parameters: {
      type: "object",
      properties: {
        q: { type: "string", description: "Free text search, at most 120 characters." },
        category: { type: "string", enum: [...MARKETPLACE_CATEGORIES] },
        availability: { type: "string", enum: [...MARKETPLACE_AVAILABILITIES] },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_passport",
    description: "Read the evidence passport (indexed state and on-chain activity) for an agent already returned by search_agents.",
    parameters: {
      type: "object",
      properties: { agentId: { type: "string" } },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_quote_input",
    description: "Read the seller's negotiation input schema for an agent already returned by search_agents.",
    parameters: {
      type: "object",
      properties: { agentId: { type: "string" } },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
  {
    name: "propose",
    description: "Finish the conversation: send the reply message, the brief, and, if ready, the agent and its seller parameters.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
        question: { type: "string" },
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
      required: ["message"],
      additionalProperties: false,
    },
  },
];

export class AskConcierge {
  constructor(private readonly deps: AskConciergeDependencies) {}

  async execute(input: { messages: ConciergeMessage[]; caller: string }): Promise<ConciergeReply> {
    const release = this.deps.admission.acquire(input.caller);
    try {
      return await this.converse(input);
    } finally {
      release();
    }
  }

  private async converse(input: { messages: ConciergeMessage[]; caller: string }): Promise<ConciergeReply> {
    const { model, agents, passports, negotiationInput } = this.deps;
    const caller = input.caller;
    const chat: ModelChatMessage[] = [
      { role: "system", content: CONCIERGE_SYSTEM_PROMPT },
      ...input.messages.map((message): ModelChatMessage => ({ role: message.role, content: message.content })),
    ];
    const seenAgents = new Map<string, ConciergeAgentCard>();
    const contracts = new Map<string, ContractEntry>();
    const steps: ConciergeStep[] = [];
    let toolCallCount = 0;

    const buildTextReply = (text: string): ConciergeReply => applyCopyFilter({
      schemaVersion: 1,
      message: text,
      question: null,
      brief: null,
      agents: [...seenAgents.values()],
      proposal: null,
      steps,
      model: model.name,
    });

    const buildProposalReply = (args: Record<string, unknown>): ConciergeReply => {
      const rawMessage = typeof args.message === "string" ? args.message : "Here is what I found.";
      const rawQuestion = typeof args.question === "string" && args.question.trim().length > 0 ? args.question : null;
      const brief = parseConciergeBrief(args.brief);

      let proposal: ConciergeProposal | null = null;
      const agentId = args.agentId;
      if (typeof agentId === "string" && seenAgents.has(agentId)) {
        const contractEntry = contracts.get(agentId);
        if (contractEntry && isPlainObject(args.parameters) && encodable(contractEntry.contract, args.parameters)) {
          const parameters = args.parameters;
          const properties = contractEntry.contract.inputSchema.properties ?? {};
          // Only the fields the model actually set: an omitted optional
          // property must not render as "undefined" in the proposal card.
          const fields = Object.keys(properties).filter((key) => parameters[key] !== undefined).map((key) => ({
            key,
            title: properties[key]?.title ?? key,
            value: isPlainObject(parameters[key]) ? JSON.stringify(parameters[key]) : String(parameters[key]),
          }));
          proposal = { agentId, parameters, contractHash: contractEntry.contractHash, fields };
        }
      }

      const orderedAgents = proposal
        ? [seenAgents.get(proposal.agentId)!, ...[...seenAgents.values()].filter((card) => card.agentId !== proposal!.agentId)]
        : [...seenAgents.values()];

      return applyCopyFilter({
        schemaVersion: 1,
        message: rawMessage,
        question: rawQuestion,
        brief,
        agents: orderedAgents,
        proposal,
        steps,
        model: model.name,
      });
    };

    const searchAgents = async (args: Record<string, unknown>): Promise<unknown> => {
      const q = typeof args.q === "string" ? args.q : undefined;
      const category = typeof args.category === "string"
        && (MARKETPLACE_CATEGORIES as readonly string[]).includes(args.category)
        ? args.category as MarketplaceCategory
        : undefined;
      const availability: MarketplaceAvailability = typeof args.availability === "string"
        && (MARKETPLACE_AVAILABILITIES as readonly string[]).includes(args.availability)
        ? args.availability as MarketplaceAvailability
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
      const label = q && !BANNED_COPY.test(q) ? q.slice(0, 60) : "the request";
      steps.push({ tool: "search_agents", summary: `${cards.length} agents for “${label}”` });
      return { agents: cards };
    };

    const getPassport = async (args: Record<string, unknown>): Promise<unknown> => {
      const agentId = args.agentId;
      if (typeof agentId !== "string") return { error: "INVALID_ARGUMENTS" };
      if (!seenAgents.has(agentId)) return { error: "UNKNOWN_AGENT" };
      let passport: AgentEvidencePassport;
      try {
        passport = await passports.execute({ agentId });
      } catch (error) {
        return toolErrorFrom(error);
      }
      steps.push({ tool: "get_passport", summary: `passport for ${agentId}` });
      return {
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

    const getQuoteInput = async (args: Record<string, unknown>): Promise<unknown> => {
      const agentId = args.agentId;
      if (typeof agentId !== "string") return { error: "INVALID_ARGUMENTS" };
      if (!seenAgents.has(agentId)) return { error: "UNKNOWN_AGENT" };
      const response = await negotiationInput(agentId, { caller });
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
      steps.push({ tool: "get_quote_input", summary: `quote input for ${agentId}` });
      return { inputSchema: contract.inputSchema, taskDescriptionPrefix: contract.taskDescriptionPrefix, terms: contract.terms };
    };

    const runTool = async (call: ModelToolCall): Promise<unknown> => {
      let args: unknown;
      try {
        args = JSON.parse(call.arguments);
      } catch {
        return { error: "INVALID_ARGUMENTS" };
      }
      if (!isPlainObject(args)) return { error: "INVALID_ARGUMENTS" };
      if (call.name === "search_agents") return searchAgents(args);
      if (call.name === "get_passport") return getPassport(args);
      if (call.name === "get_quote_input") return getQuoteInput(args);
      return { error: "UNKNOWN_TOOL" };
    };

    const processTurn = async (turn: ModelTurn): Promise<ConciergeReply | null> => {
      if (turn.kind === "text") return buildTextReply(turn.text);

      let proposeArgs: Record<string, unknown> | null = null;
      const toolResults: Array<{ id: string; content: string }> = [];
      for (const call of turn.calls) {
        let result: unknown;
        // `propose` is the mandatory structured output, not a catalog lookup,
        // so it never counts against the lookup budget below — otherwise a
        // model that used up its 6 lookups could never submit a proposal,
        // including the forced propose fallback once rounds run out.
        if (call.name === "propose") {
          let args: unknown;
          try {
            args = JSON.parse(call.arguments);
          } catch {
            args = undefined;
          }
          if (isPlainObject(args)) {
            proposeArgs ??= args;
            result = { ok: true };
          } else {
            result = { error: "INVALID_ARGUMENTS" };
          }
        } else {
          toolCallCount += 1;
          if (toolCallCount > CONCIERGE_LIMITS.toolCalls) {
            result = { error: "TOOL_BUDGET_EXCEEDED" };
          } else {
            result = await runTool(call);
          }
        }
        toolResults.push({ id: call.id, content: JSON.stringify(result) });
      }
      chat.push({ role: "assistant", content: turn.text, toolCalls: turn.calls });
      for (const toolResult of toolResults) {
        chat.push({ role: "tool", toolCallId: toolResult.id, content: toolResult.content });
      }
      return proposeArgs ? buildProposalReply(proposeArgs) : null;
    };

    // One shared deadline for the whole conversation (rounds + tool calls),
    // well under the route's maxDuration, so a slow upstream ends this use
    // case's own fallback reply instead of the platform killing the
    // function mid-flight — which would skip the `finally { release() }` in
    // execute() and leak the caller's admission slot.
    const now = this.deps.now ?? Date.now;
    const startedAt = now();
    const withinDeadline = () => now() - startedAt < CONCIERGE_LIMITS.deadlineMs;

    for (let round = 0; round < CONCIERGE_LIMITS.modelRounds; round += 1) {
      if (!withinDeadline()) break;
      // The last round forces propose so the conversation always ends in at
      // most `modelRounds` model calls (not modelRounds + 1).
      const isLastRound = round === CONCIERGE_LIMITS.modelRounds - 1;
      const turn = await model.complete({ messages: chat, tools: CONCIERGE_TOOLS, ...(isLastRound ? { forceTool: "propose" } : {}) });
      // A forced round that still answers with plain text ignored the
      // forced tool choice, so it falls through to the fallback message
      // below rather than surfacing that text as if it were a real reply.
      if (isLastRound && turn.kind !== "tool_calls") break;
      const reply = await processTurn(turn);
      if (reply) return reply;
    }

    return applyCopyFilter({
      schemaVersion: 1,
      message: "I could not finish this request. Try again with more detail.",
      question: null,
      brief: null,
      agents: [...seenAgents.values()],
      proposal: null,
      steps,
      model: model.name,
    });
  }
}

// The client echoes `message` back as an assistant turn, which
// parseConciergeMessages bounds to assistantChars, so bound it here too.
function applyCopyFilter(reply: ConciergeReply): ConciergeReply {
  return {
    ...reply,
    message: BANNED_COPY.test(reply.message) ? "Here is what I found." : reply.message.slice(0, CONCIERGE_LIMITS.assistantChars),
    question: reply.question && BANNED_COPY.test(reply.question) ? null : reply.question,
  };
}
