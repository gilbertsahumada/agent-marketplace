import { createUIMessageStreamResponse } from "ai";
import { NextResponse } from "next/server";
import { askConcierge } from "@/src/business/composition";
import { CONCIERGE_SCHEMA_VERSION, parseConciergeMessages } from "@/src/business/entities/concierge";
import { InvalidMarketplaceInputError, MarketplacePayloadTooLargeError } from "@/src/business/errors/marketplace-errors";
import { BoundedRequestJsonError, readBoundedRequestJson } from "@/src/presentation/http/bounded-request-json";
import { callerContext, clientAddress, marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

// 12 messages × 4,000 chars of assistant text plus JSON overhead.
const MAX_BODY_BYTES = 65_536;

async function readConciergeBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await readBoundedRequestJson(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BoundedRequestJsonError && error.code === "BODY_TOO_LARGE") {
      throw new MarketplacePayloadTooLargeError();
    }
    throw new InvalidMarketplaceInputError("Concierge request body must be JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidMarketplaceInputError("Concierge request body must be JSON");
  }
  return value as Record<string, unknown>;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Streams one concierge turn as an AI SDK UI message stream (SSE): text
// deltas plus every tool call and its output. Input errors, admission and a
// missing model still answer with the marketplace JSON error shape before
// the stream starts; failures after that arrive as an error chunk.
export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new InvalidMarketplaceInputError("Content-Type must be application/json");
    }
    const body = await readConciergeBody(request);
    if (body.schemaVersion !== CONCIERGE_SCHEMA_VERSION) {
      throw new InvalidMarketplaceInputError("Unsupported concierge schema version");
    }
    const messages = parseConciergeMessages(body.messages);
    const stream = askConcierge.stream({
      messages,
      caller: callerContext(request),
      admissionKey: clientAddress(request),
      // A closed tab aborts the model call so its admission slot is freed.
      ...(request.signal ? { abortSignal: request.signal } : {}),
    });
    return createUIMessageStreamResponse({ stream, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}

export async function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } },
    { status: 405, headers: { allow: "POST" } },
  );
}
