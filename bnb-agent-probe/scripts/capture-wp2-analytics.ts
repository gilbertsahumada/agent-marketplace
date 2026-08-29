import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WP2_D1_ACCOUNT_ANALYTICS_QUERY,
  WP2_D1_DATABASE_ANALYTICS_QUERY,
  WP2_QUEUE_ACCOUNT_ANALYTICS_QUERY,
  WP2_QUEUE_ANALYTICS_QUERY,
  WP2_WORKERS_ANALYTICS_QUERY,
} from "../src/evidence/wp2-24h-queries";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const ACCOUNT_ID = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SCRIPT_NAME = /^[a-z0-9-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface CaptureOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly databaseId: string;
  readonly date: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => string;
  readonly outputDirectory: string;
  readonly queueId: string;
  readonly scriptName: string;
  readonly terminalityEndInclusive: string;
}

interface QueryDefinition {
  readonly name: string;
  readonly query: string;
  readonly request: Readonly<Record<string, string>>;
  readonly variables: Readonly<Record<string, string>>;
}

export async function captureWp2Analytics(options: CaptureOptions): Promise<void> {
  validateOptions(options);
  const start = `${options.date}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 24 * 60 * 60_000);
  const endInclusive = new Date(end.getTime() - 1).toISOString();
  if (Date.parse(options.terminalityEndInclusive) < end.getTime() + 15 * 60_000) {
    throw new Error("terminality cutoff must include at least 15 minutes of grace");
  }
  const common = { accountTag: options.accountId };
  const definitions: readonly QueryDefinition[] = [
    {
      name: "d1-database",
      query: WP2_D1_DATABASE_ANALYTICS_QUERY,
      request: { date: options.date, databaseId: options.databaseId },
      variables: { ...common, date: options.date, databaseId: options.databaseId },
    },
    {
      name: "d1-account",
      query: WP2_D1_ACCOUNT_ANALYTICS_QUERY,
      request: { date: options.date },
      variables: { ...common, date: options.date },
    },
    {
      name: "workers",
      query: WP2_WORKERS_ANALYTICS_QUERY,
      request: { scriptName: options.scriptName, start, endInclusive,
        terminalityEndInclusive: options.terminalityEndInclusive },
      variables: { ...common, scriptName: options.scriptName, start,
        terminalityEndInclusive: options.terminalityEndInclusive },
    },
    {
      name: "queue",
      query: WP2_QUEUE_ANALYTICS_QUERY,
      request: { queueId: options.queueId, start, endInclusive,
        terminalityEndInclusive: options.terminalityEndInclusive },
      variables: { ...common, queueId: options.queueId, start, endInclusive,
        terminalityEndInclusive: options.terminalityEndInclusive },
    },
    {
      name: "queue-account",
      query: WP2_QUEUE_ACCOUNT_ANALYTICS_QUERY,
      request: { start, endInclusive },
      variables: { ...common, start, endInclusive },
    },
  ];
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const captureId = randomUUID();
  const outputs: Array<{ name: string; contents: string }> = [];
  for (const definition of definitions) {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: definition.query, variables: definition.variables }),
    });
    const payload = await response.json() as { readonly data?: unknown; readonly errors?: unknown };
    if (!response.ok || payload.data === undefined
      || (payload.errors !== null && payload.errors !== undefined
        && (!Array.isArray(payload.errors) || payload.errors.length !== 0))) {
      throw new Error(`${definition.name} GraphQL capture failed`);
    }
    if (definition.name === "queue") validateSuccessfulDeletes(payload.data);
    const capturedAt = now();
    canonicalTimestamp(capturedAt, "capturedAt");
    outputs.push({
      name: definition.name,
      contents: `${JSON.stringify({
        request: {
          accountId: options.accountId,
          captureId,
          capturedAt,
          endpoint: GRAPHQL_ENDPOINT,
          query: definition.query,
          variables: definition.variables,
          ...definition.request,
        },
        response: payload,
      }, null, 2)}\n`,
    });
  }
  await publishCreateOnly(options.outputDirectory, outputs);
}

function validateOptions(options: CaptureOptions): void {
  if (!ACCOUNT_ID.test(options.accountId)) throw new Error("account ID is invalid");
  if (!UUID.test(options.databaseId)) throw new Error("database ID is invalid");
  if (!ACCOUNT_ID.test(options.queueId)) throw new Error("Queue ID is invalid");
  if (!SCRIPT_NAME.test(options.scriptName)) throw new Error("script name is invalid");
  if (!DATE.test(options.date) || new Date(`${options.date}T00:00:00.000Z`).toISOString().slice(0, 10) !== options.date) {
    throw new Error("date must be a valid UTC date");
  }
  if (options.apiToken.length === 0) throw new Error("API token is required");
  if (options.outputDirectory.length === 0) throw new Error("output directory is required");
  canonicalTimestamp(options.terminalityEndInclusive, "terminality cutoff");
}

function canonicalTimestamp(value: string, label: string): void {
  if (new Date(value).toISOString() !== value) throw new Error(`${label} must be canonical UTC`);
}

async function publishCreateOnly(
  outputDirectory: string,
  outputs: readonly { readonly name: string; readonly contents: string }[],
): Promise<void> {
  const directory = resolve(outputDirectory);
  const temporary = `${directory}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(temporary);
  try {
    const files: Record<string, string> = {};
    for (const output of outputs) {
      const filename = `${output.name}.json`;
      files[filename] = createHash("sha256").update(output.contents).digest("hex");
      await writeFile(resolve(temporary, filename), output.contents, { encoding: "utf8", flag: "wx" });
    }
    const first = JSON.parse(outputs[0]!.contents) as { request: { captureId: string } };
    await writeFile(resolve(temporary, "analytics-manifest.json"), `${JSON.stringify({
      schemaVersion: 1,
      captureId: first.request.captureId,
      files,
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, directory);
  } finally {
    await rm(temporary, { force: true, recursive: true }).catch(() => undefined);
  }
}

function validateSuccessfulDeletes(value: unknown): void {
  const data = value as {
    readonly viewer?: { readonly accounts?: readonly [{
      readonly queueTerminalOperations?: ReadonlyArray<{
        readonly count?: unknown;
        readonly dimensions?: { readonly actionType?: unknown; readonly outcome?: unknown };
      }>;
    }] };
  };
  const groups = data.viewer?.accounts?.[0]?.queueTerminalOperations;
  if (!Array.isArray(groups)) throw new Error("Queue Analytics is missing terminal operations");
  let deletes = 0;
  for (const group of groups) {
    if (group.dimensions?.actionType !== "DeleteMessage") continue;
    if (typeof group.dimensions.outcome !== "string"
      || group.dimensions.outcome.toLowerCase() !== "success"
      || !Number.isSafeInteger(group.count) || (group.count as number) < 0) {
      throw new Error("Queue Analytics contains an invalid terminal delete");
    }
    deletes += group.count as number;
  }
  if (deletes !== 288) throw new Error("Queue Analytics must contain 288 successful deletes");
}

async function main(): Promise<void> {
  const [outputDirectory, date, terminalityEndInclusive] = process.argv.slice(2);
  if (outputDirectory === undefined || date === undefined || terminalityEndInclusive === undefined) {
    throw new Error("usage: tsx scripts/capture-wp2-analytics.ts <output-directory> <YYYY-MM-DD> <terminality-end-inclusive>");
  }
  await captureWp2Analytics({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    databaseId: process.env.WP2_D1_DATABASE_ID ?? "",
    date,
    outputDirectory,
    queueId: process.env.WP2_QUEUE_ID ?? "",
    scriptName: process.env.WP2_SCRIPT_NAME ?? "bnb-agent-probe-staging",
    terminalityEndInclusive,
  });
  process.stdout.write(`${resolve(outputDirectory)}\n`);
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
