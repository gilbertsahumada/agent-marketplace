import { describe, expect, it, vi } from "vitest";
import { executeWorkerAction, releaseTarget, verifyAppliedMigrations, type ReleaseOperations } from "../scripts/release";

const database = { database_name: "production-db", database_id: "12345678-1234-1234-1234-123456789abc", migrations_dir: "migrations" };
const config = { name: "production-worker", d1_databases: [database], vars: { KILL_SWITCH: "1" },
  env: { staging: { name: "staging-worker", d1_databases: [{ ...database, database_name: "staging-db" }], vars: { KILL_SWITCH: "0" } } } };
const origins = { local: "http://127.0.0.1:8787", staging: "https://staging.example.com", prod: "https://production.example.com" };
const applied = JSON.stringify([{ success: true, results: [{ name: "0001.sql" }] }]);
function operations() {
  const calls: string[] = [];
  const ops: ReleaseOperations = {
    run: vi.fn(async (command, args) => { calls.push(`${command} ${args.join(" ")}`); return applied; }),
    backupPath: vi.fn(async () => { calls.push("backupPath"); return "/private/tmp/backup.sql"; }),
    verifyBackup: vi.fn(async () => { calls.push("verifyBackup"); }),
    local: vi.fn(async () => { calls.push("local"); }),
    health: vi.fn(async () => { calls.push("health"); }),
  };
  return { ops, calls };
}
describe("Worker release", () => {
  it("uses explicit staging bindings and the top-level production environment", () => {
    expect(releaseTarget(config, "staging", origins)).toMatchObject({ database: "staging-db", name: "staging-worker", envArgs: ["--env", "staging"] });
    expect(releaseTarget(config, "prod", origins)).toMatchObject({ database: "production-db", envArgs: ["--env", ""] });
  });
  it("refuses placeholder remote IDs while permitting isolated local development", () => {
    const raw = { ...config, d1_databases: [{ ...database, database_id: "00000000-0000-0000-0000-000000000000" }] };
    expect(() => releaseTarget(raw, "prod", origins)).toThrow(/placeholder/);
    expect(releaseTarget(raw, "local", origins).environment).toBe("local");
  });
  it("fails closed for missing staging bindings, unknown environments and unsafe origins", () => {
    expect(() => releaseTarget({ ...config, env: {} }, "staging", origins)).toThrow();
    expect(() => releaseTarget(config, "production", origins)).toThrow();
    expect(() => releaseTarget(config, "prod", { ...origins, prod: "http://localhost" })).toThrow();
    expect(() => releaseTarget(config, "local", { ...origins, local: "https://production.example.com" })).toThrow();
    expect(() => releaseTarget(config, "prod", { ...origins, prod: null })).toThrow();
  });
  it("verifies actual migration records, not CLI success text", () => {
    expect(() => verifyAppliedMigrations(applied, ["0001.sql"])).not.toThrow();
    expect(() => verifyAppliedMigrations(applied, ["0001.sql", "0002.sql"])).toThrow(/0002.sql/);
    for (const response of ["cancelled", "[]", '{}', '[{"results":[],"success":false}]']) {
      expect(() => verifyAppliedMigrations(response, ["0001.sql"])).toThrow();
    }
  });
  it("builds, backs up, migrates, verifies and then deploys staging in order", async () => {
    const { ops, calls } = operations();
    await executeWorkerAction("release", releaseTarget(config, "staging", origins), ["0001.sql"], ops);
    expect(calls).toEqual([
      "npm run typecheck", "npm run manifest:check", "wrangler deploy --dry-run --env staging", "backupPath",
      "wrangler d1 export staging-db --remote --env staging --output /private/tmp/backup.sql", "verifyBackup",
      "wrangler d1 migrations apply staging-db --remote --env staging",
      'wrangler d1 execute staging-db --remote --env staging --command SELECT name FROM "d1_migrations" ORDER BY name --json',
      "wrangler deploy --keep-vars --env staging", "health",
    ]);
  });
  it("starts locally without mutating the local database", async () => {
    const { ops, calls } = operations();
    await executeWorkerAction("start", releaseTarget(config, "local", origins), ["0001.sql"], ops);
    expect(calls).toEqual(["local"]);
    expect(ops.backupPath).not.toHaveBeenCalled();
  });
  it("migrates without building or deploying", async () => {
    const { ops, calls } = operations();
    await executeWorkerAction("migrate", releaseTarget(config, "staging", origins), ["0001.sql"], ops);
    expect(calls).toEqual([
      "backupPath", "wrangler d1 export staging-db --remote --env staging --output /private/tmp/backup.sql", "verifyBackup",
      "wrangler d1 migrations apply staging-db --remote --env staging",
      'wrangler d1 execute staging-db --remote --env staging --command SELECT name FROM "d1_migrations" ORDER BY name --json',
    ]);
  });
  it("deploys only after confirming every migration is already applied", async () => {
    const { ops, calls } = operations();
    await executeWorkerAction("deploy", releaseTarget(config, "staging", origins), ["0001.sql"], ops);
    expect(calls).toEqual([
      "npm run typecheck", "npm run manifest:check", "wrangler deploy --dry-run --env staging",
      'wrangler d1 execute staging-db --remote --env staging --command SELECT name FROM "d1_migrations" ORDER BY name --json',
      "wrangler deploy --keep-vars --env staging", "health",
    ]);
    expect(ops.backupPath).not.toHaveBeenCalled();
  });
  it.each(["typecheck", "manifest:check", "--dry-run", "export", "migrations"])("never deploys after failure in %s", async failing => {
    const { ops } = operations();
    ops.run = vi.fn(async (_command, args) => { if (args.includes(failing)) throw new Error("failed"); return applied; });
    await expect(executeWorkerAction("release", releaseTarget(config, "staging", origins), ["0001.sql"], ops)).rejects.toThrow();
    expect(ops.run).not.toHaveBeenCalledWith("wrangler", ["deploy", "--keep-vars", "--env", "staging"]);
    expect(ops.health).not.toHaveBeenCalled();
  });
  it("stops for an invalid backup or missing migration even when Wrangler exits successfully", async () => {
    const first = operations();
    first.ops.verifyBackup = vi.fn().mockRejectedValue(new Error("empty backup"));
    await expect(executeWorkerAction("release", releaseTarget(config, "staging", origins), ["0001.sql"], first.ops)).rejects.toThrow("empty backup");
    expect(first.calls.some(call => call.includes("migrations apply"))).toBe(false);
    const second = operations();
    await expect(executeWorkerAction("release", releaseTarget(config, "staging", origins), ["0002.sql"], second.ops)).rejects.toThrow(/unapplied/);
    expect(second.ops.health).not.toHaveBeenCalled();
  });
});
