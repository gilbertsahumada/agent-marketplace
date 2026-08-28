import { NegotiationRequest, TermSpecification } from "@bnbagent/sdk/erc8183";

export const PROBE_REQUEST_SCHEMA_VERSION = 1;

export const GRID_PROBE_REQUEST_HASH =
  "0x697a15f62a1748230d3e4bdbbe24f6a619d1b82d45f1e4c82787e268ab2497d3";

const GRID_TASK_DESCRIPTION =
  "GRID_PLAN_V1:{\"pair\":\"BNB/USDT\",\"lowerPrice\":\"700\",\"upperPrice\":\"900\",\"capital\":\"1000\",\"gridCount\":9}";

const GRID_TERMS = Object.freeze({
  deliverables: "Deterministic Grid plan JSON with levels, allocation, triggers and assumptions",
  qualityStandards: "Deterministic output, no order execution and no custody",
});

export function buildGridProbeRequest(): NegotiationRequest {
  const request = new NegotiationRequest({
    taskDescription: GRID_TASK_DESCRIPTION,
    terms: new TermSpecification(GRID_TERMS),
  });
  if (request.computeHash() !== GRID_PROBE_REQUEST_HASH) {
    throw new Error("GRID_PROBE_REQUEST_HASH_MISMATCH");
  }
  return request;
}
