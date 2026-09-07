import "server-only";

import { getAddress, type Address } from "viem";
import { resolveBuyerQuoteRequest } from "../data/observation/quote-request-sync.ts";
import type { CatalogHireTarget } from "./catalog-erc8183-repository.ts";

export class CatalogHireUnavailableError extends Error {
  constructor(message = "The buyer quote is no longer available") {
    super(message);
    this.name = "CATALOG_HIRE_UNAVAILABLE";
  }
}

export async function resolveCatalogHireTarget(
  agentId: string,
  quoteRequestId: number,
  options: { allowExpired?: boolean; chainId?: 56 | 97 } = {},
): Promise<CatalogHireTarget> {
  const chainId = options.chainId ?? 56;
  const row = await resolveBuyerQuoteRequest(agentId, quoteRequestId, { chainId });
  if (!row || row.resultObservationId === null || !["succeeded", "expired"].includes(row.status)) {
    throw new CatalogHireUnavailableError(options.allowExpired
      ? "The original verified quote could not be found. Keep this job for recovery; do not fund another job."
      : "Request a verified buyer quote before starting this hire");
  }
  if (!options.allowExpired && (row.status !== "succeeded" || row.quoteExpiresAt === null || row.quoteExpiresAt <= Date.now())) {
    throw new CatalogHireUnavailableError("The buyer quote expired; request a fresh quote");
  }
  if (!row.endpoint || !row.provider) {
    throw new CatalogHireUnavailableError("The verified quote has no public seller target");
  }
  let provider: Address;
  try { provider = getAddress(row.provider); } catch { throw new CatalogHireUnavailableError("The verified quote has an invalid seller address"); }
  return {
    chainId,
    agentId: Number(agentId),
    endpoint: row.endpoint,
    transport: row.transport,
    requestHash: row.requestHash,
    provider,
  };
}
