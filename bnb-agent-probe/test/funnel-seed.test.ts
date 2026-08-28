import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const evidence = JSON.parse(readFileSync(
  resolve(projectRoot, "../evidence/funnel-bsc-2026-08-27T19-41-17Z.json"),
  "utf8",
)) as {
  generatedAt: string;
  cutoff: { blockNumber: string };
  sourceSha256: string;
  registeredTotal: number;
  metadata: { ok: number; httpUnreachable: number; other: number };
  protocols: Record<string, number>;
  candidates: { declaredEndpoints: number; publicHttpsEndpoints: number };
};
const seed = readFileSync(
  resolve(projectRoot, "migrations/0002_seed_funnel_snapshot.sql"),
  "utf8",
);

describe("WP1 funnel seed", () => {
  it("seeds the reviewed WP0 artifact exactly once through migrations", () => {
    expect(seed).toContain(`${Date.parse(evidence.generatedAt)}`);
    expect(seed).toContain(`'${evidence.cutoff.blockNumber}'`);
    expect(seed).toContain(`'${evidence.sourceSha256}'`);
    expect(seed).toContain(`${evidence.registeredTotal}`);
    expect(seed).toContain(`${evidence.metadata.ok}`);
    expect(seed).toContain(`${evidence.metadata.httpUnreachable}`);
    expect(seed).toContain(`${evidence.metadata.other}`);
    expect(seed).toContain(`${evidence.candidates.declaredEndpoints}`);
    expect(seed).toContain(`${evidence.candidates.publicHttpsEndpoints}`);
    expect(seed.match(/INSERT INTO funnel_snapshots/g)).toHaveLength(1);
  });
});
