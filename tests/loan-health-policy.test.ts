import { describe, expect, it } from "vitest";
import {
  LOAN_HEALTH_CANONICAL_INPUT,
  LOAN_HEALTH_NEGOTIATION_TERMS,
  LOAN_HEALTH_PLANNER,
  buildLoanHealthReport,
  loanHealthTaskDescription,
  parseLoanHealthTaskDescription,
  validateLoanHealthInput,
} from "../src/business/policies/loan-health-policy.ts";
import type { LoanHealthInput } from "../src/business/entities/loan-health-report.ts";

const SINGLE_ASSET: LoanHealthInput = {
  collateral: "BNB:10@600:80",
  debt: "USDT:4000@1",
  targetHealthFactor: "1.5",
  alertLevels: "1.5,1.25,1.1",
};

function withOverrides(overrides: Partial<LoanHealthInput>): LoanHealthInput {
  return { ...LOAN_HEALTH_CANONICAL_INPUT, ...overrides };
}

describe("validateLoanHealthInput", () => {
  it("accepts the canonical input and normalizes casing and whitespace", () => {
    const normalized = validateLoanHealthInput({
      collateral: " bnb:10@600:80 , eth:1@3000:82.5 ",
      debt: " usdt:3000@1 ",
      targetHealthFactor: " 1.5 ",
      alertLevels: " 1.5 , 1.25 , 1.1 ",
    });
    expect(normalized).toEqual(LOAN_HEALTH_CANONICAL_INPUT);
  });

  it("rejects thresholds outside (0, 100] or with more than two places", () => {
    expect(() => validateLoanHealthInput(withOverrides({ collateral: "BNB:10@600:120" }))).toThrow(/threshold/);
    expect(() => validateLoanHealthInput(withOverrides({ collateral: "BNB:10@600:0" }))).toThrow(/threshold/);
    expect(() => validateLoanHealthInput(withOverrides({ collateral: "BNB:10@600:80.123" }))).toThrow(/threshold/);
  });

  it("rejects duplicate collateral and debt assets", () => {
    expect(() => validateLoanHealthInput(withOverrides({ collateral: "BNB:10@600:80,BNB:1@600:80" })))
      .toThrow(/collateral must not repeat/);
    expect(() => validateLoanHealthInput(withOverrides({ debt: "USDT:1@1,USDT:2@1" })))
      .toThrow(/debt must not repeat/);
  });

  it("rejects alert levels that are not strictly descending", () => {
    expect(() => validateLoanHealthInput(withOverrides({ alertLevels: "1.1,1.25" }))).toThrow(/strictly descending/);
    expect(() => validateLoanHealthInput(withOverrides({ alertLevels: "1.5,1.5" }))).toThrow(/strictly descending/);
    expect(() => validateLoanHealthInput(withOverrides({ alertLevels: "1.5,1.4,1.3,1.2,1.1,1.05,1.01" }))).toThrow(/at most 6/);
    expect(() => validateLoanHealthInput(withOverrides({ alertLevels: "1.12345" }))).toThrow(/4 places/);
  });

  it("rejects a target health factor at or below 1", () => {
    expect(() => validateLoanHealthInput(withOverrides({ targetHealthFactor: "1" }))).toThrow(/above 1/);
    expect(() => validateLoanHealthInput(withOverrides({ targetHealthFactor: "0.9" }))).toThrow(/above 1/);
    expect(() => validateLoanHealthInput(withOverrides({ targetHealthFactor: "1.23456" }))).toThrow(/4 places/);
  });

  it("rejects malformed entries", () => {
    expect(() => validateLoanHealthInput(withOverrides({ collateral: "BNB:10@600" }))).toThrow(/ASSET:amount@price:liquidationThresholdPercent/);
    expect(() => validateLoanHealthInput(withOverrides({ collateral: "B:10@600:80" }))).toThrow(/ASSET:amount@price:liquidationThresholdPercent/);
    expect(() => validateLoanHealthInput(withOverrides({ collateral: "BNB:-10@600:80" }))).toThrow(/collateral amount/);
    expect(() => validateLoanHealthInput(withOverrides({ collateral: "BNB:10@0:80" }))).toThrow(/collateral price/);
    expect(() => validateLoanHealthInput(withOverrides({ debt: "USDT:3000" }))).toThrow(/ASSET:amount@price/);
    expect(() => validateLoanHealthInput(withOverrides({ debt: "" }))).toThrow(/empty entries/);
    expect(() => validateLoanHealthInput(withOverrides({ debt: "USDT:3000@1," }))).toThrow(/empty entries/);
    expect(() => validateLoanHealthInput(withOverrides({ debt: "USDT:3000@0" }))).toThrow(/debt price/);
  });
});

