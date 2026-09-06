import { isSyntacticallyPublicHttpsUrl } from "../trust8004/safe-url.ts";
import { a2aBaseEndpoint } from "../trust8004/candidates.ts";
import { NEGOTIATION_INPUT_EXTENSION, normalizeNegotiationContract, type NegotiationContract } from "../../../src/shared/negotiation-input.ts";

/** Only reads declarations: never negotiates or calls a seller tool. */
export async function discoverNegotiationInput(input: A2aProbeInput & { transport: string }): Promise<NegotiationContract> {
  if (!isSyntacticallyPublicHttpsUrl(input.endpoint)) throw new SellerProbeError("SELLER_UNSAFE_URL");
  const deadline = (input.now ?? performance.now.bind(performance))() + input.timeoutMs;
  const usage = { bytes: 0 };
  if (input.transport === "mcp") {
    const target = new URL(input.endpoint);
    const mcpInput = { ...input, taskDescription: "", terms: { deliverables: "", quality_standards: "", evaluation_required: true as const, evaluator_type: "uma_oov3" as const } };
    const initialized = await fetchMcpJson(target, { jsonrpc: "2.0", id: crypto.randomUUID(), method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "trust8004-marketplace", version: "1.0" },
    } }, mcpInput, deadline, usage);
    requireMcpVersion(initialized.result);
    await fetchMcpJson(target, { jsonrpc: "2.0", method: "notifications/initialized" }, mcpInput, deadline, usage, initialized.sessionId);
    const listed = await fetchMcpJson(target, { jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/list", params: {} }, mcpInput, deadline, usage, initialized.sessionId);
    const tools = isRecord(listed.result) && Array.isArray(listed.result.tools) ? listed.result.tools : [];
    const tool = tools.find(value => isRecord(value) && ["negotiate_erc8183_job", "request_quote"].includes(String(value.name)));
    if (!isRecord(tool)) throw new SellerProbeError("MCP_QUOTE_TOOL_REQUIRED");
    return normalizeNegotiationContract({ encoding: "request", inputSchema: tool.inputSchema,
      ...(tool.capabilityProbeParameters === undefined ? {} : { capabilityProbeParameters: tool.capabilityProbeParameters }),
    });
  }
  if (input.transport === "a2a") {
    const url = new URL(a2aBaseEndpoint(input.endpoint));
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/.well-known/agent-card.json`;
    const card = await fetchJson(url, { headers: { accept: "application/json" } }, input, deadline, usage);
    parseMessageUrl(card.url, new URL(a2aBaseEndpoint(input.endpoint)));
    if (!parseSkills(card.skills).some(skill => NEGOTIATION_SKILLS.includes(skill as typeof NEGOTIATION_SKILLS[number]))) throw new SellerProbeError("A2A_REQUIRED_SKILLS");
    const extensions = isRecord(card.capabilities) && Array.isArray(card.capabilities.extensions) ? card.capabilities.extensions : [];
    const extension = extensions.find(value => isRecord(value) && value.uri === NEGOTIATION_INPUT_EXTENSION);
    if (!isRecord(extension)) throw new SellerProbeError("NEGOTIATION_PARAMETERS_UNAVAILABLE");
    return normalizeNegotiationContract(extension.params);
  }
  if (input.transport !== "erc8183_http") throw new SellerProbeError("NEGOTIATION_TRANSPORT_UNSUPPORTED");
  const url = new URL(input.endpoint);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/(health|status|negotiate)$/, "") + "/status";
  const status = await fetchJson(url, { headers: { accept: "application/json" } }, input, deadline, usage);
  // Explicit marketplace convention. A healthy HTTP endpoint alone is not a schema.
  if (!isRecord(status.negotiationInput)) throw new SellerProbeError("NEGOTIATION_PARAMETERS_UNAVAILABLE");
  return normalizeNegotiationContract(status.negotiationInput);
}

const MAX_AGGREGATE_RESPONSE_BYTES = 64 * 1_024;
const NEGOTIATION_SKILLS = ["negotiate-erc8183-job", "negotiate"] as const;

export class SellerProbeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SellerProbeError";
  }
}

export interface A2aProbeInput {
  readonly endpoint: string;
  readonly request: Record<string, unknown>;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly fetch: typeof fetch;
  readonly now?: () => number;
  readonly expectedHttpStatus?: Erc8183HttpStatusExpectation;
  readonly expectedA2aMessageUrl?: string;
  /** Capability probes can require the funded notification skill; a buyer
   * quote only needs negotiation and may omit it. */
  readonly requireNotifyFunded?: boolean;
}

export interface Erc8183HttpStatusExpectation {
  readonly provider: string;
  readonly commerce: string;
  readonly router: string;
  readonly policy: string;
  readonly currency: string;
  readonly decimals: number;
}

export interface A2aProbeResult {
  readonly quote: Record<string, unknown>;
  readonly negotiationSkill: typeof NEGOTIATION_SKILLS[number];
}

export interface McpProbeInput extends Omit<A2aProbeInput, "expectedHttpStatus" | "expectedA2aMessageUrl"> {
  readonly taskDescription: string;
  readonly terms: {
    deliverables: string;
    quality_standards: string;
    evaluation_required: true;
    evaluator_type: "uma_oov3";
  };
}

export async function probeA2aSeller(input: A2aProbeInput): Promise<A2aProbeResult> {
  if (!isSyntacticallyPublicHttpsUrl(input.endpoint)) {
    throw new SellerProbeError("SELLER_UNSAFE_URL");
  }
  const baseEndpoint = a2aBaseEndpoint(input.endpoint);
  const now = input.now ?? performance.now.bind(performance);
  const deadline = now() + input.timeoutMs;
  const usage = { bytes: 0 };
  const endpoint = new URL(baseEndpoint);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/.well-known/agent-card.json`;

  const card = await fetchJson(endpoint, {
    headers: { accept: "application/json" },
  }, input, deadline, usage);
  const messageUrl = parseMessageUrl(card.url, new URL(baseEndpoint), input.expectedA2aMessageUrl);
  const skills = parseSkills(card.skills);
  const negotiationSkill = NEGOTIATION_SKILLS.find((skill) => skills.includes(skill));
  if (!negotiationSkill || (input.requireNotifyFunded !== false
    && skills.filter((skill) => skill === "notify_funded").length !== 1)) {
    throw new SellerProbeError("A2A_REQUIRED_SKILLS");
  }

  const requestId = crypto.randomUUID();
  const reply = await fetchJson(messageUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: crypto.randomUUID(),
          parts: [{ kind: "data", data: { skill: negotiationSkill, ...input.request } }],
        },
      },
    }),
  }, input, deadline, usage);
  if (reply.jsonrpc !== "2.0" || reply.id !== requestId || reply.error !== undefined) {
    throw new SellerProbeError("A2A_PROTOCOL_ERROR");
  }
  const result = record(reply.result, "A2A_RESULT");
  if (!Array.isArray(result.parts)) throw new SellerProbeError("A2A_RESULT");
  const part = result.parts.find((candidate) => (
    isRecord(candidate) && candidate.kind === "data" && isRecord(candidate.data)
  ));
  if (!isRecord(part) || !isRecord(part.data)) throw new SellerProbeError("A2A_RESULT");
  return { quote: part.data, negotiationSkill };
}

