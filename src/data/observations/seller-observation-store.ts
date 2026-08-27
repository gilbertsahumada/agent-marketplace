import { neon } from "@neondatabase/serverless";
import type { SellerObservation, SellerObservationStore } from "../../business/entities/seller-observation.ts";

export type { SellerObservation, SellerObservationStore } from "../../business/entities/seller-observation.ts";

function row(value: Record<string, unknown>): SellerObservation {
  return {
    agentId: String(value.agent_id),
    observedAt: new Date(String(value.observed_at)).toISOString(),
    quoteStatus: String(value.quote_status),
    transport: value.transport === null ? null : String(value.transport),
    endpoint: value.endpoint === null ? null : String(value.endpoint),
    priceRaw: value.price_raw === null ? null : String(value.price_raw),
    currency: value.currency === null ? null : String(value.currency),
    signatureMethod: value.signature_method === null ? null : String(value.signature_method),
    errorCode: value.error_code === null ? null : String(value.error_code),
  };
}

/**
 * Created per call rather than at module scope: `neon()` throws when
 * DATABASE_URL is absent, and Next.js evaluates module bodies during the build.
 */
export function createNeonSellerObservationStore(
  databaseUrl = process.env.DATABASE_URL,
): SellerObservationStore {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to store seller observations");
  const sql = neon(databaseUrl);
  return {
    async record(observation) {
      await sql`
        INSERT INTO seller_observations (
          agent_id, observed_at, quote_status,
          transport, endpoint, price_raw, currency, signature_method, error_code
        ) VALUES (
          ${observation.agentId}, ${observation.observedAt}, ${observation.quoteStatus},
          ${observation.transport}, ${observation.endpoint}, ${observation.priceRaw},
          ${observation.currency}, ${observation.signatureMethod}, ${observation.errorCode}
        )
        ON CONFLICT (agent_id, observed_at) DO NOTHING
      `;
    },
    async latest(agentIds) {
      if (agentIds.length === 0) return new Map();
      const rows = await sql`
        SELECT DISTINCT ON (agent_id)
          agent_id, observed_at, quote_status,
          transport, endpoint, price_raw, currency, signature_method, error_code
        FROM seller_observations
        WHERE agent_id = ANY(${agentIds})
        ORDER BY agent_id, observed_at DESC
      ` as Record<string, unknown>[];
      return new Map(rows.map((value) => {
        const observation = row(value);
        return [observation.agentId, observation];
      }));
    },
  };
}

/** Deterministic store for tests and for local runs without a database. */
export function createInMemorySellerObservationStore(
  seed: SellerObservation[] = [],
): SellerObservationStore & { all(): SellerObservation[] } {
  const observations = [...seed];
  return {
    async record(observation) {
      observations.push(observation);
    },
    async latest(agentIds) {
      const wanted = new Set(agentIds);
      const latest = new Map<string, SellerObservation>();
      for (const observation of observations) {
        if (!wanted.has(observation.agentId)) continue;
        const current = latest.get(observation.agentId);
        if (!current || observation.observedAt > current.observedAt) {
          latest.set(observation.agentId, observation);
        }
      }
      return latest;
    },
    all: () => [...observations],
  };
}
