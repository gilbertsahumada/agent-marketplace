import { describe, expect, it } from "vitest";
import allowlist from "./fixtures/prepare-allowlist.json";
import { scanPrepareCallsites, type AllowlistEntry } from "./helpers/prepare-scan";

/**
 * Hardened-convention gate (SPEC section 13): runtime data access goes through
 * src/db/orm.ts. Raw `.prepare(` callsites are frozen in the versioned
 * allowlist fixture: a callsite absent from the fixture fails (new raw SQL is
 * prohibited), and a fixture entry with no matching callsite fails (migrated
 * entries must be deleted, so the list only shrinks). Once WP4 migrates the
 * legacy callsites, only the `normative: true` entries remain.
 */

describe("raw .prepare( allowlist gate", () => {
  const entries = allowlist.entries as AllowlistEntry[];
  const actual = scanPrepareCallsites();
  const keyOf = (e: { file: string; function: string; fingerprint: string }) =>
    `${e.file} :: ${e.function} :: ${e.fingerprint}`;

  it("rejects any raw .prepare( callsite that is not frozen in the allowlist", () => {
    const allowed = new Map(entries.map((e) => [keyOf(e), e.count]));
    const violations = actual.filter((c) => allowed.get(keyOf(c)) !== c.count);
    expect(violations, `New or changed raw SQL callsites (use src/db/orm.ts instead):\n${violations.map(keyOf).join("\n")}`).toEqual([]);
  });

  it("requires deleting allowlist entries once their callsites migrate (shrink-only)", () => {
    const present = new Set(actual.map(keyOf));
    const stale = entries.filter((e) => !present.has(keyOf(e)));
    expect(stale, `Allowlist entries whose callsites no longer exist — delete them:\n${stale.map(keyOf).join("\n")}`).toEqual([]);
  });

  it("keeps the normative exemptions confined to the lease and the budget wrapper", () => {
    const normativeFiles = new Set(entries.filter((e) => e.normative).map((e) => e.file));
    expect([...normativeFiles].sort()).toEqual([
      "src/db/query-budget.ts",
      "src/lib/scheduler-lease.ts",
    ]);
  });
});
