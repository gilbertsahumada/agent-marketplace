import { describe, expect, it } from "vitest";
import type { YieldPlanInput } from "../src/business/entities/yield-plan.ts";
import {
  buildYieldPlan,
  parseYieldTaskDescription,
  validateYieldPlanInput,
  YIELD_CANONICAL_INPUT,
  YIELD_NEGOTIATION_TERMS,
  YIELD_PLANNER,
  yieldTaskDescription,
} from "../src/business/policies/yield-plan-policy.ts";

function input(overrides: Partial<YieldPlanInput> = {}): YieldPlanInput {
  return { ...YIELD_CANONICAL_INPUT, ...overrides };
}

describe("yield plan input validation", () => {
  it("rejects an unknown risk word", () => {
    expect(() => validateYieldPlanInput(input({ options: "Venus USDT:4.2:extreme" })))
      .toThrow("option risk must be one of low, medium, high");
  });

  it("rejects duplicate names case-insensitively", () => {
    expect(() => validateYieldPlanInput(input({ options: "Venus USDT:4.2:low,venus usdt:5:low" })))
      .toThrow("option names must be unique");
  });

  it("rejects malformed entries", () => {
    expect(() => validateYieldPlanInput(input({ options: "Venus USDT:4.2" })))
      .toThrow("options must use NAME:apyPercent:risk entries");
    expect(() => validateYieldPlanInput(input({ options: "Venus USDT:4.20001:low" })))
      .toThrow("option apyPercent must be a non-negative decimal with at most 4 places");
    expect(() => validateYieldPlanInput(input({ options: "Venus,USDT:4.2:low" })))
      .toThrow("options must use NAME:apyPercent:risk entries");
  });

  it("rejects out-of-range integers and bad capital", () => {
    expect(() => validateYieldPlanInput(input({ maxSharePercent: 5 }))).toThrow("maxSharePercent must be an integer from 10 to 100");
    expect(() => validateYieldPlanInput(input({ minOptions: 0 }))).toThrow("minOptions must be an integer from 1 to 10");
    expect(() => validateYieldPlanInput(input({ capital: "0" }))).toThrow("capital must be positive");
    expect(() => validateYieldPlanInput(input({ riskTolerance: "wild" as YieldPlanInput["riskTolerance"] })))
      .toThrow("riskTolerance must be one of low, medium, high");
  });

  it("normalizes entry spacing and risk casing", () => {
    const normalized = validateYieldPlanInput(input({ options: "  Venus USDT : 4.2 : LOW ,Beefy BNB-USDT LP:11.5:Medium " }));
    expect(normalized.options).toBe("Venus USDT:4.2:low,Beefy BNB-USDT LP:11.5:medium");
  });

  it("fails when fewer options are eligible than minOptions", () => {
    expect(() => buildYieldPlan(input({ minOptions: 3 }))).toThrow("not enough eligible options");
  });

  it("fails when the maximum share cannot cover the capital", () => {
    expect(() => buildYieldPlan(input({ options: "A:5:low,B:4:low,C:3:low", maxSharePercent: 30, minOptions: 3 })))
      .toThrow("maxSharePercent too low for minOptions");
  });
});

