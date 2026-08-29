import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const QUEUE_ID = /^[a-f0-9]{32}$/;
const DATABASE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SCRIPT_NAME = /^[a-z0-9-]+$/;
const MODES = new Set(["preflight", "activation", "drain", "cleanup"]);

type ControlMode = "preflight" | "activation" | "drain" | "cleanup";

interface CaptureOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly databaseId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly healthUrl: string;
  readonly mode: ControlMode;
  readonly now?: () => string;
  readonly outputPath: string;
  readonly queueId: string;
  readonly readSecrets: () => Promise<unknown>;
  readonly scriptName: string;
}

export async function captureWp2Control(options: CaptureOptions): Promise<void> {
  validateOptions(options);
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const schedulesUrl = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/workers/scripts/${options.scriptName}/schedules`;
  const settingsUrl = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/workers/scripts/${options.scriptName}/settings`;
  const backlogUrl = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/queues/${options.queueId}/metrics`;
  const startedAt = now();
  canonicalTimestamp(startedAt, "startedAt");
  const headers = { Authorization: `Bearer ${options.apiToken}` };
  const signal = AbortSignal.timeout(10_000);
  const [schedulesResponse, settingsResponse, backlogResponse, healthResponse, secrets] = await Promise.all([
    fetch(schedulesUrl, { headers, signal }),
    fetch(settingsUrl, { headers, signal }),
    fetch(backlogUrl, { headers, signal }),
    fetch(options.healthUrl, { signal }),
    options.readSecrets(),
  ]);
  const [schedules, settings, backlog, health] = await Promise.all([
    parseJsonResponse(schedulesResponse, "schedules"),
    parseJsonResponse(settingsResponse, "settings"),
    parseJsonResponse(backlogResponse, "Queue backlog"),
    parseJsonResponse(healthResponse, "health"),
  ]);
  validateControlState(options.mode, options.databaseId, options.scriptName,
    schedules, settings, backlog, health, secrets);
  const completedAt = now();
  canonicalTimestamp(completedAt, "completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new Error("control capture completed before it started");
  if (Date.parse(completedAt) - Date.parse(startedAt) > 10_000) {
    throw new Error("control capture exceeded its ten-second bound");
  }
  const contents = `${JSON.stringify({
    request: {
      accountId: options.accountId,
      backlogUrl,
      completedAt,
      healthUrl: options.healthUrl,
      mode: options.mode,
      queueId: options.queueId,
      schedulesUrl,
      settingsUrl,
      scriptName: options.scriptName,
      startedAt,
    },
    response: { schedules, settings, backlog, health, secrets },
  }, null, 2)}\n`;
  await publishCreateOnly(options.outputPath, contents);
}

function validateOptions(options: CaptureOptions): void {
  if (!ACCOUNT_ID.test(options.accountId)) throw new Error("account ID is invalid");
  if (!QUEUE_ID.test(options.queueId)) throw new Error("Queue ID is invalid");
  if (!DATABASE_ID.test(options.databaseId)) throw new Error("D1 database ID is invalid");
  if (!SCRIPT_NAME.test(options.scriptName)) throw new Error("script name is invalid");
  if (!MODES.has(options.mode)) throw new Error("control mode is invalid");
  if (options.apiToken.length === 0) throw new Error("API token is required");
  const health = new URL(options.healthUrl);
  if (health.protocol !== "https:" || health.pathname !== "/health" || health.search !== "" || health.hash !== "") {
    throw new Error("health URL must be an exact HTTPS /health endpoint");
  }
}

async function parseJsonResponse(response: Response, label: string): Promise<unknown> {
  const payload = await response.json();
  if (!response.ok) throw new Error(`${label} request failed`);
  return payload;
}

function validateControlState(
  mode: ControlMode,
  databaseId: string,
  scriptName: string,
  schedulesValue: unknown,
  settingsValue: unknown,
  backlogValue: unknown,
  healthValue: unknown,
  secretsValue: unknown,
): void {
  const schedules = object(schedulesValue, "schedules");
  const scheduleResult = object(schedules.result, "schedules result");
  if (schedules.success !== true || !emptyArray(schedules.errors) || !Array.isArray(scheduleResult.schedules)) {
    throw new Error("schedules response is invalid");
  }
  const crons = scheduleResult.schedules.map((entry) => object(entry, "schedule").cron);
  if (crons.some((cron) => typeof cron !== "string")) throw new Error("schedule cron is invalid");
  const producing = mode === "activation";
  const consuming = mode === "activation" || mode === "drain";
  const expectedCrons = producing ? ["*/5 * * * *"] : [];
  if (JSON.stringify(crons) !== JSON.stringify(expectedCrons)) throw new Error(`${mode} schedules are unsafe`);

  const settings = object(settingsValue, "settings");
  const settingsResult = object(settings.result, "settings result");
  if (settings.success !== true || !emptyArray(settings.errors) || !Array.isArray(settingsResult.bindings)) {
    throw new Error("settings response is invalid");
  }
  const bindings = new Map(settingsResult.bindings.map((entry) => {
    const binding = object(entry, "setting binding");
    return [binding.name, binding] as const;
  }));
  for (const [name, expected] of [
    ["DEPLOYMENT_ENV", "staging"],
    ["CLOUDFLARE_WORKERS_PLAN", "free"],
    ["CRON_INTERVAL_MINUTES", "5"],
    ["HEADER_LIMIT", "25"],
    ["SWEEP_LIMIT", "4"],
    ["SWEEP_PAGES_PER_RUN", "1"],
    ["PROBE_BATCH_SIZE", "1"],
    ["TRUST8004_REQUESTS_PER_RUN", "4"],
    ["EXTERNAL_SUBREQUESTS_PER_RUN", "12"],
    ["D1_QUERIES_PER_RUN", "40"],
    ["D1_ROWS_READ_PER_RUN", "3000"],
    ["D1_ROWS_WRITTEN_PER_RUN", "60"],
    ["PROBE_TIMEOUT_MS", "5000"],
    ["MAX_CATALOG_RESPONSE_BYTES", "16777216"],
    ["MAX_SELLER_RESPONSE_BYTES", "32768"],
    ["KILL_SWITCH", consuming ? "0" : "1"],
    ["PRODUCER_KILL_SWITCH", producing ? "0" : "1"],
    ["STAGING_MANUAL_RUN", "0"],
  ] as const) {
    const binding = bindings.get(name);
    if (binding?.type !== "plain_text" || binding.text !== expected) {
      throw new Error(`${mode} ${name} binding is unsafe`);
    }
  }
  const d1Binding = bindings.get("DB");
  const queueBinding = bindings.get("WP2_QUEUE");
  if (d1Binding?.type !== "d1" || d1Binding.id !== databaseId) {
    throw new Error(`${mode} DB binding is unsafe`);
  }
  if (queueBinding?.type !== "queue" || queueBinding.queue_name !== scriptName) {
    throw new Error(`${mode} WP2_QUEUE binding is unsafe`);
  }

  const backlog = object(backlogValue, "Queue backlog");
  const backlogResult = object(backlog.result, "Queue backlog result");
  const backlogCount = backlogResult.backlog_count;
  const backlogBytes = backlogResult.backlog_bytes;
  if (backlog.success !== true || !emptyArray(backlog.errors)
    || !Number.isSafeInteger(backlogCount) || (backlogCount as number) < 0
    || !Number.isSafeInteger(backlogBytes) || (backlogBytes as number) < 0
    || (mode !== "drain" && (backlogCount !== 0 || backlogBytes !== 0))) {
    throw new Error(`${mode} Queue backlog is invalid`);
  }

  const health = object(healthValue, "health");
  const budgets = object(health.budgets, "health budgets");
  const expectedBudgets: Readonly<Record<string, number>> = {
    cronIntervalMinutes: 5, headerLimit: 25, sweepLimit: 4, sweepPagesPerRun: 1,
    probeBatchSize: 1, trust8004RequestsPerRun: 4, externalSubrequestsPerRun: 12,
    d1QueriesPerRun: 40, d1RowsReadPerRun: 3000, d1RowsWrittenPerRun: 60,
    probeTimeoutMs: 5000, maxCatalogResponseBytes: 16777216, maxSellerResponseBytes: 32768,
  };
  if (health.plan !== "free" || health.schedulerMode !== "single_phase"
    || Object.entries(expectedBudgets).some(([name, expected]) => budgets[name] !== expected)) {
    throw new Error(`${mode} health does not match the Free profile`);
  }
  if (health.status !== "ok" || health.killSwitch !== !consuming
    || health.producerKillSwitch !== !producing
    || (health.stagingManualRun !== undefined && health.stagingManualRun !== false)) {
    throw new Error(`${mode} health safety state is invalid`);
  }
  if (!Array.isArray(secretsValue)
    || secretsValue.some((entry) => typeof object(entry, "secret").name !== "string")) {
    throw new Error("secret list is invalid");
  }
  if (secretsValue.some((entry) => object(entry, "secret").name === "SHARED_SECRET")) {
    throw new Error("SHARED_SECRET must be absent");
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function emptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function canonicalTimestamp(value: string, label: string): void {
  if (new Date(value).toISOString() !== value) throw new Error(`${label} must be canonical UTC`);
}

async function publishCreateOnly(outputPath: string, contents: string): Promise<void> {
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  try {
    await link(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const [mode, outputPath] = process.argv.slice(2);
  if (!MODES.has(mode ?? "") || outputPath === undefined) {
    throw new Error("usage: tsx scripts/capture-wp2-control.ts <preflight|activation|drain|cleanup> <output.json>");
  }
  await captureWp2Control({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    databaseId: process.env.WP2_D1_DATABASE_ID ?? "",
    healthUrl: process.env.WP2_HEALTH_URL ?? "",
    mode: mode as ControlMode,
    outputPath,
    queueId: process.env.WP2_QUEUE_ID ?? "",
    readSecrets: async () => {
      const { stdout } = await execFile(
        "wrangler",
        ["secret", "list", "--env", "staging", "--format", "json"],
        {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
        },
      );
      return JSON.parse(stdout);
    },
    scriptName: process.env.WP2_SCRIPT_NAME ?? "bnb-agent-probe-staging",
  });
  process.stdout.write(`${resolve(outputPath)}\n`);
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
