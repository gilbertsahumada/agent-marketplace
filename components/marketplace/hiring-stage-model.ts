// One looping scene for "how hiring works": a person's brief types itself,
// then a single timeline runs the hire for it. Pure function of elapsed
// milliseconds so the server can render the finished state and tests can
// pin any moment. Nothing here grades work: an agent is found, checks run,
// funds are held, a receipt lands.

export interface StageAgent {
  name: string;
  agentId: string;
}

export const DEFAULT_STAGE_AGENT: StageAgent = { name: "Grid Planner", agentId: "303779" };

export const BRIEF = {
  objective: "Run a grid on BNB/USDT between 500 and 700 for the next two weeks.",
  deliverable: "A 20-level grid plan and the orders placed on each cycle.",
  acceptance: "Stays inside the range. Stops and tells me if the price leaves it.",
  meta: "Budget 0.01 USDT per request · Starts Monday",
} as const;

export const STEP_TITLES = [
  "An agent is found",
  "It is verified before you pay",
  "Your funds go to escrow, not the agent",
  "You get the result with a receipt",
] as const;

// Phase timing, in ms from the start of a loop.
export const BRIEF_MS = 5_200;
export const STEP_MS = 3_000;
export const HOLD_MS = 3_200;
export const LOOP_MS = BRIEF_MS + STEP_MS * STEP_TITLES.length + HOLD_MS;

const HEX = "0123456789abcdef";
const SPINNER = "|/-\\";
export const RECEIPT_HASH = "5ee7c0ffee8183a1b2c3d4e5";
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const between = (t: number, from: number, to: number) => clamp((t - from) / (to - from));

export type Noise = () => number;
export type StepState = "pending" | "active" | "done";

export interface StageFrame {
  brief: { objective: string; deliverable: string; acceptance: string; meta: string };
  briefDone: boolean;
  steps: Array<{ title: string; state: StepState; lines: [string, string] }>;
  /** 0..1 fill of the vertical rail. */
  rail: number;
}

function typed(text: string, local: number): string {
  if (local >= 1) return text;
  if (local <= 0) return "";
  return `${text.slice(0, Math.floor(local * text.length))}▌`;
}

function spinner(t: number): string {
  return SPINNER[Math.floor(t / 90) % SPINNER.length]!;
}

function scrambled(target: string, local: number, noise: Noise): string {
  const resolved = Math.floor(local * target.length);
  return Array.from(target, (character, index) => index < resolved || local >= 1
    ? character
    : HEX[Math.floor(noise() * HEX.length)]!).join("");
}

function stepLines(index: number, p: number, t: number, agent: StageAgent, noise: Noise): [string, string] {
  const label = `${agent.name} #${agent.agentId}`;
  if (index === 0) {
    if (p < 0.55) return [`searching grid_trading ${spinner(t)}`, `${Math.min(3, Math.floor(p * 6))} listed`];
    return [`> ${label}`, "3 listed · 1 verified · selected"];
  }
  if (index === 1) {
    const checks = ["identity ok", "endpoint 200", "quote signed", "escrow ready"];
    const done = Math.min(checks.length, Math.floor(p * (checks.length + 0.6)));
    const running = done < checks.length ? ` ${spinner(t)}` : "";
    return [`${checks.slice(0, done).join(" · ")}${running}`, `${done}/4 checks ran · nothing assumed`];
  }
  if (index === 2) {
    const width = 12;
    const filled = Math.round(p * width);
    const bar = `[${"$".repeat(filled).padEnd(width, ".")}]`;
    return [p < 0.45 ? `createJob() ${spinner(t)}` : p < 1 ? `fund() ${bar}` : `fund() ${bar} LOCKED`, p < 1 ? "0.01 USDT moving to escrow" : "0.01 USDT held in ERC-8183 escrow"];
  }
  const hash = scrambled(RECEIPT_HASH, between(p, 0, 0.7), noise);
  return [`settle() tx 0x${hash.slice(0, 16)}…`, p < 0.8 ? "waiting for the block" : "block 120,177,601 · SETTLED"];
}

export function stageFrame(elapsed: number, agent: StageAgent = DEFAULT_STAGE_AGENT, noise: Noise = Math.random): StageFrame {
  const t = ((elapsed % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const fields = [BRIEF.objective, BRIEF.deliverable, BRIEF.acceptance, BRIEF.meta];
  const weights = fields.map((field) => field.length);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  const briefText = fields.map((field, index) => {
    const from = (cursor / total) * BRIEF_MS;
    cursor += weights[index]!;
    const to = (cursor / total) * BRIEF_MS;
    return typed(field, between(t, from, to));
  });
  const briefDone = t >= BRIEF_MS;

  const steps = STEP_TITLES.map((title, index) => {
    const from = BRIEF_MS + index * STEP_MS;
    const to = from + STEP_MS;
    const state: StepState = t >= to ? "done" : t >= from ? "active" : "pending";
    const p = state === "done" ? 1 : state === "active" ? between(t, from, to) : 0;
    return { title, state, lines: state === "pending" ? ["", ""] as [string, string] : stepLines(index, p, t, agent, noise) };
  });
  const rail = between(t, BRIEF_MS, BRIEF_MS + STEP_MS * STEP_TITLES.length);

  return {
    brief: { objective: briefText[0]!, deliverable: briefText[1]!, acceptance: briefText[2]!, meta: briefText[3]! },
    briefDone,
    steps,
    rail,
  };
}

// The resting frame the server renders: brief written, every step done.
export const RESTING_ELAPSED = BRIEF_MS + STEP_MS * STEP_TITLES.length;
