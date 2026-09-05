import { NextResponse } from "next/server";
import { reportBuyerQuoteFailure, submitBuyerQuoteResult } from "@/src/business/composition";
import { InvalidMarketplaceInputError, MarketplacePayloadTooLargeError } from "@/src/business/errors/marketplace-errors";
import { callerContext, marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

async function readEnvelope(request: Request): Promise<{ envelope?: Record<string, unknown>; errorCode?: string }> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > 64 * 1_024) throw new MarketplacePayloadTooLargeError();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 64 * 1_024) throw new MarketplacePayloadTooLargeError();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const row = value as Record<string, unknown>;
    if (typeof row.errorCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(row.errorCode)) return { errorCode: row.errorCode };
    const envelope = row.envelope;
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error();
    return { envelope: envelope as Record<string, unknown> };
  } catch { throw new InvalidMarketplaceInputError("Quote result must contain an envelope"); }
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string; attemptId: string }> }) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new InvalidMarketplaceInputError("Content-Type must be application/json");
    }
    const { agentId, attemptId } = await context.params;
    if (!/^[1-9]\d{0,19}$/.test(agentId)) throw new InvalidMarketplaceInputError("Agent id is invalid");
    const resultInput = await readEnvelope(request);
    const result = resultInput.errorCode
      ? await reportBuyerQuoteFailure(agentId, attemptId, resultInput.errorCode, { caller: callerContext(request) })
      : await submitBuyerQuoteResult(agentId, attemptId, resultInput.envelope!, { caller: callerContext(request) });
    if (!result) return NextResponse.json({ error: "quote_service_unavailable" }, { status: 503 });
    return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) { return marketplaceErrorResponse(error); }
}
