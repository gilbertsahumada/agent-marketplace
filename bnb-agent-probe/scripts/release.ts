import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";
import { buildSmokePlan, normalizeOrigin, runSmoke } from "./smoke";

export type ReleaseEnvironment = "local" | "staging" | "prod";
export type WorkerAction = "start" | "migrate" | "deploy" | "release";
export interface ReleaseTarget {
  environment: ReleaseEnvironment;
  name: string;
  database: string;
  databaseId: string;
  migrationTable: string;
  migrationDir: string;
  origin: string;
  killSwitch: boolean;
  envArgs: string[];
}
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid release configuration");
  return value as JsonObject;
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing release configuration value");
  return value;
};

export function releaseTarget(raw: unknown, environment: string, origins: unknown): ReleaseTarget {
  if (environment !== "local" && environment !== "staging" && environment !== "prod") throw new Error("Choose local, staging or prod");
  const base = object(raw);
  // Production lives at the top level, NOT --env production (which could inherit wrong bindings).
  const config = environment === "staging" ? object(object(base.env).staging) : base;
  const bindings = config.d1_databases;
  if (!Array.isArray(bindings) || bindings.length !== 1) throw new Error("Release supports exactly one explicit D1 binding");
  const database = object(bindings[0]);
  const databaseId = text(database.database_id);
  if (environment !== "local" && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(databaseId))) {
    throw new Error("Remote D1 database_id is missing or a placeholder; configure the real database before releasing");
  }
  const migrationTable = database.migrations_table ?? "d1_migrations";
  if (typeof migrationTable !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(migrationTable)) throw new Error("Unsupported migration table name");
  if (database.migrations_pattern !== undefined) throw new Error("Custom migration patterns need explicit release verification support");
  const origin = normalizeOrigin(text(object(origins)[environment]), "release origin");
  const parsed = new URL(origin);
  if (environment === "local" ? origin !== "http://127.0.0.1:8787" : parsed.protocol !== "https:") throw new Error("Invalid origin for release environment");
  const vars = object(config.vars);
  if (vars.KILL_SWITCH !== "0" && vars.KILL_SWITCH !== "1") throw new Error("KILL_SWITCH must be explicit");
  return { environment, name: text(config.name), database: text(database.database_name), databaseId,
    migrationTable, migrationDir: text(database.migrations_dir ?? "migrations"), origin,
    killSwitch: vars.KILL_SWITCH === "1", envArgs: ["--env", environment === "staging" ? "staging" : ""] };
}

export function verifyAppliedMigrations(stdout: string, expected: readonly string[]): void {
  const payload: unknown = JSON.parse(stdout);
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error("Unexpected D1 migration verification response");
  const result = object(payload[0]);
  if (result.success === false || !Array.isArray(result.results)) throw new Error("Could not verify applied migrations");
  const names = new Set(result.results.map(row => text(object(row).name)));
  const missing = expected.filter(name => !names.has(name));
  if (missing.length) throw new Error(`Deployment stopped: unapplied migrations: ${missing.join(", ")}`);
}

export interface ReleaseOperations {
  run(command: "npm" | "wrangler", args: string[], capture?: boolean): Promise<string>;
  backupPath(): Promise<string>;
  verifyBackup(path: string): Promise<void>;
  local(): Promise<void>;
  health(): Promise<void>;
}

async function verifyMigrations(target: ReleaseTarget, migrations: readonly string[], ops: ReleaseOperations) {
  const scope = target.environment === "local" ? ["--local", "--persist-to", ".wrangler/state"] : ["--remote"];
  const applied = await ops.run("wrangler", ["d1", "execute", target.database, ...scope, ...target.envArgs,
    "--command", `SELECT name FROM "${target.migrationTable}" ORDER BY name`, "--json"], true);
  verifyAppliedMigrations(applied, migrations);
}

async function applyMigrations(target: ReleaseTarget, migrations: readonly string[], ops: ReleaseOperations) {
  if (target.environment !== "local") {
    const backup = await ops.backupPath();
    await ops.run("wrangler", ["d1", "export", target.database, "--remote", ...target.envArgs, "--output", backup]);
    await ops.verifyBackup(backup);
  }
  const scope = target.environment === "local" ? ["--local", "--persist-to", ".wrangler/state"] : ["--remote"];
  await ops.run("wrangler", ["d1", "migrations", "apply", target.database, ...scope, ...target.envArgs]);
  await verifyMigrations(target, migrations, ops);
}

/** Sequential by design: deploy never runs after failed checks, backup or migration verification. */
export async function executeWorkerAction(action: WorkerAction, target: ReleaseTarget, migrations: readonly string[], ops: ReleaseOperations) {
  if (action === "start") return ops.local();
  if (action === "migrate") return applyMigrations(target, migrations, ops);

  await ops.run("npm", ["run", "typecheck"]);
  await ops.run("npm", ["run", "manifest:check"]);
  await ops.run("wrangler", ["deploy", "--dry-run", ...target.envArgs]);
  if (action === "release") await applyMigrations(target, migrations, ops);
  else await verifyMigrations(target, migrations, ops);
  await ops.run("wrangler", ["deploy", "--keep-vars", ...target.envArgs]);
  await ops.health();
}

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = resolve(workerDir, "node_modules/wrangler/bin/wrangler.js");

