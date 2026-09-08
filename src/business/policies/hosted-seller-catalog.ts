import type { GridPlan, GridPlanInput } from "../entities/grid-plan.ts";
import type { HostedSellerAgentCard } from "../entities/hosted-erc8183-seller.ts";
import type { HostedSellerPlanner, HostedSellerService, HostedSellerSlug } from "../entities/hosted-seller-service.ts";
import {
  GRID_CANONICAL_INPUT,
  GRID_NEGOTIATION_TERMS,
  buildGridPlan,
  gridTaskDescription,
  parseGridTaskDescription,
  validateGridPlanInput,
} from "./grid-plan-policy.ts";
import { gridSellerAgentCard } from "./grid-seller-policy.ts";
import { LOAN_HEALTH_PLANNER } from "./loan-health-policy.ts";
import { REBALANCE_PLANNER } from "./rebalance-plan-policy.ts";
import { YIELD_PLANNER } from "./yield-plan-policy.ts";

// The four marketplace-operated sellers. Each one is a deterministic planner
// behind the same A2A message route, quote signer and deliverable check the
// Grid seller established; only the maths and the input schema differ.

export const GRID_PLANNER: HostedSellerPlanner<GridPlanInput, GridPlan> = {
  taskPrefix: "GRID_PLAN_V1:",
  terms: GRID_NEGOTIATION_TERMS,
  canonicalInput: GRID_CANONICAL_INPUT,
  inputSchema: gridSellerAgentCard("https://seller.invalid").capabilities.extensions![0]!.params.inputSchema as Record<string, unknown>,
  validate: validateGridPlanInput,
  build: buildGridPlan,
  taskDescription: gridTaskDescription,
  parseTaskDescription: parseGridTaskDescription,
};

const NO_EXECUTION = "It computes and never executes, holds no funds and is not an official BNB reference agent.";

export const HOSTED_SELLER_SERVICES: readonly HostedSellerService[] = [
  {
    slug: "grid",
    name: "marketplace-operated-grid-planner",
    description: `Marketplace-operated Grid seller. It computes deterministic plans and performs no trading or custody. Not an official BNB reference agent.`,
    category: "grid_trading",
    imagePath: "/agents/grid.svg",
    skillName: "Negotiate a deterministic Grid plan",
    skillDescription: "Quote a reproducible Grid calculation with no order execution or custody.",
    fundedSkillName: "Compute and submit a funded Grid plan",
    fundedSkillDescription: "Verify a FUNDED job, compute its deterministic plan and submit the manifest hash.",
    tags: ["erc8183", "grid-trading", "bnb-chain"],
    planner: GRID_PLANNER as HostedSellerPlanner<unknown, unknown>,
  },
  {
    slug: "rebalance",
    name: "marketplace-operated-rebalance-planner",
    description: `Marketplace-operated rebalancing planner. Give it your positions with prices and your target weights; it returns the exact sells and buys that bring the portfolio back to target. ${NO_EXECUTION}`,
    category: "rebalancing",
    imagePath: "/agents/rebalance.svg",
    skillName: "Negotiate a deterministic rebalancing plan",
    skillDescription: "Quote a reproducible rebalancing calculation from the buyer's positions, prices and target weights; no orders are placed.",
    fundedSkillName: "Compute and submit a funded rebalancing plan",
    fundedSkillDescription: "Verify a FUNDED job, compute its deterministic rebalancing plan and submit the manifest hash.",
    tags: ["erc8183", "rebalancing", "portfolio", "bnb-chain"],
    planner: REBALANCE_PLANNER as HostedSellerPlanner<unknown, unknown>,
  },
  {
    slug: "yield",
    name: "marketplace-operated-yield-planner",
    description: `Marketplace-operated yield allocation planner. Give it the options you are considering with their rates and risk, and your limits; it returns a deterministic allocation and the blended rate of that allocation, computed from your inputs. ${NO_EXECUTION}`,
    category: "yield_optimisation",
    imagePath: "/agents/yield.svg",
    skillName: "Negotiate a deterministic yield allocation plan",
    skillDescription: "Quote a reproducible allocation across the buyer's candidate options under a risk tolerance and share cap; nothing is deposited.",
    fundedSkillName: "Compute and submit a funded yield allocation plan",
    fundedSkillDescription: "Verify a FUNDED job, compute its deterministic allocation plan and submit the manifest hash.",
    tags: ["erc8183", "yield", "allocation", "bnb-chain"],
    planner: YIELD_PLANNER as HostedSellerPlanner<unknown, unknown>,
  },
  {
    slug: "loan-health",
    name: "marketplace-operated-loan-health-check",
    description: `Marketplace-operated loan health check. Give it your collateral, debt, liquidation thresholds and alert levels; it returns the health factor, the liquidation price of each collateral asset, the distance to each alert and how much to repay or add to reach your target. One report from your numbers, not a monitoring service. ${NO_EXECUTION}`,
    category: "health_factor_monitoring",
    imagePath: "/agents/loan-health.svg",
    skillName: "Negotiate a deterministic loan health report",
    skillDescription: "Quote a reproducible health factor and liquidation report from the buyer's collateral and debt figures; no transactions and no alerts are sent.",
    fundedSkillName: "Compute and submit a funded loan health report",
    fundedSkillDescription: "Verify a FUNDED job, compute its deterministic loan health report and submit the manifest hash.",
    tags: ["erc8183", "health-factor", "lending", "bnb-chain"],
    planner: LOAN_HEALTH_PLANNER as HostedSellerPlanner<unknown, unknown>,
  },
];

