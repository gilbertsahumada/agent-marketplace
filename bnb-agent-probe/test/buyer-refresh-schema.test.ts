import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { probeObservations } from "../src/db/schema";

const migration = readFileSync(fileURLToPath(
  new URL("../migrations/0005_buyer_refresh_atomic_dedupe.sql", import.meta.url),
), "utf8");

describe("buyer refresh observation schema", () => {
  it("preserves provenance and atomically deduplicates only buyer refresh observations", () => {
    expect(getTableColumns(probeObservations)).toHaveProperty("source");
    expect(migration).toMatch(/ADD COLUMN source TEXT/);
    expect(migration).toContain("source IS NULL OR source = 'buyer_refresh'");
    expect(migration).toMatch(/CREATE UNIQUE INDEX idx_obs_buyer_refresh_negotiation/);
    expect(migration).toContain("WHERE source = 'buyer_refresh' AND negotiationHash IS NOT NULL");
  });
});
