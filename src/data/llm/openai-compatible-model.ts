import { MarketplaceDataUnavailableError, MarketplaceRateLimitError } from "../../business/errors/marketplace-errors.ts";
import type { ConciergeModel, ModelChatMessage, ModelToolCall, ModelToolDefinition, ModelTurn } from "../../business/entities/concierge.ts";

export interface OpenAiCompatibleEnvironment {
  CONCIERGE_BASE_URL?: string;
  CONCIERGE_API_KEY?: string;
  CONCIERGE_MODEL?: string;
  // Index signature keeps this assignable from process.env (a ProcessEnv,
  // which TS otherwise treats as sharing no properties with an all-optional type).
  [key: string]: string | undefined;
}

export const CONCIERGE_DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
export const CONCIERGE_DEFAULT_MODEL = "qwen-plus";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 262_144;
const DEFAULT_RETRY_AFTER_SECONDS = 10;

export function isConciergeConfigured(env: OpenAiCompatibleEnvironment = process.env): boolean {
  return typeof env.CONCIERGE_API_KEY === "string" && env.CONCIERGE_API_KEY.trim().length > 0;
}

// Serialises one concierge-side message into the OpenAI chat-completions shape.
// The "assistant" role appears in two branches of ModelChatMessage (plain text
// vs. one carrying toolCalls); the presence of `toolCalls` disambiguates them.
function toOpenAiMessage(message: ModelChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if ("toolCalls" in message) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function toOpenAiTool(tool: ModelToolDefinition): Record<string, unknown> {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

function parseRetryAfterSeconds(response: Response): number {
  const header = response.headers.get("retry-after");
  const parsed = header === null ? Number.NaN : Number(header);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : DEFAULT_RETRY_AFTER_SECONDS;
}

// Reads a fetch Response body with a byte cap so an oversized or malformed
// upstream reply cannot exhaust memory or hang parsing. Mirrors the readJson
// pattern in src/marketplace-mcp.ts (content-length pre-check + encoded-length
// re-check), adapted to the concierge's own size budget.
async function readCappedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) throw new Error("Concierge model response is too large");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error("Concierge model response is too large");
  }
  return JSON.parse(text);
}

function isToolCall(value: unknown): value is { id: string; function: { name: string; arguments: string } } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
  return (
    typeof candidate.id === "string" &&
    typeof candidate.function === "object" &&
    candidate.function !== null &&
    typeof candidate.function.name === "string" &&
    typeof candidate.function.arguments === "string"
  );
}

// Strict parse of choices[0].message into a ModelTurn: a well-formed
// tool_calls array wins, otherwise a string content is plain text, and
// anything else is treated as an unusable upstream reply.
function parseModelTurn(payload: unknown): ModelTurn {
  const message = (payload as { choices?: Array<{ message?: unknown }> } | undefined)?.choices?.[0]?.message;
  if (typeof message !== "object" || message === null) throw new Error("Concierge model reply is malformed");
  const candidate = message as { content?: unknown; tool_calls?: unknown };

  if (Array.isArray(candidate.tool_calls) && candidate.tool_calls.length > 0) {
    if (!candidate.tool_calls.every(isToolCall)) throw new Error("Concierge model reply is malformed");
    const calls: ModelToolCall[] = candidate.tool_calls.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    }));
    return { kind: "tool_calls", text: typeof candidate.content === "string" ? candidate.content : null, calls };
  }

  if (typeof candidate.content === "string") return { kind: "text", text: candidate.content };

  throw new Error("Concierge model reply is malformed");
}

export interface OpenAiCompatibleModelOptions {
  env?: OpenAiCompatibleEnvironment;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export class OpenAiCompatibleModel implements ConciergeModel {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: OpenAiCompatibleModelOptions = {}) {
    const env = options.env ?? process.env;
    this.baseUrl = (env.CONCIERGE_BASE_URL?.trim() || CONCIERGE_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = env.CONCIERGE_API_KEY?.trim() || undefined;
    this.name = env.CONCIERGE_MODEL?.trim() || CONCIERGE_DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async complete(input: { messages: ModelChatMessage[]; tools: ModelToolDefinition[]; forceTool?: string }): Promise<ModelTurn> {
    if (!this.apiKey) throw new MarketplaceDataUnavailableError("concierge model");

    const body = {
      model: this.name,
      messages: input.messages.map(toOpenAiMessage),
      tools: input.tools.map(toOpenAiTool),
      tool_choice: input.forceTool ? { type: "function", function: { name: input.forceTool } } : "auto",
      temperature: 0.2,
      max_tokens: 1_500,
      stream: false,
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Never surface the underlying error: it may embed the request (key, prompt).
      throw new MarketplaceDataUnavailableError("concierge model");
    }

    if (response.status === 429) {
      throw new MarketplaceRateLimitError(parseRetryAfterSeconds(response), "The concierge is temporarily at capacity");
    }
    if (!response.ok) throw new MarketplaceDataUnavailableError("concierge model");

    try {
      const payload = await readCappedJson(response, this.maxResponseBytes);
      return parseModelTurn(payload);
    } catch {
      throw new MarketplaceDataUnavailableError("concierge model");
    }
  }
}