export async function probeErc8183HttpSeller(input: A2aProbeInput): Promise<A2aProbeResult> {
  if (!isSyntacticallyPublicHttpsUrl(input.endpoint)) {
    throw new SellerProbeError("SELLER_UNSAFE_URL");
  }
  const declared = new URL(input.endpoint);
  const path = declared.pathname.replace(/\/+$/, "");
  const suffix = path.match(/\/(health|status|negotiate)$/)?.[1];
  const base = suffix ? path.slice(0, -(suffix.length + 1)) : path;
  const route = (name: string) => {
    const url = new URL(declared);
    url.pathname = `${base}/${name}`.replace(/\/{2,}/g, "/");
    return url;
  };
  const now = input.now ?? performance.now.bind(performance);
  const deadline = now() + input.timeoutMs;
  const usage = { bytes: 0 };
  const health = await fetchJson(route("health"), { headers: { accept: "application/json" } }, input, deadline, usage);
  if (health.status !== "ok" || health.service !== "ERC-8183 Agent") {
    throw new SellerProbeError("ERC8183_HEALTH_INVALID");
  }
  const status = await fetchJson(route("status"), { headers: { accept: "application/json" } }, input, deadline, usage);
  if (!input.expectedHttpStatus || !validHttpStatus(status, input.expectedHttpStatus)) {
    throw new SellerProbeError("ERC8183_STATUS_INVALID");
  }
  const quote = await fetchJson(route("negotiate"), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input.request),
  }, input, deadline, usage);
  return { quote, negotiationSkill: "negotiate-erc8183-job" };
}

/** Strict MCP quote adapter. Generic MCP tools are intentionally not enough
 * for hiring; the server must advertise one of the two exact tool names and
 * accept the canonical task_description + terms shape. */
