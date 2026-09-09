import { describe, expect, it } from "vitest";
import { normalizeNegotiationContract, validateParameters } from "../src/shared/negotiation-input.ts";
import { gridSellerAgentCard } from "../src/business/policies/grid-seller-policy.ts";
import {
  HOSTED_SELLER_SERVICES,
  HOSTED_SELLER_SLUGS,
  hostedSellerAgentCard,
  hostedSellerDeliverableUrl,
  hostedSellerEndpoint,
  hostedSellerForTask,
  hostedSellerMessageUrl,
  hostedSellerService,
  isHostedSellerSlug,
} from "../src/business/policies/hosted-seller-catalog.ts";

const ORIGIN = "https://bnb-agent-marketplace-ruby.vercel.app";
const BANNED = /\b(proven|track record|guarantee[ds]?|applied)\b/i;

describe("hosted seller catalog", () => {
  it("lists one deterministic seller per marketplace category", () => {
    expect(HOSTED_SELLER_SLUGS).toEqual(["grid", "rebalance", "yield", "loan-health"]);
    expect(HOSTED_SELLER_SERVICES.map(({ category }) => category)).toEqual([
      "grid_trading",
      "rebalancing",
      "yield_optimisation",
      "health_factor_monitoring",
    ]);
    expect(new Set(HOSTED_SELLER_SERVICES.map(({ name }) => name)).size).toBe(4);
    expect(new Set(HOSTED_SELLER_SERVICES.map(({ planner }) => planner.taskPrefix)).size).toBe(4);
    for (const service of HOSTED_SELLER_SERVICES) {
      expect(service.planner.taskPrefix).toMatch(/^[A-Z][A-Z0-9_]{0,63}:$/);
      expect(service.imagePath).toBe(`/agents/${service.slug}.svg`);
      expect(service.description).not.toMatch(BANNED);
      expect(service.description).toMatch(/not an official BNB reference agent/i);
    }
  });

  it("builds and re-derives the canonical example of every seller", () => {
    for (const service of HOSTED_SELLER_SERVICES) {
      const { planner } = service;
      const task = planner.taskDescription(planner.canonicalInput);
      expect(task.startsWith(planner.taskPrefix)).toBe(true);
      expect(hostedSellerForTask(task)?.slug).toBe(service.slug);
      const first = JSON.stringify(planner.build(planner.parseTaskDescription(task)));
      const second = JSON.stringify(planner.build(planner.parseTaskDescription(task)));
      expect(first).toBe(second);
      expect(JSON.parse(first)).toMatchObject({ schemaVersion: 1, execution: "none" });
    }
    expect(hostedSellerForTask('MARKETPLACE_QUOTE_V1:{"objective":"x"}')).toBeNull();
  });

  it("publishes a negotiation contract the marketplace form can render for each seller", () => {
    for (const service of HOSTED_SELLER_SERVICES) {
      const card = hostedSellerAgentCard(service, ORIGIN);
      const extension = card.capabilities.extensions![0]!;
      const contract = normalizeNegotiationContract(extension.params);
      expect(contract).not.toBeNull();
      expect(contract!.taskDescriptionPrefix).toBe(service.planner.taskPrefix);
      expect(validateParameters(contract!.inputSchema, service.planner.canonicalInput)).toBe(true);
      // The Worker's capability probe quotes with the canonical input, so every
      // seller keeps a fresh signed quote without a browser visit.
      expect(contract!.capabilityProbeParameters).toEqual(service.planner.canonicalInput);
      expect(card.url).toBe(hostedSellerMessageUrl(ORIGIN, service.slug));
      expect(card.skills.map(({ id }) => id)).toEqual(["negotiate-erc8183-job", "negotiate", "notify_funded"]);
      expect(JSON.stringify(card)).not.toMatch(BANNED);
    }
  });

  it("keeps the Grid card byte-identical to its original builder", () => {
    expect(hostedSellerAgentCard(hostedSellerService("grid"), ORIGIN)).toEqual(gridSellerAgentCard(ORIGIN));
  });

  it("derives one endpoint, message route and deliverable route per slug", () => {
    expect(hostedSellerEndpoint(ORIGIN, "loan-health")).toBe(`${ORIGIN}/loan-health`);
    expect(hostedSellerMessageUrl(ORIGIN, "yield")).toBe(`${ORIGIN}/api/sellers/yield/a2a`);
    expect(hostedSellerDeliverableUrl(ORIGIN, "rebalance", 42n)).toBe(`${ORIGIN}/api/sellers/rebalance/job/42/response`);
    expect(hostedSellerDeliverableUrl(ORIGIN, "grid", "56662")).toBe(`${ORIGIN}/api/sellers/grid/job/56662/response`);
    expect(isHostedSellerSlug("grid")).toBe(true);
    expect(isHostedSellerSlug("swap")).toBe(false);
    expect(() => hostedSellerService("swap" as never)).toThrow(/Unknown hosted seller/);
  });
});
