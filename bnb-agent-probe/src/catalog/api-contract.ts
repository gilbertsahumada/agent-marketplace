import type { CatalogObservationRow } from "../db/orm";

export const CATALOG_API_VERSION = 2 as const;
export const CATALOG_POLICY_VERSION = 2 as const;

/**
 * Evidence details are persisted as JSON, but legacy rows can predate the
 * normalized writer. Keep one malformed row from taking the catalog API down;
 * the evidence envelope remains queryable and the unavailable detail is
 * represented explicitly instead of exposing the raw string.
 */
export function publicCatalogDetails(detailsJson: string): unknown {
  try {
    return JSON.parse(detailsJson) as unknown;
  } catch {
    return null;
  }
}

export function publicCatalogObservation(observation: CatalogObservationRow) {
  const source = observation.source === "chain_index" ? "chain_read"
    : observation.source === "marketplace_probe" ? "worker_probe"
      : observation.source;
  return {
    ...observation,
    source,
    details: publicCatalogDetails(observation.detailsJson),
    detailsJson: undefined,
  };
}