export async function probeMcpSeller(input: McpProbeInput): Promise<A2aProbeResult> {
  if (!isSyntacticallyPublicHttpsUrl(input.endpoint)) throw new SellerProbeError("SELLER_UNSAFE_URL");
  const now = input.now ?? performance.now.bind(performance);
  const deadline = now() + input.timeoutMs;
  const usage = { bytes: 0 };
  const target = new URL(input.endpoint);
  const initReply = await fetchMcpJson(target, {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "trust8004-marketplace", version: "1.0" } },
  }, input, deadline, usage);
  const sessionId = initReply.sessionId;
  requireMcpVersion(initReply.result);
  await fetchMcpJson(target, { jsonrpc: "2.0", method: "notifications/initialized" }, input, deadline, usage, sessionId);
  const toolsReply = await fetchMcpJson(target, {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/list",
    params: {},
  }, input, deadline, usage, sessionId);
  const tools = toolsReply.result && isRecord(toolsReply.result) ? toolsReply.result.tools : undefined;
  if (!Array.isArray(tools)) throw new SellerProbeError("MCP_TOOLS_INVALID");
  const advertised = tools.find((tool) => isRecord(tool)
    && (tool.name === "negotiate_erc8183_job" || tool.name === "request_quote"));
  if (!isRecord(advertised) || typeof advertised.name !== "string") throw new SellerProbeError("MCP_QUOTE_TOOL_REQUIRED");
  const schema = advertised.inputSchema;
  const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : null;
  const required = isRecord(schema) && Array.isArray(schema.required)
    && schema.required.every((field) => typeof field === "string")
    ? schema.required as string[]
    : null;
  if (!isRecord(schema)
    || (schema.type !== undefined && schema.type !== "object")
    || properties === null
    || required === null
    || !( ["task_description", "terms"] as const).every((field) => field in properties)
    || !( ["task_description", "terms"] as const).every((field) => required.includes(field))) {
    throw new SellerProbeError("MCP_QUOTE_SCHEMA_INVALID");
  }
  const callReply = await fetchMcpJson(target, {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: {
      name: advertised.name,
      arguments: { task_description: input.taskDescription, terms: input.terms },
    },
  }, input, deadline, usage, sessionId);
  if (callReply.error !== undefined) throw new SellerProbeError("MCP_QUOTE_REJECTED");
  const result = callReply.result;
  if (!isRecord(result)) throw new SellerProbeError("MCP_QUOTE_INVALID");
  const content = Array.isArray(result.content) ? result.content : [];
  const data = content.find((item) => isRecord(item) && item.type === "json" && isRecord(item.json));
  if (isRecord(data) && isRecord(data.json)) return { quote: data.json, negotiationSkill: "negotiate-erc8183-job" };
  if (isRecord(result.structuredContent)) return { quote: result.structuredContent, negotiationSkill: "negotiate-erc8183-job" };
  const text = content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
  if (isRecord(text) && typeof text.text === "string") {
    try {
      const parsed: unknown = JSON.parse(text.text);
      if (isRecord(parsed)) return { quote: parsed, negotiationSkill: "negotiate-erc8183-job" };
    } catch { /* handled by the stable MCP_QUOTE_INVALID result below */ }
  }
  throw new SellerProbeError("MCP_QUOTE_INVALID");
}

function requireMcpVersion(result: unknown): void {
  if (!isRecord(result) || result.protocolVersion !== "2025-06-18") {
    throw new SellerProbeError("MCP_PROTOCOL_VERSION_UNSUPPORTED");
  }
}

async function fetchMcpJson(
  endpoint: URL,
  body: Record<string, unknown>,
  input: McpProbeInput,
  deadline: number,
  usage: { bytes: number },
  sessionId?: string,
): Promise<Record<string, unknown> & { sessionId?: string }> {
  const remainingMs = Math.floor(deadline - (input.now ?? performance.now.bind(performance))());
  if (remainingMs <= 0) throw new SellerProbeError("SELLER_TIMEOUT");
  let response: Response;
  try {
    response = await input.fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(remainingMs),
    });
  } catch { throw new SellerProbeError("SELLER_UNREACHABLE"); }
  if (response.status >= 300 && response.status < 400) throw new SellerProbeError("SELLER_REDIRECT");
  if (!response.ok) throw new SellerProbeError("MCP_HTTP_ERROR");
  const text = await readBoundedText(response, input.maxResponseBytes, usage);
  // Notifications have no JSON-RPC id or response envelope. Streamable HTTP
  // normally acknowledges them with 202 and an empty body.
  if (!Object.hasOwn(body, "id")) return sessionId ? { sessionId } : {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const event = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).at(-1)?.slice(5).trim();
    try { parsed = event ? JSON.parse(event) : null; } catch { parsed = null; }
  }
  if (!isRecord(parsed) || parsed.jsonrpc !== "2.0" || parsed.id !== body.id || parsed.error !== undefined) {
    throw new SellerProbeError("MCP_JSONRPC_INVALID");
  }
  const id = response.headers.get("mcp-session-id") ?? sessionId;
  return id ? { ...parsed, sessionId: id } : parsed;
}

