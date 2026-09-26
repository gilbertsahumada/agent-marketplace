import { getTableColumns, sql } from "drizzle-orm";
import { SQLiteD1Session } from "drizzle-orm/d1";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type { D1Database } from "../types";
import type { D1DatabaseLike } from "../db/client";
import { createDatabase, type CatalogObservationRow } from "../db/orm";
import { catalogPublicAgentMetrics, catalogPublicEndpointEvidence } from "../db/schema";
import { agentMetricsSelect, agentMetricsUpsert, endpointProjectionSelect, endpointProjectionUpsert } from "./public-projection-sql";

export type PublicEndpointEvidence = typeof catalogPublicEndpointEvidence.$inferSelect;
export type PublicAgentMetrics = typeof catalogPublicAgentMetrics.$inferSelect;
export const PUBLIC_PROJECTION_CURSOR_KEY = "catalog_public_projection_backfill_v1";

export interface PublicProjectionCursor {
  version: 1;
  phase: "evidence" | "metrics" | "verify_evidence" | "verify_metrics" | "complete";
  agentKey: string;
  endpointScope: string;
}

// Only internal SQL templates reach this boundary. Cursor, key and timestamp
// values are Drizzle parameters, never interpolated SQL identifiers or literals.
function query(template: string, values: readonly unknown[] = []) {
  const parts = template.split("?");
  if (parts.length !== values.length + 1) throw new Error("Public projection SQL binding mismatch");
  return sql.join(parts.flatMap((part, index) => index < values.length
    ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql``);
}

function database(d1: D1Database) {
  const db = createDatabase(d1 as unknown as D1DatabaseLike);
  const dialect = new SQLiteAsyncDialect();
  const session = new SQLiteD1Session(d1 as ConstructorParameters<typeof SQLiteD1Session>[0], dialect, undefined);
  return {
    all: <T>(template: string, values: readonly unknown[] = []) => db.all<T>(query(template, values)),
    first: async <T>(template: string, values: readonly unknown[] = []) =>
      (await db.all<T>(query(template, values)))[0] ?? null,
    statement: (template: string, values: readonly unknown[] = []) => {
      const statement = query(template, values);
      const runnable = db.run(statement);
      // Drizzle 0.45.2 SQLiteRaw lacks the prepared statement required by the
      // D1 batch implementation when parameters are present. Compile through
      // its exported D1 session, preserving binding, atomicity and D1 metadata.
      runnable._prepare = () => session.prepareQuery(dialect.sqlToQuery(statement), undefined, "run", false);
      return runnable;
    },
    batch: (statements: ReturnType<typeof db.run>[]) => {
      if (!statements.length) throw new Error("Public projection transaction cannot be empty");
      return db.batch(statements as [ReturnType<typeof db.run>, ...ReturnType<typeof db.run>[]]);
    },
  };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}

function pageKeys(values: readonly string[]): string[] {
  const keys = [...new Set(values)];
  if (keys.length > 60) throw new RangeError("public projection read accepts at most 60 agents");
  return keys;
}

const placeholders = (values: readonly unknown[]) => values.map(() => "?").join(",");

/** Sparse historical facts only. Join current declarations, capabilities and
 * endpoint policy at read time; missing rows mean no historical evidence. */
export async function readPublicEndpointEvidence(d1: D1Database, agents: readonly string[]): Promise<PublicEndpointEvidence[]> {
  const keys = pageKeys(agents);
  if (!keys.length) return [];
  return database(d1).all<PublicEndpointEvidence>(`SELECT * FROM catalog_public_endpoint_evidence
    WHERE agentKey IN (${placeholders(keys)}) AND projectionVersion=1 ORDER BY agentKey,endpointScope`, keys);
}

export async function readPublicAgentMetrics(d1: D1Database, agents: readonly string[]): Promise<PublicAgentMetrics[]> {
  const keys = pageKeys(agents);
  if (!keys.length) return [];
  return database(d1).all<PublicAgentMetrics>(`SELECT * FROM catalog_public_agent_metrics
    WHERE agentKey IN (${placeholders(keys)}) AND projectionVersion=1 ORDER BY agentKey`, keys);
}

/** Fetch authoritative payloads by primary key; callers keep using the current
 * public serializer. A capability probe remains in the latest quote slot. */
export async function readPublicProjectedObservations(
  d1: D1Database, agents: readonly string[], family: "platform" | "browser" | "agent",
  endpointKeys?: readonly string[],
): Promise<CatalogObservationRow[]> {
  const keys = pageKeys(agents);
  const endpoints = endpointKeys === undefined ? undefined : [...new Set(endpointKeys)];
  if ((endpoints?.length ?? 0) > 1200) throw new RangeError("public observation read accepts at most 1200 endpoints");
  if (!keys.length || endpoints?.length === 0) return [];
  const slots = family === "platform" ? "p.latestPlatformId,p.latestPlatformSuccessId"
    : family === "browser" ? "p.browserReachabilityId,p.browserProtocolId,p.browserQuoteId,p.browserChainId"
      : "p.latestQuoteId,p.latestChainId";
  const result = new Map<number, CatalogObservationRow>();
  for (const endpointChunk of endpoints === undefined ? [undefined] : chunks(endpoints, 40)) {
    const rows = await database(d1).all<CatalogObservationRow>(`SELECT DISTINCT o.* FROM catalog_public_endpoint_evidence p
      CROSS JOIN catalog_observations o
      WHERE p.agentKey IN (${placeholders(keys)}) AND p.projectionVersion=1
        ${endpointChunk === undefined ? "" : `AND p.endpointScope IN (${placeholders(endpointChunk)})`}
        AND o.id IN (${slots}) ORDER BY o.observedAt DESC,o.id DESC`, [...keys, ...(endpointChunk ?? [])]);
    for (const row of rows) result.set(row.id, row);
  }
  return [...result.values()].sort((a, b) => b.observedAt - a.observedAt || b.id - a.id);
}

function parseCursor(text: string): PublicProjectionCursor {
  const cursor = JSON.parse(text) as Partial<PublicProjectionCursor>;
  if (cursor.version !== 1 || !["evidence", "metrics", "verify_evidence", "verify_metrics", "complete"].includes(cursor.phase ?? "")
    || typeof cursor.agentKey !== "string" || typeof cursor.endpointScope !== "string") {
    throw new Error("Invalid public projection coverage cursor");
  }
  return cursor as PublicProjectionCursor;
}

export async function readPublicProjectionCoverage(d1: D1Database): Promise<PublicProjectionCursor | null> {
  const row = await database(d1).first<{ textValue: string | null }>("SELECT textValue FROM runtime_state WHERE key=?", [PUBLIC_PROJECTION_CURSOR_KEY]);
  if (!row?.textValue) return null;
  return parseCursor(row.textValue);
}

/** Complete means both bounded source-versus-projection validation passes ran.
 * Readers must stay on the existing source path until this returns true. */
export async function publicProjectionsReady(d1: D1Database): Promise<boolean> {
  try { return (await readPublicProjectionCoverage(d1))?.phase === "complete"; }
  catch { return false; }
}

const evidencePage = `SELECT agentKey,COALESCE(endpointKey,'') AS endpointScope
  FROM catalog_observations WHERE (agentKey,COALESCE(endpointKey,''))>(?,?)
  GROUP BY agentKey,COALESCE(endpointKey,'') ORDER BY agentKey,COALESCE(endpointKey,'') LIMIT ?`;
// The source CHECK permits precisely networks 56 and 97. Seek their existing
// (chainId,agentId) index separately instead of building a second history index
// merely to sort the public string key during this one-time backfill.
function metricsKeyPage(after: string, size: number): { sql: string; values: unknown[] } {
  const values: unknown[] = [after, size];
  const hirePages = [56,97].map(chain => {
    const prefix = `eip155:${chain}:`;
    const enabled = after.startsWith(prefix) || after < prefix;
    values.push(enabled ? 1 : 0, after.startsWith(prefix) ? after.slice(prefix.length) : "", size);
    return `UNION SELECT agentKey FROM (SELECT '${prefix}'||agentId AS agentKey
      FROM hire_events INDEXED BY idx_hire_agent WHERE chainId=${chain} AND ?=1 AND agentId>?
        AND provenance='chain_verified' GROUP BY agentId ORDER BY agentId LIMIT ?)`;
  }).join("\n");
  values.push(after, size, size);
  return { sql: `SELECT agentKey FROM (SELECT DISTINCT agentKey FROM catalog_quote_requests
      WHERE agentKey>? AND kind='buyer_quote' AND callerKey<>'migration' ORDER BY agentKey LIMIT ?)
    ${hirePages}
    UNION SELECT agentKey FROM (SELECT agentKey FROM catalog_public_agent_metrics WHERE agentKey>? ORDER BY agentKey LIMIT ?)
    ORDER BY agentKey LIMIT ?`, values };
}

/** Compare every projected fact, including missing/orphan rows; mutation marker
 * is internal insert bookkeeping, not public evidence. Explicit CTE columns make
 * the comparison independent of SELECT expression names. */
function equivalenceSql(family: "evidence" | "metrics", size: number): string {
  const evidence = family === "evidence";
  const columns = Object.keys(getTableColumns(evidence ? catalogPublicEndpointEvidence : catalogPublicAgentMetrics));
  const table = evidence ? "catalog_public_endpoint_evidence" : "catalog_public_agent_metrics";
  const keyColumns = evidence ? "agentKey,endpointScope" : "agentKey";
  const tuples = Array.from({ length: size }, () => evidence ? "(?,?)" : "(?)").join(",");
  const expected = evidence ? endpointProjectionSelect("SELECT * FROM keys") : agentMetricsSelect("SELECT * FROM keys");
  const join = (alias: string) => `${alias}.agentKey=k.agentKey${evidence ? ` AND ${alias}.endpointScope=k.endpointScope` : ""}`;
  const mismatch = columns.filter(column => column !== "lastObservationMutationId")
    .map(column => `e.${column} IS NOT p.${column}`).join(" OR ");
  return `WITH keys(${keyColumns}) AS (VALUES ${tuples}),expected(${columns.join(",")}) AS (${expected})
    SELECT COUNT(*) AS mismatches FROM keys k LEFT JOIN expected e ON ${join("e")}
    LEFT JOIN ${table} p ON ${join("p")} WHERE ${mismatch}`;
}

/** One bounded, resumable transaction. Absolute reconstruction and checkpoint
 * commit together. Verification also rechecks equivalence atomically with its
 * checkpoint. Competing runners cannot regress progress. Never called by HTTP. */
export async function backfillPublicProjections(
  d1: D1Database, options: { batchSize?: number; nowMs: number },
): Promise<{ cursor: PublicProjectionCursor; processed: number | null; applied: boolean | null }> {
  const size = options.batchSize ?? 20;
  if (!Number.isInteger(size) || size < 1 || size > 40) throw new RangeError("batchSize must be 1..40");
  if (!Number.isSafeInteger(options.nowMs) || options.nowMs < 0) throw new RangeError("nowMs must be a nonnegative safe integer");
  if (!d1.batch) throw new Error("Atomic D1 batch support is required for public projection backfill");
  const db = database(d1);
  const current = await db.first<{ textValue: string | null }>("SELECT textValue FROM runtime_state WHERE key=?", [PUBLIC_PROJECTION_CURSOR_KEY]);
  if (!current?.textValue) throw new Error("Public projection migration/cursor is missing");
  const cursor = parseCursor(current.textValue);
  if (cursor.phase === "complete") return { cursor, processed: 0, applied: false };
  const guard = `EXISTS (SELECT 1 FROM runtime_state WHERE key='${PUBLIC_PROJECTION_CURSOR_KEY}' AND textValue=?)`;
  const statements = [];
  const verifying = cursor.phase.startsWith("verify_");
  const evidence = cursor.phase === "evidence" || cursor.phase === "verify_evidence";
  let count = 0;
  let next: PublicProjectionCursor;
  let validation: { sql: string; values: string[] } | undefined;
  if (evidence) {
    const keys = await db.all<{ agentKey: string; endpointScope: string }>(verifying
      ? `SELECT agentKey,endpointScope FROM (${evidencePage})
        UNION SELECT agentKey,endpointScope FROM (SELECT agentKey,endpointScope FROM catalog_public_endpoint_evidence
          WHERE (agentKey,endpointScope)>(?,?) ORDER BY agentKey,endpointScope LIMIT ?)
        ORDER BY agentKey,endpointScope LIMIT ?`
      : evidencePage, verifying
        ? [cursor.agentKey, cursor.endpointScope, size, cursor.agentKey, cursor.endpointScope, size, size]
        : [cursor.agentKey, cursor.endpointScope, size]);
    count = keys.length;
    if (keys.length) {
      const bindings = keys.flatMap(key => [key.agentKey, key.endpointScope]);
      if (verifying) validation = { sql: equivalenceSql("evidence", count), values: bindings };
      else {
        const selected = `SELECT column1 AS agentKey,column2 AS endpointScope FROM (VALUES ${keys.map(() => "(?,?)").join(",")})`;
        statements.push(db.statement(`DELETE FROM catalog_public_endpoint_evidence
          WHERE (agentKey,endpointScope) IN (${keys.map(() => "(?,?)").join(",")}) AND ${guard}
            AND NOT EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=catalog_public_endpoint_evidence.agentKey
              AND COALESCE(o.endpointKey,'')=catalog_public_endpoint_evidence.endpointScope)`, [...bindings, current.textValue]));
        statements.push(db.statement(endpointProjectionUpsert(selected, guard), [...bindings, current.textValue]));
      }
      next = { version: 1, phase: cursor.phase, ...keys[keys.length - 1]! };
    } else next = { version: 1, phase: verifying ? "verify_metrics" : "metrics", agentKey: "", endpointScope: "" };
  } else {
    const page = metricsKeyPage(cursor.agentKey, size);
    const keys = await db.all<{ agentKey: string }>(page.sql, page.values);
    count = keys.length;
    if (keys.length) {
      const bindings = keys.map(key => key.agentKey);
      if (verifying) validation = { sql: equivalenceSql("metrics", count), values: bindings };
      else {
        const selected = `SELECT column1 AS agentKey FROM (VALUES ${keys.map(() => "(?)").join(",")})`;
        statements.push(db.statement(agentMetricsUpsert(selected, guard), [...bindings, current.textValue]));
      }
      next = { version: 1, phase: cursor.phase, agentKey: keys[keys.length - 1]!.agentKey, endpointScope: "" };
    } else next = { version: 1, phase: verifying ? "complete" : "verify_evidence", agentKey: "", endpointScope: "" };
  }
  if (validation) {
    const check = await db.first<{ mismatches: number }>(validation.sql, validation.values);
    if (check?.mismatches !== 0) throw new Error("Public projection source equivalence validation failed; cursor unchanged");
  }
  statements.push(db.statement(`UPDATE runtime_state SET textValue=?,updatedAt=? WHERE key=? AND textValue=?
    ${validation ? `AND NOT EXISTS (SELECT 1 FROM (${validation.sql}) WHERE mismatches<>0)` : ""}`,
    [JSON.stringify(next), options.nowMs, PUBLIC_PROJECTION_CURSOR_KEY, current.textValue, ...(validation?.values ?? [])]));
  const results = await db.batch(statements);
  const changes = (results[results.length - 1] as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  const applied = typeof changes === "number" ? changes === 1 : null;
  const coverage = await readPublicProjectionCoverage(d1);
  if (!coverage) throw new Error("Public projection cursor disappeared after atomic batch");
  return { cursor: coverage, processed: applied === null ? null : applied ? count : 0, applied };
}
