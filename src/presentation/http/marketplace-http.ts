import { NextResponse } from "next/server";
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from "../../business/entities/marketplace-agent.ts";
import {
  InvalidMarketplaceInputError,
  MarketplaceAgentNotFoundError,
  MarketplaceDataUnavailableError,
  MarketplacePayloadTooLargeError,
  MarketplaceRateLimitError,
} from "../../business/errors/marketplace-errors.ts";
import {
  InvalidPublicJobProofIdError,
  PublicJobProofNotFoundError,
} from "../../business/errors/public-job-proof-errors.ts";

export function integerParameter(value: string | null, fallback: number, name: string): number {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new InvalidMarketplaceInputError(`${name} must be a positive integer`);
  return Number(value);
}

export function categoryParameter(value: string | null): MarketplaceCategory | undefined {
  if (!value || value === "all") return undefined;
  if (!MARKETPLACE_CATEGORIES.includes(value as MarketplaceCategory)) {
    throw new InvalidMarketplaceInputError("Unknown marketplace category");
  }
  return value as MarketplaceCategory;
}

export function marketplaceErrorResponse(error: unknown): NextResponse {
  if (error instanceof MarketplacePayloadTooLargeError) {
    return NextResponse.json(
      { error: { code: error.name, message: error.message } },
      { status: 413 },
    );
  }
  if (error instanceof MarketplaceRateLimitError) {
    return NextResponse.json(
      { error: { code: error.name, message: error.message } },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
    );
  }
  if (error instanceof InvalidMarketplaceInputError || error instanceof InvalidPublicJobProofIdError) {
    return NextResponse.json({ error: { code: error.name, message: error.message } }, { status: 400 });
  }
  if (error instanceof MarketplaceAgentNotFoundError || error instanceof PublicJobProofNotFoundError) {
    return NextResponse.json({ error: { code: error.name, message: error.message } }, { status: 404 });
  }
  if (error instanceof MarketplaceDataUnavailableError) {
    return NextResponse.json({ error: { code: error.name, message: error.message } }, { status: 503 });
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "The marketplace request could not be completed" } },
    { status: 500 },
  );
}