describe("yield plan allocation", () => {
  it("builds the canonical worked example", () => {
    const plan = buildYieldPlan(YIELD_CANONICAL_INPUT);
    expect(plan.schemaVersion).toBe(1);
    expect(plan.execution).toBe("none");
    expect(plan.rateSource).toBe("provided by the buyer");
    expect(plan.capital).toBe("10000");
    expect(plan.considered).toEqual([
      { name: "Venus USDT", apyPercent: "4.2", risk: "low", eligible: true, reason: null },
      { name: "Beefy BNB-USDT LP", apyPercent: "11.5", risk: "medium", eligible: true, reason: null },
      { name: "Alpaca leveraged", apyPercent: "18", risk: "high", eligible: false, reason: "risk above tolerance" },
    ]);
    expect(plan.allocations).toEqual([
      { name: "Beefy BNB-USDT LP", apyPercent: "11.5", risk: "medium", sharePercent: "60.00", amount: "6000" },
      { name: "Venus USDT", apyPercent: "4.2", risk: "low", sharePercent: "40.00", amount: "4000" },
    ]);
    expect(plan.blendedApyPercent).toBe("8.5800");
    expect(plan.assumptions.join(" ")).toContain("buyer's inputs");
    expect(plan.assumptions.join(" ")).toContain("No compounding, fees, lock-ups or impermanent loss");
    expect(plan.assumptions.join(" ")).toContain("Nothing is deposited, moved or held");
  });

  it("caps each option at the maximum share and leaves the rest unfunded", () => {
    const plan = buildYieldPlan(input({ capital: "1000", options: "A:10:low,B:5:low,C:1:low", riskTolerance: "low", maxSharePercent: 50, minOptions: 1 }));
    expect(plan.allocations.map((allocation) => [allocation.name, allocation.amount, allocation.sharePercent])).toEqual([
      ["A", "500", "50.00"],
      ["B", "500", "50.00"],
    ]);
    expect(plan.blendedApyPercent).toBe("7.5000");
  });

  it("splits evenly across the top options when greedy funding falls short of minOptions", () => {
    const plan = buildYieldPlan(input({ capital: "1000", options: "C:1:low,A:10:low,B:5:low", riskTolerance: "low", maxSharePercent: 100, minOptions: 3 }));
    expect(plan.allocations.map((allocation) => allocation.amount)).toEqual(["333.33333333", "333.33333333", "333.33333334"]);
    expect(plan.allocations.map((allocation) => allocation.name)).toEqual(["A", "B", "C"]);
    expect(plan.allocations.map((allocation) => allocation.sharePercent)).toEqual(["33.33", "33.33", "33.33"]);
    expect(plan.blendedApyPercent).toBe("5.3333");
  });

  it("orders equal rates by name and keeps the amounts summing to capital", () => {
    const plan = buildYieldPlan(input({ capital: "99.99999999", options: "Zeta:7:low,Alpha:7:low,Mid:7:medium", riskTolerance: "high", maxSharePercent: 40, minOptions: 1 }));
    expect(plan.allocations.map((allocation) => allocation.name)).toEqual(["Alpha", "Mid", "Zeta"]);
    expect(plan.allocations.map((allocation) => allocation.amount)).toEqual(["39.99999999", "39.99999999", "20.00000001"]);
    expect(plan.blendedApyPercent).toBe("7.0000");
  });

  it("is deterministic and JSON-serialisable", () => {
    const first = JSON.stringify(buildYieldPlan(YIELD_CANONICAL_INPUT));
    const second = JSON.stringify(buildYieldPlan({ ...YIELD_CANONICAL_INPUT }));
    expect(first).toBe(second);
    expect(JSON.parse(first)).toEqual(buildYieldPlan(YIELD_CANONICAL_INPUT));
  });
});

describe("yield task description", () => {
  it("round-trips through the task prefix", () => {
    const description = yieldTaskDescription(input({ options: " Venus USDT:4.2:LOW , Beefy BNB-USDT LP:11.5:medium " }));
    expect(description.startsWith("YIELD_PLAN_V1:")).toBe(true);
    const parsed = parseYieldTaskDescription(description);
    expect(parsed).toEqual(input({ options: "Venus USDT:4.2:low,Beefy BNB-USDT LP:11.5:medium" }));
    expect(buildYieldPlan(parsed)).toEqual(buildYieldPlan(input({ options: "Venus USDT:4.2:low,Beefy BNB-USDT LP:11.5:medium" })));
  });

  it("rejects other prefixes and malformed payloads", () => {
    expect(() => parseYieldTaskDescription(`GRID_PLAN_V1:${JSON.stringify(YIELD_CANONICAL_INPUT)}`)).toThrow("task is not a yield plan request");
    expect(() => parseYieldTaskDescription("YIELD_PLAN_V1:[]")).toThrow("yield task payload is invalid");
    expect(() => parseYieldTaskDescription(`YIELD_PLAN_V1:${JSON.stringify({ ...YIELD_CANONICAL_INPUT, minOptions: "2" })}`)).toThrow("yield task fields are invalid");
  });
});

describe("YIELD_PLANNER", () => {
  it("builds from its canonical input and exposes the terms", () => {
    expect(YIELD_PLANNER.taskPrefix).toBe("YIELD_PLAN_V1:");
    expect(YIELD_PLANNER.terms).toBe(YIELD_NEGOTIATION_TERMS);
    expect(YIELD_PLANNER.build(YIELD_PLANNER.canonicalInput).allocations).toHaveLength(2);
    expect(YIELD_PLANNER.parseTaskDescription(YIELD_PLANNER.taskDescription(YIELD_PLANNER.canonicalInput))).toEqual(YIELD_CANONICAL_INPUT);
  });

  it("declares a flat schema with only string and integer properties", () => {
    const schema = YIELD_PLANNER.inputSchema as { required: string[]; properties: Record<string, { type: string }> };
    expect(schema.required).toEqual(["capital", "options", "riskTolerance", "maxSharePercent", "minOptions"]);
    expect(Object.keys(schema.properties)).toEqual(schema.required);
    for (const property of Object.values(schema.properties)) {
      expect(["string", "integer"]).toContain(property.type);
    }
  });
});
