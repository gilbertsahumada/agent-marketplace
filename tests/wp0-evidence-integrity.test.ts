import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeSourceSha256 } from "../src/trust8004/funnel-snapshot.ts";

const root = resolve(import.meta.dirname, "..");
const evidencePath = resolve(root, "evidence/funnel-bsc-2026-08-27T19-41-17Z.json");
const snapshot = JSON.parse(readFileSync(evidencePath, "utf8")) as {
  sourceSha256: string;
  cutoff: { blockNumber: string };
  scan: { maxPageBytes: number };
};

describe("committed WP0 evidence", () => {
  it("preserves the canonical artifact and its measured maximum page", () => {
    expect(computeSourceSha256(snapshot)).toBe(snapshot.sourceSha256);
    expect(snapshot.sourceSha256).toBe(
      "a8149173eeb70fb19a38610e98e4e11ecbce7ccadcfc2c0e6e25fa14a075fe69",
    );
    expect(snapshot.cutoff.blockNumber).toBe("118441354");
    expect(snapshot.scan.maxPageBytes).toBe(7_056_330);
    expect(snapshot.scan.maxPageBytes).toBeLessThan(16 * 1_024 * 1_024);
  });

  it("keeps the seed migration linked to that artifact", () => {
    const migration = readFileSync(
      resolve(root, "bnb-agent-probe/migrations/0002_seed_funnel_snapshot.sql"),
      "utf8",
    );

    expect(migration).toContain("evidence/funnel-bsc-2026-08-27T19-41-17Z.json");
    expect(migration).toContain(snapshot.sourceSha256);
    expect(migration).toContain(`'${snapshot.cutoff.blockNumber}'`);
  });
});
