import type { HostedSellerPlanner } from "../entities/hosted-seller-service.ts";
import type {
  LoanHealthAlert,
  LoanHealthCollateralLine,
  LoanHealthDebtLine,
  LoanHealthInput,
  LoanHealthReport,
  LoanHealthStatus,
} from "../entities/loan-health-report.ts";

const SCALE = 100_000_000n;
const ONE = SCALE;
const HUNDRED = 100n * SCALE;
const HEALTH_FACTOR_UNIT = 10_000n;
const PERCENT_UNIT = 1_000_000n;
const MAX_ENTRIES = 12;
const MAX_ALERT_LEVELS = 6;
const TASK_PREFIX = "LOAN_HEALTH_V1:";
const ASSET_PATTERN = /^[A-Z0-9]{2,12}$/;

export const LOAN_HEALTH_NEGOTIATION_TERMS = Object.freeze({
  deliverables:
    "Deterministic loan health report JSON with health factor, liquidation prices, distance to each alert level, repay and top-up amounts, and assumptions",
  qualityStandards: "Deterministic output, no transactions, no monitoring service and no custody",
});

export const LOAN_HEALTH_CANONICAL_INPUT: LoanHealthInput = Object.freeze({
  collateral: "BNB:10@600:80,ETH:1@3000:82.5",
  debt: "USDT:3000@1",
  targetHealthFactor: "1.5",
  alertLevels: "1.5,1.25,1.1",
});

function scaled(value: string, places: number, field: string): bigint {
  const pattern = new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${places}})?$`);
  if (!pattern.test(value)) {
    throw new Error(`${field} must be a decimal with at most ${places} places`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
}

function decimal(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(`${field} must be a positive decimal with at most 8 places`);
  }
  const result = scaled(value, 8, field);
  if (result <= 0n) throw new Error(`${field} must be positive`);
  return result;
}

function nonNegativeDecimal(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(`${field} must be a non-negative decimal with at most 8 places`);
  }
  return scaled(value, 8, field);
}

function thresholdPercent(value: string, field: string): bigint {
  const result = scaled(value, 2, field);
  if (result <= 0n || result > HUNDRED) {
    throw new Error(`${field} must be a percentage above 0 and at most 100 with at most 2 places`);
  }
  return result;
}

function healthFactorDecimal(value: string, field: string): bigint {
  const result = scaled(value, 4, field);
  if (result <= 0n) throw new Error(`${field} must be positive`);
  return result;
}

function formatted(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  const whole = magnitude / SCALE;
  const fraction = (magnitude % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${fraction ? `${whole}.${fraction}` : whole.toString()}`;
}

function truncated(value: bigint, unit: bigint): bigint {
  return (value / unit) * unit;
}

function entries(raw: string, field: string): string[] {
  const parts = raw.split(",").map((part) => part.trim().toUpperCase());
  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    throw new Error(`${field} must be a comma-separated list without empty entries`);
  }
  if (parts.length > MAX_ENTRIES) {
    throw new Error(`${field} may hold at most ${MAX_ENTRIES} entries`);
  }
  return parts;
}

function rejectDuplicates(assets: string[], field: string): void {
  if (new Set(assets).size !== assets.length) {
    throw new Error(`${field} must not repeat an asset`);
  }
}

interface CollateralEntry {
  asset: string;
  amount: bigint;
  price: bigint;
  threshold: bigint;
}

interface DebtEntry {
  asset: string;
  amount: bigint;
  price: bigint;
}

function parseCollateral(raw: string): CollateralEntry[] {
  const parsed = entries(raw, "collateral").map((entry) => {
    const [, asset = "", amount = "", price = "", threshold = ""] =
      /^([A-Z0-9]+):([^@:]+)@([^@:]+):([^@:]+)$/.exec(entry) ?? [];
    if (!ASSET_PATTERN.test(asset)) {
      throw new Error("collateral entries must use ASSET:amount@price:liquidationThresholdPercent");
    }
    return {
      asset,
      amount: decimal(amount, "collateral amount"),
      price: decimal(price, "collateral price"),
      threshold: thresholdPercent(threshold, "collateral liquidation threshold"),
    };
  });
  rejectDuplicates(parsed.map(({ asset }) => asset), "collateral");
  return parsed;
}