async function run(command: "npm" | "wrangler", args: string[], capture = false): Promise<string> {
  console.log(`→ ${command} ${args.map(arg => JSON.stringify(arg)).join(" ")}`);
  return new Promise((done, reject) => {
    const child = spawn(command === "wrangler" ? process.execPath : "npm", command === "wrangler" ? [wranglerBin, ...args] : args,
      { cwd: workerDir, shell: false, stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
        // Confirmation is handled once by this wrapper. Never mistake Wrangler's
        // successful exit after a cancelled prompt for an applied migration.
        env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } });
    let stdout = "";
    child.stdout?.on("data", chunk => { stdout += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? done(stdout) : reject(new Error(`${command} failed (${signal ?? code}); release stopped`)));
  });
}

async function health(target: ReleaseTarget, signal = new AbortController().signal) {
  // Reuse the existing smoke check, without requiring the marketplace to be deployed.
  const check = buildSmokePlan(target.origin, target.origin, { expectKillSwitch: target.killSwitch })[0]!;
  let problem = "Worker did not respond";
  for (let attempt = 0; attempt < 10; attempt++) {
    signal.throwIfAborted();
    const result = (await runSmoke([check], (input, init) => fetch(input, { ...init,
      signal: AbortSignal.any(init?.signal ? [signal, init.signal] : [signal]),
    })))[0]!;
    if (!result.problem) { console.log(`✓ Worker health checked: ${check.url}`); return; }
    problem = result.problem;
    await delay(2_000, undefined, { signal });
  }
  throw new Error(`Worker was started/deployed but health verification failed: ${problem}. No automatic rollback was attempted.`);
}

async function local(target: ReleaseTarget) {
  const controller = new AbortController();
  const child = spawn(process.execPath, [wranglerBin, "dev", "--local", "--ip", "127.0.0.1", "--port", "8787",
    "--persist-to", ".wrangler/state", ...target.envArgs], { cwd: workerDir, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  const stop = () => { controller.abort(); child.kill("SIGTERM"); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const exited = new Promise<void>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 || signal === "SIGTERM" || signal === "SIGINT" ? done() : reject(new Error(`Local Worker exited (${code})`)));
  });
  try {
    await Promise.race([health(target, controller.signal), exited.then(() => { throw new Error("Local Worker stopped before readiness"); })]);
    console.log("✓ Local Worker ready. Ctrl+C to stop.");
    await exited;
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    await exited;
  } finally {
    stop();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    plan: { type: "boolean", default: false }, "confirm-production": { type: "boolean", default: false },
  } });
  if (positionals.length !== 2) throw new Error("Usage: release <start|migrate|deploy|release> <local|staging|prod> [--plan] [--confirm-production]");
  const action = positionals[0];
  if (action !== "start" && action !== "migrate" && action !== "deploy" && action !== "release") throw new Error("Choose start, migrate, deploy or release");
  const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", await readFile(resolve(workerDir, "wrangler.jsonc"), "utf8"));
  if (parsed.error) throw new Error("Cannot parse wrangler.jsonc");
  const origins: unknown = JSON.parse(await readFile(resolve(workerDir, "release-origins.json"), "utf8"));
  const target = releaseTarget(parsed.config, positionals[1]!, origins);
  if (action === "start" && target.environment !== "local") throw new Error("start is local-only; use deploy for a remote environment");
  if ((action === "deploy" || action === "release") && target.environment === "local") {
    throw new Error(`${action} requires staging or prod; use start and migrate:local for local development`);
  }
  const migrationDir = resolve(workerDir, target.migrationDir);
  if (migrationDir !== resolve(workerDir, "migrations")) throw new Error("Release expects the versioned migrations directory");
  const migrations = (await readdir(migrationDir)).filter(name => name.endsWith(".sql")).sort();
  if (!migrations.length) throw new Error("No versioned migrations found; check configuration");
  console.log(`Action: ${action} · Target: ${target.environment} · ${target.name} · D1 ${target.database} (${target.databaseId})`);
  if (values.plan) {
    const plans: Record<WorkerAction, string> = {
      start: `start local Worker → health ${target.origin}/health`,
      migrate: `${target.environment === "local" ? "" : "backup → "}apply pending migrations → verify migration records`,
      deploy: `typecheck → manifest check → dry-run build → verify migration records → deploy → health ${target.origin}/health`,
      release: `typecheck → manifest check → dry-run build → backup → apply pending migrations → verify migration records → deploy → health ${target.origin}/health`,
    };
    console.log(`Plan only: ${plans[action]}`);
    return;
  }
  if (action === "start") {
    // Do not accidentally health-check a different Worker already listening here.
    await new Promise<void>((done, reject) => {
      const server = createServer();
      server.once("error", () => reject(new Error("Local port 8787 is unavailable; stop the existing server first")));
      server.listen(8787, "127.0.0.1", () => server.close(error => error ? reject(error) : done()));
    });
  }
  if (target.environment === "prod" && !values["confirm-production"]) {
    if (!process.stdin.isTTY) throw new Error("Production requires --confirm-production in non-interactive mode");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if ((await prompt.question(`Type ${target.name} to ${action} PRODUCTION: `)).trim() !== target.name) throw new Error("Production operation cancelled");
    } finally { prompt.close(); }
  }
  await executeWorkerAction(action, target, migrations, {
    run, health: () => health(target), local: () => local(target),
    backupPath: async () => {
      const root = resolve(workerDir, ".release-backups");
      await mkdir(root, { recursive: true, mode: 0o700 });
      const dir = await mkdtemp(resolve(root, `${target.environment}-`));
      const path = resolve(dir, "database.sql");
      console.log(`Backup will be retained at ${path}`);
      return path;
    },
    verifyBackup: async path => { if ((await stat(path)).size === 0) throw new Error("Empty database backup; release stopped"); },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Release failed"); process.exitCode = 1; });
}
