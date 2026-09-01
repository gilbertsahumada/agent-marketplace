import { NextResponse } from "next/server";
import {
  CatalogValidationRequestError,
  issueCatalogValidationRequestToken,
  requestCatalogValidation,
  validateMarketplaceAgent,
} from "@/src/business/composition";
import {
  InvalidMarketplaceInputError,
  MarketplacePayloadTooLargeError,
} from "@/src/business/errors/marketplace-errors";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

const MAX_VALIDATION_BODY_BYTES = 256;

type ValidationInput =
  | { readonly mode: "legacy"; readonly agentId: string }
  | { readonly mode: "infrastructure"; readonly agentId: string; readonly endpointKey: string; readonly validationKind: "protocol" };

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

function validationInput(raw: string): ValidationInput {
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
  const fields = value as Record<string, unknown>;
  if (entries.length === 1 && entries[0]?.[0] === "agentId" && typeof entries[0][1] === "string") {
    return { mode: "legacy", agentId: entries[0][1] };
  }
  if (entries.length === 3
    && Object.keys(fields).sort().join(",") === "agentId,endpointKey,validationKind"
    && typeof fields.agentId === "string"
    && typeof fields.endpointKey === "string"
    && fields.validationKind === "protocol") {
    return {
      mode: "infrastructure",
      agentId: fields.agentId,
      endpointKey: fields.endpointKey,
      validationKind: "protocol",
    };
  }
  throw new InvalidMarketplaceInputError("Validation accepts agentId, or an agentId, endpointKey and protocol validation kind");
}

function callerContext(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const origin = request.headers.get("origin")?.trim();
  if (!forwarded && !real && !origin) return "anonymous";
  return [forwarded || real || "unknown", origin || "same-origin"].join("|");
}

async function infrastructureResponse(
  input: Extract<ValidationInput, { mode: "infrastructure" }>,
  request: Request,
): Promise<NextResponse> {
  const result = await requestCatalogValidation(input, { caller: callerContext(request) });
  if (result.status === "completed") {
    return NextResponse.json({
      schemaVersion: 2,
      status: result.status,
      reused: result.reused,
      requestId: null,
    }, { status: 200, headers: { "cache-control": "no-store" } });
  }
  if (result.validationId === null) {
    throw new CatalogValidationRequestError("CATALOG_VALIDATION_INVALID_RESPONSE", 502);
  }
  const requestId = issueCatalogValidationRequestToken({
    agentId: input.agentId,
    endpointKey: input.endpointKey,
    validationId: result.validationId,
  });
  if (!requestId) {
    throw new CatalogValidationRequestError("CATALOG_VALIDATION_NOT_CONFIGURED", 503);
  }
  return NextResponse.json({
    schemaVersion: 2,
    status: result.status,
    reused: result.reused,
    requestId,
    pollAfterMs: result.status === "running" ? 1_000 : 1_500,
  }, { status: 202, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new InvalidMarketplaceInputError("Content-Type must be application/json");
    }
    const input = validationInput(await boundedBody(request));
    if (input.mode === "infrastructure") return await infrastructureResponse(input, request);
    const result = await validateMarketplaceAgent.execute({ agentId: input.agentId });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CatalogValidationRequestError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        {
          status: error.httpStatus,
          headers: error.retryAfterSeconds === undefined
            ? { "cache-control": "no-store" }
            : { "cache-control": "no-store", "retry-after": String(error.retryAfterSeconds) },
        },
      );
    }
    return marketplaceErrorResponse(error);
  }
}
