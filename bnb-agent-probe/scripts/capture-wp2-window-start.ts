import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PHASES = new Set(["header", "sweep", "probe"]);
const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const DATABASE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PHASE_SQL = "SELECT key, textValue AS value, integerValue FROM runtime_state WHERE key IN (?, ?) ORDER BY key ASC";
const PHASE_PARAMS = ["last_queue_scheduled_time", "next_scheduler_phase"] as const;

interface CaptureOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly databaseId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => string;
  readonly outputPath: string;
}

export async function captureWp2WindowStart(options: CaptureOptions): Promise<void> {
  if (!ACCOUNT_ID.test(options.accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID is invalid");
  if (!DATABASE_ID.test(options.databaseId)) throw new Error("WP2_D1_DATABASE_ID is invalid");
  if (options.apiToken.length === 0) throw new Error("CLOUDFLARE_API_TOKEN is required");
  if (options.outputPath.length === 0) throw new Error("output path is required");

  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/d1/database/${options.databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: PHASE_SQL,
        params: PHASE_PARAMS,
      }),
    },
  );
  const payload = await response.json() as {
    readonly success?: unknown;
    readonly errors?: unknown;
    readonly result?: unknown;
  };
  if (!response.ok
    || payload.success !== true
    || !Array.isArray(payload.errors)
    || payload.errors.length !== 0
    || !Array.isArray(payload.result)
    || payload.result.length !== 1) {
    throw new Error("Cloudflare D1 window-start query failed");
  }
  const result = payload.result[0] as { readonly results?: unknown };
  if (!Array.isArray(result.results) || result.results.length !== 2) {
    throw new Error("D1 did not return the phase and final pre-window tick rows");
  }
  const rows = new Map(result.results.map((row) => {
    const parsed = row as { readonly key?: unknown };
    return [parsed.key, row] as const;
  }));
  const phase = rows.get("next_scheduler_phase") as { readonly value?: unknown } | undefined;
  const finalTick = rows.get("last_queue_scheduled_time") as { readonly integerValue?: unknown } | undefined;
  if (typeof phase?.value !== "string" || !PHASES.has(phase.value)) {
    throw new Error("D1 returned an invalid next_scheduler_phase");
  }
  if (!Number.isSafeInteger(finalTick?.integerValue) || (finalTick?.integerValue as number) < 0) {
    throw new Error("D1 returned an invalid last_queue_scheduled_time");
  }

  const completedAt = now();
  for (const [label, timestamp] of [["startedAt", startedAt], ["completedAt", completedAt]] as const) {
    if (new Date(timestamp).toISOString() !== timestamp) throw new Error(`${label} is not canonical UTC`);
  }
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new Error("capture completed before it started");
  const output = `${JSON.stringify({
    request: {
      accountId: options.accountId,
      capturedAt: completedAt,
      completedAt,
      databaseId: options.databaseId,
      params: PHASE_PARAMS,
      sql: PHASE_SQL,
      startedAt,
    },
    response: payload,
  }, null, 2)}\n`;
  const targetPath = resolve(options.outputPath);
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, output, { encoding: "utf8", flag: "wx" });
  try {
    await link(temporaryPath, targetPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const outputPath = process.argv[2];
  if (outputPath === undefined) {
    throw new Error("usage: tsx scripts/capture-wp2-window-start.ts <output.json>");
  }
  await captureWp2WindowStart({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    databaseId: process.env.WP2_D1_DATABASE_ID ?? "",
    outputPath,
  });
  process.stdout.write(`${resolve(outputPath)}\n`);
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
