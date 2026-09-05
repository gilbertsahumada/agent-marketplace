// Four small ASCII scenes, one per journey step, as pure frame functions of
// a progress value in [0, 1]. Progress 1 is the resting state the server
// renders; the client replays each scene from 0 while its step is active.
// Nothing here claims more than the step itself: a "found" agent, checks
// that ran, funds held, a receipt. No scene says a job was good.

export const SCENE_ROWS = 8;
const HEX = "0123456789abcdef";
export const RECEIPT_HASH = "5ee7c0ffee8183a1b2c3d4e5";
const CLAMP = (value: number) => Math.min(1, Math.max(0, value));

export type Noise = () => number;

function pad(lines: string[]): string[] {
  while (lines.length < SCENE_ROWS) lines.push("");
  return lines.slice(0, SCENE_ROWS);
}

// A grid of agents; a scan column sweeps left to right, then the matching
// agent lights up.
export function discoverFrame(progress: number): string[] {
  const p = CLAMP(progress);
  const columns = 9;
  const rows = 4;
  const sweep = p < 0.78 ? Math.floor((p / 0.78) * columns) : -1;
  const found = p >= 0.78;
  const target = { row: 1, column: 5 };
  const grid = Array.from({ length: rows }, (_, row) => {
    let line = " ";
    for (let column = 0; column < columns; column += 1) {
      const isTarget = row === target.row && column === target.column;
      if (found && isTarget) line += "[#]";
      else if (found && column === target.column + 1) line += " ";
      else if (found && column === target.column - 1) line += "· ";
      else line += column === sweep ? "+ " : "· ";
    }
    return line.trimEnd();
  });
  return pad([
    "",
    ...grid,
    "",
    found ? " found · grid planner" : ` scanning ${"".padEnd(Math.floor(p * 12), ".")}`,
  ]);
}

// Four checks fill one after another; none is skipped and none is guessed.
export function verifyFrame(progress: number): string[] {
  const p = CLAMP(progress);
  const checks = ["identity", "endpoint", "quote", "escrow"];
  const width = 8;
  const lines = checks.map((label, index) => {
    const local = CLAMP(p * checks.length - index);
    const filled = Math.round(local * width);
    const bar = "#".repeat(filled) + ".".repeat(width - filled);
    return ` ${label.padEnd(9)}[${bar}]${local === 1 ? " ok" : ""}`;
  });
  return pad(["", ...lines, "", p >= 1 ? " 4/4 checks ran" : ` ${Math.min(checks.length, Math.floor(p * checks.length))}/4 checks ran`]);
}

// An escrow box fills from the bottom, then locks.
export function hireFrame(progress: number): string[] {
  const p = CLAMP(progress);
  const inner = 12;
  const depth = 4;
  const filled = Math.min(depth, Math.floor(p * (depth + 0.999)));
  const locked = p >= 0.92;
  const top = locked ? ` +${"-".repeat(2)} LOCKED ${"-".repeat(inner - 10)}+` : ` +${"-".repeat(inner)}+`;
  const body = Array.from({ length: depth }, (_, row) => {
    const fromBottom = depth - row;
    return ` |${(fromBottom <= filled ? "$" : " ").repeat(inner)}|`;
  });
  return pad([top, ...body, ` +${"-".repeat(inner)}+`, "", locked ? " 0.01 USDT held in escrow" : " funding escrow"]);
}

// A transaction hash resolves left to right into the receipt; the block and
// the settled phase follow.
export function proveFrame(progress: number, noise: Noise = Math.random): string[] {
  const p = CLAMP(progress);
  const resolved = Math.floor(p * RECEIPT_HASH.length);
  const hash = Array.from(RECEIPT_HASH, (character, index) => index < resolved || p >= 1
    ? character
    : HEX[Math.floor(noise() * HEX.length)]!).join("");
  return pad([
    "",
    ` tx 0x${hash.slice(0, 12)}`,
    `      ${hash.slice(12)}`,
    "",
    p >= 0.55 ? " block 120,177,601" : "",
    p >= 0.8 ? " phase  settled" : "",
    "",
    p >= 1 ? " receipt on chain" : " writing receipt",
  ]);
}

export const JOURNEY_SCENES = [
  { step: "Discover", detail: "Filter the market by the outcome you need.", frame: discoverFrame },
  { step: "Verify", detail: "Inspect identity, endpoint, quote, and provenance.", frame: verifyFrame },
  { step: "Hire", detail: "Accept a fresh quote with funds held in escrow.", frame: hireFrame },
  { step: "Prove", detail: "Track the result back to its onchain receipt.", frame: proveFrame },
] as const;