function parseDebt(raw: string): DebtEntry[] {
  const parsed = entries(raw, "debt").map((entry) => {
    const [, asset = "", amount = "", price = ""] =
      /^([A-Z0-9]+):([^@:]+)@([^@:]+)$/.exec(entry) ?? [];
    if (!ASSET_PATTERN.test(asset)) {
      throw new Error("debt entries must use ASSET:amount@price");
    }
    return {
      asset,
      amount: nonNegativeDecimal(amount, "debt amount"),
      price: decimal(price, "debt price"),
    };
  });
  rejectDuplicates(parsed.map(({ asset }) => asset), "debt");
  return parsed;
}

function parseTarget(raw: string): bigint {
  const target = healthFactorDecimal(raw, "targetHealthFactor");
  if (target <= ONE) throw new Error("targetHealthFactor must be above 1");
  return target;
}

function parseAlertLevels(raw: string): bigint[] {
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) {
    throw new Error("alertLevels must be a comma-separated list without empty entries");
  }
  if (parts.length > MAX_ALERT_LEVELS) {
    throw new Error(`alertLevels may hold at most ${MAX_ALERT_LEVELS} levels`);
  }
  const levels = parts.map((part) => healthFactorDecimal(part, "alertLevels"));
  const descending = levels.every((level, index) => index === 0 || level < (levels[index - 1] ?? level));
  if (!descending) throw new Error("alertLevels must be strictly descending");
  return levels;
}

export function validateLoanHealthInput(input: LoanHealthInput): LoanHealthInput {
  const collateral = parseCollateral(input.collateral.trim());
  const debt = parseDebt(input.debt.trim());
  const targetHealthFactor = input.targetHealthFactor.trim();
  parseTarget(targetHealthFactor);
  const alertLevels = input.alertLevels.trim();
  parseAlertLevels(alertLevels);
  return {
    collateral: collateral
      .map(({ asset, amount, price, threshold }) =>
        `${asset}:${formatted(amount)}@${formatted(price)}:${formatted(threshold)}`)
      .join(","),
    debt: debt
      .map(({ asset, amount, price }) => `${asset}:${formatted(amount)}@${formatted(price)}`)
      .join(","),
    targetHealthFactor,
    alertLevels: alertLevels.split(",").map((part) => part.trim()).join(","),
  };
}

function statusFor(healthFactor: bigint, lowestAlert: bigint): LoanHealthStatus {
  if (healthFactor < ONE) return "liquidatable";
  if (healthFactor < lowestAlert) return "at_risk";
  return "healthy";
}

export function buildLoanHealthReport(rawInput: LoanHealthInput): LoanHealthReport {
  const input = validateLoanHealthInput(rawInput);
  const collateral = parseCollateral(input.collateral);
  const debt = parseDebt(input.debt);
  const target = parseTarget(input.targetHealthFactor);
  const alertLevels = parseAlertLevels(input.alertLevels);
  const lowestAlert = alertLevels[alertLevels.length - 1] ?? ONE;

  const collateralValues = collateral.map((entry) => {
    const value = entry.amount * entry.price / SCALE;
    return { entry, value, weighted: value * entry.threshold / HUNDRED };
  });
  const debtValues = debt.map((entry) => ({ entry, value: entry.amount * entry.price / SCALE }));
  const collateralValue = collateralValues.reduce((sum, { value }) => sum + value, 0n);
  const weightedCollateral = collateralValues.reduce((sum, { weighted }) => sum + weighted, 0n);
  const debtValue = debtValues.reduce((sum, { value }) => sum + value, 0n);
  const hasDebt = debtValue > 0n;

  const collateralLines: LoanHealthCollateralLine[] = collateralValues.map(({ entry, value, weighted }) => {
    const otherWeighted = weightedCollateral - weighted;
    const uncovered = debtValue - otherWeighted;
    const liquidationPrice = uncovered > 0n
      ? uncovered * HUNDRED / (entry.amount * entry.threshold / SCALE)
      : null;
    return {
      asset: entry.asset,
      amount: formatted(entry.amount),
      price: formatted(entry.price),
      value: formatted(value),
      liquidationThresholdPercent: formatted(entry.threshold),
      weightedValue: formatted(weighted),
      liquidationPrice: liquidationPrice === null ? null : formatted(liquidationPrice),
    };
  });

  const debtLines: LoanHealthDebtLine[] = debtValues.map(({ entry, value }) => ({
    asset: entry.asset,
    amount: formatted(entry.amount),
    price: formatted(entry.price),
    value: formatted(value),
  }));

  const healthFactor = hasDebt
    ? truncated(weightedCollateral * SCALE / debtValue, HEALTH_FACTOR_UNIT)
    : null;

  const alerts: LoanHealthAlert[] = alertLevels.map((level) => {
    if (healthFactor === null) {
      return { level: formatted(level), state: "clear", distancePercent: "infinite" };
    }
    const distance = truncated((healthFactor - level) * HUNDRED / level, PERCENT_UNIT);
    return {
      level: formatted(level),
      state: healthFactor < level ? "breached" : "clear",
      distancePercent: formatted(distance),
    };
  });

  const toReachTarget = healthFactor === null
    ? null
    : (() => {
        const repay = debtValue - weightedCollateral * SCALE / target;
        const add = target * debtValue / SCALE - weightedCollateral;
        return {
          repayValue: formatted(repay > 0n ? repay : 0n),
          addCollateralValue: formatted(add > 0n ? add : 0n),
        };
      })();

  return {
    schemaVersion: 1,
    collateral: collateralLines,
    debt: debtLines,
    totals: {
      collateralValue: formatted(collateralValue),
      weightedCollateralValue: formatted(weightedCollateral),
      debtValue: formatted(debtValue),
    },
    healthFactor: healthFactor === null ? "infinite" : formatted(healthFactor),
    status: healthFactor === null ? "no_debt" : statusFor(healthFactor, lowestAlert),
    targetHealthFactor: formatted(target),
    toReachTarget,
    alerts,
    assumptions: [
      "Prices and liquidation thresholds are the buyer's inputs at one moment; nothing is fetched from a market or a lending protocol.",
      "This is a single report computed once from those inputs. It is not a monitoring service and no alert will be sent.",
      "Health factor is weighted collateral value divided by debt value, where each collateral value is weighted by its liquidation threshold.",
      "Each liquidation price assumes every other collateral asset keeps the price given in the input; null means no price of that asset alone reaches a health factor of 1.",
      "Repay and top-up amounts are values in the debt quote unit; the top-up is expressed as collateral value at a 100 percent liquidation threshold.",
      "No interest accrual, borrow fees, liquidation penalties or price slippage are modelled.",
      "Nothing is transacted, borrowed, repaid or held; the report only describes the numbers supplied.",
    ],
    execution: "none",
  };
}

