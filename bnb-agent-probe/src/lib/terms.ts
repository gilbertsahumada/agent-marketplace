import { NegotiationRequest, TermSpecification } from "@bnbagent/sdk/erc8183";

export const PROBE_REQUEST_SCHEMA_VERSION = 1;

export const PROBE_CATEGORIES = [
  "rebalancing",
  "grid_trading",
  "yield_optimisation",
  "health_factor_monitoring",
] as const;
export type ProbeCategory = typeof PROBE_CATEGORIES[number];

export const GRID_PROBE_REQUEST_HASH =
  "0x697a15f62a1748230d3e4bdbbe24f6a619d1b82d45f1e4c82787e268ab2497d3";

const GRID_TASK_DESCRIPTION =
  "GRID_PLAN_V1:{\"pair\":\"BNB/USDT\",\"lowerPrice\":\"700\",\"upperPrice\":\"900\",\"capital\":\"1000\",\"gridCount\":9}";

const GRID_TERMS = Object.freeze({
  deliverables: "Deterministic Grid plan JSON with levels, allocation, triggers and assumptions",
  qualityStandards: "Deterministic output, no order execution and no custody",
});

const CATEGORY_TEMPLATES: Record<ProbeCategory, {
  taskDescription: string;
  deliverables: string;
  qualityStandards: string;
  hash: string;
}> = {
  rebalancing: {
    taskDescription: 'REBALANCE_READINESS_V1:{"currentBps":{"BNB":6000,"USDT":4000},"targetBps":{"BNB":5000,"USDT":5000}}',
    deliverables: "Deterministic portfolio rebalancing plan with target deltas and assumptions",
    qualityStandards: "Analysis only, deterministic output, no order execution and no custody",
    hash: "0x30c4d87009384d98601811722a9982fbe95d4efd65b5f891e46937832e9c0288",
  },
  grid_trading: {
    taskDescription: GRID_TASK_DESCRIPTION,
    ...GRID_TERMS,
    hash: GRID_PROBE_REQUEST_HASH,
  },
  yield_optimisation: {
    taskDescription: 'YIELD_READINESS_V1:{"capital":"1000","currency":"USDT","maxProtocols":3,"risk":"moderate"}',
    deliverables: "Deterministic comparison of yield options with allocation rationale and assumptions",
    qualityStandards: "Analysis only, no deposits, no transaction execution and no custody",
    hash: "0xf932f814bf58850fca34c32d25dc38890041079f75014d4e400bb92d607c9970",
  },
  health_factor_monitoring: {
    taskDescription: 'HEALTH_FACTOR_READINESS_V1:{"collateral":"10 BNB","debt":"2000 USDT","warningThreshold":"1.50","criticalThreshold":"1.20"}',
    deliverables: "Deterministic health-factor assessment with thresholds, alerts and suggested actions",
    qualityStandards: "Analysis only, no transaction execution and no custody",
    hash: "0xb31d452e27e497cb57af53f4f0caa9ed394d1c19acdab34e18aefe4924378ef4",
  },
};

export interface ProbeRequestTemplate {
  readonly category: ProbeCategory | null;
  readonly request: NegotiationRequest;
  readonly requestHash: string;
  readonly deliverables: string;
  readonly qualityStandards: string;
}

export interface BuyerQuoteBrief {
  readonly objective: string;
  readonly deliverable: string;
  readonly acceptanceCriteria: string;
}

const BRIEF_TEXT_MAX = 500;

/** Canonical request shared by A2A, HTTP and MCP quote transports. */
export function buildBuyerQuoteRequest(brief: BuyerQuoteBrief): ProbeRequestTemplate {
  const values = [brief.objective, brief.deliverable, brief.acceptanceCriteria];
  if (values.some((value) => typeof value !== "string" || value.trim().length < 1 || value.length > BRIEF_TEXT_MAX)) {
    throw new Error("BUYER_BRIEF_INVALID");
  }
  const taskDescription = `MARKETPLACE_QUOTE_V1:${JSON.stringify({
    objective: brief.objective.trim(),
    deliverable: brief.deliverable.trim(),
    acceptanceCriteria: brief.acceptanceCriteria.trim(),
  })}`;
  const deliverables = brief.deliverable.trim();
  const qualityStandards = brief.acceptanceCriteria.trim();
  const request = new NegotiationRequest({
    taskDescription,
    terms: new TermSpecification({ deliverables, qualityStandards }),
  });
  return {
    category: null,
    request,
    requestHash: request.computeHash().toLowerCase(),
    deliverables,
    qualityStandards,
  };
}

export function buildReadinessProbeRequest(category: ProbeCategory | null): ProbeRequestTemplate {
  if (category !== null) return buildProbeRequest(category);
  const deliverables = "Return a deterministic text readiness receipt";
  const qualityStandards = "Provide a signed ERC-8183 quote without executing work";
  const request = new NegotiationRequest({
    taskDescription: "Marketplace readiness quote probe; no job will be funded",
    terms: new TermSpecification({ deliverables, qualityStandards }),
  });
  return {
    category: null,
    request,
    requestHash: request.computeHash().toLowerCase(),
    deliverables,
    qualityStandards,
  };
}

export function buildProbeRequest(category: ProbeCategory): ProbeRequestTemplate {
  const template = CATEGORY_TEMPLATES[category];
  const request = new NegotiationRequest({
    taskDescription: template.taskDescription,
    terms: new TermSpecification({
      deliverables: template.deliverables,
      qualityStandards: template.qualityStandards,
    }),
  });
  if (request.computeHash().toLowerCase() !== template.hash) {
    throw new Error("PROBE_REQUEST_HASH_MISMATCH");
  }
  return {
    category,
    request,
    requestHash: template.hash,
    deliverables: template.deliverables,
    qualityStandards: template.qualityStandards,
  };
}

export function buildGridProbeRequest(): NegotiationRequest {
  return buildProbeRequest("grid_trading").request;
}
