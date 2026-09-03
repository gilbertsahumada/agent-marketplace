import { NextResponse } from "next/server";
import type { HireAddress, HireChainId } from "../../business/entities/hire-job.ts";
import { InvalidMarketplaceInputError, MarketplaceDataUnavailableError } from "../../business/errors/marketplace-errors.ts";

// Same cache window as the Worker routes behind these responses.
export const LEDGER_CACHE_HEADERS = { "cache-control": "public, max-age=30, stale-while-revalidate=60" };

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

export function allowlistedQuery(url: URL, allowed: readonly string[]): void {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) throw new InvalidMarketplaceInputError(`Unknown query parameter ${key}`);
  }
}

export function ledgerResponse<T>(value: T | null, operation: string): NextResponse {
  if (value === null) throw new MarketplaceDataUnavailableError(operation);
  return NextResponse.json(value, { headers: LEDGER_CACHE_HEADERS });
}
