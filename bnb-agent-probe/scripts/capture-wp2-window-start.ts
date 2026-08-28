import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PHASES = new Set(["header", "sweep", "probe"]);
const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const DATABASE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

interface CaptureOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly capturedAt?: () => string;
  readonly databaseId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly outputPath: string;
}

export async function captureWp2WindowStart(options: CaptureOptions): Promise<void> {
  if (!ACCOUNT_ID.test(options.accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID is invalid");
  if (!DATABASE_ID.test(options.databaseId)) throw new Error("WP2_D1_DATABASE_ID is invalid");
  if (options.apiToken.length === 0) throw new Error("CLOUDFLARE_API_TOKEN is required");
  if (options.outputPath.length === 0) throw new Error("output path is required");

  const fetch = options.fetch ?? globalThis.fetch;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/d1/database/${options.databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "SELECT key, textValue AS value FROM runtime_state WHERE key = ? LIMIT 1",
        params: ["next_scheduler_phase"],
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
  if (!Array.isArray(result.results) || result.results.length !== 1) {
    throw new Error("D1 did not return one next_scheduler_phase row");
  }
  const row = result.results[0] as { readonly key?: unknown; readonly value?: unknown };
  if (row.key !== "next_scheduler_phase" || typeof row.value !== "string" || !PHASES.has(row.value)) {
    throw new Error("D1 returned an invalid next_scheduler_phase");
  }

  const capturedAt = (options.capturedAt ?? (() => new Date().toISOString()))();
  if (new Date(capturedAt).toISOString() !== capturedAt) throw new Error("capturedAt is not canonical UTC");
  const output = `${JSON.stringify({ request: { capturedAt }, response: payload }, null, 2)}\n`;
  await mkdir(dirname(resolve(options.outputPath)), { recursive: true });
  await writeFile(resolve(options.outputPath), output, { encoding: "utf8", flag: "wx" });
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
