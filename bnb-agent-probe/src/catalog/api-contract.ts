import type { CatalogObservationRow } from "../db/orm";

export const CATALOG_API_VERSION = 2 as const;
export const CATALOG_POLICY_VERSION = 2 as const;

export function publicCatalogObservation(observation: CatalogObservationRow) {
  const source = observation.source === "chain_index" ? "chain_read"
    : observation.source === "marketplace_probe" ? "worker_probe"
      : observation.source;
  return {
    ...observation,
    source,
    details: JSON.parse(observation.detailsJson) as unknown,
    detailsJson: undefined,
  };
}
