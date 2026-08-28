import { isSyntacticallyPublicHttpsUrl } from "../trust8004/safe-url";

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
}

export interface A2aProbeResult {
  readonly quote: Record<string, unknown>;
  readonly negotiationSkill: typeof NEGOTIATION_SKILLS[number];
}

export async function probeA2aSeller(input: A2aProbeInput): Promise<A2aProbeResult> {
  if (!isSyntacticallyPublicHttpsUrl(input.endpoint)) {
    throw new SellerProbeError("SELLER_UNSAFE_URL");
  }
  const now = input.now ?? performance.now.bind(performance);
  const deadline = now() + input.timeoutMs;
  const usage = { bytes: 0 };
  const endpoint = new URL(input.endpoint);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/.well-known/agent-card.json`;

  const card = await fetchJson(endpoint, {
    headers: { accept: "application/json" },
  }, input, deadline, usage);
  const messageUrl = parseMessageUrl(card.url, new URL(input.endpoint).origin);
  const skills = parseSkills(card.skills);
  const negotiationSkill = NEGOTIATION_SKILLS.find((skill) => skills.includes(skill));
  if (!negotiationSkill || skills.filter((skill) => skill === "notify_funded").length !== 1) {
    throw new SellerProbeError("A2A_REQUIRED_SKILLS");
  }

  const reply = await fetchJson(messageUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
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
  if (reply.error !== undefined) throw new SellerProbeError("A2A_PROTOCOL_ERROR");
  const result = record(reply.result, "A2A_RESULT");
  if (!Array.isArray(result.parts)) throw new SellerProbeError("A2A_RESULT");
  const part = result.parts.find((candidate) => (
    isRecord(candidate) && candidate.kind === "data" && isRecord(candidate.data)
  ));
  if (!isRecord(part) || !isRecord(part.data)) throw new SellerProbeError("A2A_RESULT");
  return { quote: part.data, negotiationSkill };
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
  try {
    response = await input.fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(remainingMs),
    });
  } catch {
    throw new SellerProbeError("SELLER_UNREACHABLE");
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new SellerProbeError("SELLER_REDIRECT");
  }
  if (response.status >= 500) throw new SellerProbeError("SELLER_UNREACHABLE");
  if (!response.ok) throw new SellerProbeError("SELLER_HTTP_4XX");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) throw new SellerProbeError("SELLER_INVALID_JSON");
  const text = await readBoundedText(response, input.maxResponseBytes, usage);
  try {
    return record(JSON.parse(text), "SELLER_INVALID_JSON");
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

function parseMessageUrl(value: unknown, expectedOrigin: string): URL {
  if (typeof value !== "string" || !isSyntacticallyPublicHttpsUrl(value)) {
    throw new SellerProbeError("A2A_CARD_URL");
  }
  const url = new URL(value);
  if (url.origin !== expectedOrigin) throw new SellerProbeError("A2A_CARD_URL");
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
