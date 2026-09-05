import { NextResponse } from "next/server";
import type { HireAddress, HireChainId } from "../../business/entities/hire-job.ts";
import { InvalidMarketplaceInputError, MarketplaceDataUnavailableError } from "../../business/errors/marketplace-errors.ts";

// Same cache window as the Worker routes behind these responses.
export const LEDGER_CACHE_HEADERS = { "cache-control": "public, max-age=30, stale-while-revalidate=60" };
// The activity window is served by the Worker with a longer window of its own.
export const ACTIVITY_CACHE_HEADERS = { "cache-control": "public, max-age=60, stale-while-revalidate=300" };

export function chainIdParameter(value: string | null): HireChainId {
  if (value === "56") return 56;
  if (value === "97") return 97;
  throw new InvalidMarketplaceInputError("chainId must be 56 or 97");
}

export function addressParameter(value: string | null, name: string): HireAddress | undefined {
  if (value === null) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new InvalidMarketplaceInputError(`${name} must be an EVM address`);
  return value as HireAddress;
}

export function jobIdParameter(value: string | null, name: string): string | undefined {
  if (value === null) return undefined;
  if (!/^(?:0|[1-9]\d{0,15})$/.test(value)) throw new InvalidMarketplaceInputError(`${name} must be a job id`);
  return value;
}

// Decimal 1..90 with no leading zero; absent means the Worker's default.
export function daysParameter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^[1-9]\d?$/.test(value) || Number(value) > 90) throw new InvalidMarketplaceInputError("days must be between 1 and 90");
  return Number(value);
}

export function agentIdParameter(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (!/^[1-9]\d{0,19}$/.test(value)) throw new InvalidMarketplaceInputError("agentId must be a positive integer");
  return value;
}

export function allowlistedQuery(url: URL, allowed: readonly string[]): void {
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) throw new InvalidMarketplaceInputError(`Unknown query parameter ${key}`);
    if (seen.has(key)) throw new InvalidMarketplaceInputError(`Query parameter ${key} must appear once`);
    seen.add(key);
  }
}

export function ledgerResponse<T>(value: T | null, operation: string): NextResponse {
  if (value === null) throw new MarketplaceDataUnavailableError(operation);
  return NextResponse.json(value, { headers: LEDGER_CACHE_HEADERS });
}
