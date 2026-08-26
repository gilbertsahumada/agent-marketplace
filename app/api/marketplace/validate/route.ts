import { NextResponse } from "next/server";
import { validateMarketplaceAgent } from "@/src/business/composition";
import {
  InvalidMarketplaceInputError,
  MarketplacePayloadTooLargeError,
} from "@/src/business/errors/marketplace-errors";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

const MAX_VALIDATION_BODY_BYTES = 256;

async function boundedBody(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_VALIDATION_BODY_BYTES) {
    throw new MarketplacePayloadTooLargeError();
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_VALIDATION_BODY_BYTES) {
      await reader.cancel();
      throw new MarketplacePayloadTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

function validationInput(raw: string): { agentId: string } {
  if (raw.length > 256) throw new InvalidMarketplaceInputError("Validation input is too large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new InvalidMarketplaceInputError("Validation input must be JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidMarketplaceInputError("Validation input must be an object");
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== "agentId" || typeof entries[0][1] !== "string") {
    throw new InvalidMarketplaceInputError("Validation accepts only agentId");
  }
  return { agentId: entries[0][1] };
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new InvalidMarketplaceInputError("Content-Type must be application/json");
    }
    const result = await validateMarketplaceAgent.execute(validationInput(await boundedBody(request)));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
