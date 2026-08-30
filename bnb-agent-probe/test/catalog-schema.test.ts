import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  catalogAgents,
  catalogAgentEndpoints,
  catalogEndpoints,
  catalogObservations,
} from "../src/db/schema";

const migration = readFileSync(
  new URL("../migrations/0006_catalog_index.sql", import.meta.url),
  "utf8",
);
const observationBridgeMigration = readFileSync(
  new URL("../migrations/0007_bridge_probe_observations.sql", import.meta.url),
  "utf8",
);

describe("catalog index schema", () => {
  it("models identity, declaration and append-only observation facts separately", () => {
    expect([...migration.matchAll(/CREATE TABLE\s+(\w+)/g)].map((entry) => entry[1])).toEqual([
      "catalog_agents",
      "catalog_endpoints",
      "catalog_agent_endpoints",
      "catalog_observations",
    ]);
    for (const table of [catalogAgents, catalogEndpoints, catalogAgentEndpoints, catalogObservations]) {
      const name = getTableName(table);
      const migrationTable = migration.match(new RegExp(`CREATE TABLE ${name} \\(([\\s\\S]*?)\\n\\);`))?.[1];
      expect(migrationTable, `missing migration table ${name}`).toBeDefined();
      for (const column of Object.values(getTableColumns(table))) {
        expect(migrationTable).toMatch(new RegExp(`(^|\\n)\\s*${column.name}\\s`, "m"));
      }
    }
  });

  it("keeps transport, commerce, provenance and outcomes distinct", () => {
    expect(migration).toContain("'a2a', 'mcp', 'web', 'erc8183_http'");
    expect(migration).toContain("'a2a', 'mcp', 'web', 'erc8183_http', 'erc8183'");
    expect(migration).toContain("'browser_reported', 'marketplace_probe', 'worker_probe', 'chain_index'");
    expect(migration).toContain("'cors_blocked'");
    expect(migration).toContain("'quote_verified'");
  });

  it("exposes no update or delete path for catalog observations", () => {
    expect(migration).not.toMatch(/UPDATE\s+catalog_observations|DELETE\s+FROM\s+catalog_observations/i);
  });

  it("backfills and continuously mirrors marketplace probe evidence append-only", () => {
    expect(observationBridgeMigration).toMatch(/INSERT INTO catalog_observations/i);
    expect(observationBridgeMigration).toMatch(/AFTER INSERT ON probe_observations/i);
    expect(observationBridgeMigration).not.toMatch(/UPDATE\s+catalog_observations|DELETE\s+FROM\s+catalog_observations/i);
  });
});
