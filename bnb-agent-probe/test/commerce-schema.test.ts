import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { commerceJobEvents, commerceJobs } from "../src/db/schema";

const migration = readFileSync(new URL("../migrations/0022_commerce_index.sql", import.meta.url), "utf8");

describe("Commerce index schema", () => {
  it("keeps the Drizzle model reconciled with migration 0022", () => {
    for (const table of [commerceJobs, commerceJobEvents]) {
      const tableName = getTableName(table);
      const migrationTable = migration.match(new RegExp(`CREATE TABLE ${tableName} \\(([\\s\\S]*?)\\n\\);`))?.[1];
      expect(migrationTable, `missing migration table ${tableName}`).toBeDefined();
      for (const column of Object.values(getTableColumns(table)).map((entry) => entry.name)) {
        expect(new RegExp(`(^|\\n)\\s*${column}\\s`, "m").test(migrationTable!), `${tableName}.${column}`).toBe(true);
      }
    }
  });

  it("keys jobs by chain and numeric id, dedupes events by log and joins hire_events by job", () => {
    expect(migration).toContain("PRIMARY KEY (chainId, jobId)");
    expect(migration).toContain("jobId        INTEGER NOT NULL CHECK (jobId >= 0)");
    expect(migration).toContain("UNIQUE (chainId, txHash, logIndex)");
    expect(migration).toContain("CREATE INDEX idx_hire_events_job");
    expect(migration).toContain("ON hire_events (chainId, jobId)");
    expect(migration).toContain("CHECK (phase IN ('created', 'funded', 'submitted', 'settled', 'refunded'))");
  });

  it("makes the event ledger append-only", () => {
    expect(migration).toMatch(/CREATE TRIGGER commerce_job_events_no_update/);
    expect(migration).toMatch(/CREATE TRIGGER commerce_job_events_no_delete/);
    expect(migration).not.toMatch(/CREATE TRIGGER commerce_jobs_no_(update|delete)/);
  });
});
