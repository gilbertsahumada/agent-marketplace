import { sql } from "drizzle-orm";
import { createDatabase } from "../db/orm";
import type { D1DatabaseLike } from "../db/client";

export const SWEEP_METRICS_KEY = "catalog_sweep_hour";
const fields = ["ticks", "selected", "enqueued", "claimOrSendFailed", "completed", "consumerErrors", "durationMs", "queueWaitMs", "compatible", "providerBlocked", "transientFailure", "quoteSucceeded"] as const;
export type SweepCounters = Partial<Record<typeof fields[number], number>>;

/** Atomic counters for the current UTC hour. Physical executions, not unique agents. */
export async function recordSweepMetrics(binding: D1DatabaseLike, now: number, counters: SweepCounters): Promise<void> {
  const hour = Math.floor(now / 3_600_000) * 3_600_000;
  const initial = Object.fromEntries(fields.map(key => [key, counters[key] ?? 0]));
  const updates = fields.flatMap(key => [sql`${`$.${key}`}`, sql`COALESCE(json_extract(runtime_state.textValue, ${`$.${key}`}), 0) + ${initial[key]}`]);
  await createDatabase(binding).run(sql`
    INSERT INTO runtime_state (key, textValue, integerValue, updatedAt)
    VALUES (${SWEEP_METRICS_KEY}, ${JSON.stringify(initial)}, ${hour}, ${now})
    ON CONFLICT(key) DO UPDATE SET textValue=CASE WHEN runtime_state.integerValue=${hour}
      THEN json_set(runtime_state.textValue, ${sql.join(updates, sql`, `)}) ELSE excluded.textValue END,
      integerValue=${hour}, updatedAt=${now}
    WHERE runtime_state.integerValue <= ${hour}
  `);
}

export function needsProviderChange(code: string): boolean {
  return /PARAMETERS|SCHEMA|REQUIRED_SKILLS|TOOL_REQUIRED|UNSUPPORTED/.test(code) || code === "SELLER_ACCESS_DENIED";
}
