import type { HostedSellerPlanner } from "../entities/hosted-seller-service.ts";
import type { YieldOption, YieldPlan, YieldPlanInput, YieldRisk } from "../entities/yield-plan.ts";

const SCALE = 100_000_000n;
const TASK_PREFIX = "YIELD_PLAN_V1:";
const RISKS: readonly YieldRisk[] = ["low", "medium", "high"];
const RISK_RANK: Record<YieldRisk, number> = { low: 0, medium: 1, high: 2 };
const NAME_PATTERN = /^[A-Za-z0-9 .\/-]{1,40}$/;
const APY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export const YIELD_NEGOTIATION_TERMS = Object.freeze({
  deliverables: "Deterministic yield allocation plan JSON with per-option allocation, blended rate from the provided inputs and assumptions",
  qualityStandards: "Deterministic output, no deposits, no order execution and no custody",
});

export const YIELD_CANONICAL_INPUT: YieldPlanInput = Object.freeze({
  capital: "10000",
  options: "Venus USDT:4.2:low,Beefy BNB-USDT LP:11.5:medium,Alpaca leveraged:18:high",
  riskTolerance: "medium",
  maxSharePercent: 60,
  minOptions: 2,
});

function decimal(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(`${field} must be a positive decimal with at most 8 places`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
  if (result <= 0n) throw new Error(`${field} must be positive`);
  return result;
}

function rate(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
}

function formatted(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function fixed(value: bigint, places: number): string {
  const unit = 10n ** BigInt(places);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(places, "0");
  return `${whole}.${fraction}`;
}

function isRisk(value: string): value is YieldRisk {
  return (RISKS as readonly string[]).includes(value);
}

function parseOptions(value: string): YieldOption[] {
  const entries = value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (entries.length < 1 || entries.length > 10) throw new Error("options must contain 1 to 10 entries");
  const seen = new Set<string>();
  return entries.map((entry) => {
    const [rawName, rawApy, rawRisk, ...extra] = entry.split(":");
    if (rawName === undefined || rawApy === undefined || rawRisk === undefined || extra.length > 0) {
      throw new Error("options must use NAME:apyPercent:risk entries");
    }
    const name = rawName.trim();
    const apyPercent = rawApy.trim();
    const risk = rawRisk.trim().toLowerCase();
    if (!NAME_PATTERN.test(name)) {
      throw new Error("option names must be 1 to 40 letters, digits, spaces, hyphens, dots or slashes");
    }
    if (!APY_PATTERN.test(apyPercent)) {
      throw new Error("option apyPercent must be a non-negative decimal with at most 4 places");
    }
    if (!isRisk(risk)) throw new Error("option risk must be one of low, medium, high");
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error("option names must be unique");
    seen.add(key);
    return { name, apyPercent, risk };
  });
}

export function validateYieldPlanInput(input: YieldPlanInput): YieldPlanInput {
  decimal(input.capital, "capital");
  if (typeof input.options !== "string") throw new Error("options must be a string");
  const options = parseOptions(input.options);
  if (typeof input.riskTolerance !== "string" || !isRisk(input.riskTolerance)) {
    throw new Error("riskTolerance must be one of low, medium, high");
  }
  if (!Number.isSafeInteger(input.maxSharePercent) || input.maxSharePercent < 10 || input.maxSharePercent > 100) {
    throw new Error("maxSharePercent must be an integer from 10 to 100");
  }
  if (!Number.isSafeInteger(input.minOptions) || input.minOptions < 1 || input.minOptions > 10) {
    throw new Error("minOptions must be an integer from 1 to 10");
  }
  return {
    capital: input.capital,
    options: options.map((option) => `${option.name}:${option.apyPercent}:${option.risk}`).join(","),
    riskTolerance: input.riskTolerance,
    maxSharePercent: input.maxSharePercent,
    minOptions: input.minOptions,
  };
}

function allocate(capital: bigint, eligible: YieldOption[], input: YieldPlanInput): bigint[] {
  const maxAmount = capital * BigInt(input.maxSharePercent) / 100n;
  if (eligible.length * input.maxSharePercent < 100) throw new Error("maxSharePercent too low for minOptions");
  const amounts = eligible.map(() => 0n);
  let remaining = capital;
  for (let index = 0; index < eligible.length && remaining > 0n; index += 1) {
    const amount = remaining < maxAmount ? remaining : maxAmount;
    amounts[index] = amount;
    remaining -= amount;
  }
  const funded = amounts.filter((amount) => amount > 0n).length;
  if (funded >= input.minOptions) return amounts;
  const count = BigInt(input.minOptions);
  const share = capital / count;
  return eligible.map((_, index) => {
    if (index >= input.minOptions) return 0n;
    return index === input.minOptions - 1 ? capital - share * (count - 1n) : share;
  });
}

export function buildYieldPlan(rawInput: YieldPlanInput): YieldPlan {
  const input = validateYieldPlanInput(rawInput);
  const capital = decimal(input.capital, "capital");
  const options = parseOptions(input.options);
  const tolerance = RISK_RANK[input.riskTolerance];
  const considered = options.map((option) => {
    const eligible = RISK_RANK[option.risk] <= tolerance;
    return { ...option, eligible, reason: eligible ? null : "risk above tolerance" };
  });
  const eligible = options
    .filter((option) => RISK_RANK[option.risk] <= tolerance)
    .sort((left, right) => {
      const leftRate = rate(left.apyPercent);
      const rightRate = rate(right.apyPercent);
      if (leftRate !== rightRate) return leftRate > rightRate ? -1 : 1;
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
  if (eligible.length < input.minOptions) throw new Error("not enough eligible options");
  const amounts = allocate(capital, eligible, input);
  const allocations = eligible.flatMap((option, index) => {
    const amount = amounts[index] ?? 0n;
    if (amount === 0n) return [];
    return [{
      ...option,
      sharePercent: fixed(amount * 10_000n / capital, 2),
      amount: formatted(amount),
    }];
  });
  const weighted = eligible.reduce((sum, option, index) => sum + (amounts[index] ?? 0n) * rate(option.apyPercent), 0n);
  const blended = weighted / capital / 10_000n;
  return {
    schemaVersion: 1,
    capital: formatted(capital),
    riskTolerance: input.riskTolerance,
    maxSharePercent: input.maxSharePercent,
    minOptions: input.minOptions,
    considered,
    allocations,
    blendedApyPercent: fixed(blended, 4),
    rateSource: "provided by the buyer",
    assumptions: [
      "Rates are the buyer's inputs; the marketplace does not observe, verify or forecast them.",
      "The blended rate is the allocation-weighted arithmetic mean of the provided rates.",
      "Options with risk above the tolerance are excluded; eligible options are ranked by provided rate, then name.",
      "Capital is assigned greedily up to the maximum share per option; when fewer than the minimum number of options would be funded, it is split evenly across the top options.",
      "Rounding remainder is assigned to the final funded option so amounts sum exactly to the capital.",
      "No compounding, fees, lock-ups or impermanent loss are modelled.",
      "Nothing is deposited, moved or held; this plan performs no execution and no custody.",
    ],
    execution: "none",
  };
}

export function yieldTaskDescription(input: YieldPlanInput): string {
  const normalized = validateYieldPlanInput(input);
  return `${TASK_PREFIX}${JSON.stringify(normalized)}`;
}

export function parseYieldTaskDescription(value: string): YieldPlanInput {
  if (!value.startsWith(TASK_PREFIX)) throw new Error("task is not a yield plan request");
  const parsed = JSON.parse(value.slice(TASK_PREFIX.length)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("yield task payload is invalid");
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.capital !== "string" ||
    typeof candidate.options !== "string" ||
    typeof candidate.riskTolerance !== "string" ||
    !isRisk(candidate.riskTolerance) ||
    typeof candidate.maxSharePercent !== "number" ||
    typeof candidate.minOptions !== "number"
  ) throw new Error("yield task fields are invalid");
  return validateYieldPlanInput({
    capital: candidate.capital,
    options: candidate.options,
    riskTolerance: candidate.riskTolerance,
    maxSharePercent: candidate.maxSharePercent,
    minOptions: candidate.minOptions,
  });
}

export const YIELD_PLANNER: HostedSellerPlanner<YieldPlanInput, YieldPlan> = Object.freeze({
  taskPrefix: TASK_PREFIX,
  terms: YIELD_NEGOTIATION_TERMS,
  canonicalInput: YIELD_CANONICAL_INPUT,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["capital", "options", "riskTolerance", "maxSharePercent", "minOptions"],
    properties: {
      capital: {
        type: "string",
        title: "Capital to allocate",
        minLength: 1,
        maxLength: 40,
        description: "Positive decimal, up to 8 decimal places; nothing is deposited.",
      },
      options: {
        type: "string",
        title: "Candidate options",
        minLength: 5,
        maxLength: 800,
        description: "Comma-separated NAME:apyPercent:risk entries, risk one of low, medium, high, e.g. Venus USDT:4.2:low,Beefy BNB-USDT LP:11.5:medium.",
      },
      riskTolerance: { type: "string", title: "Risk tolerance", enum: ["low", "medium", "high"] },
      maxSharePercent: { type: "integer", title: "Max share per option (%)", minimum: 10, maximum: 100 },
      minOptions: { type: "integer", title: "Minimum number of options", minimum: 1, maximum: 10 },
    },
  },
  validate: validateYieldPlanInput,
  build: buildYieldPlan,
  taskDescription: yieldTaskDescription,
  parseTaskDescription: parseYieldTaskDescription,
});
