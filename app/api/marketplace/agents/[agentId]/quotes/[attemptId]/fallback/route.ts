import { NextResponse } from "next/server";
import { fallbackBuyerQuote } from "@/src/business/composition";
import { InvalidMarketplaceInputError, MarketplacePayloadTooLargeError } from "@/src/business/errors/marketplace-errors";
import { callerContext, marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

async function readRequest(request: Request): Promise<{ task_description: string; terms: Record<string, unknown> }> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > 4_096) throw new MarketplacePayloadTooLargeError();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4_096) throw new MarketplacePayloadTooLargeError();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const row = value as Record<string, unknown>;
    if (typeof row.task_description !== "string" || !row.terms || typeof row.terms !== "object" || Array.isArray(row.terms)) throw new Error();
    return { task_description: row.task_description, terms: row.terms as Record<string, unknown> };
  } catch { throw new InvalidMarketplaceInputError("Fallback request is invalid"); }
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string; attemptId: string }> }) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new InvalidMarketplaceInputError("Content-Type must be application/json");
    }
    const { agentId, attemptId } = await context.params;
    if (!/^[1-9]\d{0,19}$/.test(agentId)) throw new InvalidMarketplaceInputError("Agent id is invalid");
    const browserErrorCode = request.headers.get("x-marketplace-browser-error");
    const result = await fallbackBuyerQuote(agentId, attemptId, await readRequest(request),
      { caller: callerContext(request), ...(browserErrorCode ? { browserErrorCode } : {}) });
    if (!result) return NextResponse.json({ error: "quote_service_unavailable" }, { status: 503 });
    return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) { return marketplaceErrorResponse(error); }
}
