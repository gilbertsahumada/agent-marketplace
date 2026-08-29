import { randomUUID } from "node:crypto";
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WP2_ATTEMPT_COHORT_SQL } from "../src/evidence/wp2-24h-queries";

const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const DATABASE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

interface CaptureOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly databaseId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => string;
  readonly outputPath: string;
  readonly windowEnd: string;
  readonly windowStart: string;
}

export async function captureWp2Ledger(options: CaptureOptions): Promise<void> {
  if (!ACCOUNT_ID.test(options.accountId)) throw new Error("account ID is invalid");
  if (!DATABASE_ID.test(options.databaseId)) throw new Error("database ID is invalid");
  if (options.apiToken.length === 0) throw new Error("API token is required");
  const start = canonicalTimestamp(options.windowStart, "window start");
  const end = canonicalTimestamp(options.windowEnd, "window end");
  if (end - start !== 24 * 60 * 60_000 || start % (24 * 60 * 60_000) !== 0) {
    throw new Error("window must be one complete UTC day");
  }
  const params = [start, end, start, end] as const;
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const startedTimestamp = canonicalTimestamp(startedAt, "startedAt");
  if (startedTimestamp < end + 15 * 60_000) {
    throw new Error("scheduler ledger capture must follow the terminality grace");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/d1/database/${options.databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: WP2_ATTEMPT_COHORT_SQL, params }),
    },
  );
  const payload = await response.json() as {
    readonly errors?: unknown;
    readonly result?: unknown;
    readonly success?: unknown;
  };
  if (!response.ok || payload.success !== true || !Array.isArray(payload.errors)
    || payload.errors.length !== 0 || !Array.isArray(payload.result) || payload.result.length !== 1) {
    throw new Error("Cloudflare D1 scheduler ledger query failed");
  }
  const result = payload.result[0] as { readonly results?: unknown };
  if (!Array.isArray(result.results)) throw new Error("scheduler ledger rows are missing");
  const completedAt = now();
  const completedTimestamp = canonicalTimestamp(completedAt, "completedAt");
  if (completedTimestamp < startedTimestamp || completedTimestamp - startedTimestamp > 10_000) {
    throw new Error("scheduler ledger capture exceeded its ten-second bound");
  }
  const contents = `${JSON.stringify({
    request: {
      accountId: options.accountId,
      capturedAt: completedAt,
      completedAt,
      databaseId: options.databaseId,
      params,
      sql: WP2_ATTEMPT_COHORT_SQL,
      startedAt,
      windowEnd: options.windowEnd,
      windowStart: options.windowStart,
    },
    response: payload,
  }, null, 2)}\n`;
  await publishCreateOnly(options.outputPath, contents);
}

function canonicalTimestamp(value: string, label: string): number {
  if (new Date(value).toISOString() !== value) throw new Error(`${label} must be canonical UTC`);
  return Date.parse(value);
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
  const [outputPath, windowStart, windowEnd] = process.argv.slice(2);
  if (outputPath === undefined || windowStart === undefined || windowEnd === undefined) {
    throw new Error("usage: tsx scripts/capture-wp2-ledger.ts <output.json> <window-start> <window-end>");
  }
  await captureWp2Ledger({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    databaseId: process.env.WP2_D1_DATABASE_ID ?? "",
    outputPath,
    windowEnd,
    windowStart,
  });
  process.stdout.write(`${resolve(outputPath)}\n`);
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
