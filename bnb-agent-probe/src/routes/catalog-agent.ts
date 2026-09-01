import type { D1DatabaseLike } from "../db/client";
import { createDatabase, readCatalogAgentEvidence } from "../db/orm";
import { deriveCatalogEvidenceState } from "../catalog/evidence-policy";
import { CATALOG_API_VERSION, publicCatalogObservation } from "../catalog/api-contract";
import type { D1Database } from "../types";

const AGENT_ID = /^[1-9]\d*$/;
const PLATFORM_SOURCES = new Set(["worker_probe", "buyer_refresh", "migration"]);

export async function catalogAgentResponse(
  request: Request,
  d1: D1Database,
  nowMs = Date.now(),
  responseVersion: 1 | 2 = 2,
): Promise<Response> {
  const url = new URL(request.url);
  const pathMatch = /^\/catalog-agent\/([1-9]\d*)$/.exec(url.pathname);
  const queryAgentId = url.pathname === "/catalog-agent" ? url.searchParams.get("agentId") : null;
  const agentId = pathMatch?.[1] ?? queryAgentId;
  const queryValid = pathMatch
    ? url.search === ""
    : url.pathname === "/catalog-agent"
      && [...url.searchParams.keys()].every((key) => key === "agentId");
  if (!agentId || !AGENT_ID.test(agentId) || !queryValid) {
    return Response.json({ error: "invalid_request" }, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
  const evidence = await readCatalogAgentEvidence(
    createDatabase(d1 as unknown as D1DatabaseLike),
    agentId,
  );
  if (evidence.agent === null) {
    return Response.json({ error: "not_found" }, {
      status: 404,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  const state = deriveCatalogEvidenceState({
    endpoints: evidence.endpoints,
    observations: evidence.observations,
    admission: evidence.admission,
    nowMs,
  });
  const serializeObservation = publicCatalogObservation;
  const currentOperationalEndpointKeys = new Set(evidence.endpoints
    .filter((endpoint) => endpoint.role === "operational" && endpoint.eligibility === "eligible")
    .map((endpoint) => endpoint.endpointKey));
  const resources = evidence.declarations.flatMap((declaration) => {
    const endpoint = evidence.endpoints.find((candidate) => candidate.endpointKey === declaration.endpointKey);
    if (!endpoint) return [];
    const operational = endpoint.role === "operational" && endpoint.eligibility === "eligible";
    const endpointObservations = operational
      ? evidence.observations.filter((observation) => observation.endpointKey === endpoint.endpointKey)
      : [];
    const platformEvidence = endpointObservations.filter((observation) => PLATFORM_SOURCES.has(observation.source)
      && (observation.validationKind === "protocol" || observation.validationKind === "reachability")
      && observation.verificationLevel === "platform_observed");
    const latestEvidence = platformEvidence[0] ?? null;
    const latestSuccess = platformEvidence.find((observation) => observation.outcome === "protocol_valid") ?? null;
    const latestBrowserEvidence = endpointObservations.find((observation) => observation.source === "browser_reported") ?? null;
    // Endpoint projections are shared by declarations of the same exact URI.
    // Only expose their schedule counters when the scoped ledger evidence
    // belongs to this agent and still matches the shared projection.
    const projectionMatches = latestEvidence !== null
      && endpoint.representativeAgentKey === evidence.agent?.agentKey
      && endpoint.lastAttemptAt === latestEvidence.observedAt
      && endpoint.lastAttemptOutcome === latestEvidence.outcome;
    const nextProbeAt = projectionMatches && endpoint.role === "operational" && endpoint.eligibility === "eligible"
      ? endpoint.nextProbeAt : null;
    return [{
      ...endpoint,
      nextProbeAt,
      lastProbedAt: latestEvidence?.observedAt ?? null,
      lastAttemptAt: latestEvidence?.observedAt ?? null,
      lastAttemptOutcome: latestEvidence?.outcome ?? null,
      lastSuccessfulAt: latestSuccess?.observedAt ?? null,
      consecutiveFailures: projectionMatches ? endpoint.consecutiveFailures : 0,
      declaration: {
        state: declaration.declarationState,
        priority: declaration.priority,
        rawServiceLabel: declaration.rawServiceLabel,
        rawSource: declaration.rawSource,
        rawSourceIndex: declaration.rawSourceIndex,
        metadataVersion: declaration.metadataVersion,
        firstSeenAt: declaration.firstSeenAt,
        lastSeenAt: declaration.lastSeenAt,
      },
      attemptCount: operational ? evidence.platformAttemptCountByEndpoint.get(endpoint.endpointKey) ?? 0 : 0,
      latestEvidence: latestEvidence ? serializeObservation(latestEvidence) : null,
      latestSuccess: latestSuccess ? serializeObservation(latestSuccess) : null,
      latestBrowserEvidence: latestBrowserEvidence ? serializeObservation(latestBrowserEvidence) : null,
    }];
  });
  const admittedEndpointKey = evidence.admission?.endpointKey ?? null;
  const quoteObservation = evidence.observations.find((observation) => observation.validationKind === "quote"
    && observation.verificationLevel === "cryptographic"
    && observation.endpointKey !== null
    && (admittedEndpointKey === null || observation.endpointKey === admittedEndpointKey)
    && currentOperationalEndpointKeys.has(observation.endpointKey)) ?? null;
  const chainObservations = evidence.observations.filter((observation) => observation.validationKind === "chain"
    && observation.verificationLevel === "onchain");
  const v1Body = {
    schemaVersion: 1,
    chainId: 56,
    agentId,
    agent: evidence.agent,
    platformAttemptCount: evidence.platformAttemptCount,
    declarations: evidence.declarations.map((declaration) => ({
      ...evidence.endpoints.find((endpoint) => endpoint.endpointKey === declaration.endpointKey),
      priority: declaration.priority,
    })),
    observations: evidence.observations.map(serializeObservation),
  };
  const v2Body = {
    schemaVersion: 2,
    apiVersion: CATALOG_API_VERSION,
    policyVersion: evidence.agent.policyVersion,
    chainId: 56,
    agentId,
    agent: evidence.agent,
    provenance: {
      source: evidence.agent.metadataVersion?.startsWith("directed:") ? "bsc_registration" : "trust8004",
      trust8004Indexed: !evidence.agent.metadataVersion?.startsWith("directed:"),
      metadataVersion: evidence.agent.metadataVersion,
      metadataObservedAt: evidence.agent.metadataObservedAt,
      registeredAt: evidence.agent.registeredAt,
      blockNumber: evidence.agent.blockNumber,
    },
    ingest: evidence.ingestTask,
    platformAttemptCount: evidence.platformAttemptCount,
    admission: evidence.admission,
    state,
    capabilities: state,
    resources,
    quote: quoteObservation ? {
      outcome: quoteObservation.outcome,
      observedAt: quoteObservation.observedAt,
      expiresAt: quoteObservation.expiresAt,
      artifactHash: quoteObservation.artifactHash,
      endpointKey: quoteObservation.endpointKey,
    } : null,
    onchainReferences: chainObservations.map((observation) => ({
      observationId: observation.id,
      observedAt: observation.observedAt,
      artifactHash: observation.artifactHash,
      details: JSON.parse(observation.detailsJson) as unknown,
    })),
    declarations: evidence.declarations.map((declaration) => ({
      ...evidence.endpoints.find((endpoint) => endpoint.endpointKey === declaration.endpointKey),
      priority: declaration.priority,
    })),
    observations: evidence.observations.map(serializeObservation),
  };
  return Response.json(responseVersion === 2 ? v2Body : v1Body, {
    headers: {
      "cache-control": "public, max-age=30, stale-while-revalidate=60",
      "x-content-type-options": "nosniff",
    },
  });
}
