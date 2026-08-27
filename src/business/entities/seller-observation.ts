/**
 * A fact observed by this marketplace while probing a seller.
 *
 * `hireable` is intentionally absent. Consumers derive a current label from
 * this observation, its age and the active qualification policy when reading.
 */
export interface SellerObservation {
  agentId: string;
  observedAt: string;
  quoteStatus: string;
  transport: string | null;
  endpoint: string | null;
  priceRaw: string | null;
  currency: string | null;
  signatureMethod: string | null;
  errorCode: string | null;
}

export interface SellerObservationStore {
  record(observation: SellerObservation): Promise<void>;
  latest(agentIds: string[]): Promise<Map<string, SellerObservation>>;
}
