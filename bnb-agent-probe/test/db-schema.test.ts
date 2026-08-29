import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  funnelSnapshots,
  hireEvents,
  probeObservations,
  probeTargets,
  runtimeState,
} from "../src/db/schema";

const migrationPath = fileURLToPath(
  new URL("../migrations/0001_initial.sql", import.meta.url),
);
const migration = readFileSync(migrationPath, "utf8");

describe("D1 schema", () => {
  it("creates exactly the five normative tables", () => {
    const tables = [...migration.matchAll(/CREATE TABLE\s+(\w+)/g)].map((match) => match[1]);

    expect(tables).toEqual([
      "probe_targets",
      "probe_observations",
      "funnel_snapshots",
      "hire_events",
      "runtime_state",
    ]);
  });

  it("creates every required query index", () => {
    const indexes = [...migration.matchAll(/CREATE INDEX\s+(\w+)/g)].map((match) => match[1]);

    expect(indexes).toEqual([
      "idx_targets_probe",
      "idx_obs_agent",
      "idx_obs_target",
      "idx_obs_target_category",
      "idx_hire_agent",
    ]);
  });

  it("keeps the Drizzle table and column model reconciled with the migration", () => {
    const drizzleTables = [
      probeTargets,
      probeObservations,
      funnelSnapshots,
      hireEvents,
      runtimeState,
    ];

    for (const table of drizzleTables) {
      const tableName = getTableName(table);
      const migrationTable = migration.match(
        new RegExp(`CREATE TABLE ${tableName} \\(([\\s\\S]*?)\\n\\);`),
      )?.[1];
      expect(migrationTable, `missing migration table ${tableName}`).toBeDefined();

      const drizzleColumns = Object.values(getTableColumns(table)).map((column) => column.name);
      for (const column of drizzleColumns) {
        expect(migrationTable, `${tableName}.${column} is absent from migration`).toMatch(
          new RegExp(`(^|\\n)\\s*${column}\\s`, "m"),
        );
      }
    }
  });

  it("keeps BSC and enum constraints in the database", () => {
    expect(migration.match(/CHECK \(chainId = 56\)/g)).toHaveLength(3);
    expect(migration).toContain("'a2a', 'erc8183_http'");
    expect(migration).not.toContain("'candidate_unverified'");
    expect(migration).toContain("eventKey         TEXT NOT NULL UNIQUE");
  });

  it("does not add mutation triggers or lifecycle columns to append-only tables", () => {
    expect(migration).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(migration).not.toMatch(/lastProbedAt/i);
  });

  it("exposes no UPDATE or DELETE path for append-only tables", () => {
    const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
    const sourceFiles: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = resolve(directory, entry);
        if (statSync(path).isDirectory()) visit(path);
        else if (path.endsWith(".ts")) sourceFiles.push(path);
      }
    };
    visit(sourceRoot);
    const applicationSource = sourceFiles
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    for (const table of ["probe_observations", "funnel_snapshots", "hire_events"]) {
      expect(applicationSource).not.toMatch(new RegExp(`(?:UPDATE|DELETE\\s+FROM)\\s+${table}`, "i"));
    }
  });
});