describe("buildLoanHealthReport", () => {
  it("computes the single-asset worked example by hand", () => {
    const report = buildLoanHealthReport(SINGLE_ASSET);
    expect(report.schemaVersion).toBe(1);
    expect(report.execution).toBe("none");
    expect(report.totals).toEqual({
      collateralValue: "6000",
      weightedCollateralValue: "4800",
      debtValue: "4000",
    });
    expect(report.healthFactor).toBe("1.2");
    expect(report.status).toBe("healthy");
    expect(report.collateral).toEqual([
      {
        asset: "BNB",
        amount: "10",
        price: "600",
        value: "6000",
        liquidationThresholdPercent: "80",
        weightedValue: "4800",
        liquidationPrice: "500",
      },
    ]);
    expect(report.debt).toEqual([{ asset: "USDT", amount: "4000", price: "1", value: "4000" }]);
    expect(report.targetHealthFactor).toBe("1.5");
    expect(report.toReachTarget).toEqual({ repayValue: "800", addCollateralValue: "1200" });
    expect(report.alerts).toEqual([
      { level: "1.5", state: "breached", distancePercent: "-20" },
      { level: "1.25", state: "breached", distancePercent: "-4" },
      { level: "1.1", state: "clear", distancePercent: "9.09" },
    ]);
  });

  it("computes per-asset liquidation prices for the canonical multi-asset input", () => {
    const report = buildLoanHealthReport(LOAN_HEALTH_CANONICAL_INPUT);
    expect(report.totals).toEqual({
      collateralValue: "9000",
      weightedCollateralValue: "7275",
      debtValue: "3000",
    });
    expect(report.healthFactor).toBe("2.425");
    expect(report.status).toBe("healthy");
    expect(report.collateral.map(({ asset, weightedValue, liquidationPrice }) => ({ asset, weightedValue, liquidationPrice }))).toEqual([
      { asset: "BNB", weightedValue: "4800", liquidationPrice: "65.625" },
      { asset: "ETH", weightedValue: "2475", liquidationPrice: null },
    ]);
    expect(report.toReachTarget).toEqual({ repayValue: "0", addCollateralValue: "0" });
    expect(report.alerts.every(({ state }) => state === "clear")).toBe(true);
    expect(report.alerts[2]).toEqual({ level: "1.1", state: "clear", distancePercent: "120.45" });
  });

  it("reports no_debt with an infinite health factor when the debt value is zero", () => {
    const report = buildLoanHealthReport(withOverrides({ debt: "USDT:0@1" }));
    expect(report.status).toBe("no_debt");
    expect(report.healthFactor).toBe("infinite");
    expect(report.totals.debtValue).toBe("0");
    expect(report.toReachTarget).toBeNull();
    expect(report.collateral.every(({ liquidationPrice }) => liquidationPrice === null)).toBe(true);
    expect(report.alerts).toEqual([
      { level: "1.5", state: "clear", distancePercent: "infinite" },
      { level: "1.25", state: "clear", distancePercent: "infinite" },
      { level: "1.1", state: "clear", distancePercent: "infinite" },
    ]);
  });

  it("reports liquidatable below a health factor of 1 with repay and top-up amounts", () => {
    const report = buildLoanHealthReport({ ...SINGLE_ASSET, debt: "USDT:6000@1" });
    expect(report.healthFactor).toBe("0.8");
    expect(report.status).toBe("liquidatable");
    expect(report.collateral[0]?.liquidationPrice).toBe("750");
    expect(report.toReachTarget).toEqual({ repayValue: "2800", addCollateralValue: "4200" });
    expect(report.alerts).toEqual([
      { level: "1.5", state: "breached", distancePercent: "-46.66" },
      { level: "1.25", state: "breached", distancePercent: "-36" },
      { level: "1.1", state: "breached", distancePercent: "-27.27" },
    ]);
  });

  it("reports at_risk between 1 and the lowest alert level", () => {
    const report = buildLoanHealthReport({ ...SINGLE_ASSET, collateral: "BNB:10@600:84", debt: "USDT:4800@1" });
    expect(report.healthFactor).toBe("1.05");
    expect(report.status).toBe("at_risk");
  });

  it("truncates the health factor to four places", () => {
    const report = buildLoanHealthReport({ ...SINGLE_ASSET, debt: "USDT:7@1" });
    expect(report.healthFactor).toBe("685.7142");
  });

  it("is deterministic and JSON-serialisable", () => {
    const first = buildLoanHealthReport(LOAN_HEALTH_CANONICAL_INPUT);
    const second = buildLoanHealthReport({
      collateral: "eth:1@3000:82.5, bnb:10@600:80".split(", ").reverse().join(","),
      debt: "usdt:3000@1",
      targetHealthFactor: "1.5",
      alertLevels: "1.5, 1.25, 1.1",
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it("states that it is a one-time report and models no execution", () => {
    const report = buildLoanHealthReport(LOAN_HEALTH_CANONICAL_INPUT);
    const text = report.assumptions.join(" ");
    expect(text).toMatch(/single report/);
    expect(text).toMatch(/not a monitoring service/);
    expect(text).toMatch(/no alert will be sent/);
    expect(text).toMatch(/other collateral asset keeps the price/);
    expect(text).toMatch(/No interest accrual/);
    expect(text).toMatch(/Nothing is transacted/);
    expect(text).toMatch(/100 percent liquidation threshold/);
  });
});

describe("task description", () => {
  it("round-trips through the LOAN_HEALTH_V1 prefix", () => {
    const description = loanHealthTaskDescription(LOAN_HEALTH_CANONICAL_INPUT);
    expect(description.startsWith("LOAN_HEALTH_V1:")).toBe(true);
    expect(parseLoanHealthTaskDescription(description)).toEqual(LOAN_HEALTH_CANONICAL_INPUT);
  });

  it("rejects foreign prefixes and invalid payloads", () => {
    expect(() => parseLoanHealthTaskDescription("GRID_PLAN_V1:{}")).toThrow(/not a loan health request/);
    expect(() => parseLoanHealthTaskDescription("LOAN_HEALTH_V1:[]")).toThrow(/payload is invalid/);
    expect(() => parseLoanHealthTaskDescription('LOAN_HEALTH_V1:{"collateral":"BNB:10@600:80"}')).toThrow(/fields are invalid/);
    expect(() => parseLoanHealthTaskDescription(
      'LOAN_HEALTH_V1:{"collateral":"BNB:10@600:80","debt":"USDT:1@1","targetHealthFactor":"1","alertLevels":"1.1"}',
    )).toThrow(/above 1/);
  });
});

describe("LOAN_HEALTH_PLANNER", () => {
  it("builds the canonical input through the planner surface", () => {
    expect(LOAN_HEALTH_PLANNER.taskPrefix).toBe("LOAN_HEALTH_V1:");
    expect(LOAN_HEALTH_PLANNER.terms).toBe(LOAN_HEALTH_NEGOTIATION_TERMS);
    const report = LOAN_HEALTH_PLANNER.build(LOAN_HEALTH_PLANNER.canonicalInput);
    expect(report.status).toBe("healthy");
    expect(LOAN_HEALTH_PLANNER.parseTaskDescription(
      LOAN_HEALTH_PLANNER.taskDescription(LOAN_HEALTH_PLANNER.canonicalInput),
    )).toEqual(LOAN_HEALTH_PLANNER.validate(LOAN_HEALTH_PLANNER.canonicalInput));
  });

  it("exposes a flat input schema with string or integer properties only", () => {
    const schema = LOAN_HEALTH_PLANNER.inputSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { type: string }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["collateral", "debt", "targetHealthFactor", "alertLevels"]);
    expect(Object.keys(schema.properties)).toEqual(schema.required);
    for (const property of Object.values(schema.properties)) {
      expect(["string", "integer"]).toContain(property.type);
    }
  });
});
