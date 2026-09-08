import { describe, expect, it } from "vitest";
import type { RebalancePlanInput } from "../src/business/entities/rebalance-plan.ts";
import {
  REBALANCE_CANONICAL_INPUT,
  REBALANCE_NEGOTIATION_TERMS,
  REBALANCE_PLANNER,
  buildRebalancePlan,
  parseRebalanceTaskDescription,
  rebalanceTaskDescription,
  validateRebalancePlanInput,
} from "../src/business/policies/rebalance-plan-policy.ts";

const SCALE = 100_000_000n;

function raw(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
  return negative ? -result : result;
}

function withInput(overrides: Partial<RebalancePlanInput>): RebalancePlanInput {
  return { ...REBALANCE_CANONICAL_INPUT, ...overrides };
}

describe("validateRebalancePlanInput", () => {
  it("rejects bad asset symbols", () => {
    expect(() => validateRebalancePlanInput(withInput({ positions: "B:2.5@600,USDT:1000@1", targets: "B:50,USDT:50" })))
      .toThrow(/asset symbols/);
    expect(() => validateRebalancePlanInput(withInput({ positions: "BN-B:2.5@600,USDT:1000@1", targets: "BN-B:50,USDT:50" })))
      .toThrow(/asset symbols/);
  });

  it("rejects duplicate assets in positions and targets", () => {
    expect(() => validateRebalancePlanInput(withInput({ positions: "BNB:1@600,BNB:2@600", targets: "BNB:100" })))
      .toThrow(/more than once/);
    expect(() => validateRebalancePlanInput(withInput({ targets: "BNB:50,BNB:30,ETH:20" })))
      .toThrow(/more than once/);
  });

  it("rejects targets that do not match positions", () => {
    expect(() => validateRebalancePlanInput(withInput({ targets: "BNB:50,USDT:50" }))).toThrow(/missing ETH/);
    expect(() => validateRebalancePlanInput(withInput({ targets: "BNB:50,USDT:30,ETH:10,BTC:10" })))
      .toThrow(/BTC which is not a position/);
  });

  it("rejects target weights that do not sum to 100", () => {
    expect(() => validateRebalancePlanInput(withInput({ targets: "BNB:50,USDT:30,ETH:21" }))).toThrow(/sum to exactly 100/);
    expect(() => validateRebalancePlanInput(withInput({ targets: "BNB:50,USDT:30,ETH:19.99" }))).toThrow(/sum to exactly 100/);
  });

  it("rejects malformed amounts, prices and percents", () => {
    expect(() => validateRebalancePlanInput(withInput({ positions: "BNB:0@600,USDT:1000@1,ETH:0.4@3000" }))).toThrow(/positive/);
    expect(() => validateRebalancePlanInput(withInput({ positions: "BNB:2.5@600.123456789,USDT:1000@1,ETH:0.4@3000" })))
      .toThrow(/at most 8 places/);
    expect(() => validateRebalancePlanInput(withInput({ targets: "BNB:50.123,USDT:29.877,ETH:20" }))).toThrow(/at most 2 places/);
    expect(() => validateRebalancePlanInput(withInput({ positions: "BNB:2.5@600" , targets: "BNB:100" }))).toThrow(/2 to 12 assets/);
  });

  it("rejects a drift threshold outside 0 to 50", () => {
    expect(() => validateRebalancePlanInput(withInput({ driftThresholdPercent: -1 }))).toThrow(/0 to 50/);
    expect(() => validateRebalancePlanInput(withInput({ driftThresholdPercent: 51 }))).toThrow(/0 to 50/);
    expect(() => validateRebalancePlanInput(withInput({ driftThresholdPercent: 2.5 }))).toThrow(/0 to 50/);
  });

  it("normalizes symbols and whitespace into a canonical form", () => {
    const normalized = validateRebalancePlanInput({
      positions: " bnb:2.5@600 , usdt:1000@1,eth:0.4@3000",
      targets: "bnb:50, usdt:30 ,eth:20",
      driftThresholdPercent: 5,
    });
    expect(normalized).toEqual(REBALANCE_CANONICAL_INPUT);
  });
});