export function loanHealthTaskDescription(input: LoanHealthInput): string {
  const normalized = validateLoanHealthInput(input);
  return `${TASK_PREFIX}${JSON.stringify(normalized)}`;
}

export function parseLoanHealthTaskDescription(value: string): LoanHealthInput {
  if (!value.startsWith(TASK_PREFIX)) throw new Error("task is not a loan health request");
  const parsed = JSON.parse(value.slice(TASK_PREFIX.length)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("loan health task payload is invalid");
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.collateral !== "string" ||
    typeof candidate.debt !== "string" ||
    typeof candidate.targetHealthFactor !== "string" ||
    typeof candidate.alertLevels !== "string"
  ) throw new Error("loan health task fields are invalid");
  return validateLoanHealthInput({
    collateral: candidate.collateral,
    debt: candidate.debt,
    targetHealthFactor: candidate.targetHealthFactor,
    alertLevels: candidate.alertLevels,
  });
}

export const LOAN_HEALTH_PLANNER: HostedSellerPlanner<LoanHealthInput, LoanHealthReport> = Object.freeze({
  taskPrefix: TASK_PREFIX,
  terms: LOAN_HEALTH_NEGOTIATION_TERMS,
  canonicalInput: LOAN_HEALTH_CANONICAL_INPUT,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["collateral", "debt", "targetHealthFactor", "alertLevels"],
    properties: {
      collateral: {
        type: "string",
        title: "Collateral positions",
        minLength: 5,
        maxLength: 600,
        description:
          "Comma-separated ASSET:amount@price:liquidationThresholdPercent entries, e.g. BNB:10@600:80. Prices in the same quote unit as the debt.",
      },
      debt: {
        type: "string",
        title: "Debt positions",
        minLength: 5,
        maxLength: 300,
        description: "Comma-separated ASSET:amount@price entries, e.g. USDT:3000@1.",
      },
      targetHealthFactor: {
        type: "string",
        title: "Target health factor",
        minLength: 1,
        maxLength: 10,
        description: "Decimal above 1, up to 4 places, e.g. 1.5.",
      },
      alertLevels: {
        type: "string",
        title: "Alert levels",
        minLength: 1,
        maxLength: 60,
        description: "Comma-separated health factors in descending order, e.g. 1.5,1.25,1.1.",
      },
    },
  },
  validate: validateLoanHealthInput,
  build: buildLoanHealthReport,
  taskDescription: loanHealthTaskDescription,
  parseTaskDescription: parseLoanHealthTaskDescription,
});