function validHttpStatus(
  status: Record<string, unknown>,
  expected: Erc8183HttpStatusExpectation,
): boolean {
  const sameAddress = (actual: unknown, wanted: string) => (
    typeof actual === "string"
    && /^0x[0-9a-fA-F]{40}$/.test(actual)
    && actual.toLowerCase() === wanted.toLowerCase()
  );
  return status.status === "ok"
    && sameAddress(status.agent_address, expected.provider)
    && sameAddress(status.commerce_address, expected.commerce)
    && sameAddress(status.router_address, expected.router)
    && sameAddress(status.policy_address, expected.policy)
    && sameAddress(status.currency, expected.currency)
    && status.decimals === expected.decimals
    && typeof status.service_price === "string"
    && /^\d+$/.test(status.service_price);
}

async function fetchJson(
  url: URL,
  init: RequestInit,
  input: A2aProbeInput,
  deadline: number,
  usage: { bytes: number },
): Promise<Record<string, unknown>> {
  const remainingMs = Math.floor(deadline - (input.now ?? performance.now.bind(performance))());
  if (remainingMs <= 0) throw new SellerProbeError("SELLER_TIMEOUT");
  let response: Response;
  const fetchImpl = input.fetch;
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(remainingMs),
    });
  } catch (error) {
    if (
      error instanceof DOMException
      && (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new SellerProbeError("SELLER_TIMEOUT");
    }
    throw new SellerProbeError("SELLER_UNREACHABLE");
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new SellerProbeError("SELLER_REDIRECT");
  }
  if (response.status >= 500) throw new SellerProbeError("SELLER_SERVER_ERROR");
  if (response.status === 401 || response.status === 403) throw new SellerProbeError("SELLER_ACCESS_DENIED");
  if (response.status === 429) throw new SellerProbeError("SELLER_RATE_LIMITED");
  if (!response.ok) throw new SellerProbeError("SELLER_HTTP_4XX");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) throw new SellerProbeError("SELLER_INVALID_JSON");
  let text: string;
  try {
    text = await readBoundedText(response, input.maxResponseBytes, usage);
  } catch (error) {
    if (error instanceof SellerProbeError) throw error;
    if (
      error instanceof DOMException
      && (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new SellerProbeError("SELLER_TIMEOUT");
    }
    throw new SellerProbeError("SELLER_UNREACHABLE");
  }
  try {
    const parsed = record(JSON.parse(text), "SELLER_INVALID_JSON");
    if ((input.now ?? performance.now.bind(performance))() >= deadline) {
      throw new SellerProbeError("SELLER_TIMEOUT");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SellerProbeError) throw error;
    throw new SellerProbeError("SELLER_INVALID_JSON");
  }
}

async function readBoundedText(
  response: Response,
  perResponseLimit: number,
  usage: { bytes: number },
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      usage.bytes += value.byteLength;
      if (bytes > perResponseLimit || usage.bytes > MAX_AGGREGATE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SellerProbeError("SELLER_RESPONSE_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseMessageUrl(value: unknown, registeredEndpoint: URL, expected?: string): URL {
  if (typeof value !== "string" || !isSyntacticallyPublicHttpsUrl(value)) {
    throw new SellerProbeError("A2A_CARD_URL");
  }
  const url = new URL(value);
  if (url.origin !== registeredEndpoint.origin || url.search !== "" || url.hash !== "") {
    throw new SellerProbeError("A2A_CARD_URL");
  }
  if (expected !== undefined && url.toString() !== new URL(expected).toString()) {
    throw new SellerProbeError("A2A_CARD_URL");
  }
  return url;
}

function parseSkills(value: unknown): string[] {
  if (!Array.isArray(value)) throw new SellerProbeError("A2A_REQUIRED_SKILLS");
  const skills = value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || candidate.id.length === 0) {
      throw new SellerProbeError("A2A_REQUIRED_SKILLS");
    }
    return candidate.id;
  });
  if (new Set(skills).size !== skills.length) throw new SellerProbeError("A2A_REQUIRED_SKILLS");
  return skills;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value)) throw new SellerProbeError(code);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