export const HOSTED_SELLER_SLUGS = HOSTED_SELLER_SERVICES.map(({ slug }) => slug) as readonly HostedSellerSlug[];

export function isHostedSellerSlug(value: string): value is HostedSellerSlug {
  return HOSTED_SELLER_SERVICES.some(({ slug }) => slug === value);
}

export function hostedSellerService(slug: HostedSellerSlug): HostedSellerService {
  const service = HOSTED_SELLER_SERVICES.find((candidate) => candidate.slug === slug);
  if (!service) throw new Error(`Unknown hosted seller: ${slug}`);
  return service;
}

/** The seller whose task prefix opens the description, or null for a foreign task. */
export function hostedSellerForTask(taskDescription: string): HostedSellerService | null {
  return HOSTED_SELLER_SERVICES.find(({ planner }) => taskDescription.startsWith(planner.taskPrefix)) ?? null;
}

export function hostedSellerEndpoint(origin: string, slug: HostedSellerSlug): string {
  return `${origin}/${slug}`;
}

export function hostedSellerMessageUrl(origin: string, slug: HostedSellerSlug): string {
  return `${origin}/api/sellers/${slug}/a2a`;
}

export function hostedSellerDeliverableUrl(origin: string, slug: HostedSellerSlug, jobId: bigint | number | string): string {
  return `${origin}/api/sellers/${slug}/job/${jobId}/response`;
}

export function hostedSellerAgentCard(service: HostedSellerService, origin: string): HostedSellerAgentCard {
  if (service.slug === "grid") return gridSellerAgentCard(origin);
  const negotiate = {
    name: service.skillName,
    description: service.skillDescription,
    tags: [...service.tags],
  };
  return {
    protocolVersion: "0.3.0",
    name: service.name,
    description: service.description,
    url: hostedSellerMessageUrl(origin, service.slug),
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false, extensions: [{
      uri: "https://marketplace.trust8004.xyz/extensions/negotiation-input/v1",
      description: "Marketplace-specific negotiation input contract; not an ERC-8183 or A2A standard schema.",
      required: false,
      params: {
        skill: "negotiate-erc8183-job",
        taskDescriptionPrefix: service.planner.taskPrefix,
        // The Worker's capability probe requests a signed quote with these
        // parameters, so the seller stays "ready" without a browser visit.
        // They are the canonical input, the one a public proof is captured from.
        capabilityProbeParameters: structuredClone(service.planner.canonicalInput) as Record<string, unknown>,
        inputSchema: service.planner.inputSchema,
        terms: {
          deliverables: service.planner.terms.deliverables,
          quality_standards: service.planner.terms.qualityStandards,
          evaluation_required: true,
          evaluator_type: "uma_oov3",
        },
      },
    }] },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      { id: "negotiate-erc8183-job", ...negotiate },
      { id: "negotiate", ...negotiate },
      {
        id: "notify_funded",
        name: service.fundedSkillName,
        description: service.fundedSkillDescription,
        tags: [...service.tags],
      },
    ],
  };
}
