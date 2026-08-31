import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  runCatalogSnapshot,
  type CatalogSnapshotCheckpoint,
  type CatalogSnapshotPage,
} from "./catalog-snapshot.ts";

const BASE_URL = "https://trust8004.xyz";
const PAGE_SIZE = 2_000;
const MINIMUM_INTERVAL_MS = 1_100;
const MAX_RESPONSE_BYTES = 16 * 1_024 * 1_024;

interface CliOptions {
  output: string;
  checkpoint: string;
  resume: boolean;
}

function filenameTimestamp(timestamp: string): string {
  return timestamp.replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
}

export function parseCatalogSnapshotCliOptions(args: string[], generatedAt: string): CliOptions {
  let output = resolve(`evidence/catalog-v2-bsc-${filenameTimestamp(generatedAt)}.json`);
  let checkpoint: string | undefined;
  let resume = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--resume") {
      resume = true;
      continue;
    }
    if (argument !== "--output" && argument !== "--checkpoint") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a file path`);
    if (argument === "--output") output = resolve(value);
    else checkpoint = resolve(value);
    index += 1;
  }
  return { output, checkpoint: checkpoint ?? `${output}.checkpoint.json`, resume };
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("CATALOG_RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("CATALOG_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new Error("CATALOG_INVALID_JSON");
  }
}

function page(value: unknown, expectedOffset: number): CatalogSnapshotPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CATALOG_SCHEMA:response");
  const response = value as Record<string, unknown>;
  if (!Array.isArray(response.items)
    || typeof response.total !== "number"
    || typeof response.offset !== "number"
    || typeof response.limit !== "number") {
    throw new Error("CATALOG_SCHEMA:page");
  }
  if (response.offset !== expectedOffset) throw new Error("CATALOG_PAGE_OFFSET_MISMATCH");
  return response as unknown as CatalogSnapshotPage;
}

function createPageFetcher(fetchImpl: typeof fetch = fetch): (offset: number, limit: number) => Promise<CatalogSnapshotPage> {
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  return async (offset, limit) => {
    const remaining = MINIMUM_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (remaining > 0) await new Promise<void>((done) => setTimeout(done, remaining));
    lastRequestAt = Date.now();
    const url = new URL("/api/app/agents", BASE_URL);
    url.search = new URLSearchParams({
      chainId: "56",
      limit: String(limit),
      offset: String(offset),
      includeReputation: "false",
      includeCategoryCounts: "false",
      includeMetadataReasonCounts: "false",
      includeTotal: "true",
      sortBy: "registered",
      sortOrder: "asc",
    }).toString();
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`CATALOG_HTTP:${response.status}`);
    return page(await boundedJson(response), offset);
  };
}

async function writeAtomic(destination: string, contents: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, destination);
}

async function writeExclusive(destination: string, contents: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function readCheckpoint(path: string): Promise<CatalogSnapshotCheckpoint> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as CatalogSnapshotCheckpoint;
  if (parsed.schemaVersion !== 2) throw new Error("CATALOG_CHECKPOINT_INVALID");
  return parsed;
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const options = parseCatalogSnapshotCliOptions(process.argv.slice(2), generatedAt);
  const resume = options.resume ? await readCheckpoint(options.checkpoint) : undefined;
  const snapshot = await runCatalogSnapshot({
    generatedAt,
    pageSize: PAGE_SIZE,
    ...(resume ? { resume } : {}),
    fetchPage: createPageFetcher(),
    onCheckpoint: async (checkpoint) => {
      if (checkpoint.pages % 5 !== 0 && checkpoint.nextOffset !== checkpoint.expectedTotal) return;
      await writeAtomic(options.checkpoint, `${JSON.stringify(checkpoint)}\n`);
      process.stdout.write(
        `Catalog v2 progress: ${checkpoint.nextOffset}/${checkpoint.expectedTotal ?? "unknown"}\n`,
      );
    },
  });
  await writeExclusive(options.output, `${JSON.stringify(snapshot)}\n`);
  await unlink(options.checkpoint).catch(() => undefined);
  process.stdout.write(
    `Catalog v2 snapshot: ${options.output}\n`
      + `registered=${snapshot.stats.registered} candidates=${snapshot.stats.candidates} `
      + `declarations=${snapshot.stats.declarations}\n`
      + `sourceSha256=${snapshot.sourceSha256}\n`,
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
