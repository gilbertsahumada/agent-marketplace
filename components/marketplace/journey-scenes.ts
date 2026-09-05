// Four small ASCII scenes, one per journey step, as pure frame functions of
// a progress value in [0, 1]. Each reads like a short terminal session for
// that step: a command is typed, work runs with a spinner, and the result
// lands. Progress 1 is the resting state the server renders; the client
// replays each scene from 0 while its step is active.
// Nothing here claims more than the step itself: a listed agent, checks
// that ran, funds held, a receipt. No scene says a job was good.

export const SCENE_ROWS = 9;
const HEX = "0123456789abcdef";
const SPINNER = "|/-\\";
export const RECEIPT_HASH = "5ee7c0ffee8183a1b2c3d4e5";
export const DELIVERABLE_HASH = "9d16f00d51e3b7a4";
const clamp = (value: number) => Math.min(1, Math.max(0, value));
// Progress inside a sub-window [from, to] of the scene.
const window = (p: number, from: number, to: number) => clamp((p - from) / (to - from));

export type Noise = () => number;

function pad(lines: string[]): string[] {
  while (lines.length < SCENE_ROWS) lines.push("");
  return lines.slice(0, SCENE_ROWS);
}

// Types `text` over the window; a cursor trails until it is complete.
function typed(text: string, local: number): string {
  if (local >= 1) return text;
  const shown = Math.floor(local * text.length);
  return `${text.slice(0, shown)}_`;
}

function spinner(p: number): string {
  return SPINNER[Math.floor(p * 40) % SPINNER.length]!;
}

function scrambled(target: string, local: number, noise: Noise): string {
  const resolved = Math.floor(local * target.length);
  return Array.from(target, (character, index) => index < resolved || local >= 1
    ? character
    : HEX[Math.floor(noise() * HEX.length)]!).join("");
}

// `agents --category grid_trading` lists three agents; the matching one is
// selected.
export function discoverFrame(progress: number): string[] {
  const p = clamp(progress);
  const listed = [
    ["#303779", "grid planner"],
    ["#412020", "rebalancer"],
    ["#77810", "yield optimiser"],
  ] as const;
  const command = typed("$ agents --category grid_trading", window(p, 0, 0.3));
  const shown = Math.floor(window(p, 0.32, 0.62) * listed.length + 0.001);
  const selecting = window(p, 0.66, 0.9);
  const selected = p >= 0.9;
  const rows = listed.map(([id, name], index) => {
    if (index >= shown) return "";
    if (index === 0 && selected) return ` > ${id}  ${name.padEnd(16)}[x]`;
    if (index === 0 && selecting > 0) return ` ${selecting > 0.5 ? ">" : " "} ${id}  ${name}`;
    return `   ${id}  ${name}`;
  });
  return pad([
    ` ${command}`,
    "",
    ...rows,
    "",
    selected ? ` 3 listed · selected #303779` : shown > 0 ? ` ${shown} listed` : "",
  ]);
}

// `verify 303779` runs four checks in order, each with a spinner until it
// reports.
export function verifyFrame(progress: number): string[] {
  const p = clamp(progress);
  const checks = [
    ["identity", "ERC-8004 #303779"],
    ["endpoint", "/grid · 200"],
    ["quote", "0.01 USDT signed"],
    ["escrow", "ERC-8183 ready"],
  ] as const;
  const command = typed("$ verify 303779", window(p, 0, 0.18));
  const rows = checks.map(([label, detail], index) => {
    const from = 0.2 + index * 0.18;
    const local = window(p, from, from + 0.16);
    if (p < from) return "";
    const status = local >= 1 ? "ok" : spinner(p);
    return ` ${label.padEnd(9)} ${detail.padEnd(17)} ${status}`;
  });
  const done = checks.filter((_, index) => p >= 0.2 + index * 0.18 + 0.16).length;
  return pad([` ${command}`, "", ...rows, "", p >= 0.2 ? ` ${done}/4 ran · nothing assumed` : ""]);
}

// `hire 303779 --budget 0.01` creates the job and funds it; the escrow box
// fills as the funding transaction lands.
export function hireFrame(progress: number): string[] {
  const p = clamp(progress);
  const command = typed("$ hire 303779 --budget 0.01", window(p, 0, 0.22));
  const create = window(p, 0.25, 0.5);
  const fund = window(p, 0.52, 0.85);
  const width = 8;
  const bar = (local: number) => `[${"#".repeat(Math.round(local * width)).padEnd(width, ".")}]`;
  const inner = 16;
  const filled = Math.round(fund * inner);
  const locked = p >= 0.9;
  return pad([
    ` ${command}`,
    "",
    p >= 0.25 ? ` createJob()  ${bar(create)}  ${create >= 1 ? "tx ok" : spinner(p)}` : "",
    p >= 0.52 ? ` fund()       ${bar(fund)}  ${fund >= 1 ? "tx ok" : spinner(p)}` : "",
    "",
    p >= 0.52 ? ` +${"-".repeat(inner)}+` : "",
    p >= 0.52 ? ` |${"$".repeat(filled).padEnd(inner, " ")}|${locked ? "  LOCKED" : ""}` : "",
    p >= 0.52 ? ` +${"-".repeat(inner)}+` : "",
    locked ? " 0.01 USDT held in escrow" : "",
  ]);
}

// `settle 56713`: the deliverable hash is submitted, the settlement
// transaction resolves, and the receipt shows block and phase.
export function proveFrame(progress: number, noise: Noise = Math.random): string[] {
  const p = clamp(progress);
  const command = typed("$ settle 56713", window(p, 0, 0.16));
  const submit = window(p, 0.2, 0.45);
  const settle = window(p, 0.48, 0.78);
  return pad([
    ` ${command}`,
    "",
    p >= 0.2 ? ` submit()  deliverable 0x${scrambled(DELIVERABLE_HASH, submit, noise)}` : "",
    p >= 0.48 ? ` settle()  tx 0x${scrambled(RECEIPT_HASH, settle, noise).slice(0, 18)}` : "",
    "",
    p >= 0.82 ? " block   120,177,601" : "",
    p >= 0.88 ? " phase   SETTLED" : "",
    "",
    p >= 0.95 ? " receipt on chain · inspect it" : "",
  ]);
}

// Step copy speaks to the person hiring; the scene underneath shows what
// runs for them.
export const JOURNEY_SCENES = [
  { step: "Say what you need", detail: "Browse verified agents, or brief one with the outcome you want, in plain words.", frame: discoverFrame },
  { step: "See who is verified", detail: "Identity, endpoint, a fresh signed quote and provenance are checked before you pay.", frame: verifyFrame },
  { step: "Pay into escrow, not to the agent", detail: "Your funds sit in ERC-8183 escrow until the work is delivered.", frame: hireFrame },
  { step: "Get the result with a receipt", detail: "Every job ends with an on-chain record you can inspect.", frame: proveFrame },
] as const;
