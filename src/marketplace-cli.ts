export const DEFAULT_ORIGIN = "https://bnb-agent-marketplace-ruby.vercel.app";
const MAX_RESPONSE_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 40_000;

type CliResource = "agent" | "seller" | "job";
type CliAction = "inspect" | "validate" | "qualify" | "proof";

export interface MarketplaceCliArguments {
  resource: CliResource;
  action: CliAction;
  chainId: 56;
  id: string;
  origin: string;
}

interface MarketplaceCliDependencies {
  fetch?: typeof globalThis.fetch;
}

function usage(): string {
  return [
    "Usage:",
    "  marketplace agent inspect 56:<agentId>",
    "  marketplace agent validate 56:<agentId>",
    "  marketplace seller qualify 56:<agentId>",
    "  marketplace job proof 56:<jobId>",
    "Options:",
    "  --origin <https-url>  Marketplace origin (http is allowed only for localhost)",
  ].join("\n");
}

export function normalizedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("origin must be an absolute URL");
  }
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) throw new Error("origin must use HTTPS unless it is localhost");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("origin must contain only scheme, host, and optional port");
  }
  return url.origin;
}

export function parseMarketplaceCliArguments(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): MarketplaceCliArguments {
  const [resource, action, target, ...options] = argv;
  const validCommand = (resource === "agent" && (action === "inspect" || action === "validate"))
    || (resource === "seller" && action === "qualify")
    || (resource === "job" && action === "proof");
  if (!validCommand || !target) throw new Error(usage());
  if (options.length !== 0 && (options.length !== 2 || options[0] !== "--origin" || !options[1])) {
    throw new Error(usage());
  }
  const match = /^(\d+):([0-9]+)$/.exec(target);
  if (!match || match[1] !== "56") throw new Error("Only BSC chain target 56:<id> is supported");
  if (resource === "job" && !/^[1-9]\d*$/.test(match[2]!)) throw new Error("jobId must be positive");
  const origin = normalizedOrigin(options[1] ?? env.MARKETPLACE_ORIGIN ?? DEFAULT_ORIGIN);
  return {
    resource,
    action,
    chainId: 56,
    id: match[2]!,
    origin,
  } as MarketplaceCliArguments;
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Marketplace API schema error: ${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function matchingIdentifier(value: unknown, id: string, context: string): void {
  if (value !== id) throw new Error(`Marketplace API schema error: ${context} does not match the request`);
}

function validateResponse(payload: unknown, args: MarketplaceCliArguments): unknown {
  const root = record(payload, "response");
  if (root.chainId !== 56) throw new Error("Marketplace API schema error: chainId must be 56");
  if (args.resource === "agent" && args.action === "inspect") {
    matchingIdentifier(root.agentId, args.id, "agentId");
    if (typeof root.name !== "string") throw new Error("Marketplace API schema error: agent name is missing");
    return payload;
  }
  if (args.resource === "agent") {
    const agent = record(root.agent, "agent");
    const passport = record(root.passport, "passport");
    matchingIdentifier(agent.agentId, args.id, "agent.agentId");
    matchingIdentifier(passport.agentId, args.id, "passport.agentId");
    return payload;
  }
  if (args.resource === "seller") {
    matchingIdentifier(root.agentId, args.id, "agentId");
    if (!["registered", "evaluated", "hireable", "job_proven", "attention"].includes(String(root.state))) {
      throw new Error("Marketplace API schema error: Passport state is invalid");
    }
    record(root.checks, "checks");
    if (!Array.isArray(root.nextRequirements)) throw new Error("Marketplace API schema error: nextRequirements must be an array");
    return payload;
  }
  matchingIdentifier(root.jobId, args.id, "jobId");
  if (typeof root.agentId !== "string" || root.resultHashVerified !== true) {
    throw new Error("Marketplace API schema error: durable Mainnet proof is incomplete");
  }
  return payload;
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Marketplace API response exceeded the size limit");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Marketplace API response exceeded the size limit");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("Marketplace API returned invalid JSON");
  }
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload
      ? record(Reflect.get(payload, "error"), "error")
      : {};
    const code = typeof error.code === "string" ? error.code.slice(0, 80) : `HTTP_${response.status}`;
    const message = typeof error.message === "string" ? error.message.slice(0, 300) : "Marketplace request failed";
    throw new Error(`${code}: ${message}`);
  }
  return payload;
}

export async function executeMarketplaceCli(
  args: MarketplaceCliArguments,
  dependencies: MarketplaceCliDependencies = {},
): Promise<unknown> {
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const path = args.resource === "agent" && args.action === "inspect"
    ? `/api/marketplace/agents/${args.id}`
    : args.resource === "agent"
      ? "/api/marketplace/validate"
      : args.resource === "seller"
        ? `/api/marketplace/agents/${args.id}/passport`
        : `/api/marketplace/proofs/jobs/mainnet/${args.id}`;
  const isValidation = args.resource === "agent" && args.action === "validate";
  const response = await fetch(`${args.origin}${path}`, {
    method: isValidation ? "POST" : "GET",
    headers: isValidation
      ? { accept: "application/json", "content-type": "application/json" }
      : { accept: "application/json" },
    ...(isValidation ? { body: JSON.stringify({ agentId: args.id }) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return validateResponse(await readJson(response), args);
}

export async function runMarketplaceCli(): Promise<void> {
  try {
    const result = await executeMarketplaceCli(parseMarketplaceCliArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Marketplace CLI failed"}\n`);
    process.exitCode = 1;
  }
}
