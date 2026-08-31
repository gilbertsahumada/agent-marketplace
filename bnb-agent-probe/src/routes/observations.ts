import type { D1DatabaseLike } from "../db/client";
import {
  createDatabase,
  readObservationFeed,
  type ProbeObservationRow,
} from "../db/orm";

const CATEGORIES = [
  "rebalancing",
  "grid_trading",
  "yield_optimisation",
  "health_factor_monitoring",
] as const;

type MarketplaceCategory = typeof CATEGORIES[number];

export interface LatestObservation {
  probedAt: number;
  probeCategory: MarketplaceCategory | null;
  outcome: ProbeObservationRow["outcome"];
  observedMetadataUpdatedAt: number | null;
  observedWallet: string | null;
  observedWalletSource: ProbeObservationRow["observedWalletSource"];
  observedBlockNumber: string | null;
  onchainObservedAt: number | null;
  commerce: string | null;
  router: string | null;
  policy: string | null;
  priceRaw: string | null;
  currency: string | null;
  decimals: number | null;
  requestHash: string | null;
  negotiationHash: string | null;
  quoteNegotiatedAt: number | null;
  quoteExpiresAt: number | null;
  signatureMethod: ProbeObservationRow["signatureMethod"];
  errorCode: string | null;
  httpStatus: number | null;
  durationMs: number;
}

function targetKey(row: {
  chainId: number;
  agentId: string;
  transport: string;
  endpoint: string;
}): string {
  return JSON.stringify([row.chainId, row.agentId, row.transport, row.endpoint]);
}

function category(value: string | null): MarketplaceCategory | null {
  if (value === null) return null;
  if ((CATEGORIES as readonly string[]).includes(value)) return value as MarketplaceCategory;
  throw new Error("OBSERVATIONS_INVALID_CATEGORY");
}

function categories(value: string): MarketplaceCategory[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("OBSERVATIONS_INVALID_CATEGORIES");
  const result = parsed.map((entry) => {
    if (typeof entry !== "string") throw new Error("OBSERVATIONS_INVALID_CATEGORIES");
    const parsedCategory = category(entry);
    if (parsedCategory === null) throw new Error("OBSERVATIONS_INVALID_CATEGORIES");
    return parsedCategory;
  });
  if (new Set(result).size !== result.length) throw new Error("OBSERVATIONS_INVALID_CATEGORIES");
  return result;
}

function latestObservation(row: ProbeObservationRow): LatestObservation {
  return {
    probedAt: row.probedAt,
    probeCategory: category(row.probeCategory),
    outcome: row.outcome,
    observedMetadataUpdatedAt: row.observedMetadataUpdatedAt,
    observedWallet: row.observedWallet,
    observedWalletSource: row.observedWalletSource,
    observedBlockNumber: row.observedBlockNumber,
    onchainObservedAt: row.onchainObservedAt,
    commerce: row.commerce,
    router: row.router,
    policy: row.policy,
    priceRaw: row.priceRaw,
    currency: row.currency,
    decimals: row.decimals,
    requestHash: row.requestHash,
    negotiationHash: row.negotiationHash,
    quoteNegotiatedAt: row.quoteNegotiatedAt,
    quoteExpiresAt: row.quoteExpiresAt,
    signatureMethod: row.signatureMethod,
    errorCode: row.errorCode,
    httpStatus: row.httpStatus,
    durationMs: row.durationMs,
  };
}

