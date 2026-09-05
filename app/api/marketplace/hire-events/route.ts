import { NextResponse } from "next/server";
import { recordHireEvent } from "@/src/business/composition";
import { InvalidMarketplaceInputError, MarketplacePayloadTooLargeError } from "@/src/business/errors/marketplace-errors";
import { callerContext, marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

type HireEventInput = Parameters<typeof recordHireEvent>[0];

const MAX_BODY_BYTES = 1_024;
const KEYS = ["agentId", "chainId", "jobId", "phase", "txHash"] as const;
const TELEMETRY_PHASES = new Set<HireEventInput["phase"]>(["clicked"]);
const CHAIN_PHASES = new Set<HireEventInput["phase"]>(["created", "funded", "submitted"]);
const AGENT_ID = /^[1-9]\d{0,19}$/;
const JOB_ID = /^(?:0|[1-9]\d{0,77})$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const STATUS_CODES: Record<Awaited<ReturnType<typeof recordHireEvent>>["status"], number> = {
  recorded: 201,
  duplicate: 200,
  rejected: 409,
  failed: 202,
  not_configured: 202,
};

async function boundedJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) {
    throw new MarketplacePayloadTooLargeError();
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new MarketplacePayloadTooLargeError();
  try { return JSON.parse(body) as unknown; } catch { throw new InvalidMarketplaceInputError("Hire event must be JSON"); }
}

function input(raw: unknown): HireEventInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidMarketplaceInputError("Hire event must be an object");
  }
  const value = raw as Record<string, unknown>;
  const phase = value.phase as HireEventInput["phase"];
  const keys = Object.keys(value).filter((key) => key !== "quoteRequestId").sort().join(",");
  const quoteRequestId = value.quoteRequestId;
  if (keys !== KEYS.join(",")
    || (value.chainId !== 56 && value.chainId !== 97)
    || typeof value.agentId !== "string" || !AGENT_ID.test(value.agentId)
    || typeof phase !== "string" || !(TELEMETRY_PHASES.has(phase) || CHAIN_PHASES.has(phase))) {
    throw new InvalidMarketplaceInputError("Hire event contract is invalid");
  }
  if (TELEMETRY_PHASES.has(phase)) {
    if (value.jobId !== null || value.txHash !== null || quoteRequestId !== undefined) {
      throw new InvalidMarketplaceInputError("Telemetry phases carry no job or transaction");
    }
    return { agentId: value.agentId, chainId: value.chainId, phase, jobId: null, txHash: null };
  }
  if (typeof value.jobId !== "string" || !JOB_ID.test(value.jobId)
    || typeof value.txHash !== "string" || !TX_HASH.test(value.txHash)) {
    throw new InvalidMarketplaceInputError("Chain phases require a job id and a transaction hash");
  }
  if (quoteRequestId !== undefined
    && (!Number.isSafeInteger(quoteRequestId) || Number(quoteRequestId) < 1)) {
    throw new InvalidMarketplaceInputError("quoteRequestId must be a positive request id");
  }
  return {
    agentId: value.agentId, chainId: value.chainId, phase, jobId: value.jobId, txHash: value.txHash,
    ...(quoteRequestId === undefined ? {} : { quoteRequestId: quoteRequestId as number }),
  };
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new InvalidMarketplaceInputError("Content-Type must be application/json");
    }
    // The request context feeds the Worker's per-caller telemetry budget as an
    // HMAC fingerprint only; nothing else about the request is forwarded.
    const sync = await recordHireEvent(input(await boundedJson(request)), { caller: callerContext(request) });
    return NextResponse.json({ persistence: sync.status }, {
      status: STATUS_CODES[sync.status],
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
