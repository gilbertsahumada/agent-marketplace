import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Column, getTableColumns, getTableName, is, SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { commerceJobEvents, commerceJobs } from "../src/db/schema";

const migrationsDir = new URL("../migrations/", import.meta.url);
const migration = readFileSync(new URL("0022_commerce_index.sql", migrationsDir), "utf8");

// The whole migration chain applied to an in-memory SQLite, so index shape is
// asserted on what the engine built rather than on the SQL text alone.
function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const entry of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(entry, migrationsDir), "utf8"));
  }
  return db;
}

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

  it("orders the status index by chain, status, then newest job so the status list is a range scan", () => {
    const db = migratedDatabase();
    const columns = db.prepare("PRAGMA index_info(idx_commerce_jobs_status)").all() as Array<{ seqno: number; name: string }>;
    expect(columns.map((column) => column.name)).toEqual(["chainId", "status", "jobId"]);
    const created = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("idx_commerce_jobs_status") as { sql: string };
    expect(created.sql.replaceAll(/\s+/g, " ")).toBe("CREATE INDEX idx_commerce_jobs_status ON commerce_jobs (chainId, status, jobId DESC)");
    db.close();

    // `desc(column)` is an SQL fragment in the Drizzle model; read the column it wraps.
    const columnName = (column: unknown): string | undefined => (is(column, Column)
      ? column.name
      : is(column, SQL) ? column.queryChunks.find((chunk): chunk is Column => is(chunk, Column))?.name : undefined);
    const model = getTableConfig(commerceJobs).indexes.find((index) => index.config.name === "idx_commerce_jobs_status");
    expect(model?.config.columns.map(columnName)).toEqual(["chainId", "status", "jobId"]);
    expect(is(model?.config.columns[2], SQL)).toBe(true);
  });

  it("documents the rollback order for the deployer: triggers, then indexes, then tables", () => {
    const header = migration.slice(0, migration.indexOf("CREATE TABLE"));
    expect(header).toMatch(/[Rr]ollback/);
    expect(header.indexOf("TRIGGER")).toBeGreaterThan(-1);
    expect(header.indexOf("TRIGGER")).toBeLessThan(header.indexOf("INDEX"));
    expect(header.indexOf("INDEX")).toBeLessThan(header.indexOf("TABLE"));
  });

  it("makes the event ledger append-only", () => {
    expect(migration).toMatch(/CREATE TRIGGER commerce_job_events_no_update/);
    expect(migration).toMatch(/CREATE TRIGGER commerce_job_events_no_delete/);
    expect(migration).not.toMatch(/CREATE TRIGGER commerce_jobs/);
  });
});
