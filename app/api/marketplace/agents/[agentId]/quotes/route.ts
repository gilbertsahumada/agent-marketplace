import { NextResponse } from "next/server";
import { getBuyerQuoteHistory, startBuyerQuote } from "@/src/business/composition";
import { InvalidMarketplaceInputError, MarketplacePayloadTooLargeError } from "@/src/business/errors/marketplace-errors";
import { callerContext, marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

const MAX = 500;
async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > 4_096) throw new MarketplacePayloadTooLargeError();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4_096) throw new MarketplacePayloadTooLargeError();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new InvalidMarketplaceInputError("Quote brief must be JSON"); }
}

function brief(value: Record<string, unknown>) {
  if (value.schemaVersion === 2) {
    if (Object.keys(value).sort().join(",") !== "contractHash,endpointKey,parameters,schemaVersion"
      || typeof value.endpointKey !== "string" || !/^[a-f0-9]{64}$/.test(value.endpointKey)
      || typeof value.contractHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contractHash)
      || !value.parameters || typeof value.parameters !== "object" || Array.isArray(value.parameters)) throw new InvalidMarketplaceInputError("Seller parameters are invalid");
    return { schemaVersion: 2 as const, endpointKey: value.endpointKey, contractHash: value.contractHash, parameters: value.parameters as Record<string, unknown> };
  }
  if (Object.keys(value).sort().join(",") !== "acceptanceCriteria,deliverable,objective"
    || [value.objective, value.deliverable, value.acceptanceCriteria].some((entry) => (
      typeof entry !== "string" || entry.trim().length < 1 || entry.length > MAX
    ))) throw new InvalidMarketplaceInputError("Quote brief is invalid");
  return {
    objective: String(value.objective),
    deliverable: String(value.deliverable),
    acceptanceCriteria: String(value.acceptanceCriteria),
  };
}

export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await context.params;
    const params = new URL(_request.url).searchParams;
    const page = params.get("page");
    if ([...params.keys()].some(key => key !== "page") || params.getAll("page").length > 1 || (page !== null && !/^[1-9]\d{0,5}$/.test(page))) throw new InvalidMarketplaceInputError("Invalid history page");
    const result = await getBuyerQuoteHistory(agentId, page ? { page: Number(page) } : {});
    if (!result) return NextResponse.json({ error: "quote_service_unavailable" }, { status: 503 });
    return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) { return marketplaceErrorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new InvalidMarketplaceInputError("Content-Type must be application/json");
    }
    const { agentId } = await context.params;
    const result = await startBuyerQuote(agentId, brief(await readJson(request)), { caller: callerContext(request) });
    if (!result) return NextResponse.json({ error: "quote_service_unavailable" }, { status: 503 });
    return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) { return marketplaceErrorResponse(error); }
}
