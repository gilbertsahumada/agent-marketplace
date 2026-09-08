import type { HostedSellerPlanner } from "../entities/hosted-seller-service.ts";
import type {
  RebalanceAction,
  RebalancePlan,
  RebalancePlanInput,
  RebalancePosition,
  RebalanceTrade,
} from "../entities/rebalance-plan.ts";

const SCALE = 100_000_000n;
const HUNDRED_PERCENT = 100n * SCALE;
const TASK_PREFIX = "REBALANCE_PLAN_V1:";
const ASSET_PATTERN = /^[A-Z0-9]{2,12}$/;

export const REBALANCE_NEGOTIATION_TERMS = Object.freeze({
  deliverables: "Deterministic rebalancing plan JSON with current weights, drift, trades and assumptions",
  qualityStandards: "Deterministic output, no order execution and no custody",
});

export const REBALANCE_CANONICAL_INPUT = Object.freeze({
  positions: "BNB:2.5@600,USDT:1000@1,ETH:0.4@3000",
  targets: "BNB:50,USDT:30,ETH:20",
  driftThresholdPercent: 5,
});

interface ParsedPosition {
  asset: string;
  amount: bigint;
  price: bigint;
}

interface ParsedTarget {
  asset: string;
  percent: bigint;
}

function decimal(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(`${field} must be a positive decimal with at most 8 places`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
  if (result <= 0n) throw new Error(`${field} must be positive`);
  return result;
}

function percent(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new Error(`${field} must be a non-negative percent with at most 2 places`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
}

function formatted(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function signed(value: bigint): string {
  return value < 0n ? `-${formatted(-value)}` : formatted(value);
}

function entries(value: string, field: string): string[] {
  const parts = value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error(`${field} must list at least one entry`);
  return parts;
}

function asset(symbol: string, field: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!ASSET_PATTERN.test(normalized)) throw new Error(`${field} asset symbols must be 2 to 12 letters or digits`);
  return normalized;
}

function parsePositions(value: string): ParsedPosition[] {
  const positions = entries(value, "positions").map((entry) => {
    const [, rawAsset = "", rawAmount = "", rawPrice = ""] = /^([^:]+):([^@]+)@(.+)$/.exec(entry) ?? [];
    if (!rawAsset) throw new Error("positions entries must use ASSET:amount@price");
    const symbol = asset(rawAsset, "positions");
    return {
      asset: symbol,
      amount: decimal(rawAmount.trim(), `${symbol} amount`),
      price: decimal(rawPrice.trim(), `${symbol} price`),
    };
  });
  if (positions.length < 2 || positions.length > 12) throw new Error("positions must list 2 to 12 assets");
  const seen = new Set<string>();
  for (const position of positions) {
    if (seen.has(position.asset)) throw new Error(`positions lists ${position.asset} more than once`);
    seen.add(position.asset);
  }
  return positions;
}

function parseTargets(value: string, positions: ParsedPosition[]): ParsedTarget[] {
  const targets = entries(value, "targets").map((entry) => {
    const [, rawAsset = "", rawPercent = ""] = /^([^:]+):(.+)$/.exec(entry) ?? [];
    if (!rawAsset) throw new Error("targets entries must use ASSET:percent");
    const symbol = asset(rawAsset, "targets");
    return { asset: symbol, percent: percent(rawPercent.trim(), `${symbol} target`) };
  });
  const positionAssets = new Set(positions.map((position) => position.asset));
  const seen = new Set<string>();
  for (const target of targets) {
    if (!positionAssets.has(target.asset)) throw new Error(`targets references ${target.asset} which is not a position`);
    if (seen.has(target.asset)) throw new Error(`targets lists ${target.asset} more than once`);
    seen.add(target.asset);
  }
  for (const position of positions) {
    if (!seen.has(position.asset)) throw new Error(`targets is missing ${position.asset}`);
  }
  const sum = targets.reduce((acc, target) => acc + target.percent, 0n);
  if (sum !== HUNDRED_PERCENT) throw new Error("targets must sum to exactly 100");
  return targets;
}

function serializePositions(positions: ParsedPosition[]): string {
  return positions.map((p) => `${p.asset}:${formatted(p.amount)}@${formatted(p.price)}`).join(",");
}

function serializeTargets(targets: ParsedTarget[]): string {
  return targets.map((t) => `${t.asset}:${formatted(t.percent)}`).join(",");
}

export function validateRebalancePlanInput(input: RebalancePlanInput): RebalancePlanInput {
  if (typeof input.positions !== "string" || typeof input.targets !== "string") {
    throw new Error("positions and targets must be strings");
  }
  const threshold = input.driftThresholdPercent;
  if (!Number.isSafeInteger(threshold) || threshold < 0 || threshold > 50) {
    throw new Error("driftThresholdPercent must be an integer from 0 to 50");
  }
  const positions = parsePositions(input.positions);
  const targets = parseTargets(input.targets, positions);
  return {
    positions: serializePositions(positions),
    targets: serializeTargets(targets),
    driftThresholdPercent: threshold,
  };
}

export function buildRebalancePlan(rawInput: RebalancePlanInput): RebalancePlan {
  const input = validateRebalancePlanInput(rawInput);
  const parsedPositions = parsePositions(input.positions);
  const targetByAsset = new Map(parseTargets(input.targets, parsedPositions).map((t) => [t.asset, t.percent]));
  const threshold = BigInt(input.driftThresholdPercent) * SCALE;

  const valued = parsedPositions.map((position) => ({ ...position, value: position.amount * position.price / SCALE }));
  const total = valued.reduce((acc, position) => acc + position.value, 0n);

  const positions: RebalancePosition[] = valued.map((position) => {
    const value = position.value;
    const targetPercent = targetByAsset.get(position.asset) ?? 0n;
    const currentPercent = value * HUNDRED_PERCENT / total;
    const targetValue = total * targetPercent / HUNDRED_PERCENT;
    const drift = currentPercent - targetPercent;
    const magnitude = drift < 0n ? -drift : drift;
    let action: RebalanceAction = "hold";
    let tradeValue = 0n;
    if (magnitude > threshold) {
      action = drift < 0n ? "buy" : "sell";
      tradeValue = drift < 0n ? targetValue - value : value - targetValue;
    }
    const tradeAmount = tradeValue * SCALE / position.price;
    return {
      asset: position.asset,
      amount: formatted(position.amount),
      price: formatted(position.price),
      value: formatted(value),
      currentWeightPercent: formatted(currentPercent),
      targetWeightPercent: formatted(targetPercent),
      driftPercent: signed(drift),
      action,
      tradeAmount: formatted(tradeAmount),
      tradeValue: formatted(tradeValue),
    };
  });

  const byAsset = (a: RebalancePosition, b: RebalancePosition) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0);
  const tradeFor = (position: RebalancePosition): RebalanceTrade => ({
    asset: position.asset,
    side: position.action === "sell" ? "sell" : "buy",
    amount: position.tradeAmount,
    value: position.tradeValue,
  });
  const trades = [
    ...positions.filter((p) => p.action === "sell").sort(byAsset).map(tradeFor),
    ...positions.filter((p) => p.action === "buy").sort(byAsset).map(tradeFor),
  ];

  return {
    schemaVersion: 1,
    quoteUnit: "price units as provided",
    totalValue: formatted(total),
    positions,
    trades,
    driftThresholdPercent: input.driftThresholdPercent,
    assumptions: [
      "Prices are the buyer's inputs at one moment and are not fetched from any market.",
      "Every position is valued as amount times price in the same quote unit; no fees or slippage are modelled.",
      "Drift is the current weight minus the target weight in percentage points.",
      "Assets within the drift threshold are held, so buy and sell totals balance only when every asset trades.",
      "Trade values close the gap to the target value; trade amounts are the value divided by the input price, truncated to 8 places.",
      "This plan performs no order placement, custody or financial execution.",
    ],
    execution: "none",
  };
}

export function rebalanceTaskDescription(input: RebalancePlanInput): string {
  const normalized = validateRebalancePlanInput(input);
  return `${TASK_PREFIX}${JSON.stringify(normalized)}`;
}

export function parseRebalanceTaskDescription(value: string): RebalancePlanInput {
  if (!value.startsWith(TASK_PREFIX)) throw new Error("task is not a rebalance plan request");
  const parsed = JSON.parse(value.slice(TASK_PREFIX.length)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("rebalance task payload is invalid");
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.positions !== "string" ||
    typeof candidate.targets !== "string" ||
    typeof candidate.driftThresholdPercent !== "number"
  ) throw new Error("rebalance task fields are invalid");
  return validateRebalancePlanInput({
    positions: candidate.positions,
    targets: candidate.targets,
    driftThresholdPercent: candidate.driftThresholdPercent,
  });
}

export const REBALANCE_PLANNER: HostedSellerPlanner<RebalancePlanInput, RebalancePlan> = Object.freeze({
  taskPrefix: TASK_PREFIX,
  terms: REBALANCE_NEGOTIATION_TERMS,
  canonicalInput: REBALANCE_CANONICAL_INPUT,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["positions", "targets", "driftThresholdPercent"],
    properties: {
      positions: {
        type: "string",
        title: "Current positions",
        minLength: 3,
        maxLength: 600,
        description: "Comma-separated ASSET:amount@price entries, e.g. BNB:2.5@600,USDT:1000@1. Prices in the same quote unit.",
      },
      targets: {
        type: "string",
        title: "Target weights",
        minLength: 3,
        maxLength: 300,
        description: "Comma-separated ASSET:percent entries that sum to 100, e.g. BNB:50,USDT:30,ETH:20.",
      },
      driftThresholdPercent: {
        type: "integer",
        title: "Drift threshold (%)",
        minimum: 0,
        maximum: 50,
        description: "Assets within this distance of their target are left alone.",
      },
    },
  },
  validate: validateRebalancePlanInput,
  build: buildRebalancePlan,
  taskDescription: rebalanceTaskDescription,
  parseTaskDescription: parseRebalanceTaskDescription,
});
