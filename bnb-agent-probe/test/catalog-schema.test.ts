import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  catalogAgents,
  catalogAgentAdmission,
  catalogAgentEndpoints,
  catalogEndpoints,
  catalogDirectedTracking,
  catalogIngestTasks,
  catalogObservations,
  catalogValidationRequests,
} from "../src/db/schema";

const migration = readFileSync(
  new URL("../migrations/0006_catalog_index.sql", import.meta.url),
  "utf8",
);
const observationBridgeMigration = readFileSync(
  new URL("../migrations/0007_bridge_probe_observations.sql", import.meta.url),
  "utf8",
);
const normalizationMigration = readFileSync(
  new URL("../migrations/0008_catalog_resource_roles_and_validation_jobs.sql", import.meta.url),
  "utf8",
);
const endpointLeaseMigration = readFileSync(
  new URL("../migrations/0012_catalog_endpoint_leases.sql", import.meta.url),
  "utf8",
);
const observationSourceMigration = readFileSync(
  new URL("../migrations/0013_catalog_observation_sources.sql", import.meta.url),
  "utf8",
);
const identityMigration = readFileSync(
  new URL("../migrations/0014_catalog_agent_identity.sql", import.meta.url),
  "utf8",
);
const validationDedupeMigration = readFileSync(
  new URL("../migrations/0015_agent_scoped_validation_dedupe.sql", import.meta.url),
  "utf8",
);
const quoteArtifactDedupeMigration = readFileSync(
  new URL("../migrations/0016_scoped_quote_artifact_dedupe.sql", import.meta.url),
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
        const declaredInBase = new RegExp(`(^|\\n)\\s*${column.name}\\s`, "m").test(migrationTable!);
        const addedLater = new RegExp(`ALTER TABLE ${name} ADD COLUMN ${column.name}\\s`, "m").test(normalizationMigration);
        const addedForLeases = new RegExp(`ALTER TABLE ${name} ADD COLUMN ${column.name}\\s`, "m").test(endpointLeaseMigration);
        const addedForIdentity = new RegExp(`ALTER TABLE ${name} ADD COLUMN ${column.name}\\s`, "m").test(identityMigration);
        expect(declaredInBase || addedLater || addedForLeases || addedForIdentity, `missing migration column ${name}.${column.name}`).toBe(true);
      }
    }
  });

  it("adds normalized resources, append-only evidence, validation work and commerce admission", () => {
    for (const table of [catalogValidationRequests, catalogAgentAdmission]) {
      const name = getTableName(table);
      const migrationTable = normalizationMigration.match(new RegExp(`CREATE TABLE ${name} \\(([\\s\\S]*?)\\n\\);`))?.[1];
      expect(migrationTable, `missing migration table ${name}`).toBeDefined();
      for (const column of Object.values(getTableColumns(table))) {
        expect(migrationTable).toMatch(new RegExp(`(^|\\n)\\s*${column.name}\\s`, "m"));
      }
    }
    expect(normalizationMigration).toContain("idx_catalog_validation_requests_active");
    expect(normalizationMigration).toContain("idx_catalog_observations_quote_artifact");
    expect(normalizationMigration).toContain("catalog_observations_no_update");
    expect(normalizationMigration).toContain("catalog_observations_no_delete");
    expect(normalizationMigration).toContain("legacy_backfill");
  });

  it("adds a bounded resumable catalog ingest worklist", () => {
    const ingestMigration = readFileSync(
      new URL("../migrations/0009_catalog_ingest_worklist.sql", import.meta.url),
      "utf8",
    );
    const name = getTableName(catalogIngestTasks);
    const migrationTable = ingestMigration.match(new RegExp(`CREATE TABLE ${name} \\(([\\s\\S]*?)\\n\\);`))?.[1];
    expect(migrationTable).toBeDefined();
    for (const column of Object.values(getTableColumns(catalogIngestTasks))) {
      expect(migrationTable).toMatch(new RegExp(`(^|\\n)\\s*${column.name}\\s`, "m"));
    }
    expect(ingestMigration).toContain("idx_catalog_ingest_tasks_work");
  });

  it("persists resumable directed registration tracking", () => {
    const directedMigration = readFileSync(
      new URL("../migrations/0010_catalog_directed_tracking.sql", import.meta.url),
      "utf8",
    );
    const name = getTableName(catalogDirectedTracking);
    const migrationTable = directedMigration.match(new RegExp(`CREATE TABLE ${name} \\(([\\s\\S]*?)\\n\\);`))?.[1];
    expect(migrationTable).toBeDefined();
    for (const column of Object.values(getTableColumns(catalogDirectedTracking))) {
      expect(migrationTable).toMatch(new RegExp(`(^|\\n)\\s*${column.name}\\s`, "m"));
    }
    expect(directedMigration).toContain("idx_catalog_directed_tracking_status");
  });

  it("keeps transport, commerce, provenance and outcomes distinct", () => {
    expect(migration).toContain("'a2a', 'mcp', 'web', 'erc8183_http'");
    expect(migration).toContain("'a2a', 'mcp', 'web', 'erc8183_http', 'erc8183'");
    expect(observationSourceMigration).toContain("'browser_reported', 'worker_probe', 'buyer_refresh', 'chain_read', 'migration'");
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

  it("migrates legacy validation dedupe keys to the declaring-agent scope", () => {
    expect(validationDedupeMigration).toContain("dedupeKey = agentKey || ':' || endpointKey || ':' || validationKind");
    expect(validationDedupeMigration).toContain("dedupeKey = endpointKey || ':' || validationKind");
  });

  it("scopes signed quote artifact deduplication to the declaring agent and endpoint", () => {
    expect(quoteArtifactDedupeMigration).toContain("DROP INDEX IF EXISTS idx_catalog_observations_quote_artifact");
    expect(quoteArtifactDedupeMigration).toContain(
      "ON catalog_observations (agentKey, endpointKey, artifactHash)",
    );
    expect(quoteArtifactDedupeMigration).toContain("validationKind = 'quote'");
  });
});
