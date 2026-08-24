import type { GridPlan, GridPlanInput } from "../entities/grid-plan.js";

const SCALE = 100_000_000n;

function decimal(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(`${field} must be a positive decimal with at most 8 places`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
  if (result <= 0n) throw new Error(`${field} must be positive`);
  return result;
}

function formatted(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function validateGridPlanInput(input: GridPlanInput): GridPlanInput {
  const pair = input.pair.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/.test(pair)) {
    throw new Error("pair must use BASE/QUOTE symbols");
  }
  if (!Number.isSafeInteger(input.gridCount) || input.gridCount < 2 || input.gridCount > 100) {
    throw new Error("gridCount must be an integer from 2 to 100");
  }
  const lower = decimal(input.lowerPrice, "lowerPrice");
  const upper = decimal(input.upperPrice, "upperPrice");
  decimal(input.capital, "capital");
  if (upper <= lower) throw new Error("upperPrice must exceed lowerPrice");
  return { ...input, pair };
}

export function buildGridPlan(rawInput: GridPlanInput): GridPlan {
  const input = validateGridPlanInput(rawInput);
  const lower = decimal(input.lowerPrice, "lowerPrice");
  const upper = decimal(input.upperPrice, "upperPrice");
  const capital = decimal(input.capital, "capital");
  const intervals = BigInt(input.gridCount - 1);
  const spacing = (upper - lower) / intervals;
  const perLevel = capital / BigInt(input.gridCount);
  const midpoint = (lower + upper) / 2n;
  const levels = Array.from({ length: input.gridCount }, (_, index) => {
    const price = index === input.gridCount - 1 ? upper : lower + spacing * BigInt(index);
    const allocated = index === input.gridCount - 1
      ? capital - perLevel * BigInt(input.gridCount - 1)
      : perLevel;
    return {
      index: index + 1,
      price: formatted(price),
      side: price <= midpoint ? "buy" as const : "sell" as const,
      capital: formatted(allocated),
    };
  });
  return {
    schemaVersion: 1,
    pair: input.pair,
    lowerPrice: formatted(lower),
    upperPrice: formatted(upper),
    capital: formatted(capital),
    gridCount: input.gridCount,
    spacing: formatted(spacing),
    levels,
    rebalanceTriggers: {
      below: formatted(lower * 95n / 100n),
      above: formatted(upper * 105n / 100n),
    },
    assumptions: [
      "Arithmetic price spacing with inclusive lower and upper bounds.",
      "Capital is allocated evenly; rounding remainder is assigned to the final level.",
      "Buy levels are at or below the range midpoint and sell levels are above it.",
      "Rebalance triggers sit five percent outside the configured range.",
      "This plan performs no order placement, custody or financial execution.",
    ],
    execution: "none",
  };
}

export function gridTaskDescription(input: GridPlanInput): string {
  const normalized = validateGridPlanInput(input);
  return `GRID_PLAN_V1:${JSON.stringify(normalized)}`;
}

export function parseGridTaskDescription(value: string): GridPlanInput {
  if (!value.startsWith("GRID_PLAN_V1:")) throw new Error("task is not a Grid plan request");
  const parsed = JSON.parse(value.slice("GRID_PLAN_V1:".length)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Grid task payload is invalid");
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.pair !== "string" ||
    typeof candidate.lowerPrice !== "string" ||
    typeof candidate.upperPrice !== "string" ||
    typeof candidate.capital !== "string" ||
    typeof candidate.gridCount !== "number"
  ) throw new Error("Grid task fields are invalid");
  return validateGridPlanInput({
    pair: candidate.pair,
    lowerPrice: candidate.lowerPrice,
    upperPrice: candidate.upperPrice,
    capital: candidate.capital,
    gridCount: candidate.gridCount,
  });
}
