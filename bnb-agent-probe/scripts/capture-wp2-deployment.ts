import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const COMMIT = /^[a-f0-9]{40}$/;
const ETAG = /^[a-f0-9]{64}$/;
const SCRIPT_NAME = /^[a-z0-9-]+$/;
const VERSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

interface CaptureOptions {
  readonly commit: string;
  readonly drainVersionIds: readonly string[];
  readonly measuredVersionId: string;
  readonly outputPath: string;
  readonly readVersion: (versionId: string) => Promise<unknown>;
  readonly scriptName: string;
}

export async function captureWp2Deployment(options: CaptureOptions): Promise<void> {
  if (!COMMIT.test(options.commit)) throw new Error("commit must be a full lowercase Git SHA");
  if (!SCRIPT_NAME.test(options.scriptName)) throw new Error("script name is invalid");
  if (!VERSION_ID.test(options.measuredVersionId)) throw new Error("measured version ID is invalid");
  if (options.drainVersionIds.length === 0
    || options.drainVersionIds.some((id) => !VERSION_ID.test(id))) {
    throw new Error("at least one valid drain version ID is required");
  }
  const ids = [options.measuredVersionId, ...options.drainVersionIds];
  if (new Set(ids).size !== ids.length) throw new Error("version IDs must be unique");

  const [measured, ...drainVersions] = await Promise.all(ids.map((id) => options.readVersion(id)));
  const measuredEtag = validateVersion(
    measured,
    options.measuredVersionId,
    options.commit,
    false,
  );
  for (const [index, version] of drainVersions.entries()) {
    const etag = validateVersion(version, options.drainVersionIds[index]!, options.commit, true);
    if (etag !== measuredEtag) throw new Error("drain version bundle differs from measured bundle");
  }

  const output = `${JSON.stringify({
    request: {
      scriptName: options.scriptName,
      measuredVersionId: options.measuredVersionId,
      drainVersionIds: options.drainVersionIds,
    },
    response: { measured, drainVersions },
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

function validateVersion(value: unknown, id: string, commit: string, drain: boolean): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("version response is invalid");
  }
  const version = value as Record<string, unknown>;
  const annotations = version.annotations as Record<string, unknown> | undefined;
  const resources = version.resources as Record<string, unknown> | undefined;
  const script = resources?.script as Record<string, unknown> | undefined;
  const tag = annotations?.["workers/tag"];
  const prefix = `git-${commit.slice(0, 12)}`;
  if (version.id !== id
    || annotations?.["workers/message"] !== `git_commit=${commit}`
    || typeof tag !== "string"
    || (drain ? !tag.startsWith(`${prefix}-`) : tag !== prefix)
    || typeof script?.etag !== "string"
    || !ETAG.test(script.etag)) {
    throw new Error("version response does not match deployment provenance");
  }
  return script.etag;
}

async function main(): Promise<void> {
  const [outputPath, scriptName, commit, measuredVersionId, ...drainVersionIds] = process.argv.slice(2);
  if (outputPath === undefined || scriptName === undefined || commit === undefined
    || measuredVersionId === undefined || drainVersionIds.length === 0) {
    throw new Error(
      "usage: tsx scripts/capture-wp2-deployment.ts <output.json> <script> <commit> <measured-id> <drain-id...>",
    );
  }
  await captureWp2Deployment({
    commit,
    drainVersionIds,
    measuredVersionId,
    outputPath,
    readVersion: async (versionId) => {
      const { stdout } = await execFile(
        "wrangler",
        ["versions", "view", versionId, "--env", "staging", "--json"],
        { cwd: process.cwd(), maxBuffer: 8 * 1_024 * 1_024 },
      );
      return JSON.parse(stdout);
    },
    scriptName,
  });
  process.stdout.write(`${resolve(outputPath)}\n`);
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
