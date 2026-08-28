import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";

import { schedulerAttempts } from "../src/db/schema";

const migration = readFileSync(fileURLToPath(
  new URL("../migrations/0003_scheduler_attempts.sql", import.meta.url),
), "utf8");

describe("scheduler attempt audit schema", () => {
  it("matches the Drizzle columns and bounds delivery attempts", () => {
    expect(getTableName(schedulerAttempts)).toBe("scheduler_attempts");
    const columns = Object.values(getTableColumns(schedulerAttempts)).map(({ name }) => name);
    for (const column of columns) {
      expect(migration).toMatch(new RegExp(`(^|\\n)\\s*${column}\\s`, "m"));
    }
    expect(migration).toContain("attempt BETWEEN 1 AND 4");
    expect(migration).toContain("d1Queries BETWEEN 1 AND 40");
  });

  it("makes the evidence ledger append-only and window-indexed", () => {
    expect(migration).toContain("CREATE INDEX idx_scheduler_attempts_window");
    expect(migration).toContain("CREATE TRIGGER scheduler_attempts_no_update");
    expect(migration).toContain("CREATE TRIGGER scheduler_attempts_no_delete");
    expect(migration).toContain("scheduler_attempts is append-only");
  });
});