export async function observationsResponse(
  binding: unknown,
  generatedAt = Date.now(),
  agentIds: readonly string[] = [],
  monitoringConfig?: {
    producerEnabled: boolean;
    consumerEnabled: boolean;
    cronIntervalMinutes: number;
  },
): Promise<Response> {
  try {
    const rows = await readObservationFeed(createDatabase(binding as D1DatabaseLike), agentIds);
    const observations = new Map<string, ProbeObservationRow[]>();
    for (const row of rows.latestByTargetCategory) {
      const key = targetKey(row);
      observations.set(key, [...(observations.get(key) ?? []), row]);
    }
    const verifiedQuotes = new Map<string, typeof rows.quoteVerifiedAtByTargetCategory>();
    for (const row of rows.quoteVerifiedAtByTargetCategory) {
      const key = targetKey(row);
      verifiedQuotes.set(key, [...(verifiedQuotes.get(key) ?? []), row]);
    }
    const attemptStats = new Map(rows.attemptStatsByTarget.map((row) => [targetKey(row), row]));

    const body = {
      schemaVersion: 1 as const,
      generatedAt,
      monitoring: rows.lastSchedulerAttempt === null ? {
        lastSchedulerAttemptAt: null,
        lastSchedulerPhase: null,
        lastSchedulerOutcome: null,
        ...monitoringConfig,
      } : {
        lastSchedulerAttemptAt: rows.lastSchedulerAttempt.finishedAt,
        lastSchedulerPhase: rows.lastSchedulerAttempt.phase,
        lastSchedulerOutcome: rows.lastSchedulerAttempt.outcome,
        ...monitoringConfig,
      },
      funnel: rows.funnel === null ? null : {
        measuredAt: rows.funnel.measuredAt,
        blockNumber: rows.funnel.blockNumber,
        sourceSha256: rows.funnel.sourceSha256,
        registeredTotal: rows.funnel.registeredTotal,
        metadataOk: rows.funnel.metadataOk,
        metadataHttpUnreachable: rows.funnel.metadataHttpUnreachable,
        metadataOther: rows.funnel.metadataOther,
        a2aOnly: rows.funnel.a2aOnly,
        erc8183Only: rows.funnel.erc8183Only,
        both: rows.funnel.both,
        mcpOnly: rows.funnel.mcpOnly,
        otherOrNone: rows.funnel.otherOrNone,
        protocolUnknown: rows.funnel.protocolUnknown,
        declaredCandidateEndpoints: rows.funnel.declaredCandidateEndpoints,
        publicCandidateEndpoints: rows.funnel.publicCandidateEndpoints,
      },
      targets: rows.targets.map((target) => {
        const key = targetKey(target);
        const stats = attemptStats.get(key);
        const targetObservations = observations.get(key) ?? [];
        const latestRow = targetObservations.reduce<ProbeObservationRow | null>(
          (latest, candidate) => latest === null || candidate.probedAt > latest.probedAt
            || (candidate.probedAt === latest.probedAt && candidate.id > latest.id)
            ? candidate
            : latest,
          null,
        );
        const latestByCategory: Partial<Record<MarketplaceCategory, LatestObservation>> = {};
        for (const row of targetObservations) {
          const probeCategory = category(row.probeCategory);
          if (probeCategory !== null) latestByCategory[probeCategory] = latestObservation(row);
        }
        const quoteRows = verifiedQuotes.get(key) ?? [];
        const lastQuoteVerifiedAtByCategory: Partial<Record<MarketplaceCategory, number>> = {};
        let lastQuoteVerifiedAt: number | null = null;
        for (const row of quoteRows) {
          if (row.probedAt === null) continue;
          if (lastQuoteVerifiedAt === null || row.probedAt > lastQuoteVerifiedAt) {
            lastQuoteVerifiedAt = row.probedAt;
          }
          const probeCategory = category(row.probeCategory);
          if (probeCategory !== null) lastQuoteVerifiedAtByCategory[probeCategory] = row.probedAt;
        }
        return {
          agentId: target.agentId,
          chainId: 56 as const,
          transport: target.transport,
          endpoint: target.endpoint,
          name: target.name,
          categories: categories(target.categoriesJson),
          categoryProvenance: target.categoryProvenance,
          declarationState: target.declarationState,
          currentMetadataUpdatedAt: target.currentMetadataUpdatedAt,
          lastMetadataCheckedAt: target.lastMetadataCheckedAt,
          attemptCount: stats?.attemptCount ?? 0,
          firstProbedAt: stats?.firstProbedAt ?? null,
          lastProbedAt: stats?.lastProbedAt ?? null,
          latest: latestRow === null ? null : latestObservation(latestRow),
          latestByCategory,
          lastQuoteVerifiedAt,
          lastQuoteVerifiedAtByCategory,
        };
      }),
    };

    return Response.json(body, {
      headers: {
        "cache-control": "public, s-maxage=60, must-revalidate",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "observations_unavailable" }, {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }
}