describe("buildRebalancePlan", () => {
  it("computes the canonical example exactly", () => {
    const plan = buildRebalancePlan(REBALANCE_CANONICAL_INPUT);
    expect(plan.schemaVersion).toBe(1);
    expect(plan.execution).toBe("none");
    expect(plan.quoteUnit).toBe("price units as provided");
    expect(plan.totalValue).toBe("3700");
    expect(plan.driftThresholdPercent).toBe(5);
    expect(plan.positions).toEqual([
      {
        asset: "BNB",
        amount: "2.5",
        price: "600",
        value: "1500",
        currentWeightPercent: "40.54054054",
        targetWeightPercent: "50",
        driftPercent: "-9.45945946",
        action: "buy",
        tradeAmount: "0.58333333",
        tradeValue: "350",
      },
      {
        asset: "USDT",
        amount: "1000",
        price: "1",
        value: "1000",
        currentWeightPercent: "27.02702702",
        targetWeightPercent: "30",
        driftPercent: "-2.97297298",
        action: "hold",
        tradeAmount: "0",
        tradeValue: "0",
      },
      {
        asset: "ETH",
        amount: "0.4",
        price: "3000",
        value: "1200",
        currentWeightPercent: "32.43243243",
        targetWeightPercent: "20",
        driftPercent: "12.43243243",
        action: "sell",
        tradeAmount: "0.15333333",
        tradeValue: "460",
      },
    ]);
    expect(plan.trades).toEqual([
      { asset: "ETH", side: "sell", amount: "0.15333333", value: "460" },
      { asset: "BNB", side: "buy", amount: "0.58333333", value: "350" },
    ]);
    expect(plan.assumptions.join(" ")).toMatch(/buyer's inputs at one moment/);
    expect(plan.assumptions.join(" ")).toMatch(/no fees or slippage/);
    expect(plan.assumptions.join(" ")).toMatch(/no order placement, custody or financial execution/);
  });

  it("holds every asset that sits within the drift threshold", () => {
    const plan = buildRebalancePlan(withInput({ driftThresholdPercent: 13 }));
    expect(plan.positions.every((position) => position.action === "hold")).toBe(true);
    expect(plan.positions.every((position) => position.tradeValue === "0" && position.tradeAmount === "0")).toBe(true);
    expect(plan.trades).toEqual([]);
  });

  it("balances sells against buys when every asset trades, within one raw unit per asset", () => {
    const inputs: RebalancePlanInput[] = [
      withInput({ driftThresholdPercent: 0 }),
      { positions: "AAA:1.00000001@1,BBB:1@1,CCC:1@1", targets: "AAA:33.33,BBB:33.33,CCC:33.34", driftThresholdPercent: 0 },
      { positions: "ZZZ:7@13.37,MMM:0.00000009@99999,AAA:42@0.5", targets: "ZZZ:12.5,MMM:70,AAA:17.5", driftThresholdPercent: 0 },
    ];
    for (const input of inputs) {
      const plan = buildRebalancePlan(input);
      expect(plan.positions.every((position) => position.action !== "hold" || position.driftPercent === "0")).toBe(true);
      const sold = plan.trades.filter((t) => t.side === "sell").reduce((acc, t) => acc + raw(t.value), 0n);
      const bought = plan.trades.filter((t) => t.side === "buy").reduce((acc, t) => acc + raw(t.value), 0n);
      const difference = sold > bought ? sold - bought : bought - sold;
      expect(difference <= BigInt(plan.positions.length)).toBe(true);
    }
  });

  it("orders trades as sells then buys, each group by asset name", () => {
    const plan = buildRebalancePlan({
      positions: "DDD:10@1,AAA:10@1,CCC:10@1,BBB:10@1",
      targets: "DDD:5,AAA:5,CCC:45,BBB:45",
      driftThresholdPercent: 0,
    });
    expect(plan.trades.map((t) => `${t.side}:${t.asset}`)).toEqual(["sell:AAA", "sell:DDD", "buy:BBB", "buy:CCC"]);
  });

  it("is deterministic and JSON-serialisable", () => {
    const first = JSON.stringify(buildRebalancePlan(REBALANCE_CANONICAL_INPUT));
    const second = JSON.stringify(buildRebalancePlan({ ...REBALANCE_CANONICAL_INPUT }));
    expect(first).toBe(second);
    expect(JSON.parse(first)).toEqual(buildRebalancePlan(REBALANCE_CANONICAL_INPUT));
  });
});

describe("task description round trip", () => {
  it("prefixes the normalized input and parses it back", () => {
    const description = rebalanceTaskDescription({
      positions: " bnb:2.5@600 , usdt:1000@1,eth:0.4@3000",
      targets: "bnb:50, usdt:30 ,eth:20",
      driftThresholdPercent: 5,
    });
    expect(description.startsWith("REBALANCE_PLAN_V1:")).toBe(true);
    expect(parseRebalanceTaskDescription(description)).toEqual(REBALANCE_CANONICAL_INPUT);
    expect(rebalanceTaskDescription(parseRebalanceTaskDescription(description))).toBe(description);
  });

  it("rejects foreign prefixes and malformed payloads", () => {
    expect(() => parseRebalanceTaskDescription(`GRID_PLAN_V1:${JSON.stringify(REBALANCE_CANONICAL_INPUT)}`))
      .toThrow(/not a rebalance plan request/);
    expect(() => parseRebalanceTaskDescription("REBALANCE_PLAN_V1:[]")).toThrow(/payload is invalid/);
    expect(() => parseRebalanceTaskDescription('REBALANCE_PLAN_V1:{"positions":"BNB:1@1,ETH:1@1"}')).toThrow(/fields are invalid/);
  });
});

describe("REBALANCE_PLANNER", () => {
  it("wires the planner functions and builds its canonical input", () => {
    expect(REBALANCE_PLANNER.taskPrefix).toBe("REBALANCE_PLAN_V1:");
    expect(REBALANCE_PLANNER.terms).toBe(REBALANCE_NEGOTIATION_TERMS);
    expect(REBALANCE_PLANNER.validate(REBALANCE_PLANNER.canonicalInput)).toEqual(REBALANCE_CANONICAL_INPUT);
    const plan = REBALANCE_PLANNER.build(REBALANCE_PLANNER.canonicalInput);
    expect(plan.schemaVersion).toBe(1);
    expect(plan.execution).toBe("none");
    expect(plan.trades.length).toBe(2);
    expect(REBALANCE_PLANNER.parseTaskDescription(REBALANCE_PLANNER.taskDescription(REBALANCE_CANONICAL_INPUT)))
      .toEqual(REBALANCE_CANONICAL_INPUT);
  });

  it("exposes a flat input schema of string and integer properties", () => {
    const schema = REBALANCE_PLANNER.inputSchema as {
      type: string;
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { type: string }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["positions", "targets", "driftThresholdPercent"]);
    expect(Object.keys(schema.properties)).toEqual(["positions", "targets", "driftThresholdPercent"]);
    for (const property of Object.values(schema.properties)) {
      expect(["string", "integer"]).toContain(property.type);
    }
  });
});
