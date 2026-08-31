import type { D1DatabaseLike } from "../db/client";
import { createDatabase, readCatalogAgentEvidence } from "../db/orm";
import type { D1Database } from "../types";

const AGENT_ID = /^[1-9]\d*$/;

export async function catalogAgentResponse(request: Request, d1: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  if (!agentId || !AGENT_ID.test(agentId) || [...url.searchParams.keys()].some((key) => key !== "agentId")) {
    return Response.json({ error: "invalid_request" }, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
  const evidence = await readCatalogAgentEvidence(
    createDatabase(d1 as unknown as D1DatabaseLike),
    agentId,
  );
  return Response.json({
    schemaVersion: 1,
    chainId: 56,
    agentId,
    agent: evidence.agent,
    platformAttemptCount: evidence.platformAttemptCount,
    declarations: evidence.declarations.map((declaration) => ({
      ...evidence.endpoints.find((endpoint) => endpoint.endpointKey === declaration.endpointKey),
      priority: declaration.priority,
    })),
    observations: evidence.observations.map((observation) => ({
      ...observation,
      details: JSON.parse(observation.detailsJson) as unknown,
      detailsJson: undefined,
    })),
  }, {
    headers: {
      "cache-control": "public, max-age=30, stale-while-revalidate=60",
      "x-content-type-options": "nosniff",
    },
  });
}
